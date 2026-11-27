from app import decks, jobs
from tests.conftest import make_deck


def test_deck_from_list_runs_in_background(fake):
    d = decks.create_deck("Thrushes", "list", {"species": ["Turdus merula", "Song Thrush", "Nonexistent bird"]})
    assert "job_id" in d
    assert jobs.wait_idle(10)
    job = jobs.get_job(d["job_id"])
    assert job["status"] == "done"
    assert job["done"] == job["total"] == 3
    assert job["result"]["not_found"] == ["Nonexistent bird"]
    d = decks.get_deck(d["id"])
    assert {c["name"] for c in d["cards"]} == {"Turdus merula", "Turdus philomelos"}


def test_deck_from_taxon(fake):
    d = decks.create_deck("Turdus", "taxon", {"taxon_id": 12716, "limit": 3})
    jobs.wait_idle(10)
    assert decks.get_deck(d["id"])["num_cards"] == 3


def test_deck_from_place(fake):
    d = decks.create_deck("UK birds", "place", {"place_id": 6857, "place_name": "United Kingdom"})
    jobs.wait_idle(10)
    d = decks.get_deck(d["id"])
    assert d["num_cards"] == 7
    assert d["place_id"] == 6857


def test_add_and_remove(fake):
    d = make_deck(species=["Turdus merula"])
    r = decks.add_species(d["id"], ["Redwing"])
    jobs.wait_idle(10)
    assert jobs.get_job(r["job_id"])["result"]["added"] == 1
    decks.remove_cards(d["id"], [4])
    assert decks.get_deck(d["id"])["num_cards"] == 1
