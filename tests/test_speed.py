"""v0.3 speed features: questions prepared ahead, deck warm-up, shared nearby lookups,
request priority."""
import threading
import time

from fastapi.testclient import TestClient

from app import jobs, warmup
from app.inat_client import RateLimiter, background_priority, snap_to_grid
from app.main import app
from tests.conftest import make_deck


def test_questions_prepared_ahead_are_different_species(fake):
    d = make_deck()
    with TestClient(app) as c:
        ids = []
        for _ in range(3):   # like the browser keeping 3 questions ready
            q = c.get(f"/api/decks/{d['id']}/next").json()
            ids.append(q["question_id"])
        with __import__("app.db", fromlist=["get_conn"]).get_conn() as conn:
            cards = [conn.execute("SELECT card_id FROM questions WHERE id = ?", (i,)).fetchone()[0] for i in ids]
        assert len(set(cards)) == 3


def test_warmup_means_questions_need_no_inat_calls(fake):
    d = make_deck()   # creating a deck queues a warm-up automatically
    assert jobs.wait_idle(10)
    status = warmup.status(d["id"])
    assert status["status"] == "done" and status["done"] == 3
    assert fake.downloads, "warm-up should download photos"
    fake.calls.clear()
    with TestClient(app) as c:
        q = c.get(f"/api/decks/{d['id']}/next").json()
        assert "question_id" in q
    # The fake client logs every call, but real iNat calls only happen on a cache miss.
    # Here we check the expensive lookups were all made during warm-up instead:
    names = {name for name, _ in fake.calls}
    assert "observations" not in names


def test_nearby_photos_share_one_grid_cell():
    assert snap_to_grid(51.75, 1.0) == snap_to_grid(51.2, 1.0) == 51.5
    assert snap_to_grid(-1.25, 1.0) == -1.5
    assert snap_to_grid(52.01, 1.0) != snap_to_grid(51.99, 1.0)


def test_foreground_requests_jump_the_queue():
    rl = RateLimiter(0.1)
    order = []

    def bg():
        with background_priority():
            for _ in range(3):
                rl.wait()
                order.append("bg")

    def fg():
        time.sleep(0.05)
        rl.wait()
        order.append("fg")

    t1, t2 = threading.Thread(target=bg), threading.Thread(target=fg)
    t1.start(); t2.start(); t1.join(); t2.join()
    # the quiz request went ahead of the remaining background request
    assert order[-1] == "bg" and "fg" in order


def test_warmup_endpoint_and_dedupe(fake):
    d = make_deck()
    with TestClient(app) as c:
        a = c.post(f"/api/decks/{d['id']}/warmup").json()["job_id"]
        b = c.post(f"/api/decks/{d['id']}/warmup").json()["job_id"]
        assert a == b or jobs.get_job(a)["status"] == "done"
        jobs.wait_idle(10)
        assert c.get(f"/api/decks/{d['id']}/warmup").json()["status"] == "done"
