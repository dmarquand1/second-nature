"""Species with no research-grade photos are taken out of the deck (version 0.4.8).

Rare species often have none (or, on the website, none with an open licence),
which used to stop the quiz with an error.
"""
from fastapi.testclient import TestClient

from app import db, decks, jobs, quiz
from app.main import app
from tests.conftest import make_deck

ALL = ("Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale")


def test_quiz_skips_and_removes_species_without_photos(fake, monkeypatch):
    monkeypatch.setattr(fake, "no_photos", {7})          # the Nightingale (rarest) has none
    d = make_deck(species=ALL, new_order="rare")
    # The warm-up after building takes it out before you even start.
    deck = decks.get_deck(d["id"])
    assert deck["num_cards"] == 6
    assert [t["name"] for t in deck["no_photos"]] == ["Luscinia megarhynchos"]
    q = quiz.next_question(d["id"])
    assert q.get("question_id") and q["photos"]


def test_quiz_removes_it_if_found_while_studying(fake, monkeypatch):
    d = make_deck(species=("Turdus merula", "Common Nightingale"), new_order="rare")
    with db.get_conn() as conn:       # its photos were saved earlier, but are gone now
        conn.execute("DELETE FROM observations WHERE taxon_id = 7")
    monkeypatch.setattr(fake, "no_photos", {7})
    q = quiz.next_question(d["id"])
    with db.get_conn() as conn:
        tid = conn.execute("SELECT c.taxon_id FROM questions q JOIN cards c ON c.id = q.card_id WHERE q.id = ?",
                           (q["question_id"],)).fetchone()[0]
    assert tid == 1
    body = TestClient(app).get(f"/api/decks/{d['id']}").json()
    assert body["num_cards"] == 1 and body["no_photos"][0]["common_name"] == "Common Nightingale"


def test_deck_where_nothing_has_photos(fake, monkeypatch):
    monkeypatch.setattr(fake, "no_photos", set(range(1, 8)))
    d = decks.create_deck("x", "list", {"species": ["Turdus merula"]})
    assert jobs.wait_idle(10)
    assert decks.get_deck(d["id"])["num_cards"] == 0
    r = TestClient(app).get(f"/api/decks/{d['id']}/next")
    assert r.status_code >= 400


def test_network_trouble_does_not_remove_species(fake, monkeypatch):
    from app.inat_client import InatError
    d = make_deck(species=("Turdus merula", "Common Nightingale"))
    with db.get_conn() as conn:
        conn.execute("DELETE FROM observations")
    def down(*a, **k):
        raise InatError("offline")
    monkeypatch.setattr(fake, "observations", down)
    monkeypatch.setattr(fake, "observations_many", down)
    try:
        quiz.next_question(d["id"])
    except Exception:
        pass
    assert decks.get_deck(d["id"])["num_cards"] == 2     # nothing taken out
