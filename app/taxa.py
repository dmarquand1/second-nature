"""Store and look up taxa locally (names, photos, genus/family/order ids)."""
import json
import time

from .db import get_conn
from .inat_client import get_client


def _photo(t: dict) -> str | None:
    p = t.get("default_photo") or {}
    return p.get("medium_url") or p.get("square_url") or p.get("url")


def upsert_taxon(conn, t: dict) -> None:
    """Save the basic fields of an iNat taxon object (from any endpoint)."""
    conn.execute(
        """
        INSERT INTO taxa (id, name, common_name, rank, iconic_taxon_name, ancestor_ids,
                          photo_url, wikipedia_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            common_name = COALESCE(excluded.common_name, taxa.common_name),
            rank = excluded.rank,
            iconic_taxon_name = COALESCE(excluded.iconic_taxon_name, taxa.iconic_taxon_name),
            ancestor_ids = COALESCE(excluded.ancestor_ids, taxa.ancestor_ids),
            photo_url = COALESCE(excluded.photo_url, taxa.photo_url),
            wikipedia_url = COALESCE(excluded.wikipedia_url, taxa.wikipedia_url),
            updated_at = excluded.updated_at
        """,
        (
            t["id"], t["name"], t.get("preferred_common_name"), t.get("rank"),
            t.get("iconic_taxon_name"),
            json.dumps(t["ancestor_ids"]) if t.get("ancestor_ids") else None,
            _photo(t), t.get("wikipedia_url"), time.time(),
        ),
    )


RANKS = ("genus", "family", "order")


def _save_details(t: dict, rank_of: dict[int, tuple[str, int]] | None = None) -> None:
    """Store a taxon with its genus/family/order ids.
    Uses t["ancestors"] when iNat includes it, otherwise `rank_of` (ancestor id -> rank)."""
    ids = dict.fromkeys(RANKS)
    if t.get("ancestors"):
        for a in t["ancestors"]:
            if a.get("rank") in ids:
                ids[a["rank"]] = a["id"]
    elif rank_of:
        for aid in t.get("ancestor_ids") or []:
            rank = rank_of.get(aid)
            if rank in ids:
                ids[rank] = aid
    with get_conn() as conn:
        upsert_taxon(conn, t)
        conn.execute(
            "UPDATE taxa SET genus_id = ?, family_id = ?, order_id = ?, details_fetched = 1 WHERE id = ?",
            (ids["genus"], ids["family"], ids["order"], t["id"]),
        )


def ensure_details(taxon_id: int) -> dict:
    """Make sure we know the genus/family/order of a taxon. Returns the DB row as dict."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM taxa WHERE id = ?", (taxon_id,)).fetchone()
    if row and row["details_fetched"]:
        return dict(row)
    ensure_details_many([taxon_id])
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM taxa WHERE id = ?", (taxon_id,)).fetchone()
    return dict(row) if row else {}


def ensure_details_many(taxon_ids: list[int]) -> int:
    """Fetch genus/family/order for many taxa at once: 30 per iNaturalist request
    instead of one request each. Returns how many were fetched."""
    with get_conn() as conn:
        done = {r[0] for r in conn.execute(
            f"SELECT id FROM taxa WHERE details_fetched = 1 AND id IN ({','.join('?' * len(taxon_ids))})",
            list(taxon_ids)).fetchall()} if taxon_ids else set()
    todo = [int(t) for t in dict.fromkeys(taxon_ids) if int(t) not in done]
    if not todo:
        return 0
    client = get_client()
    found = client.taxa_by_ids(todo)
    # If iNat left out the ancestor list, look the ancestors up too (also batched,
    # and shared: all thrushes have the same genus, family and order).
    missing = {aid for t in found if not t.get("ancestors") for aid in (t.get("ancestor_ids") or [])
               if aid != t["id"]}
    rank_of = {}
    if missing:
        rank_of = {a["id"]: a.get("rank") for a in client.taxa_by_ids(sorted(missing))}
    for t in found:
        _save_details(t, rank_of)
    return len(found)


def get_taxon(conn, taxon_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM taxa WHERE id = ?", (taxon_id,)).fetchone()
    return dict(row) if row else None


def public(t: dict) -> dict:
    """The fields the frontend needs to show a taxon."""
    return {
        "id": t["id"],
        "name": t["name"],
        "common_name": t.get("common_name"),
        "rank": t.get("rank"),
        "photo_url": t.get("photo_url"),
        "url": f"https://www.inaturalist.org/taxa/{t['id']}",
        "wikipedia_url": t.get("wikipedia_url"),
    }
