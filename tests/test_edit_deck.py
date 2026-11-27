"""v0.3: editing a deck."""
from fastapi.testclient import TestClient

from app import jobs
from app.main import app
from tests.conftest import make_deck


def test_rename_and_settings(fake):
    d = make_deck()
    with TestClient(app) as c:
        r = c.patch(f"/api/decks/{d['id']}", json={"name": "Renamed", "description": "UK thrushes",
                                                   "num_choices": 6, "new_per_day": 5}).json()
    assert (r["name"], r["description"], r["num_choices"], r["new_per_day"]) == ("Renamed", "UK thrushes", 6, 5)


def test_set_and_clear_place(fake):
    d = make_deck()
    with TestClient(app) as c:
        r = c.patch(f"/api/decks/{d['id']}", json={"place_id": 6857, "place_name": "United Kingdom"}).json()
        assert r["place_id"] == 6857
        jobs.wait_idle(10)
        r = c.patch(f"/api/decks/{d['id']}", json={"clear_place": True}).json()
        assert r["place_id"] is None and r["place_name"] is None


def test_add_from_search_and_remove_several(fake):
    d = make_deck(species=["Turdus merula"])
    with TestClient(app) as c:
        r = c.post(f"/api/decks/{d['id']}/taxa", json={"taxon_ids": [2, 3, 6]}).json()
        assert r["added"] == 3
        r = c.post(f"/api/decks/{d['id']}/remove", json={"taxon_ids": [2, 3]}).json()
        assert r["removed"] == 2
        deck = c.get(f"/api/decks/{d['id']}").json()
    assert {x["taxon_id"] for x in deck["cards"]} == {1, 6}


def test_invalid_settings_rejected(fake):
    d = make_deck()
    with TestClient(app) as c:
        assert c.patch(f"/api/decks/{d['id']}", json={"num_choices": 9}).status_code == 422
        assert c.patch("/api/decks/9999", json={"name": "x"}).status_code == 404
