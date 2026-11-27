"""Numbers for the Stats page: progress, struggles, mix-ups, upcoming reviews.

Everything comes from the `cards` (FSRS state) and `reviews` (answer log) tables.
Pass a deck id for one deck, or None for all decks.
"""
import datetime as dt
import time

from . import config
from .db import get_conn
from .images import local_url
from .scheduler import day_start

MATURE_DAYS = 21          # like Anki: a card is "mature" when its interval/stability passes 3 weeks


def _day_key(ts: float) -> str:
    """Study-day (starting DAY_STARTS_AT_HOUR) that a timestamp belongs to, as YYYY-MM-DD."""
    d = dt.datetime.fromtimestamp(ts) - dt.timedelta(hours=config.DAY_STARTS_AT_HOUR)
    return d.date().isoformat()


def _streak(days: set[str], today: str) -> int:
    """Consecutive study days ending today (or yesterday, if you haven't studied yet today)."""
    d = dt.date.fromisoformat(today)
    if today not in days:
        d -= dt.timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= dt.timedelta(days=1)
    return n


def _taxon(row, prefix="") -> dict:
    return {"id": row[f"{prefix}id"], "name": row[f"{prefix}name"], "common_name": row[f"{prefix}common_name"],
            "photo_url": local_url(row[f"{prefix}photo_url"])}


def overview(deck_id: int | None = None, now: float | None = None, days: int = 30) -> dict:
    now = now or time.time()
    deck_sql = "" if deck_id is None else " AND deck_id = ?"
    deck_args = () if deck_id is None else (deck_id,)
    today = _day_key(now)

    with get_conn() as conn:
        rev = conn.execute(f"SELECT reviewed_at, correct, response_ms FROM reviews WHERE 1=1{deck_sql}",
                           deck_args).fetchall()

        cards = conn.execute(f"SELECT state, stability, due FROM cards WHERE 1=1{deck_sql}", deck_args).fetchall()

        struggles = conn.execute(
            f"""SELECT t.id, t.name, t.common_name, t.photo_url, c.deck_id, d.name AS deck_name,
                       c.lapses, c.difficulty, c.stability,
                       COUNT(r.id) AS seen, SUM(r.correct) AS right
                FROM cards c JOIN taxa t ON t.id = c.taxon_id JOIN decks d ON d.id = c.deck_id
                JOIN reviews r ON r.card_id = c.id
                WHERE 1=1{deck_sql.replace('deck_id', 'c.deck_id')}
                GROUP BY c.id HAVING seen >= 2 AND seen > right
                ORDER BY (seen - right) * 1.0 / seen DESC, (seen - right) DESC, c.difficulty DESC
                LIMIT 15""", deck_args).fetchall()

        confusions = conn.execute(
            f"""SELECT a.id, a.name, a.common_name, a.photo_url,
                       b.id AS b_id, b.name AS b_name, b.common_name AS b_common_name, b.photo_url AS b_photo_url,
                       COUNT(*) AS n, MAX(r.reviewed_at) AS last
                FROM reviews r JOIN taxa a ON a.id = r.taxon_id JOIN taxa b ON b.id = r.chosen_taxon_id
                WHERE r.correct = 0{deck_sql.replace('deck_id', 'r.deck_id')}
                GROUP BY r.taxon_id, r.chosen_taxon_id ORDER BY n DESC, last DESC LIMIT 15""",
            deck_args).fetchall()

        strongest = conn.execute(
            f"""SELECT t.id, t.name, t.common_name, t.photo_url, c.stability
                FROM cards c JOIN taxa t ON t.id = c.taxon_id
                WHERE c.state = 2{deck_sql.replace('deck_id', 'c.deck_id')}
                ORDER BY c.stability DESC LIMIT 10""", deck_args).fetchall()

        per_deck = []
        if deck_id is None:
            for d in conn.execute("SELECT id, name FROM decks ORDER BY name").fetchall():
                r = conn.execute("SELECT COUNT(*), COALESCE(SUM(correct), 0) FROM reviews WHERE deck_id = ?",
                                 (d["id"],)).fetchone()
                c = conn.execute(
                    """SELECT COUNT(*), SUM(state != 0), SUM(state = 2 AND stability >= ?),
                              SUM(state != 0 AND due <= ?) FROM cards WHERE deck_id = ?""",
                    (MATURE_DAYS, now, d["id"])).fetchone()
                per_deck.append({"id": d["id"], "name": d["name"], "species": c[0], "studied": c[1] or 0,
                                 "mature": c[2] or 0, "due": c[3] or 0, "reviews": r[0],
                                 "accuracy": round(r[1] / r[0], 3) if r[0] else None})

    # Totals
    total = len(rev)
    right = sum(r["correct"] for r in rev)
    study_days = {_day_key(r["reviewed_at"]) for r in rev}
    today_rev = [r for r in rev if r["reviewed_at"] >= day_start(now)]
    totals = {
        "reviews": total,
        "correct": right,
        "accuracy": round(right / total, 3) if total else None,
        "days_studied": len(study_days),
        "streak": _streak(study_days, today),
        "today_reviews": len(today_rev),
        "today_accuracy": round(sum(r["correct"] for r in today_rev) / len(today_rev), 3) if today_rev else None,
        "minutes": round(sum(min(r["response_ms"] or 0, 120000) for r in rev) / 60000),
    }

    # Reviews per day, last `days` days (oldest first)
    by_day = {}
    for r in rev:
        k = _day_key(r["reviewed_at"])
        b = by_day.setdefault(k, [0, 0])
        b[0] += 1
        b[1] += r["correct"]
    t0 = dt.date.fromisoformat(today)
    daily = []
    for i in range(days - 1, -1, -1):
        k = (t0 - dt.timedelta(days=i)).isoformat()
        n, c = by_day.get(k, (0, 0))
        daily.append({"date": k, "reviews": n, "correct": c})

    # Card states
    states = {"new": 0, "learning": 0, "young": 0, "mature": 0}
    for c in cards:
        if c["state"] == 0:
            states["new"] += 1
        elif c["state"] in (1, 3):
            states["learning"] += 1
        elif (c["stability"] or 0) >= MATURE_DAYS:
            states["mature"] += 1
        else:
            states["young"] += 1

    # Upcoming reviews: day 0 is today including anything overdue
    end_today = day_start(now) + 86400
    forecast = [0] * 14
    for c in cards:
        if c["state"] == 0 or c["due"] is None:
            continue
        i = 0 if c["due"] < end_today else int((c["due"] - end_today) // 86400) + 1
        if i < 14:
            forecast[i] += 1
    forecast = [{"day": i, "date": (t0 + dt.timedelta(days=i)).isoformat(), "due": n} for i, n in enumerate(forecast)]

    return {
        "deck_id": deck_id,
        "totals": totals,
        "daily": daily,
        "states": states,
        "forecast": forecast,
        "struggles": [{**_taxon(r), "deck_id": r["deck_id"], "deck_name": r["deck_name"], "seen": r["seen"],
                       "right": r["right"], "accuracy": round(r["right"] / r["seen"], 3), "lapses": r["lapses"],
                       "difficulty": round(r["difficulty"], 1) if r["difficulty"] else None}
                      for r in struggles],
        "confusions": [{"answer": _taxon(r), "chosen": _taxon(r, "b_"), "count": r["n"], "last": r["last"]}
                       for r in confusions],
        "strongest": [{**_taxon(r), "stability_days": round(r["stability"])} for r in strongest],
        "per_deck": per_deck,
    }
