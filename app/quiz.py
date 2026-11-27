"""Build quiz questions and check answers."""
import json
import math
import random
import time

from . import config
from .db import get_conn
from .distractors import pick_distractors
from .inat_client import get_client
from .fsrs import CardState
from .scheduler import (apply_rating, fsrs, pick_next_card, queue_counts, rating_from_answer,
                        restore_state, save_state, state_json, to_state)
from .images import local_url
from .taxa import get_taxon, public


class QuizError(Exception):
    pass


def licence_info(code: str | None) -> dict:
    """Readable name and link for an iNaturalist photo licence code (e.g. 'cc-by-nc')."""
    if not code:
        return {"license_name": "All rights reserved", "license_url": None}
    code = code.lower()
    if code == "cc0":
        return {"license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/"}
    if code.startswith("cc-"):
        parts = code[3:]
        return {"license_name": "CC " + parts.upper(),
                "license_url": f"https://creativecommons.org/licenses/{parts}/4.0/"}
    return {"license_name": code, "license_url": None}


def _photo_url(url: str, size: str = "large") -> str:
    # iNat photo URLs end in square/small/medium/large/original + extension
    for s in ("square", "small", "medium", "large", "thumb", "original"):
        url = url.replace(f"/{s}.", f"/{size}.")
    return url


def photo_sizes(url: str) -> dict:
    """Local (cached) URLs for the sizes the browser uses."""
    return {"url": local_url(_photo_url(url, "medium")), "large": local_url(_photo_url(url, "large")),
            "original": local_url(_photo_url(url, "original"))}


def is_dead(o: dict) -> bool:
    """True if the community annotated this observation "Alive or Dead: Dead"
    (e.g. roadkill, a dead bird on the beach, pinned insects)."""
    return any(a.get("controlled_attribute_id") == config.ALIVE_OR_DEAD_TERM
               and a.get("controlled_value_id") == config.DEAD_VALUE
               for a in o.get("annotations") or [])


def _store_observations(conn, taxon_id: int, results: list[dict], pool_place_id) -> None:
    now = time.time()
    for o in results:
        photos = [
            {"url": _photo_url(p["url"]), "attribution": p.get("attribution"),
             "license": p.get("license_code")}
            for p in o.get("photos") or [] if p.get("url")
        ]
        if not photos:
            continue
        lat = lng = None
        if o.get("location"):
            try:
                lat, lng = (float(x) for x in o["location"].split(","))
            except ValueError:
                pass
        conn.execute(
            """INSERT INTO observations (id, taxon_id, obs_taxon_id, photos, latitude, longitude, obscured,
                    positional_accuracy, place_guess, observed_on, observer, uri, pool_place_id, fetched_at, dead,
                    faves)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET photos = excluded.photos, fetched_at = excluded.fetched_at,
                   dead = excluded.dead, faves = excluded.faves,
                   pool_place_id = COALESCE(excluded.pool_place_id, observations.pool_place_id)""",
            (o["id"], taxon_id, (o.get("taxon") or {}).get("id"), json.dumps(photos), lat, lng,
             1 if o.get("obscured") else 0, o.get("positional_accuracy"), o.get("place_guess"),
             o.get("observed_on"), (o.get("user") or {}).get("login"),
             o.get("uri") or f"https://www.inaturalist.org/observations/{o['id']}", pool_place_id, now,
             1 if is_dead(o) else 0, int(o.get("faves_count") or 0)),
        )


def observation_pool(taxon_id: int, place_id: int | None) -> list:
    """All stored observations to quiz on for this species, fetching from iNat if needed.
    Prefers the deck's place; falls back to worldwide if it has too few."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM observations WHERE taxon_id = ?", (taxon_id,)).fetchall()
    client = get_client()
    # Photos saved before version 0.4.1 don't say whether the organism is dead yet:
    # look them up again once (usually straight from the cache).
    unchecked = {r["pool_place_id"] for r in rows if r["dead"] is None or r["faves"] is None}
    if unchecked:
        for pid in unchecked:
            results = client.observations(taxon_id, place_id=pid, per_page=config.OBSERVATIONS_PER_TAXON)
            with get_conn() as conn:
                _store_observations(conn, taxon_id, results, pid)
        with get_conn() as conn:
            conn.execute("UPDATE observations SET dead = COALESCE(dead, 0), faves = COALESCE(faves, 0) "
                         "WHERE taxon_id = ?", (taxon_id,))
            rows = conn.execute("SELECT * FROM observations WHERE taxon_id = ?", (taxon_id,)).fetchall()
    local = [r for r in rows if place_id and r["pool_place_id"] == place_id]
    fetched = False
    if place_id and not local:
        # Cached API call, so repeating this is cheap.
        results = client.observations(taxon_id, place_id=place_id, per_page=config.OBSERVATIONS_PER_TAXON)
        if len(results) >= 3:
            with get_conn() as conn:
                _store_observations(conn, taxon_id, results, place_id)
            fetched = True
    if not rows and not fetched:
        results = client.observations(taxon_id, per_page=config.OBSERVATIONS_PER_TAXON)
        with get_conn() as conn:
            _store_observations(conn, taxon_id, results, None)
        fetched = True
    if fetched:
        with get_conn() as conn:
            rows = conn.execute("SELECT * FROM observations WHERE taxon_id = ?", (taxon_id,)).fetchall()
        local = [r for r in rows if place_id and r["pool_place_id"] == place_id]
    return local or rows


def fill_pools_batched(taxon_ids: list[int], place_id: int | None, group: int = 10, min_each: int = 5) -> int:
    """Fetch photo pools for many species with one request per `group` species
    (instead of one each). Species that come back with fewer than `min_each`
    photos are left for observation_pool() to fetch on their own.
    Returns the number of species whose pool was filled."""
    with get_conn() as conn:
        have = {r[0] for r in conn.execute(
            "SELECT DISTINCT taxon_id FROM observations WHERE pool_place_id IS ?", (place_id,)).fetchall()}
    todo = [t for t in dict.fromkeys(taxon_ids) if t not in have]
    filled = 0
    client = get_client()
    for i in range(0, len(todo), group):
        chunk = todo[i:i + group]
        results = client.observations_many(chunk, place_id=place_id)
        by_species: dict[int, list] = {t: [] for t in chunk}
        for o in results:
            tx = o.get("taxon") or {}
            # The observation may be of a subspecies: match it to the species in its ancestry.
            for sid in [tx.get("id"), *(tx.get("ancestor_ids") or [])]:
                if sid in by_species:
                    by_species[sid].append(o)
                    break
        with get_conn() as conn:
            for sid, obs in by_species.items():
                if len(obs) >= min_each:
                    _store_observations(conn, sid, obs, place_id)
                    filled += 1
    return filled


def _obs_order(r, photo_choice: str = "any") -> tuple:
    """Least shown first. Ties are broken in a fixed shuffled order (so the deck
    warm-up can prepare exactly the photo you'll see next), tilted by favourites:
      best  - most favourites first
      mixed - each favourite makes a photo likelier to come first, but photos
              without favourites still turn up
      any   - favourites ignored"""
    shuffle = ((r["id"] * 2654435761) % 4294967296) / 4294967296    # 0..1, fixed per observation
    faves = r["faves"] or 0
    if photo_choice == "best":
        return (r["times_shown"], -faves, shuffle)
    if photo_choice == "mixed":
        return (r["times_shown"], shuffle / (1 + math.log1p(faves)))
    return (r["times_shown"], shuffle)


def next_observation(taxon_id: int, place_id: int | None, hide_dead: bool = True,
                     photo_choice: str = "mixed") -> dict | None:
    """The observation that will be shown next for this species.
    With hide_dead, observations annotated as dead are skipped (unless that's all there is)."""
    candidates = observation_pool(taxon_id, place_id)
    if hide_dead:
        candidates = [r for r in candidates if not r["dead"]] or candidates
    return dict(min(candidates, key=lambda r: _obs_order(r, photo_choice))) if candidates else None


def next_question(deck_id: int, rng: random.Random | None = None, practice: bool = False) -> dict:
    rng = rng or random.Random()
    with get_conn() as conn:
        deck = conn.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
        if not deck:
            raise QuizError("Deck not found.")
        if not conn.execute("SELECT 1 FROM cards WHERE deck_id = ?", (deck_id,)).fetchone():
            raise QuizError("This deck has no species yet.")
        card = pick_next_card(conn, deck_id, rng, practice=practice)
        counts = queue_counts(conn, deck_id)
    # A species with no research-grade photos we can use is taken out of the deck
    # (the deck page lists them), and the next species is tried instead.
    for _ in range(config.MAX_NO_PHOTO_SKIPS):
        if not card:
            # Nothing due and no new cards left today.
            return {"done": True, "counts": counts}
        obs = next_observation(card["taxon_id"], deck["place_id"], bool(deck["hide_dead"]), deck["photo_choice"])
        if obs:
            break
        from .decks import drop_no_photo_species
        drop_no_photo_species(deck_id, card["taxon_id"])
        with get_conn() as conn:
            if not conn.execute("SELECT 1 FROM cards WHERE deck_id = ?", (deck_id,)).fetchone():
                raise QuizError("None of the species in this deck have research-grade photos we can show.")
            card = pick_next_card(conn, deck_id, rng, practice=practice)
            counts = queue_counts(conn, deck_id)
    else:
        raise QuizError("No research-grade photos found for these species on iNaturalist.")
    n_wrong = deck["num_choices"] - 1
    distractors = pick_distractors(card["taxon_id"], n_wrong, deck_id=deck_id, place_id=deck["place_id"],
                                   lat=obs["latitude"], lng=obs["longitude"], rng=rng)
    choice_ids = [card["taxon_id"]] + [d["id"] for d in distractors]
    rng.shuffle(choice_ids)

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO questions (deck_id, card_id, observation_id, choices, created_at) VALUES (?, ?, ?, ?, ?)",
            (deck_id, card["id"], obs["id"], json.dumps(choice_ids), time.time()),
        )
        qid = cur.lastrowid
        conn.execute("UPDATE observations SET times_shown = times_shown + 1, last_shown = ? WHERE id = ?",
                     (time.time(), obs["id"]))
        choices = []
        for tid in choice_ids:
            t = get_taxon(conn, tid)
            choices.append({"id": tid, "name": t["name"], "common_name": t.get("common_name")})

    photos = json.loads(obs["photos"])[: config.MAX_PHOTOS_PER_QUESTION]
    return {
        "question_id": qid,
        "deck_id": deck_id,
        # Photos come through the local offline cache. Attribution is shown on reveal.
        # Medium photos (~3x smaller) appear first; the page swaps in the large one when it
        # has loaded, and the viewer loads the original when you zoom in.
        # Photographer and licence go with each photo (shown under it), as the licences require.
        "photos": [{**photo_sizes(p["url"]), "attribution": p.get("attribution"), **licence_info(p.get("license"))}
                   for p in photos],
        "location": {
            "lat": obs["latitude"], "lng": obs["longitude"],
            "obscured": bool(obs["obscured"]), "accuracy_m": obs["positional_accuracy"],
            "place_guess": obs["place_guess"],
        },
        "observed_on": obs["observed_on"],
        "choices": choices,
        "is_new": card["state"] == 0,
        "counts": counts,
    }


def answer_question(question_id: int, chosen_taxon_id: int, response_ms: int | None = None) -> dict:
    with get_conn() as conn:
        q = conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
        if not q:
            raise QuizError("Question not found.")
        card = dict(conn.execute("SELECT * FROM cards WHERE id = ?", (q["card_id"],)).fetchone())
        obs = dict(conn.execute("SELECT * FROM observations WHERE id = ?", (q["observation_id"],)).fetchone())
        correct = int(chosen_taxon_id) == card["taxon_id"]
        if not q["answered"]:
            rating = rating_from_answer(correct, response_ms)
            before, after = apply_rating(conn, card, rating)
            conn.execute(
                """INSERT INTO reviews (question_id, deck_id, card_id, taxon_id, observation_id, chosen_taxon_id,
                                        correct, rating, response_ms, choices, reviewed_at, card_before, card_after)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (question_id, q["deck_id"], card["id"], card["taxon_id"], obs["id"], chosen_taxon_id,
                 int(correct), rating, response_ms, q["choices"], time.time(), before, after),
            )
            conn.execute("UPDATE questions SET answered = 1 WHERE id = ?", (question_id,))
        review = conn.execute("SELECT * FROM reviews WHERE question_id = ?", (question_id,)).fetchone()
        correct = bool(review["correct"])
        intervals = rating_previews(review["card_before"], review["reviewed_at"])
        answer = get_taxon(conn, card["taxon_id"])
        chosen = get_taxon(conn, int(chosen_taxon_id))
    return {
        "correct": correct,
        "rating": review["rating"],
        "intervals": intervals,      # e.g. {"1": "1 min", "3": "3 days"}
        "answer": public(answer),
        "chosen": public(chosen) if chosen else None,
        "observation": {
            "id": obs["id"], "uri": obs["uri"], "observer": obs["observer"],
            "observed_on": obs["observed_on"], "place_guess": obs["place_guess"],
            "photos": [{**p, **licence_info(p.get("license"))}
                       for p in json.loads(obs["photos"])[: config.MAX_PHOTOS_PER_QUESTION]],
        },
    }


def _fmt_seconds(sec: float) -> str:
    if sec < 3600:
        return f"{max(1, round(sec / 60))} min"
    if sec < 86400:
        return f"{round(sec / 3600)} h"
    days = sec / 86400
    if days < 31:
        return f"{round(days)} day" + ("s" if round(days) != 1 else "")
    if days < 365:
        return f"{days / 30.4:.1f} months"
    return f"{days / 365:.1f} years"


def rating_previews(before_json: str, reviewed_at: float) -> dict:
    """How long until the card comes back for each possible rating."""
    if not before_json:   # answered before version 0.2
        return {}
    before = CardState(**json.loads(before_json))
    return {
        str(r): _fmt_seconds(fsrs.review(before, r, reviewed_at).due - reviewed_at)
        for r in (1, 2, 3, 4)
    }


def rate_question(question_id: int, rating: int) -> dict:
    """Change the rating of an answered question (e.g. you guessed, so mark it Hard).
    The card is reset to how it was before the answer and FSRS is re-run."""
    if rating not in (1, 2, 3, 4):
        raise QuizError("Rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).")
    with get_conn() as conn:
        review = conn.execute("SELECT * FROM reviews WHERE question_id = ?", (question_id,)).fetchone()
        if not review:
            raise QuizError("Answer the question first.")
        if not review["card_before"]:
            raise QuizError("This answer was given before spaced repetition was added.")
        if not review["correct"] and rating != 1:
            raise QuizError("A wrong answer is always rated Again.")
        later = conn.execute("SELECT 1 FROM reviews WHERE card_id = ? AND id > ?",
                             (review["card_id"], review["id"])).fetchone()
        if later:
            raise QuizError("This species has been reviewed again since, so this rating can't change.")
        restored = restore_state(conn, review["card_id"], review["card_before"])
        card = dict(conn.execute("SELECT * FROM cards WHERE id = ?", (review["card_id"],)).fetchone())
        after = fsrs.review(to_state(card), rating, review["reviewed_at"])
        save_state(conn, card["id"], after)
        conn.execute("UPDATE reviews SET rating = ?, card_after = ? WHERE id = ?",
                     (rating, state_json(after), review["id"]))
    return {"rating": rating, "due": after.due, "state": after.state, "previous_state": restored.state}
