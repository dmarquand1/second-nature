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

## Browser tests (optional, one-time setup)

`tests/test_ui.py` opens the real app in a headless Chromium and clicks
through it. It's skipped until Playwright's browser is installed:

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium
pytest tests/test_ui.py
```

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
| `test_images.py` | Photo cache: allowed hosts only, download once, trimming, local URLs |
| `test_stats.py` | Totals, streak, daily, states, forecast, struggles, mix-ups, per deck; mix-ups feeding the look-alikes |
| `test_polish.py` | Licences, cache URLs, interrupted jobs after restart, version info |
| `test_ui.py` | Browser: build progress and report, deck search, quiz "next" is instant, zoom (and keys don't leak to the quiz), edit page, stats page, `?` help |

## In VS Code

The **Testing** panel (flask icon) finds the tests automatically
(`.vscode/settings.json` turns pytest on). Click ▶ to run them.
