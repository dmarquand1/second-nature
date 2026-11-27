"""Which card to show next, and how answers update the schedule (FSRS).

Queue order, like Anki:
  1. cards that are due (learning steps and reviews), most overdue first,
     mixed in with
  2. new species, up to the deck's daily new-card limit,
  3. learning cards that will be due within 20 minutes ("learn ahead"),
  4. nothing: you're done for now. Practice mode keeps going with the
     cards that are due soonest (FSRS handles early reviews correctly).
"""
import datetime as dt
import json
import random
import time

from . import config
from .fsrs import AGAIN, EASY, FSRS, GOOD, HARD, LEARNING, NEW, RELEARNING, CardState

RATING_AGAIN, RATING_HARD, RATING_GOOD, RATING_EASY = AGAIN, HARD, GOOD, EASY
LEARN_AHEAD_SECONDS = 20 * 60

fsrs = FSRS(desired_retention=config.DESIRED_RETENTION)


def rating_from_answer(correct: bool, response_ms: int | None = None) -> int:
    """Suggested rating for a multiple-choice answer. You can change it on the reveal."""
    if not correct:
        return AGAIN
    if response_ms is not None and response_ms < 4000:
        return EASY
    if response_ms is not None and response_ms > 15000:
        return HARD
    return GOOD


def day_start(now: float | None = None) -> float:
    """Unix time when today's study day began (local time, DAY_STARTS_AT_HOUR)."""
    now_dt = dt.datetime.fromtimestamp(now or time.time())
    start = now_dt.replace(hour=config.DAY_STARTS_AT_HOUR, minute=0, second=0, microsecond=0)
    if now_dt < start:
        start -= dt.timedelta(days=1)
    return start.timestamp()


# ---- card <-> database ----------------------------------------------------
def to_state(card: dict) -> CardState:
    return CardState(
        state=card["state"], stability=card["stability"], difficulty=card["difficulty"],
        due=card["due"], last_review=card["last_review"], reps=card["reps"], lapses=card["lapses"],
        scheduled_days=card["scheduled_days"] or 0.0, elapsed_days=card["elapsed_days"] or 0.0,
    )


def state_json(s: CardState) -> str:
    return json.dumps(s.__dict__)


def save_state(conn, card_id: int, s: CardState) -> None:
    conn.execute(
        """UPDATE cards SET state = ?, stability = ?, difficulty = ?, due = ?, last_review = ?,
                            reps = ?, lapses = ?, scheduled_days = ?, elapsed_days = ?
           WHERE id = ?""",
        (s.state, s.stability, s.difficulty, s.due, s.last_review, s.reps, s.lapses,
         s.scheduled_days, s.elapsed_days, card_id),
    )


def apply_rating(conn, card: dict, rating: int, now: float | None = None) -> tuple[str, str]:
    """Run FSRS for one answer and save it. Returns (state_before, state_after) as JSON."""
    now = now or time.time()
    before = to_state(card)
    after = fsrs.review(before, rating, now)
    save_state(conn, card["id"], after)
    return state_json(before), state_json(after)


def restore_state(conn, card_id: int, before_json: str) -> CardState:
    s = CardState(**json.loads(before_json))
    save_state(conn, card_id, s)
    return s


# ---- the queue ------------------------------------------------------------
def queue_counts(conn, deck_id: int, now: float | None = None) -> dict:
    now = now or time.time()
    deck = conn.execute("SELECT new_per_day FROM decks WHERE id = ?", (deck_id,)).fetchone()
    new_per_day = deck["new_per_day"] if deck else config.DEFAULT_NEW_PER_DAY
    due = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND state != ? AND due <= ?", (deck_id, NEW, now)
    ).fetchone()[0]
    new_total = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND state = ?", (deck_id, NEW)
    ).fetchone()[0]
    new_today = conn.execute(
        """SELECT COUNT(DISTINCT card_id) FROM reviews
           WHERE deck_id = ? AND reviewed_at >= ? AND json_extract(card_before, '$.state') = ?""",
        (deck_id, day_start(now), NEW),
    ).fetchone()[0]
    next_due = conn.execute(
        "SELECT MIN(due) FROM cards WHERE deck_id = ? AND state != ? AND due > ?", (deck_id, NEW, now)
    ).fetchone()[0]
    new_available = max(0, min(new_total, new_per_day - new_today))
    return {
        "due": due,
        "new_available": new_available,
        "new_total": new_total,
        "new_today": new_today,
        "new_per_day": new_per_day,
        "next_due": next_due,
    }


def pick_next_card(conn, deck_id: int, rng: random.Random | None = None, now: float | None = None,
                   practice: bool = False) -> dict | None:
    rng = rng or random.Random()
    now = now or time.time()
    last = conn.execute(
        "SELECT card_id FROM questions WHERE deck_id = ? ORDER BY id DESC LIMIT 1", (deck_id,)
    ).fetchone()
    last_id = last["card_id"] if last else None
    # Cards already in a question prepared ahead (not answered yet) are avoided,
    # so preloading 2-3 questions doesn't give you the same species twice.
    pending = {r[0] for r in conn.execute(
        "SELECT card_id FROM questions WHERE deck_id = ? AND answered = 0 AND created_at > ?",
        (deck_id, now - config.PREFETCH_PENDING_MINUTES * 60),
    ).fetchall()}
    avoid = pending | {last_id}

    def first(rows):
        rows = [dict(r) for r in rows]
        others = [r for r in rows if r["id"] not in avoid]
        return (others or rows)[0] if rows else None

    due = conn.execute(
        "SELECT * FROM cards WHERE deck_id = ? AND state != ? AND due <= ? ORDER BY due",
        (deck_id, NEW, now),
    ).fetchall()
    counts = queue_counts(conn, deck_id, now)
    new_rows = []
    if counts["new_available"] > 0:
        new_rows = conn.execute(
            "SELECT * FROM cards WHERE deck_id = ? AND state = ?", (deck_id, NEW)
        ).fetchall()
        new_rows = [dict(r) for r in new_rows]
        rng.shuffle(new_rows)

    # Mix due and new cards in proportion to how many of each are left.
    due = [dict(r) for r in due]
    fresh_due = [r for r in due if r["id"] not in avoid]
    fresh_new = [r for r in new_rows if r["id"] not in avoid]
    if fresh_due and fresh_new:
        if rng.random() < counts["new_available"] / (counts["new_available"] + len(fresh_due)):
            return fresh_new[0]
        return fresh_due[0]
    if fresh_due or fresh_new:
        return (fresh_due or fresh_new)[0]

    ahead = conn.execute(
        "SELECT * FROM cards WHERE deck_id = ? AND state IN (?, ?) AND due <= ? ORDER BY due",
        (deck_id, LEARNING, RELEARNING, now + LEARN_AHEAD_SECONDS),
    ).fetchall()
    card = first(ahead) if ahead else None
    if card and not (practice and card["id"] in avoid):
        return card

    if practice:
        # Keep going with whatever is due soonest (never the same species twice in a row).
        soonest = conn.execute(
            "SELECT * FROM cards WHERE deck_id = ? ORDER BY state = ?, due LIMIT 5", (deck_id, NEW)
        ).fetchall()
        return first(soonest)
    return card
