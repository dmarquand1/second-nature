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


def ensure_details(taxon_id: int) -> dict:
    """Make sure we know the genus/family/order of a taxon. Returns the DB row as dict."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM taxa WHERE id = ?", (taxon_id,)).fetchone()
    if row and row["details_fetched"]:
        return dict(row)
    t = get_client().taxon(taxon_id)
    if not t:
        return dict(row) if row else {}
    ids = {"genus": None, "family": None, "order": None}
    for a in t.get("ancestors") or []:
        if a.get("rank") in ids:
            ids[a["rank"]] = a["id"]
    with get_conn() as conn:
        upsert_taxon(conn, t)
        conn.execute(
            "UPDATE taxa SET genus_id = ?, family_id = ?, order_id = ?, details_fetched = 1 WHERE id = ?",
            (ids["genus"], ids["family"], ids["order"], taxon_id),
        )
        row = conn.execute("SELECT * FROM taxa WHERE id = ?", (taxon_id,)).fetchone()
    return dict(row)


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
