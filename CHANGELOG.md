# Changelog

## 0.4.3 (2026-11-27) - lighter website storage

Website only (the local app is unchanged). Saves much less in the browser, and keeps all progress.
- Saved iNaturalist answers keep only the fields the app uses (not identifications, comments, profiles and so on),
  so each one is a small fraction of its old size. Search-as-you-type answers aren't saved at all.
- Saved answers are deleted after 14 days (was 60), and only the newest 1,500 are kept. The old, larger saved
  answers are deleted once when the new version first opens (storage version 2).
- Photo lists: 12 observations per species (was 20) and at most 4 photos each; fewer fields per observation.
- Tidied when the page opens: prepared questions older than 2 days, finished background jobs, photo lists for
  species no longer in a deck, and extra copies on old answers. Every deck, species card and answer is kept, so
  progress, statistics and backups are unchanged.
- Settings: new **Free up space (keeps your progress)** button, and a short note on what is saved.
- Publish workflow comment updated (it runs on `main` or `master`).
- Tests: four more browser tests (slim saved answers, trimming, tidying keeps progress, free up space).

## 0.4.2 (2026-11-27) - favour well-liked photos

- **Which photos** deck setting (New deck and Edit pages): **Mixed** (default, favourited photos likelier first),
  **Best first** (most favourites first) or **Any**. Photos are fetched most-favourited first (`order_by=votes`,
  with a fallback if iNaturalist ever refuses it). Least-seen photos still always come first, so every photo comes round.
  Works in the local app and the website. Database upgrade: migration 5 (`decks.photo_choice`, `observations.faves`).
- Tests: `tests/test_photo_choice.py` (7 tests) and one more browser test; live checks confirm the favourites order.

## 0.4.1 (2026-11-27) - hide dead organisms

- **Hide photos of dead organisms**: new deck setting (on by default, New deck and Edit pages) that skips
  observations iNaturalist users annotated "Alive or Dead: Dead". Works in the local app and the website.
  Photos saved by earlier versions are checked once. Database upgrade: migration 4 (`decks.hide_dead`,
  `observations.dead`); nothing to delete.
- `python run.py` explains in plain words when the app is already running, instead of "[Errno 10048]".
- Website: asks the browser to keep saved progress permanently, and Settings says whether it agreed.
- Tests: `tests/test_dead.py` (6 tests) and one more browser test; live checks confirm iNaturalist sends annotations.

## 0.4.0 (2026-11-27) - website version

- **New name: Second Nature** ("learn to identify species until it's second nature"), replacing "iNat Quiz" so the
  name doesn't use iNaturalist's trademark. Saved progress, backups and the project folder name are unchanged.
- **Runs as a website**: `web/index.html` + `static/` work on any static web host with no Python server.
  The backend is translated to JavaScript in `static/local/` (same rules as `app/`); the screens are shared
  and `static/api.js` sends their requests to `static/local/router.js` in the website version.
- **Each player's browser talks to iNaturalist directly**: 1 request per second per browser, quiz first,
  IndexedDB cache with the same freshness times, one request for duplicate lookups, old copy when offline.
- **Photos straight from iNaturalist** (not copied). The website shows open-licence photos only (`photo_license`
  filter plus a check per photo).
- **Compliance** (docs/13-compliance.md): photographer and licence shown under every photo and in the zoom viewer
  (both versions); daily request budget per browser (background pauses at 7,000, all at 9,000); OpenStreetMap tiles
  from the exact address with a linked credit; "not endorsed by iNaturalist" and a privacy section listing the
  services the browser connects to (no accounts, cookies or tracking).
- **Progress kept in the browser**, with **Settings**: download a backup, restore it (also to move between
  computers), privacy, requests today, storage used, delete everything.
- **Try it locally** at `http://127.0.0.1:8000/play/`; **publish on GitHub Pages** with
  `.github/workflows/pages.yml` (see docs/12-website.md).
- **Tests**: `web/tests.html` runs 22 JavaScript tests in any browser (also `?live` for 4 real-iNaturalist
  checks); `tests/test_web.py` runs them and a click-through automatically when Playwright is available.
  Version numbers are checked to match everywhere.

## 0.3.1 (2026-11-27) - speed-ups

- **Batched lookups**: taxonomy for 30 species per request (`taxa.ensure_details_many`), photos for
  10 species per request (`quiz.fill_pools_batched`). Species with too few photos in a batch are
  fetched on their own. A new species now needs about 1-2 requests instead of 4-6.
- **Fewer fallback lookups**: "same family / same order" requests are skipped when there are already
  a couple more good look-alikes than needed.
- **Medium photos first**: the quiz shows the medium photo (about 3x smaller) immediately, swaps in the
  large one once loaded; the zoom viewer starts from large and loads the original when zoomed in.
  The warm-up downloads medium photos.
- **First question sooner**: when building a deck from a list, the first species found is added
  straight away. Simulated at iNat's real speed: first question 21 s → 7 s.
- **Live checks**: `pytest -m live` runs a few tests against the real iNaturalist (skipped normally).
- Background jobs always find their handlers (fixes a warm-up that could fail as "Unknown job kind").
- Browser tests are skipped (not errors) when Playwright is blocked, e.g. by a work laptop's
  Application Control policy. Playwright moved out of `requirements-dev.txt` into optional `requirements-ui.txt`.
- Hide the harmless httpx/Starlette deprecation warning (`pytest.ini`).

## 0.3.0 (2026-11-27) - speed, big decks, editing, stats, zoom, polish

- **Faster**: 2 questions are prepared ahead (with photos downloaded) while you answer; each deck is
  warmed up in the background (taxonomy, photo pool, look-alikes, first photos); "nearby" lookups are
  shared within 1° grid cells; quiz requests jump ahead of background ones in the 1 req/s queue.
- **Offline photo cache** in `data/images/` via `/api/img`, trimmed to 1.5 GB (least recently used first).
- **Big species lists**: decks are built in the background with a progress bar; upload .txt/.csv; taxon
  ids looked up 30 at a time; known species need no lookup; up to 5,000 species; report of names not
  found, best-guess matches and non-species. Deck page has search, sort and paging.
- **Edit deck page**: rename, description, focus place (set/clear), new per day, choices, add by search
  / paste / file, multi-select remove, delete.
- **Stats page** (all decks or one): totals, streak, progress states, answers per day, upcoming reviews,
  species you struggle with, pairs you mix up, strongest species, per-deck table.
- **Photo zoom**: click the photo or press Z; wheel/pinch zoom, drag, double-click, full-resolution photo.
- **Polish (step 8)**: `?` keyboard shortcuts help, arrow keys switch photos, `G D` / `G S` navigation,
  licence name + link for every photo, your past mix-ups are used as wrong-answer options.
- Database upgrade 3 (`jobs` table, extra indexes). Browser tests with Playwright (optional).

## 0.2.0 (2026-11-27) - spaced repetition

- FSRS-5 scheduler (`app/fsrs.py`): stability, difficulty and intervals per species, 90% target retention.
- Queue like Anki: due cards first, mixed with new species up to a daily limit per deck (default 20),
  learning steps of 1 and 5 minutes, relearning after 10 minutes.
- After each answer: Again / Hard / Good / Easy buttons showing the next interval. A rating is suggested
  from correctness and answer speed; wrong answers are always Again.
- "All done for now" screen with time of next review, plus a Keep practising mode.
- Due / new counts on the decks page, deck page and quiz header. Deck settings (name, new per day, choices).
- Database upgrades itself on start (keeps existing decks); answers from 0.1 are kept, those cards start as new.
- New endpoints: `POST /api/questions/{id}/rate`, `PATCH /api/decks/{id}`, `?practice=true` on `/next`.

## 0.1.0 (2026-11-27) - first local version

- Project setup: FastAPI backend, SQLite database, plain HTML/JS frontend, `python run.py` to start.
- iNaturalist API client with SQLite response cache and 1 request/second rate limit.
- Decks from a species list, a taxon, or common species in a place; optional place focus.
- Hard distractors: iNat similar species, same genus, related deck members, same family nearby.
- Quiz screen: up to 4 photos, map, date, 4-6 choices, keyboard shortcuts, reveal with links and attribution.
- Data model ready for FSRS spaced repetition (step 6) and stats (step 7).
- Offline test suite with a fake iNaturalist client.
