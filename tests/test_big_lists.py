"""v0.3: much bigger species lists."""
from fastapi.testclient import TestClient

from app import config, decks, jobs
from app.main import app


def test_clean_names_handles_csv_headers_comments_and_duplicates():
    text = "﻿scientific_name,count\nTurdus merula,5\n# a comment\n\n\"Song Thrush\";x\nturdus merula\n12716\tfoo"
    assert decks.clean_names(text) == ["Turdus merula", "Song Thrush", "12716"]


def test_taxon_ids_are_looked_up_in_batches(fake):
    d = decks.create_deck("ids", "list", {"species": ["1", "2", "3", "999999"]})
    jobs.wait_idle(10)
    job = jobs.get_job(d["job_id"])
    assert job["result"]["added"] == 3
    assert job["result"]["not_found"] == ["999999"]
    batch_calls = [kw for name, kw in fake.calls if name == "taxa_by_ids"]
    assert batch_calls[0]["ids"] == [1, 2, 3, 999999]     # one request, not four
    assert not [1 for name, _ in fake.calls if name == "search_taxa"]


def test_known_species_need_no_lookup(fake):
    decks.create_deck("a", "list", {"species": ["Turdus merula"]})
    jobs.wait_idle(10)
    fake.calls.clear()
    decks.create_deck("b", "list", {"species": ["turdus MERULA", "Eurasian Blackbird"]})
    jobs.wait_idle(10)
    assert not [1 for name, _ in fake.calls if name == "search_taxa"]


def test_guesses_are_reported(fake):
    d = decks.create_deck("g", "list", {"species": ["thrush"]})   # not an exact name
    jobs.wait_idle(10)
    job = jobs.get_job(d["job_id"])
    assert job["result"]["guessed"] and job["result"]["guessed"][0]["input"] == "thrush"


def test_large_list_progress_and_partial_cards(fake, monkeypatch):
    names = [f"Unknown {i}" for i in range(120)] + ["Redwing"]
    d = decks.create_deck("big", "list", {"species": names})
    jobs.wait_idle(20)
    job = jobs.get_job(d["job_id"])
    assert job["total"] == 121 and job["done"] == 121
    assert len(job["result"]["not_found"]) == 120
    assert decks.get_deck(d["id"])["num_cards"] == 1


def test_deck_size_capped(fake, monkeypatch):
    monkeypatch.setattr(config, "MAX_DECK_SPECIES", 2)
    d = decks.create_deck("cap", "list", {"species": ["1", "2", "3", "4"]})
    jobs.wait_idle(10)
    assert decks.get_deck(d["id"])["num_cards"] == 2


def test_api_accepts_big_limits_and_text(fake):
    with TestClient(app) as c:
        r = c.post("/api/decks", json={"name": "x", "source_type": "taxon", "taxon_id": 12716, "limit": 2000})
        assert r.status_code == 200 and "job_id" in r.json()
        jobs.wait_idle(10)
        job = c.get(f"/api/jobs/{r.json()['job_id']}").json()
        assert job["status"] == "done"
        r = c.post(f"/api/decks/{r.json()['id']}/species", json={"species": "Redwing\nFieldfare"})
        assert r.json()["count"] == 2
