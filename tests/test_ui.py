"""Browser tests for the screens (zoom, questions ready ahead, edit page, stats page, shortcuts).

These are optional: they run only if Playwright is installed, see docs/01-getting-started.md:
    pip install playwright
    python -m playwright install chromium
Otherwise they are skipped and the rest of the tests still run.
"""
import os
import socket
import threading
import time

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

import uvicorn  # noqa: E402

from app import images, jobs  # noqa: E402
from app.main import app  # noqa: E402

# A tiny valid PNG, so photos actually render in the browser.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf"
    "c0f01f0005000201a5f0d1d60000000049454e44ae426082")


@pytest.fixture()
def server(fake, monkeypatch):
    class R:
        status_code = 200
        content = PNG
    monkeypatch.setattr(images._http, "get", lambda url: R())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    t.join(5)


@pytest.fixture()
def page(server):
    with sync_api.sync_playwright() as p:
        try:
            # INAT_QUIZ_CHROMIUM lets you point at a Chrome/Chromium you already have.
            exe = os.environ.get("INAT_QUIZ_CHROMIUM")
            browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        except Exception as exc:   # browser not downloaded
            pytest.skip(f"Chromium for Playwright not installed: {exc}")
        pg = browser.new_page(viewport={"width": 1280, "height": 900})
        pg.route("**/*", lambda r: r.abort() if ("cdnjs" in r.request.url or "openstreetmap" in r.request.url)
                 else r.continue_())
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.base = server
        yield pg
        browser.close()
        assert not errors, errors


def _make_deck(page, names="Turdus merula\nSong Thrush\nRedwing\nNotabird"):
    page.goto(page.base + "/#/new")
    page.fill("input[name=name]", "Thrushes")
    page.fill("textarea[name=species]", names)
    page.click("button[type=submit]")
    page.wait_for_url("**/#/deck/*")
    jobs.wait_idle(10)
    page.reload()
    page.wait_for_selector(".job.ok")


def test_build_progress_and_not_found_report(page):
    _make_deck(page)
    assert "3 species added" in page.inner_text(".job.ok")
    assert "1 not found" in page.inner_text(".job.ok")
    page.fill("#filter", "song")
    page.wait_for_function("document.querySelectorAll('.card.sp').length === 1")


def test_quiz_prepares_questions_ahead_and_zoom(page):
    _make_deck(page)
    page.goto(page.base + "/#/quiz/1")
    page.wait_for_selector(".choice")
    page.wait_for_timeout(500)          # questions ahead get prepared in the background
    page.keyboard.press("1")
    page.wait_for_selector(".ratings")
    t0 = time.monotonic()
    page.keyboard.press("Enter")
    page.wait_for_selector(".choice:not([disabled])")
    assert time.monotonic() - t0 < 1.0   # next question was ready

    page.keyboard.press("z")
    page.wait_for_selector(".viewer:not(.hidden)")
    page.mouse.move(640, 400)
    page.mouse.wheel(0, -400)
    page.wait_for_timeout(200)
    assert page.inner_text(".viewer-zoom") != "100%"
    page.keyboard.press("1")            # keys go to the viewer, not the quiz behind it
    assert page.locator(".ratings").count() == 0
    page.keyboard.press("Escape")
    assert page.locator(".viewer.hidden").count() == 1


def test_edit_page_add_and_remove(page):
    _make_deck(page)
    page.goto(page.base + "/#/deck/1/edit")
    page.fill("#taxon-q", "Field")
    page.click("#taxon-results li")
    page.wait_for_function("document.querySelectorAll('.edit-row').length === 4")
    page.check(".edit-row input >> nth=0")
    page.click("#remove")
    page.wait_for_function("document.querySelectorAll('.edit-row').length === 3")
    page.fill("#e-name", "Renamed")
    page.click("#save")
    page.wait_for_timeout(300)
    page.goto(page.base + "/#/")
    page.wait_for_selector(".card.deck")
    assert "Renamed" in page.inner_text("#deck-list")


def test_stats_page_and_shortcuts_help(page):
    _make_deck(page)
    page.goto(page.base + "/#/quiz/1")
    page.wait_for_selector(".choice")
    for _ in range(3):
        page.keyboard.press("2")
        page.wait_for_selector(".ratings")
        page.keyboard.press("Enter")
        page.wait_for_selector(".choice:not([disabled]), .done")
    page.goto(page.base + "/#/stats")
    page.wait_for_selector(".tiles")
    assert "3" in page.inner_text(".tile >> nth=0")
    assert page.locator(".chart").count() == 2
    page.keyboard.press("?")
    assert page.locator(".modal:not(.hidden)").count() == 1
