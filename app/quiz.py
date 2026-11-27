"""Build quiz questions and check answers."""
import json
import random
import time

from . import config
from .db import get_conn
from .distractors import pick_distractors
from .inat_client import get_client
from .scheduler import apply_rating, pick_next_card, rating_from_answer
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


def next_question(deck_id: int, rng: random.Random | None = None) -> dict:
    rng = rng or random.Random()
    with get_conn() as conn:
        deck = conn.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
        if not deck:
            raise QuizError("Deck not found.")
        card = pick_next_card(conn, deck_id, rng)
    if not card:
        raise QuizError("This deck has no species yet.")

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
            conn.execute(
                """INSERT INTO reviews (question_id, deck_id, card_id, taxon_id, observation_id, chosen_taxon_id,
                                        correct, rating, response_ms, choices, reviewed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (question_id, q["deck_id"], card["id"], card["taxon_id"], obs["id"], chosen_taxon_id,
                 int(correct), rating, response_ms, q["choices"], time.time()),
            )
            conn.execute("UPDATE questions SET answered = 1 WHERE id = ?", (question_id,))
            apply_rating(conn, card, rating)
        answer = get_taxon(conn, card["taxon_id"])
        chosen = get_taxon(conn, int(chosen_taxon_id))
    return {
        "correct": correct,
        "answer": public(answer),
        "chosen": public(chosen) if chosen else None,
        "observation": {
            "id": obs["id"], "uri": obs["uri"], "observer": obs["observer"],
            "observed_on": obs["observed_on"], "place_guess": obs["place_guess"],
            "photos": json.loads(obs["photos"])[: config.MAX_PHOTOS_PER_QUESTION],
        },
    }
