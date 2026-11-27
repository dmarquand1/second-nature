import time

from fastapi.testclient import TestClient

from app import decks
from app.db import get_conn
from app.main import app
from app.scheduler import pick_next_card, queue_counts


def _deck(n_new_per_day=20):
    return decks.create_deck("T", "list", {"species": ["Turdus merula", "Song Thrush", "Redwing"]},
                             new_per_day=n_new_per_day)


def test_due_cards_come_before_learn_ahead_and_new_limit(fake):
    d = _deck(n_new_per_day=1)
    now = time.time()
    with get_conn() as conn:
        conn.execute("UPDATE cards SET state = 2, stability = 5, difficulty = 5, due = ?, last_review = ? "
                     "WHERE deck_id = ? AND taxon_id = 4", (now - 3600, now - 6 * 86400, d["id"]))
        counts = queue_counts(conn, d["id"], now)
        assert counts["due"] == 1 and counts["new_available"] == 1
        card = pick_next_card(conn, d["id"], now=now)
        assert card is not None


def test_done_when_nothing_due_and_new_limit_reached(fake):
    d = _deck(n_new_per_day=1)
    with TestClient(app) as c:
        q = c.get(f"/api/decks/{d['id']}/next").json()
        assert q["is_new"]
        # answer wrongly
        r = c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": 0}).json()
        ans = r["answer"]["id"]
        # rating override is only Again for wrong answers
        assert c.post(f"/api/questions/{q['question_id']}/rate", json={"rating": 3}).status_code == 400
        q2 = c.get(f"/api/decks/{d['id']}/next").json()
        # wrong answer -> learning card due in 1 minute -> shown via learn-ahead
        assert not q2.get("done")
        r2 = c.post(f"/api/questions/{q2['question_id']}/answer", json={"taxon_id": ans}).json()
        assert r2["correct"]
        c.post(f"/api/questions/{q2['question_id']}/rate", json={"rating": 4})
        done = c.get(f"/api/decks/{d['id']}/next").json()
        assert done["done"] is True
        assert done["counts"]["new_today"] == 1
        practice = c.get(f"/api/decks/{d['id']}/next?practice=true").json()
        assert "question_id" in practice


def _answer_id(question_id):
    with get_conn() as conn:
        return conn.execute("SELECT c.taxon_id FROM questions q JOIN cards c ON c.id = q.card_id "
                            "WHERE q.id = ?", (question_id,)).fetchone()[0]


def test_rating_override_reruns_fsrs(fake):
    d = _deck()
    with TestClient(app) as c:
        q = c.get(f"/api/decks/{d['id']}/next").json()
        tid = _answer_id(q["question_id"])
        r = c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": tid, "response_ms": 8000}).json()
        assert r["correct"] and r["rating"] == 3
        assert set(r["intervals"]) == {"1", "2", "3", "4"}
        assert r["intervals"]["1"] == "1 min" and r["intervals"]["3"] == "3 days"

        def card():
            with get_conn() as conn:
                return dict(conn.execute("SELECT * FROM cards WHERE deck_id = ? AND taxon_id = ?",
                                         (d["id"], tid)).fetchone())
        good = card()
        assert good["state"] == 2 and good["reps"] == 1
        # "I guessed": change to Again -> back into learning, still only one rep
        c.post(f"/api/questions/{q['question_id']}/rate", json={"rating": 1})
        again = card()
        assert again["state"] == 1 and again["reps"] == 1 and again["due"] < good["due"]


def test_migration_upgrades_old_database(tmp_path, monkeypatch):
    import sqlite3
    from app import config, db
    path = tmp_path / "old.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    conn = sqlite3.connect(path)
    conn.executescript(db.SCHEMA)
    conn.execute("INSERT INTO decks (name, source_type, source_params, created_at) VALUES ('d','list','{}',0)")
    conn.execute("INSERT INTO taxa (id, name) VALUES (1, 'x')")
    conn.execute("INSERT INTO cards (deck_id, taxon_id, added_at, state, reps) VALUES (1, 1, 0, 1, 3)")
    conn.commit(); conn.close()
    db.init_db()
    db.init_db()  # running twice is safe
    with db.get_conn() as c:
        assert c.execute("PRAGMA user_version").fetchone()[0] == 2
        assert c.execute("SELECT new_per_day FROM decks").fetchone()[0] == 20
        assert c.execute("SELECT state FROM cards").fetchone()[0] == 0
