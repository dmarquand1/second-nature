"""Order of new species (version 0.4.6): deck setting "New species order".

In the fake iNaturalist (conftest.py) species 1-5 are Turdus thrushes, 6 (Robin) and
7 (Nightingale) share another genus; species 1 is the most observed and 7 the least.
"""
import random

from fastapi.testclient import TestClient

from app import db, jobs, scheduler
from app.main import app
from tests.conftest import make_deck

ALL = ("Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale")


def _order(deck_id, order):
    with db.get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM cards WHERE deck_id = ? AND state = 0", (deck_id,))]
        return [r["taxon_id"] for r in scheduler.order_new(conn, deck_id, rows, order, random.Random(1))]


def _start(deck_id, taxon_id, difficulty):
    """Pretend this species has been studied, with this FSRS difficulty (1 easy - 10 hard)."""
    with db.get_conn() as conn:
        conn.execute("UPDATE cards SET state = 2, difficulty = ?, due = 9e12 WHERE deck_id = ? AND taxon_id = ?",
                     (difficulty, deck_id, taxon_id))


def test_default_and_setting(fake):
    d = make_deck(species=ALL)
    assert d["new_order"] == "random"
    c = TestClient(app)
    assert c.patch(f"/api/decks/{d['id']}", json={"new_order": "rare"}).json()["new_order"] == "rare"
    assert c.patch(f"/api/decks/{d['id']}", json={"new_order": "nonsense"}).status_code == 422


def test_added_common_rare(fake):
    d = make_deck(species=ALL)
    assert _order(d["id"], "added") == [1, 2, 3, 4, 5, 6, 7]
    assert _order(d["id"], "common") == [1, 2, 3, 4, 5, 6, 7]
    assert _order(d["id"], "rare") == [7, 6, 5, 4, 3, 2, 1]
    assert sorted(_order(d["id"], "random")) == [1, 2, 3, 4, 5, 6, 7]


def test_counts_filled_in_for_older_species(fake):
    d = make_deck(species=ALL)
    with db.get_conn() as conn:
        conn.execute("UPDATE taxa SET obs_count = NULL")
    TestClient(app).patch(f"/api/decks/{d['id']}", json={"new_order": "rare"})   # starts a warm-up
    assert jobs.wait_idle(10)
    assert _order(d["id"], "rare") == [7, 6, 5, 4, 3, 2, 1]


def test_relatives_of_hardest_and_easiest(fake):
    d = make_deck(species=ALL)
    _start(d["id"], 6, 9.5)      # Robin: hard
    _start(d["id"], 1, 1.5)      # Blackbird: easy
    assert _order(d["id"], "hard")[0] == 7                     # the Robin's relative first
    assert _order(d["id"], "easy")[0] in (2, 3, 4, 5)          # the Blackbird's relatives first


def test_grouped_and_varied(fake):
    d = make_deck(species=ALL)
    _start(d["id"], 6, 5)
    assert _order(d["id"], "grouped")[0] == 7                  # finish the genus you've started
    d2 = make_deck(name="B", species=ALL)
    _start(d2["id"], 1, 5)
    _start(d2["id"], 2, 5)
    assert set(_order(d2["id"], "varied")[:2]) == {6, 7}       # something different first


def test_next_question_follows_the_order(fake):
    from app import quiz
    d = make_deck(species=ALL, new_order="rare")
    q = quiz.next_question(d["id"])
    with db.get_conn() as conn:
        tid = conn.execute("SELECT c.taxon_id FROM questions q JOIN cards c ON c.id = q.card_id WHERE q.id = ?",
                           (q["question_id"],)).fetchone()[0]
    assert tid == 7
