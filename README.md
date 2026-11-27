# Second Nature

*Learn to identify species until it's second nature.*

A personal species-identification practice tool. It shows you research-grade
photos from [iNaturalist](https://www.inaturalist.org), with a map and date,
and asks you to pick the right species from a multiple-choice list of
**realistic look-alikes** (same genus, species people commonly confuse on
iNaturalist, and related species found nearby).

Inspired by [iNatGuessr](https://simonrolph.github.io/iNatGuessr/) and
[identifi.life](https://identifi.life/).

Two ways to use it:

* **Local app** on your own computer: Python (FastAPI) backend, SQLite database,
  plain HTML/JS frontend. Start it with `python run.py`.
* **Website** (from version 0.4): the same screens running entirely in the
  browser, publishable for free on GitHub Pages. Try it at
  `http://127.0.0.1:8000/play/` while the local app runs. See
  [docs/12-website.md](docs/12-website.md).

## Quick start (Windows, Git Bash)

Full step-by-step guide: [docs/01-getting-started.md](docs/01-getting-started.md)

```bash
cd ~/Projects/inat-quiz
py -m venv .venv                 # create the virtual environment (first time only)
source .venv/Scripts/activate    # activate it (every new terminal)
pip install -r requirements.txt  # install packages (first time / when requirements change)
python run.py                    # start the app; your browser opens http://127.0.0.1:8000
```

Press `Ctrl+C` in the terminal to stop it.

## Features (version 0.4)

- **Decks** built three ways: paste or upload a species list, pick a group (e.g.
  genus *Turdus*, order Odonata), or take the most-observed species in a place.
  Up to 5,000 species per deck, found in the background with a progress bar.
  Any deck can be focused on a place so photos and distractors come from there.
- **Edit decks**: rename, add species by search, paste or file, remove several
  at once, change the focus place and settings.
- **Hard distractors** from iNaturalist "similar species", congeners, related
  deck members, same-family species observed near the photo's location, and
  the species *you* have mixed up before.
- **Quiz screen**: up to 4 photos with **zoom** (scroll, pinch, drag, full
  resolution), small map, date, 4 to 6 choices, keyboard shortcuts (press `?`),
  reveal with links to the observation and species page, photographer and licence.
- **Fast**: the next questions are prepared while you look at the current one,
  and each deck is "warmed up" in the background.
- **Offline photo cache**: photos are saved on your computer after the first
  view (`data/images/`, trimmed to 1.5 GB).
- **Stats page**: answers per day, streak, progress (new / learning / young /
  mature), species you struggle with, pairs you mix up, upcoming reviews.
- **Spaced repetition (FSRS)**, the algorithm Anki uses: each species is
  scheduled to come back just before you'd forget it. Due and new counts per
  deck, a daily new-species limit, and Again / Hard / Good / Easy buttons
  after each answer showing when you'd see it next.
- **Polite to iNaturalist**: max 1 request per second, every response cached
  locally in SQLite (or in the browser, for the website).
- **Website version**: no server or account needed; each player's browser
  talks to iNaturalist directly, photos load from iNaturalist (open licences by
  only), progress stays in the browser with backup and restore.
  See [docs/13-compliance.md](docs/13-compliance.md) before publishing.

## Project layout

```
inat-quiz/
├── app/                  Python backend (FastAPI)
│   ├── main.py           API routes + serves the frontend
│   ├── config.py         settings (rate limit, cache times, quiz defaults)
│   ├── db.py             SQLite schema and connection helper
│   ├── inat_client.py    iNaturalist API client (cache + rate limit)
│   ├── taxa.py           local store of species names/photos/taxonomy
│   ├── decks.py          building decks (list / taxon / place)
│   ├── distractors.py    choosing hard wrong answers
│   ├── fsrs.py           the FSRS spaced repetition maths
│   ├── jobs.py           background jobs (building decks, warm-up)
│   ├── warmup.py         gets a deck's photos and look-alikes ready ahead of time
│   ├── images.py         offline photo cache
│   ├── stats.py          numbers for the Stats page
│   ├── scheduler.py      which card next, applying ratings
│   └── quiz.py           building questions and checking answers
├── static/               frontend (plain HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── style.css
│   ├── api.js            fetch helpers
│   ├── app.js            page router
│   ├── viewer.js         full-screen photo zoom
│   ├── shortcuts.js      keyboard shortcuts help (?)
│   ├── views/            one file per screen (decks, new, deck, edit, quiz, stats, settings)
│   └── local/            the website version's "backend" in JavaScript (runs in the browser)
├── web/                  the website version: index.html, tests.html, tests/
├── .github/workflows/    pages.yml publishes the website on GitHub Pages
├── tests/                pytest tests (use a fake iNaturalist, run offline)
├── docs/                 step-by-step documentation
├── data/                 your local database (not committed to git)
├── run.py                one-command start
├── requirements.txt      runtime packages
└── requirements-dev.txt  + test tools
```

## Documentation

| Doc | What's in it |
|---|---|
| [01 Getting started](docs/01-getting-started.md) | Install Python, venv, run the app, run tests |
| [02 GitHub setup](docs/02-github-setup.md) | Create the GitHub repo and first push |
| [03 Git workflow](docs/03-git-workflow.md) | Everyday stage / commit / push commands |
| [04 Architecture](docs/04-architecture.md) | How the pieces fit together, API endpoints |
| [05 Data model](docs/05-data-model.md) | Database tables, ready for FSRS and stats |
| [06 Distractors](docs/06-distractors.md) | How the wrong answers are chosen |
| [07 Spaced repetition](docs/07-spaced-repetition.md) | How FSRS schedules your reviews, and the ratings |
| [08 Speed and offline photos](docs/08-speed-and-offline.md) | Questions ready ahead, warm-up, photo cache |
| [09 Decks: big lists and editing](docs/09-decks.md) | Building big decks, file upload, the edit page |
| [10 Stats](docs/10-stats.md) | What each number and chart on the Stats page means |
| [11 Testing](docs/11-testing.md) | Running the tests, including the browser tests |
| [12 The website version](docs/12-website.md) | How it works, trying it locally, publishing on GitHub Pages |
| [13 Putting it online responsibly](docs/13-compliance.md) | iNaturalist, photo licence, map and privacy rules, and what to decide before publishing |
| [Roadmap](docs/roadmap.md) | What's done and what's next |
| [Requested changes](docs/requested-changes.md) | Wish list of changes and their status |
| [Changelog](CHANGELOG.md) | What changed in each version |

## Credits

Photos and data come from iNaturalist and its observers; each photo's
attribution and licence is shown after you answer. Please follow the
[iNaturalist API recommended practices](https://www.inaturalist.org/pages/api+recommended+practices).
