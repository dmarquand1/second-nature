"""Hide photos of dead organisms (version 0.4.1).

iNaturalist users can annotate an observation "Alive or Dead: Dead". Each deck
has a setting (on by default) that skips those observations. The fake
iNaturalist (conftest.py) marks the first observation of every species as dead.
"""
from fastapi.testclient import TestClient

from app import db, decks, quiz
from app.main import app
from tests.conftest import make_deck


def _dead_ids():
    with db.get_conn() as conn:
        return {r[0] for r in conn.execute("SELECT id FROM observations WHERE dead = 1")}


def test_dead_annotation_is_read(fake):
    assert quiz.is_dead({"annotations": [{"controlled_attribute_id": 17, "controlled_value_id": 19}]})
    assert not quiz.is_dead({"annotations": [{"controlled_attribute_id": 17, "controlled_value_id": 18}]})
    assert not quiz.is_dead({"annotations": [{"controlled_attribute_id": 1, "controlled_value_id": 19}]})
    assert not quiz.is_dead({})


def test_dead_photos_hidden_by_default(fake):
    d = make_deck()
    assert d["hide_dead"] == 1
    dead = _dead_ids()
    assert dead, "the fake's dead observations were stored with dead = 1"
    seen = set()
    for _ in range(20):
        q = quiz.next_question(d["id"], practice=True)
        with db.get_conn() as conn:
            seen.add(conn.execute("SELECT observation_id FROM questions WHERE id = ?", (q["question_id"],)).fetchone()[0])
    assert seen and not (seen & dead)


def test_dead_photos_shown_when_setting_off(fake):
    d = make_deck(species=("Turdus merula",), hide_dead=False)
    seen = set()
    for _ in range(12):     # 6 photos per species, least-shown first: all of them come round
        q = quiz.next_question(d["id"], practice=True)
        with db.get_conn() as conn:
            seen.add(conn.execute("SELECT observation_id FROM questions WHERE id = ?", (q["question_id"],)).fetchone()[0])
    assert seen & _dead_ids()


def test_only_dead_photos_still_gives_a_question(fake):
    d = make_deck(species=("Turdus merula",))
    with db.get_conn() as conn:
        conn.execute("UPDATE observations SET dead = 1")
    assert quiz.next_question(d["id"], practice=True)["photos"]


def test_setting_via_api(fake):
    with TestClient(app) as c:
        r = c.post("/api/decks", json={"name": "x", "source_type": "list", "species": ["Redwing"], "hide_dead": False})
        deck_id = r.json()["id"]
        assert r.json()["hide_dead"] == 0
        assert c.patch(f"/api/decks/{deck_id}", json={"hide_dead": True}).json()["hide_dead"] == 1
    assert decks.get_deck(deck_id)["hide_dead"] == 1


def test_photos_saved_before_041_get_checked(fake):
    """Older databases have dead = NULL: they're looked up once, then hidden properly."""
    d = make_deck(species=("Turdus merula",))
    with db.get_conn() as conn:
        conn.execute("UPDATE observations SET dead = NULL")
    q = quiz.next_question(d["id"], practice=True)
    with db.get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM observations WHERE dead IS NULL").fetchone()[0] == 0
        obs_id = conn.execute("SELECT observation_id FROM questions WHERE id = ?", (q["question_id"],)).fetchone()[0]
    assert obs_id not in _dead_ids()
