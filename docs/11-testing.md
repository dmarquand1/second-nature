# 11 Testing

All tests use a **fake iNaturalist** (`tests/conftest.py`), so they run offline,
fast, and never touch your real database (each test gets a temporary one).

## Run the tests

```bash
cd ~/Projects/inat-quiz
source .venv/Scripts/activate
pytest
```

Run one file, or show each test name:

```bash
pytest tests/test_stats.py
pytest -v
```

## Live checks against the real iNaturalist (optional)

The normal tests never touch the internet. To check that iNaturalist still
answers the way the app expects (search, batched taxonomy, photos, licences,
similar species, place counts, photo download), run:

```bash
pytest -m live
```

About 12 requests, ~15 seconds. Run it now and then, e.g. if the app suddenly
can't find species or photos. Please don't run it in a loop.

## Browser tests (optional, one-time setup)

`tests/test_ui.py` opens the real app in a headless Chromium and clicks
through it. It's skipped unless Playwright is installed and allowed to run:

```bash
pip install -r requirements-ui.txt
python -m playwright install chromium
pytest tests/test_ui.py
```

**Work laptops:** some organisations block Playwright's helper program
(`node.exe`) with an "Application Control policy". Then the 4 browser tests
are simply **skipped**; everything else still runs. To remove Playwright again:
`pip uninstall playwright`.

## Website version tests (no install needed)

The website version (see [12 The website version](12-website.md)) has its own
tests in JavaScript. They run in **your normal browser**, so they work on the
work laptop too:

1. Start the app: `python run.py`
2. Open **http://127.0.0.1:8000/play/tests.html**. About 20 tests run in a
   couple of seconds; all lines should be green with a 🎉 at the top.
3. Optional: **http://127.0.0.1:8000/play/tests.html?live** runs 4 checks
   against the real iNaturalist (search, open-licence photos, look-alikes, a
   real question). About a minute.

They use a pretend iNaturalist and their own browser storage, so they never
touch your progress. `tests/test_web.py` runs the same page automatically when
Playwright is available (skipped otherwise), plus a click-through of the
website screens.

## What is covered

| File | Covers |
|---|---|
| `test_inat_client.py` | Rate limiter, response cache |
| `test_decks.py` | Building decks (list / taxon / place) in the background, add, remove |
| `test_big_lists.py` | CSV/text cleaning, batched id lookups, no lookup for known species, best-guess report, 100+ name lists with progress, size cap, API |
| `test_edit_deck.py` | Rename, description, settings, set/clear focus place, add from search, remove several, validation |
| `test_distractors.py` | Look-alike scoring and picking |
| `test_fsrs.py` | FSRS maths |
| `test_scheduler.py` | Due/new queue, daily limit, done state, practice, rating override, database upgrades |
| `test_quiz_api.py` | A full question/answer round, no repeats |
| `test_speed.py` | Questions prepared ahead are different species, warm-up makes questions need no lookups, shared grid cells, quiz requests go first |
| `test_speed_v031.py` | Batched taxonomy (with and without iNat's ancestor list), batched photo pools incl. uneven results and subspecies, warm-up uses batches, fallback lookups skipped, medium/large/original photo sizes, first species added straight away |
| `test_live.py` | **Real iNaturalist** (only with `pytest -m live`) |
| `test_images.py` | Photo cache: allowed hosts only, download once, trimming, local URLs |
| `test_stats.py` | Totals, streak, daily, states, forecast, struggles, mix-ups, per deck; mix-ups feeding the look-alikes |
| `test_polish.py` | Licences, cache URLs, interrupted jobs after restart, version info (same everywhere), `/play/` pages served |
| `test_dead.py` | Reading the "Alive or Dead" annotation, dead photos hidden by default, shown when the setting is off, a question even if all photos are dead, setting via the API, photos from older versions checked once |
| `test_job_priority.py` | A new deck is built straight away while another deck is warming up (the warm-up pauses, then carries on) |
| `test_new_order.py` | New species order: default and setting via the API, added/common/rare, counts looked up for older species, relatives of hardest/easiest, one group at a time, variety, the quiz follows the order |
| `test_answer_source.py` | Wrong answers from: anywhere by default, only this deck (fewer choices, no extra lookups), mostly this deck tops up, big decks stay inside, one-species decks still get choices, relatives score higher, setting via the API |
| `test_photo_choice.py` | Favourites stored, best first, mixed tilts towards favourites, every photo still comes round, setting via the API (and bad values refused), older photos get favourites, most-favourited request with fallback |
| `test_web.py` + `web/tests/tests.js` | **Website version**: FSRS gives the same numbers as Python, name cleaning, list/taxon decks with report, edit and delete, questions with photos straight from iNaturalist, look-alikes, answer and re-rate rules, daily limit and practice, prepared-ahead questions differ, batched warm-up, cache (repeats, two at once, offline fallback), quiz requests first, open-licence filter and credit with each photo, daily request budget, stats, backup and restore, slim saved answers and trimming, tidying up keeps progress, free up space, wrong answers from (deck only, mostly deck), new species order; click-through; What's new dot; new species order on the deck pages; welcome tour (shown to new players, skippable, opens again, not shown once you have decks) with backup download |
| `test_ui.py` | Browser: build progress and report, deck search, quiz "next" is instant, zoom (and keys don't leak to the quiz), edit page, stats page, `?` help, welcome tour |

## In VS Code

The **Testing** panel (flask icon) finds the tests automatically
(`.vscode/settings.json` turns pytest on). Click ▶ to run them.
