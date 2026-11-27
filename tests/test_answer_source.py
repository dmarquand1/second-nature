"""Where wrong answers come from (version 0.4.5).

Deck setting "Wrong answers from" (decks.answer_source):
  anywhere (default) - lookalikes from anywhere, plus related deck species
  mostly_deck        - deck species first, outside lookalikes only to top up
  deck               - only deck species (fewer choices if the deck is small)
"""
from fastapi.testclient import TestClient

from app import db, decks, quiz
from app.main import app
from tests.conftest import make_deck

DECK = ("Turdus merula", "Song Thrush", "Redwing")       # species 1, 2, 4


def _choice_sets(deck_id, n=8):
    out = []
    for _ in range(n):
        q = quiz.next_question(deck_id, practice=True)
        with db.get_conn() as conn:
            card = conn.execute("SELECT c.taxon_id FROM questions q JOIN cards c ON c.id = q.card_id WHERE q.id = ?",
                                (q["question_id"],)).fetchone()[0]
        out.append((card, {c["id"] for c in q["choices"]}))
    return out


def test_default_is_anywhere(fake):
    d = make_deck(species=DECK)
    assert d["answer_source"] == "anywhere"
    # Lookalikes from outside the deck turn up (the deck alone has only 2 others).
    assert any(len(ids) == 5 and ids - {1, 2, 4} for _, ids in _choice_sets(d["id"], 3))


def test_only_this_deck(fake):
    d = make_deck(species=DECK, answer_source="deck")
    for target, ids in _choice_sets(d["id"]):
        assert ids == {1, 2, 4}, ids                    # nothing from outside, so 3 choices not 5
    assert not [c for c in fake.calls if c[0] == "species_counts" and c[1].get("taxon_id") != None
                and c[1].get("lat") is not None]        # no "nearby" lookups needed


def test_mostly_this_deck_tops_up(fake):
    d = make_deck(species=DECK, answer_source="mostly_deck")
    for target, ids in _choice_sets(d["id"]):
        assert len(ids) == 5
        assert {1, 2, 4} <= ids                         # every deck species is used first
        assert len(ids - {1, 2, 4}) == 2                # then 2 lookalikes from outside


def test_mostly_this_deck_with_a_big_deck_stays_inside(fake):
    names = ("Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin")
    d = make_deck(species=names, answer_source="mostly_deck")
    for _, ids in _choice_sets(d["id"]):
        assert ids <= {1, 2, 3, 4, 5, 6} and len(ids) == 5


def test_only_this_deck_with_one_species_still_has_choices(fake):
    d = make_deck(species=("Turdus merula",), answer_source="deck")
    q = quiz.next_question(d["id"], practice=True)
    assert len(q["choices"]) == 5


def test_deck_answers_prefer_close_relatives(fake):
    # Blackbird's look-alikes in the deck: thrushes (same genus, iNat "similar") beat the Robin.
    names = ("Turdus merula", "Song Thrush", "Mistle Thrush", "European Robin", "Common Nightingale")
    d = make_deck(species=names, answer_source="deck", num_choices=4)
    cands = __import__("app.distractors", fromlist=["x"]).deck_candidates(1, d["id"])
    assert cands[2]["score"] > cands[6]["score"] and cands[3]["score"] > cands[7]["score"]


def test_setting_via_api(fake):
    d = make_deck(species=DECK)
    c = TestClient(app)
    assert c.patch(f"/api/decks/{d['id']}", json={"answer_source": "mostly_deck"}).json()["answer_source"] == "mostly_deck"
    assert c.patch(f"/api/decks/{d['id']}", json={"answer_source": "nonsense"}).status_code == 422
    r = c.post("/api/decks", json={"name": "x", "source_type": "list", "species": "Robin", "answer_source": "deck"})
    assert r.json()["answer_source"] == "deck"
    assert decks.get_deck(d["id"])["answer_source"] == "mostly_deck"
