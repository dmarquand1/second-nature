"""Build and edit species sets ("decks"). Three ways to build one:

  * list  - from a pasted/uploaded list of names (scientific or common) or taxon ids
  * taxon - the most-observed species within a taxon, e.g. genus Turdus
  * place - the most-observed species in a place (optionally within a taxon)

Finding species can take a while (iNaturalist allows ~1 request per second),
so it runs as a background job (see jobs.py) and cards appear as they're found.
"""
import json
import re
import time

from . import config, jobs
from .db import get_conn
from .images import local_url
from .inat_client import InatError, get_client
from .scheduler import queue_counts
from .taxa import upsert_taxon


class DeckError(ValueError):
    pass


# ---- name lookup ---------------------------------------------------------
def clean_names(names) -> list[str]:
    """Split pasted text / CSV lines into names. Takes the first CSV column,
    skips blank lines, comments (#) and a header row, removes duplicates."""
    if isinstance(names, str):
        names = names.splitlines()
    out, seen = [], set()
    for line in names:
        line = str(line).strip().lstrip("﻿")
        if not line or line.startswith("#"):
            continue
        first = re.split(r"[,;\t]", line, maxsplit=1)[0].strip().strip('"').strip()
        if not first or first.lower() in {"name", "species", "scientific_name", "scientific name",
                                          "common_name", "taxon_id", "taxon"}:
            continue
        key = first.lower()
        if key not in seen:
            seen.add(key)
            out.append(first)
    return out


def _local_match(name: str) -> dict | None:
    """Exact match against species we already know (no API call needed)."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT * FROM taxa WHERE rank = 'species'
               AND (name = ? COLLATE NOCASE OR common_name = ? COLLATE NOCASE) LIMIT 1""",
            (name, name),
        ).fetchone()
    if not row:
        return None
    return {"id": row["id"], "name": row["name"], "preferred_common_name": row["common_name"],
            "rank": row["rank"], "iconic_taxon_name": row["iconic_taxon_name"]}


def resolve_name(name: str) -> tuple[dict | None, bool]:
    """Turn one name into an iNat taxon. Returns (taxon, exact) where exact is
    False when we had to take iNaturalist's best guess."""
    name = name.strip()
    if not name:
        return None, True
    local = _local_match(name)
    if local:
        return local, True
    client = get_client()
    results = client.search_taxa(name, rank="species") or client.search_taxa(name)
    if not results:
        return None, True
    lower = name.lower()
    for t in results:
        if t.get("name", "").lower() == lower or (t.get("preferred_common_name") or "").lower() == lower:
            return t, True
    for t in results:
        if (t.get("matched_term") or "").lower() == lower:
            return t, True
    return results[0], False


# ---- adding / removing cards --------------------------------------------
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


def _card_count(deck_id: int) -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM cards WHERE deck_id = ?", (deck_id,)).fetchone()[0]


@jobs.handler("build")
def _build_job(job_id: int, deck_id: int, params: dict, progress) -> dict:
    """Background job: find species and add them to the deck as they're found."""
    client = get_client()
    source = params.get("source_type", "list")
    room = config.MAX_DECK_SPECIES - _card_count(deck_id)
    result = {"added": 0, "not_found": [], "guessed": [], "not_species": []}

    def add(taxa):
        species = [t for t in taxa if t.get("rank") == "species"]
        result["not_species"] += [f"{t['name']} ({t.get('rank')})" for t in taxa if t.get("rank") != "species"]
        with get_conn() as conn:
            result["added"] += _add_taxa(conn, deck_id, species)

    if source == "list":
        names = clean_names(params.get("species") or [])[: max(room, 0)]
        total = len(names)
        progress(0, total, f"Looking up {total} names", force=True)
        ids = [n for n in names if n.isdigit()]
        words = [n for n in names if not n.isdigit()]
        done = 0
        if ids:
            found = client.taxa_by_ids([int(i) for i in ids])
            found_ids = {str(t["id"]) for t in found}
            result["not_found"] += [i for i in ids if i not in found_ids]
            add(found)
            done += len(ids)
            progress(done, total, force=True)
        batch = []
        for name in words:
            try:
                taxon, exact = resolve_name(name)
            except InatError as exc:
                result["not_found"].append(f"{name} (error: {exc})")
                taxon, exact = None, True
            if taxon is None:
                result["not_found"].append(name)
            else:
                if not exact:
                    result["guessed"].append({"input": name, "name": taxon["name"],
                                              "common_name": taxon.get("preferred_common_name")})
                batch.append(taxon)
            done += 1
            # Add the very first species at once (so the first question can start), then in tens.
            if len(batch) >= (1 if result["added"] == 0 else 10):
                add(batch)
                batch = []
            progress(done, total, f"Looked up {done} of {total} names")
        add(batch)
        progress(total, total, force=True)
    else:
        limit = max(2, min(int(params.get("limit") or 30), room))
        progress(0, limit, "Asking iNaturalist for the most-observed species", force=True)
        if params.get("lat") is not None and not params.get("place_id"):
            counts = client.species_counts(taxon_id=params.get("taxon_id"), lat=params["lat"],
                                           lng=params["lng"], radius_km=params.get("radius_km"),
                                           per_page=min(limit, 500))
        else:
            counts = client.species_counts_many(
                limit, progress=lambda n: progress(n, limit, f"Found {n} species"),
                taxon_id=params.get("taxon_id"), place_id=params.get("place_id"))
        add([c["taxon"] for c in counts[:limit]])
        progress(limit, limit, force=True)

    # Get photos and look-alikes ready for studying.
    jobs.submit("warmup", deck_id, {}, dedupe=True)
    return result


def _validate_source(source_type: str, params: dict) -> None:
    if source_type == "list":
        if not clean_names(params.get("species") or []):
            raise DeckError("Add at least one species name.")
    elif source_type == "taxon":
        if not params.get("taxon_id"):
            raise DeckError("Choose a group (taxon) first.")
    elif source_type == "place":
        if not params.get("place_id") and params.get("lat") is None:
            raise DeckError("Choose a place first.")
    else:
        raise DeckError(f"Unknown deck type: {source_type}")


def create_deck(name: str, source_type: str, params: dict, num_choices: int = 5,
                description: str | None = None, new_per_day: int = config.DEFAULT_NEW_PER_DAY,
                hide_dead: bool = True, photo_choice: str = "mixed", answer_source: str = "anywhere") -> dict:
    """Create the deck straight away and find its species in the background."""
    _validate_source(source_type, params)
    num_choices = max(4, min(int(num_choices), 6))
    stored = {k: v for k, v in params.items() if k != "species"}
    if source_type == "list":
        stored["count"] = len(clean_names(params.get("species") or []))
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO decks (name, description, source_type, source_params, place_id, place_name,
                                  num_choices, new_per_day, hide_dead, photo_choice, answer_source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name.strip() or "Untitled deck", description, source_type, json.dumps(stored),
             params.get("place_id"), params.get("place_name"), num_choices, int(new_per_day),
             1 if hide_dead else 0, photo_choice if photo_choice in config.PHOTO_CHOICES else "mixed",
             answer_source if answer_source in config.ANSWER_SOURCES else "anywhere", time.time()),
        )
        deck_id = cur.lastrowid
    job_id = jobs.submit("build", deck_id, {"source_type": source_type, **params})
    deck = get_deck(deck_id)
    deck["job_id"] = job_id
    return deck


def add_species(deck_id: int, names) -> dict:
    """Add names (pasted or from a file) in the background. Returns the job."""
    names = clean_names(names)
    if not names:
        raise DeckError("Add at least one species name.")
    job_id = jobs.submit("build", deck_id, {"source_type": "list", "species": names})
    return {"job_id": job_id, "count": len(names)}


def add_taxa_ids(deck_id: int, taxon_ids: list[int]) -> dict:
    """Add species picked from the search box (we already know their ids)."""
    found = get_client().taxa_by_ids(taxon_ids)
    species = [t for t in found if t.get("rank") == "species"]
    with get_conn() as conn:
        added = _add_taxa(conn, deck_id, species)
    skipped = [f"{t['name']} ({t.get('rank')})" for t in found if t.get("rank") != "species"]
    jobs.submit("warmup", deck_id, {}, dedupe=True)
    return {"added": added, "not_species": skipped}


def remove_cards(deck_id: int, taxon_ids: list[int]) -> int:
    with get_conn() as conn:
        cur = conn.executemany("DELETE FROM cards WHERE deck_id = ? AND taxon_id = ?",
                               [(deck_id, int(t)) for t in taxon_ids])
        return cur.rowcount


def update_settings(deck_id: int, name: str | None = None, num_choices: int | None = None,
                    new_per_day: int | None = None, description: str | None = None,
                    place_id: int | None = None, place_name: str | None = None,
                    clear_place: bool = False, hide_dead: bool | None = None,
                    photo_choice: str | None = None, answer_source: str | None = None) -> None:
    with get_conn() as conn:
        if name is not None and name.strip():
            conn.execute("UPDATE decks SET name = ? WHERE id = ?", (name.strip(), deck_id))
        if description is not None:
            conn.execute("UPDATE decks SET description = ? WHERE id = ?", (description.strip() or None, deck_id))
        if num_choices is not None:
            conn.execute("UPDATE decks SET num_choices = ? WHERE id = ?", (max(4, min(num_choices, 6)), deck_id))
        if new_per_day is not None:
            conn.execute("UPDATE decks SET new_per_day = ? WHERE id = ?", (max(0, new_per_day), deck_id))
        if photo_choice in config.PHOTO_CHOICES:
            conn.execute("UPDATE decks SET photo_choice = ? WHERE id = ?", (photo_choice, deck_id))
        if answer_source in config.ANSWER_SOURCES:
            conn.execute("UPDATE decks SET answer_source = ? WHERE id = ?", (answer_source, deck_id))
        if hide_dead is not None:
            conn.execute("UPDATE decks SET hide_dead = ? WHERE id = ?", (1 if hide_dead else 0, deck_id))
        if clear_place:
            conn.execute("UPDATE decks SET place_id = NULL, place_name = NULL WHERE id = ?", (deck_id,))
        elif place_id is not None:
            conn.execute("UPDATE decks SET place_id = ?, place_name = ? WHERE id = ?",
                         (place_id, place_name, deck_id))
    if clear_place or place_id is not None:
        jobs.submit("warmup", deck_id, {}, dedupe=True)


def delete_deck(deck_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))


# ---- reading ---------------------------------------------------------------
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
    d["queue"] = queue_counts(conn, d["id"])
    d["building"] = conn.execute(
        "SELECT 1 FROM jobs WHERE deck_id = ? AND kind = 'build' AND status IN ('queued', 'running')",
        (d["id"],),
    ).fetchone() is not None
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
            """SELECT c.id AS card_id, c.lapses, c.state AS card_state, c.due, c.stability, t.*,
                      COALESCE(r.seen, 0) AS seen, COALESCE(r.right, 0) AS right
               FROM cards c JOIN taxa t ON t.id = c.taxon_id
               LEFT JOIN (SELECT card_id, COUNT(*) AS seen, SUM(correct) AS right
                          FROM reviews GROUP BY card_id) r ON r.card_id = c.id
               WHERE c.deck_id = ? ORDER BY t.name""",
            (deck_id,),
        ).fetchall()
        d["cards"] = [
            {
                "card_id": c["card_id"], "taxon_id": c["id"], "name": c["name"],
                "common_name": c["common_name"], "photo_url": local_url(c["photo_url"]),
                "seen": c["seen"], "right": c["right"], "lapses": c["lapses"],
                "state": c["card_state"], "due": c["due"], "stability": c["stability"],
            }
            for c in cards
        ]
    d["jobs"] = jobs.deck_jobs(deck_id)
    return d
