"""Build species sets ("decks") in three ways:

  * list  - from a pasted list of names (scientific or common) or taxon ids
  * taxon - the most-observed species within a taxon, e.g. genus Turdus
  * place - the most-observed species in a place (optionally within a taxon)
"""
import json
import time

from .db import get_conn
from .inat_client import get_client
from .taxa import upsert_taxon


class DeckError(ValueError):
    pass


def resolve_name(name: str) -> dict | None:
    """Turn one line of a species list into an iNat taxon (species rank preferred)."""
    name = name.strip()
    if not name:
        return None
    client = get_client()
    if name.isdigit():
        return client.taxon(int(name))
    results = client.search_taxa(name, rank="species") or client.search_taxa(name)
    if not results:
        return None
    lower = name.lower()
    for t in results:
        if t.get("name", "").lower() == lower or (t.get("preferred_common_name") or "").lower() == lower:
            return t
    for t in results:
        if lower in (t.get("matched_term") or "").lower():
            return t
    return results[0]


def _species_from_source(source_type: str, params: dict) -> tuple[list[dict], list[str]]:
    client = get_client()
    limit = max(2, min(int(params.get("limit") or 30), 200))
    if source_type == "list":
        names = params.get("species") or []
        if isinstance(names, str):
            names = [n for n in names.replace(";", "\n").splitlines()]
        found, missing = [], []
        for n in names:
            if not n.strip():
                continue
            t = resolve_name(n)
            (found.append(t) if t else missing.append(n.strip()))
        return found, missing
    if source_type == "taxon":
        if not params.get("taxon_id"):
            raise DeckError("Choose a taxon first.")
        counts = client.species_counts(taxon_id=params["taxon_id"], place_id=params.get("place_id"),
                                       per_page=limit)
        return [c["taxon"] for c in counts[:limit]], []
    if source_type == "place":
        if not params.get("place_id") and params.get("lat") is None:
            raise DeckError("Choose a place first.")
        counts = client.species_counts(
            taxon_id=params.get("taxon_id"), place_id=params.get("place_id"),
            lat=params.get("lat"), lng=params.get("lng"), radius_km=params.get("radius_km"),
            per_page=limit,
        )
        return [c["taxon"] for c in counts[:limit]], []
    raise DeckError(f"Unknown deck type: {source_type}")


def _add_taxa(conn, deck_id: int, taxa: list[dict]) -> int:
    added = 0
    now = time.time()
    for t in taxa:
        upsert_taxon(conn, t)
        cur = conn.execute(
            "INSERT OR IGNORE INTO cards (deck_id, taxon_id, added_at) VALUES (?, ?, ?)",
            (deck_id, t["id"], now),
        )
        added += cur.rowcount
    return added


def create_deck(name: str, source_type: str, params: dict, num_choices: int = 5,
                description: str | None = None) -> dict:
    taxa, missing = _species_from_source(source_type, params)
    if len(taxa) < 1:
        raise DeckError("No species found for that selection.")
    num_choices = max(4, min(int(num_choices), 6))
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO decks (name, description, source_type, source_params, place_id, place_name,
                                  num_choices, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (name.strip() or "Untitled deck", description, source_type, json.dumps(params),
             params.get("place_id"), params.get("place_name"), num_choices, time.time()),
        )
        deck_id = cur.lastrowid
        _add_taxa(conn, deck_id, taxa)
    deck = get_deck(deck_id)
    deck["unmatched"] = missing
    return deck


def add_species(deck_id: int, names: list[str]) -> dict:
    taxa, missing = _species_from_source("list", {"species": names})
    with get_conn() as conn:
        added = _add_taxa(conn, deck_id, taxa)
    return {"added": added, "unmatched": missing}


def remove_card(deck_id: int, taxon_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM cards WHERE deck_id = ? AND taxon_id = ?", (deck_id, taxon_id))


def delete_deck(deck_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))


def _deck_summary(conn, row) -> dict:
    d = dict(row)
    d["source_params"] = json.loads(d["source_params"])
    stats = conn.execute(
        """SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS right FROM reviews WHERE deck_id = ?""",
        (d["id"],),
    ).fetchone()
    d["num_cards"] = conn.execute("SELECT COUNT(*) FROM cards WHERE deck_id = ?", (d["id"],)).fetchone()[0]
    d["num_reviews"] = stats["n"]
    d["accuracy"] = round(stats["right"] / stats["n"], 3) if stats["n"] else None
    return d


def list_decks() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM decks ORDER BY created_at DESC").fetchall()
        return [_deck_summary(conn, r) for r in rows]


def get_deck(deck_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            return None
        d = _deck_summary(conn, row)
        cards = conn.execute(
            """SELECT c.id AS card_id, c.reps, c.lapses, c.state, c.last_review, t.*,
                      (SELECT COUNT(*) FROM reviews r WHERE r.card_id = c.id) AS seen,
                      (SELECT COALESCE(SUM(correct),0) FROM reviews r WHERE r.card_id = c.id) AS right
               FROM cards c JOIN taxa t ON t.id = c.taxon_id
               WHERE c.deck_id = ? ORDER BY t.name""",
            (deck_id,),
        ).fetchall()
        d["cards"] = [
            {
                "card_id": c["card_id"], "taxon_id": c["id"], "name": c["name"],
                "common_name": c["common_name"], "photo_url": c["photo_url"],
                "seen": c["seen"], "right": c["right"],
            }
            for c in cards
        ]
        return d
