"""Deck warm-up: get everything a question needs ready before you study.

For each species in the deck (the ones you'll see soonest first) it fetches:
  * taxonomy (genus / family / order)
  * the pool of research-grade observations
  * the look-alike candidates for the next photo (similar species, congeners,
    same family nearby)
  * the photos themselves, for the next WARMUP_IMAGES_FOR_NEXT species

Everything is cached, so once a deck is warm, questions come almost entirely
from your own computer.
"""
import json

from . import config, images, jobs
from .db import get_conn
from .distractors import prepare_candidates
from .inat_client import InatError
from .quiz import _photo_url, fill_pools_batched, next_observation
from .taxa import ensure_details, ensure_details_many, ensure_obs_counts


def _cards_in_study_order(deck_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM cards WHERE deck_id = ?
               ORDER BY CASE WHEN state = 0 THEN 1 ELSE 0 END, due, id""",
            (deck_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@jobs.handler("warmup")
def warmup_deck(job_id: int, deck_id: int, params: dict, progress) -> dict:
    with get_conn() as conn:
        deck = conn.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
    if not deck:
        return {}
    cards = _cards_in_study_order(deck_id)
    total = len(cards)
    progress(0, total, "Getting photos and look-alikes ready", force=True)
    failed = 0
    ids = [c["taxon_id"] for c in cards]
    # Batched first: taxonomy for 30 species per request, photo pools for 10 per request.
    try:
        progress(0, total, "Fetching taxonomy for all species", force=True)
        ensure_details_many(ids)
        if deck["new_order"] in ("common", "rare"):
            ensure_obs_counts(deck_id)
        progress(0, total, "Fetching photos for all species", force=True)
        fill_pools_batched(ids, deck["place_id"])
    except InatError:
        pass   # fall back to one-by-one below
    for i, card in enumerate(cards, start=1):
        try:
            ensure_details(card["taxon_id"])
            obs = next_observation(card["taxon_id"], deck["place_id"], bool(deck["hide_dead"]), deck["photo_choice"])
            if obs:
                prepare_candidates(card["taxon_id"], deck_id, deck["place_id"],
                                   obs["latitude"], obs["longitude"], needed=deck["num_choices"] - 1)
                if i <= config.WARMUP_IMAGES_FOR_NEXT:
                    photos = json.loads(obs["photos"])[: config.MAX_PHOTOS_PER_QUESTION]
                    images.prefetch([_photo_url(p["url"], "medium") for p in photos])
        except InatError:
            failed += 1
        progress(i, total, f"Ready: {i} of {total} species")
    progress(total, total, force=True)
    return {"species": total, "failed": failed}


def start(deck_id: int) -> int:
    return jobs.submit("warmup", deck_id, {}, dedupe=True)


def status(deck_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE deck_id = ? AND kind = 'warmup' ORDER BY id DESC LIMIT 1", (deck_id,)
        ).fetchone()
    return jobs.get_job(row["id"]) if row else None
