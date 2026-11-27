import os
import time

import pytest
from fastapi.testclient import TestClient

from app import config, images
from app.main import app

URL = "https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpg"


def test_only_inat_hosts_allowed(fake):
    assert images.allowed(URL)
    assert not images.allowed("https://evil.example.com/x.jpg")
    assert not images.allowed("http://inaturalist-open-data.s3.amazonaws.com/x.jpg")
    with pytest.raises(images.ImageError):
        images.get_image("https://evil.example.com/x.jpg")


def test_photo_downloaded_once_then_served_from_disk(fake):
    with TestClient(app) as c:
        r1 = c.get("/api/img", params={"u": URL})
        r2 = c.get("/api/img", params={"u": URL})
    assert r1.status_code == r2.status_code == 200
    assert r1.headers["content-type"] == "image/jpeg"
    assert fake.downloads == [URL]
    assert images.is_cached(URL)


def test_bad_host_gives_404(fake):
    with TestClient(app) as c:
        assert c.get("/api/img", params={"u": "https://evil.example.com/a.jpg"}).status_code == 404


def test_trim_removes_least_recently_used(fake):
    a = "https://static.inaturalist.org/photos/1/large.jpg"
    b = "https://static.inaturalist.org/photos/2/large.jpg"
    pa, _ = images.get_image(a)
    pb, _ = images.get_image(b)
    os.utime(pa, (time.time() - 1000, time.time() - 1000))   # a is older
    removed = images.trim_cache(max_mb=len(pb.read_bytes()) / 1e6)
    assert removed == 1 and not pa.exists() and pb.exists()


def test_question_photos_use_local_cache_urls(fake):
    from tests.conftest import make_deck
    d = make_deck()
    with TestClient(app) as c:
        q = c.get(f"/api/decks/{d['id']}/next").json()
    assert q["photos"][0]["url"].startswith("/api/img?u=")
    assert "original" in q["photos"][0]["original"]
