"""v0.3 polish (step 8): licences, offline cache URLs, jobs after a restart, API info."""
import time

from fastapi.testclient import TestClient

from app import db, images
from app.main import app
from app.quiz import licence_info


def test_licence_names_and_links():
    assert licence_info("cc-by-nc") == {"license_name": "CC BY-NC",
                                        "license_url": "https://creativecommons.org/licenses/by-nc/4.0/"}
    assert licence_info("cc0")["license_url"].endswith("/zero/1.0/")
    assert licence_info(None) == {"license_name": "All rights reserved", "license_url": None}


def test_only_inat_photos_go_through_the_cache():
    assert images.local_url("https://static.inaturalist.org/photos/1/square.jpg").startswith("/api/img?u=")
    assert images.local_url("https://example.com/x.jpg") == "https://example.com/x.jpg"
    assert images.local_url(None) is None


def test_reveal_shows_licence_for_each_photo(fake):
    from tests.conftest import make_deck
    d = make_deck()
    with TestClient(app) as c:
        q = c.get(f"/api/decks/{d['id']}/next").json()
        r = c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": 0}).json()
    p = r["observation"]["photos"][0]
    assert p["license_name"] == "CC BY" and p["license_url"] and p["attribution"]


def test_unfinished_jobs_marked_interrupted_on_restart(fake):
    with db.get_conn() as conn:
        conn.execute("INSERT INTO jobs (kind, status, created_at) VALUES ('build', 'running', ?)", (time.time(),))
    db.init_db()   # what happens when the app starts again
    with db.get_conn() as conn:
        assert conn.execute("SELECT status FROM jobs").fetchone()[0] == "interrupted"


def test_info_endpoint(fake):
    with TestClient(app) as c:
        info = c.get("/api/info").json()
    from app.main import __version__
    assert info["version"] == __version__ and "image_cache_mb" in info


def test_versions_match():
    """The app, the website version and the ?v= on scripts (which makes browsers
    load new files after an update) should all carry the same version number."""
    from app import config
    from app.main import __version__
    assert f'IQ.VERSION = "{__version__}"' in (config.STATIC_DIR / "local" / "router.js").read_text()
    for page in (config.STATIC_DIR / "index.html", config.WEB_DIR / "index.html"):
        text = page.read_text()
        assert f"?v={__version__}" in text and "?v=0.3" not in text, page


def test_website_pages_are_served(fake):
    """The website version preview at /play/ (see docs/12-website.md)."""
    with TestClient(app) as c:
        r = c.get("/play/")
        assert r.status_code == 200 and "static/local/router.js" in r.text
        assert c.get("/play/static/local/store.js").status_code == 200
        assert c.get("/play/tests.html").status_code == 200
        assert c.get("/play/tests/tests.js").status_code == 200
        assert c.get("/play", follow_redirects=False).status_code in (302, 307)
