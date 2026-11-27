"""Favour well-liked photos (version 0.4.2).

Each deck chooses which photo of a species to show next:
  mixed (default) - favourited photos likelier to come first, others still appear
  best            - most favourites first
  any             - favourites ignored
In the fake iNaturalist (conftest.py) observation 5 of each species has 12
favourites and observation 3 has 4; observation 0 is annotated dead.
"""
from fastapi.testclient import TestClient

from app import db, decks, quiz
from app.inat_client import InatClient, InatError
from app.main import app
from tests.conftest import make_deck


def _shown(deck_id, n):
    out = []
    for _ in range(n):
        q = quiz.next_question(deck_id, practice=True)
        with db.get_conn() as conn:
            out.append(conn.execute("SELECT observation_id FROM questions WHERE id = ?",
                                    (q["question_id"],)).fetchone()[0])
    return out


def test_favourites_are_stored(fake):
    make_deck(species=("Turdus merula",))
    with db.get_conn() as conn:
        faves = dict(conn.execute("SELECT id, faves FROM observations WHERE taxon_id = 1").fetchall())
    assert faves[1005] == 12 and faves[1003] == 4 and faves[1001] == 0


def test_best_first(fake):
    d = make_deck(species=("Turdus merula",), photo_choice="best")
    assert d["photo_choice"] == "best"
    shown = _shown(d["id"], 2)
    assert shown == [1005, 1003]        # most favourites first


def test_mixed_tilts_towards_favourites():
    """For the same shuffle position, more favourites always means sooner."""
    row = lambda i, faves: {"id": i, "times_shown": 0, "faves": faves}
    for i in range(1, 200):
        assert quiz._obs_order(row(i, 10), "mixed") < quiz._obs_order(row(i, 0), "mixed")
        assert quiz._obs_order(row(i, 10), "any") == quiz._obs_order(row(i, 0), "any")
    # ...but a photo that's been shown less still always comes first.
    assert quiz._obs_order({"id": 1, "times_shown": 0, "faves": 0}, "best") < \
        quiz._obs_order({"id": 1, "times_shown": 1, "faves": 99}, "best")


def test_every_photo_still_comes_round(fake):
    d = make_deck(species=("Turdus merula",))           # mixed by default
    assert d["photo_choice"] == "mixed"
    assert set(_shown(d["id"], 5)) == {1001, 1002, 1003, 1004, 1005}   # all alive ones, no repeats


def test_setting_via_api(fake):
    with TestClient(app) as c:
        r = c.post("/api/decks", json={"name": "x", "source_type": "list", "species": ["Redwing"], "photo_choice": "any"})
        assert r.json()["photo_choice"] == "any"
        deck_id = r.json()["id"]
        assert c.patch(f"/api/decks/{deck_id}", json={"photo_choice": "best"}).json()["photo_choice"] == "best"
        assert c.patch(f"/api/decks/{deck_id}", json={"photo_choice": "nonsense"}).status_code == 422
    assert decks.get_deck(deck_id)["photo_choice"] == "best"


def test_older_photos_get_their_favourites(fake):
    d = make_deck(species=("Turdus merula",), photo_choice="best")
    with db.get_conn() as conn:
        conn.execute("UPDATE observations SET faves = NULL")
    assert _shown(d["id"], 1) == [1005]


def test_client_asks_for_most_favourited_and_falls_back(monkeypatch):
    c = InatClient(min_interval=0)
    asked = []

    def fake_get(path, params, ttl_kind="default"):
        asked.append(params.get("order_by"))
        if params.get("order_by"):
            raise InatError("iNaturalist returned 422 for /observations: bad order_by")
        return {"results": [{"id": 1}]}

    monkeypatch.setattr(c, "get", fake_get)
    assert c.observations(1) == [{"id": 1}]
    assert asked == ["votes", None]
