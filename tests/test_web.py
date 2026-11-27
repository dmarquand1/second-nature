"""Tests for the website version (v0.4), which runs entirely in the browser.

1. test_browser_unit_tests opens web/tests.html (the JavaScript tests, with a
   pretend iNaturalist) and checks they all pass. You can also open that page
   yourself: http://127.0.0.1:8000/play/tests.html while the app is running.
2. test_website_end_to_end clicks through the real website screens, with the
   browser's requests to iNaturalist answered by the same fake as the Python tests.

Like test_ui.py these need Playwright, and skip if it isn't installed or your
computer blocks it.
"""
import json
import re
from urllib.parse import parse_qs, urlparse

import pytest

pytest.importorskip("playwright.sync_api")

from tests.conftest import FakeClient  # noqa: E402
from tests.test_ui import PNG, page, server  # noqa: E402,F401  (fixtures)


def test_browser_unit_tests(page):
    page.goto(page.base + "/play/tests.html")
    page.wait_for_function("window.testResults && window.testResults.done", timeout=60000)
    res = page.evaluate("window.testResults")
    assert res["failed"] == 0, res["failures"]
    assert res["passed"] >= 20


_FAKE = FakeClient()


def _fake_inat(route):
    """Answer the browser's iNaturalist requests from the Python FakeClient."""
    fake = _FAKE
    u = urlparse(route.request.url)
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    path = u.path.removeprefix("/v1")
    if path in ("/taxa/autocomplete", "/taxa"):
        body = {"results": fake.autocomplete_taxa(q.get("q", ""))}
    elif m := re.fullmatch(r"/taxa/([\d,]+)", path):
        body = {"results": fake.taxa_by_ids([int(i) for i in m[1].split(",")])}
    elif path == "/places/autocomplete":
        body = {"results": fake.autocomplete_places(q.get("q", ""))}
    elif path == "/observations/species_counts":
        res = fake.species_counts(taxon_id=int(q["taxon_id"]) if q.get("taxon_id") else None, per_page=500)
        body = {"results": res, "total_results": len(res)}
    elif path == "/identifications/similar_species":
        body = {"results": fake.similar_species(int(q["taxon_id"]))}
    elif path == "/observations":
        ids = [int(i) for i in q["taxon_id"].split(",")]
        res = fake.observations_many(ids) if "," in q["taxon_id"] else fake.observations(ids[0])
        body = {"results": res, "total_results": len(res)}
    else:
        return route.fulfill(status=404, body="{}")
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body),
                  headers={"Access-Control-Allow-Origin": "*"})


def test_website_end_to_end(page):
    calls = []
    page.route("https://api.inaturalist.org/**", lambda r: (calls.append(r.request.url), _fake_inat(r)))
    page.route("https://inaturalist-open-data.s3.amazonaws.com/**",
               lambda r: r.fulfill(status=200, content_type="image/png", body=PNG))
    page.goto(page.base + "/play/#/new")
    page.fill("input[name=name]", "Thrushes")
    page.fill("textarea[name=species]", "Turdus merula\nSong Thrush\nRedwing")
    page.click("button[type=submit]")
    page.wait_for_url("**/#/deck/*")
    page.goto(page.base + "/play/#/quiz/1")
    page.wait_for_selector(".choice", timeout=20000)
    img = page.get_attribute("#main-img", "src")
    assert img.startswith("https://inaturalist-open-data.s3.amazonaws.com/"), img
    assert all("photo_license=" in c for c in calls if "/observations?" in c)
    # Photographer and licence are shown with the photo, and the map credits OpenStreetMap.
    assert "CC BY" in page.inner_text("#photo-credit") and "tester" in page.inner_text("#photo-credit")
    page.keyboard.press("1")
    page.wait_for_selector(".ratings", timeout=10000)
    # Progress is kept in the browser: reload and it's still there.
    page.goto(page.base + "/play/#/stats")
    page.wait_for_selector("text=Progress")
    assert page.evaluate("IQ.store.all('reviews').length") == 1
    page.goto(page.base + "/play/#/settings")
    page.wait_for_selector("#backup")
    with page.expect_download() as dl:
        page.click("#backup")
    data = json.loads(open(dl.value.path()).read())
    assert data["app"] == "inat-quiz" and len(data["tables"]["reviews"]) == 1


def test_welcome_tour_for_new_players(page):
    """A new player (no decks) gets a short tour, can skip it, and can open it again."""
    page.goto(page.base + "/play/#/")
    page.wait_for_selector(".tour", timeout=10000)
    assert "Welcome to Second Nature" in page.inner_text(".tour")
    page.click(".tour [data-next]")                          # "Show me"
    assert "Make a deck" in page.inner_text(".tour")
    page.keyboard.press("ArrowRight")
    assert "Name the species" in page.inner_text(".tour")
    page.click(".tour [data-skip]")                          # skip partway through
    assert page.locator(".tour").count() == 0
    page.reload()                                            # not shown again once skipped
    page.wait_for_selector("#start-tour")
    page.wait_for_timeout(300)
    assert page.locator(".tour").count() == 0
    page.click("#start-tour")                                # ...but can be opened again
    page.wait_for_selector(".tour")
    page.keyboard.press("Escape")
    assert page.locator(".tour").count() == 0
    # From Settings, all the way through: the last step goes to New deck.
    page.goto(page.base + "/play/#/settings")
    page.click("#tour")
    for _ in range(5):
        page.click(".tour [data-next]")
    assert "Your progress" in page.inner_text(".tour") and "this browser" in page.inner_text(".tour")
    page.click(".tour [data-next]")                          # "Make my first deck"
    page.wait_for_url("**/#/new")
    assert page.locator(".tour").count() == 0


def test_welcome_tour_not_shown_to_players_with_decks(page):
    page.route("https://api.inaturalist.org/**", _fake_inat)
    page.goto(page.base + "/play/#/new")
    page.evaluate("localStorage.clear()")
    page.fill("input[name=name]", "Thrushes")
    page.fill("textarea[name=species]", "Turdus merula")
    page.click("button[type=submit]")
    page.wait_for_url("**/#/deck/*")
    page.goto(page.base + "/play/#/")
    page.wait_for_selector(".deck")
    page.wait_for_timeout(300)
    assert page.locator(".tour").count() == 0


def test_whats_new_page(page):
    """Returning players see a dot on "What's new" until they've looked; new players don't."""
    page.goto(page.base + "/play/#/stats")
    page.wait_for_selector("#nav-updates")
    assert "has-news" in page.get_attribute("#nav-updates", "class")       # never looked: dot shown
    page.click("#nav-updates")
    page.wait_for_selector(".update")
    assert "New species order" in page.inner_text("#app")
    assert "has-news" not in (page.get_attribute("#nav-updates", "class") or "")
    page.reload()
    page.wait_for_selector("#nav-updates")
    assert "has-news" not in (page.get_attribute("#nav-updates", "class") or "")
    # A brand-new player who finishes or skips the tour isn't shown the dot.
    page.evaluate("localStorage.clear()")
    page.goto(page.base + "/play/#/")
    page.wait_for_selector(".tour")
    page.click(".tour [data-skip]")
    assert "has-news" not in (page.get_attribute("#nav-updates", "class") or "")


def test_new_species_order_on_edit_page(page):
    page.route("https://api.inaturalist.org/**", _fake_inat)
    page.goto(page.base + "/play/#/new")
    page.evaluate("localStorage.setItem('sn.tutorialSeen', '1')")
    page.fill("input[name=name]", "Thrushes")
    page.fill("textarea[name=species]", "Turdus merula\nSong Thrush")
    page.select_option("select[name=new_order]", "rare")
    page.click("button[type=submit]")
    page.wait_for_url("**/#/deck/*")
    assert page.evaluate("IQ.store.get('decks', 1).new_order") == "rare"
    page.goto(page.base + "/play/#/deck/1/edit")
    page.wait_for_selector("#e-order")
    assert page.input_value("#e-order") == "rare"
    page.select_option("#e-order", "grouped")
    page.click("#save")
    page.wait_for_function("IQ.store.get('decks', 1).new_order === 'grouped'")
