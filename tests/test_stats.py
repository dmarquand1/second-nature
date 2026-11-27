"""v0.3: stats page and mistakes feeding back into the wrong-answer choices."""
import time

from fastapi.testclient import TestClient

from app import stats
from app.db import get_conn
from app.distractors import gather_candidates
from app.main import app
from tests.conftest import make_deck


def _answer_id(qid):
    with get_conn() as conn:
        return conn.execute("SELECT c.taxon_id FROM questions q JOIN cards c ON c.id = q.card_id "
                            "WHERE q.id = ?", (qid,)).fetchone()[0]


def _play(c, deck_id, rounds, wrong_with=None):
    for _ in range(rounds):
        q = c.get(f"/api/decks/{deck_id}/next?practice=true").json()
        right = _answer_id(q["question_id"])
        pick = wrong_with if wrong_with and wrong_with != right else right
        c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": pick, "response_ms": 5000})


def test_stats_overview(fake):
    d = make_deck()
    with TestClient(app) as c:
        _play(c, d["id"], 4, wrong_with=5)       # always pick Fieldfare -> all wrong (unless it IS the answer)
        _play(c, d["id"], 3)                     # then all right
        s = c.get("/api/stats").json()
        s_deck = c.get(f"/api/stats?deck_id={d['id']}").json()
    t = s["totals"]
    assert t["reviews"] == 7 and t["correct"] == 3
    assert t["streak"] == 1 and t["today_reviews"] == 7 and t["days_studied"] == 1
    assert len(s["daily"]) == 30 and s["daily"][-1]["reviews"] == 7
    assert sum(s["states"].values()) == 3
    assert s["confusions"][0]["chosen"]["id"] == 5
    assert s["struggles"], "species answered wrongly twice should be listed"
    assert sum(f["due"] for f in s["forecast"]) >= 1
    assert s["per_deck"][0]["reviews"] == 7
    assert s_deck["per_deck"] == [] and s_deck["totals"]["reviews"] == 7


def test_streak_counts_consecutive_days(fake):
    today = stats._day_key(time.time())
    import datetime as dt
    days = {(dt.date.fromisoformat(today) - dt.timedelta(days=i)).isoformat() for i in (1, 2, 3, 5)}
    assert stats._streak(days, today) == 3          # yesterday, 2 and 3 days ago
    assert stats._streak(days | {today}, today) == 4


def test_your_mixups_become_distractors(fake):
    d = make_deck(species=["Turdus merula", "Common Nightingale"])
    with get_conn() as conn:
        card = conn.execute("SELECT id FROM cards WHERE deck_id = ? AND taxon_id = 1", (d["id"],)).fetchone()[0]
        conn.execute("""INSERT INTO reviews (deck_id, card_id, taxon_id, chosen_taxon_id, correct, reviewed_at)
                        VALUES (?, ?, 1, 7, 0, ?)""", (d["id"], card, time.time()))
    cands = gather_candidates(1, needed=4)
    assert "you've mixed these up before" in cands[7]["reasons"]
