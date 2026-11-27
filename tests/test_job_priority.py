"""A new deck is built straight away, even while another deck is warming up (version 0.4.7)."""
import json
import time

from app import db, decks, jobs
from tests.conftest import make_deck

ALL = ("Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale")


def test_build_goes_ahead_of_a_running_warmup(fake, monkeypatch):
    slow = fake.similar_species
    monkeypatch.setattr(fake, "similar_species", lambda *a, **k: (time.sleep(0.05), slow(*a, **k))[1])
    a = decks.create_deck("A", "list", {"species": list(ALL)})
    # Wait until A's warm-up is under way, then make deck B.
    deadline = time.time() + 5
    while time.time() < deadline:
        with db.get_conn() as conn:
            if conn.execute("SELECT 1 FROM jobs WHERE kind = 'warmup' AND status = 'running'").fetchone():
                break
        time.sleep(0.01)
    b = decks.create_deck("B", "list", {"species": ["Redwing"]})
    assert jobs.wait_idle(20)
    with db.get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM jobs ORDER BY id")]
    build_b = next(r for r in rows if r["kind"] == "build" and r["deck_id"] == b["id"])
    warm_a = [r for r in rows if r["kind"] == "warmup" and r["deck_id"] == a["id"]]
    assert json.loads(warm_a[0]["result"]).get("paused"), "A's warm-up paused for B"
    assert build_b["finished_at"] < warm_a[-1]["finished_at"], "B was built before A's warm-up finished"
    assert warm_a[-1]["status"] == "done" and not json.loads(warm_a[-1]["result"]).get("paused"), "A's warm-up carried on"
    assert decks.get_deck(b["id"])["num_cards"] == 1
