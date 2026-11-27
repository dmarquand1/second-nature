"""Which card to show next, and how to record an answer.

STEP 5 (now): a simple placeholder scheduler.
  * unseen cards first, then the cards you get wrong most often,
    with some randomness, never the same species twice in a row.

STEP 6 (next): replace `pick_next_card` and `apply_rating` with FSRS.
The `cards` table already has the FSRS columns (state, due, stability,
difficulty, reps, lapses, ...) and every answer is logged in `reviews`,
so only this file needs to change.
"""
import random
import time

RATING_AGAIN, RATING_HARD, RATING_GOOD, RATING_EASY = 1, 2, 3, 4


def rating_from_answer(correct: bool, response_ms: int | None = None) -> int:
    """Map a multiple-choice answer to an FSRS-style rating."""
    if not correct:
        return RATING_AGAIN
    if response_ms is not None and response_ms < 4000:
        return RATING_EASY
    if response_ms is not None and response_ms > 15000:
        return RATING_HARD
    return RATING_GOOD


def pick_next_card(conn, deck_id: int, rng: random.Random | None = None) -> dict | None:
    rng = rng or random.Random()
    rows = conn.execute(
        """SELECT c.*,
                  (SELECT COUNT(*) FROM reviews r WHERE r.card_id = c.id) AS seen,
                  (SELECT COALESCE(SUM(1 - correct), 0) FROM reviews r WHERE r.card_id = c.id) AS wrong
           FROM cards c WHERE c.deck_id = ?""",
        (deck_id,),
    ).fetchall()
    if not rows:
        return None
    last = conn.execute(
        "SELECT card_id FROM questions WHERE deck_id = ? ORDER BY id DESC LIMIT 1", (deck_id,)
    ).fetchone()
    cards = [dict(r) for r in rows]
    if last and len(cards) > 1:
        cards = [c for c in cards if c["id"] != last["card_id"]]
    weights = []
    for c in cards:
        if c["seen"] == 0:
            w = 5.0
        else:
            w = 1.0 + 3.0 * (c["wrong"] + 1) / (c["seen"] + 2)
        weights.append(w)
    return rng.choices(cards, weights=weights, k=1)[0]


def apply_rating(conn, card: dict, rating: int, now: float | None = None) -> None:
    """Update the card after a review. Placeholder until FSRS (step 6)."""
    now = now or time.time()
    lapses = card["lapses"] + (1 if rating == RATING_AGAIN else 0)
    conn.execute(
        "UPDATE cards SET reps = reps + 1, lapses = ?, last_review = ?, state = CASE WHEN state = 0 THEN 1 ELSE state END WHERE id = ?",
        (lapses, now, card["id"]),
    )
