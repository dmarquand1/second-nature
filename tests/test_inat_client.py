import time

from app import config, db
from app.inat_client import InatClient, RateLimiter


def test_rate_limiter_spaces_calls():
    rl = RateLimiter(0.2)
    start = time.monotonic()
    for _ in range(3):
        rl.wait()
    assert time.monotonic() - start >= 0.39


def test_get_uses_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "c.db")
    db.init_db()
    client = InatClient(min_interval=0)
    calls = []

    def fake_fetch(path, params):
        calls.append(path)
        return {"results": [{"id": 1}]}

    monkeypatch.setattr(client, "_fetch", fake_fetch)
    assert client.get("/taxa/1", {}, "taxa") == {"results": [{"id": 1}]}
    assert client.get("/taxa/1", {}, "taxa") == {"results": [{"id": 1}]}
    assert calls == ["/taxa/1"]  # second call came from the cache
