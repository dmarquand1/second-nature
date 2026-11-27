"""Which card to show next, and how answers update the schedule (FSRS).

Queue order, like Anki:
  1. cards that are due (learning steps and reviews), most overdue first,
     mixed in with
  2. new species, up to the deck's daily new-card limit, in the order the
     deck asks for (see order_new),
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


# How related two species are, for the "hard", "easy" and "varied" orders.
_RELATED = (("genus_id", 1.0), ("family_id", 0.6), ("order_id", 0.3))


def order_new(conn, deck_id: int, new_rows: list[dict], order: str, rng: random.Random) -> list[dict]:
    """Sort a deck's new cards for the deck's "New species order" setting.

    Ties (and species we know nothing about yet) are in random order."""
    rows = list(new_rows)
    rng.shuffle(rows)
    if order == "random" or not rows:
        return rows
    if order == "added":
        return sorted(rows, key=lambda r: r["id"])
    taxa = {r["id"]: dict(r) for r in conn.execute(
        "SELECT t.* FROM taxa t JOIN cards c ON c.taxon_id = t.id WHERE c.deck_id = ?", (deck_id,))}
    tx = lambda r: taxa.get(r["taxon_id"], {})        # noqa: E731
    if order in ("common", "rare"):
        sign = -1 if order == "common" else 1
        # Species whose count we don't know yet go last.
        return sorted(rows, key=lambda r: (tx(r).get("obs_count") is None, sign * (tx(r).get("obs_count") or 0)))

    started = [dict(r) for r in conn.execute(
        "SELECT taxon_id, difficulty, state FROM cards WHERE deck_id = ? AND state != ?", (deck_id, NEW))]
    if order == "grouped":
        # Finish the groups you've started, then the next group, genus by genus.
        fams = {tx(c).get("family_id") for c in started} - {None}
        gens = {tx(c).get("genus_id") for c in started} - {None}
        return sorted(rows, key=lambda r: (tx(r).get("family_id") not in fams, tx(r).get("genus_id") not in gens,
                                           tx(r).get("order_id") or 0, tx(r).get("family_id") or 0,
                                           tx(r).get("genus_id") or 0, tx(r).get("name", "")))
    if order == "varied":
        # Groups you've seen least of first, so you get a broad sweep before the fine detail.
        seen = {k: {} for k, _ in _RELATED}
        for c in started:
            for k, _ in _RELATED:
                if tx(c).get(k):
                    seen[k][tx(c)[k]] = seen[k].get(tx(c)[k], 0) + 1
        return sorted(rows, key=lambda r: tuple(seen[k].get(tx(r).get(k), 0) for k in ("order_id", "family_id", "genus_id")))

    # "hard" / "easy": relatives of the species you find hardest / know best come first.
    # FSRS difficulty runs from 1 (easy) to 10 (hard).
    best = {k: {} for k, _ in _RELATED}
    for c in started:
        d = c["difficulty"] if c["difficulty"] is not None else 5.5
        w = (d - 1) / 9 if order == "hard" else (10 - d) / 9
        for k, _ in _RELATED:
            if tx(c).get(k):
                best[k][tx(c)[k]] = max(best[k].get(tx(c)[k], 0), w)

    def score(r):
        return max((best[k].get(tx(r).get(k), 0) * rel for k, rel in _RELATED), default=0)
    return sorted(rows, key=lambda r: -score(r))


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
        deck_row = conn.execute("SELECT new_order FROM decks WHERE id = ?", (deck_id,)).fetchone()
        new_rows = order_new(conn, deck_id, [dict(r) for r in new_rows],
                             (deck_row["new_order"] if deck_row else None) or "random", rng)

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
