"""Build quiz questions and check answers."""
import json
import random
import time

from . import config
from .db import get_conn
from .distractors import pick_distractors
from .inat_client import get_client
from .fsrs import CardState
from .scheduler import (apply_rating, fsrs, pick_next_card, queue_counts, rating_from_answer,
                        restore_state, save_state, state_json, to_state)
from .taxa import get_taxon, public


class QuizError(Exception):
    pass


def _photo_url(url: str, size: str = "large") -> str:
    # iNat photo URLs end in square/small/medium/large/original + extension
    for s in ("square", "small", "medium", "thumb", "original"):
        url = url.replace(f"/{s}.", f"/{size}.")
    return url


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
                    positional_accuracy, place_guess, observed_on, observer, uri, pool_place_id, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET photos = excluded.photos, fetched_at = excluded.fetched_at,
                   pool_place_id = COALESCE(excluded.pool_place_id, observations.pool_place_id)""",
            (o["id"], taxon_id, (o.get("taxon") or {}).get("id"), json.dumps(photos), lat, lng,
             1 if o.get("obscured") else 0, o.get("positional_accuracy"), o.get("place_guess"),
             o.get("observed_on"), (o.get("user") or {}).get("login"),
             o.get("uri") or f"https://www.inaturalist.org/observations/{o['id']}", pool_place_id, now),
        )


def _choose_observation(taxon_id: int, place_id: int | None, rng: random.Random) -> dict:
    """Pick a research-grade observation of this species, fetching a pool if needed.
    Prefers the deck's place; falls back to worldwide if it has too few."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM observations WHERE taxon_id = ?", (taxon_id,)).fetchall()
    local = [r for r in rows if place_id and r["pool_place_id"] == place_id]
    client = get_client()
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
    candidates = local or rows
    if not candidates:
        raise QuizError("No research-grade photos found for this species.")
    # Least-shown first, random among ties.
    least = min(r["times_shown"] for r in candidates)
    pick = rng.choice([r for r in candidates if r["times_shown"] == least])
    return dict(pick)


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
    if not card:
        # Nothing due and no new cards left today.
        return {"done": True, "counts": counts}

    obs = _choose_observation(card["taxon_id"], deck["place_id"], rng)
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
        "photos": [{"url": p["url"]} for p in photos],   # attribution is shown on reveal
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
            "photos": json.loads(obs["photos"])[: config.MAX_PHOTOS_PER_QUESTION],
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
