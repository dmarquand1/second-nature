# 12 The website version

From version 0.4 the quiz also runs as a **website**: a set of files that any
web host can serve, with no Python server behind it. You can try it on your own
computer first and then publish it for free with **GitHub Pages**.

The local app (`python run.py`) still works exactly as before. Both versions use
the same screens.

## How it works

```
 Player's browser                                       iNaturalist
 ┌──────────────────────────────────────────┐
 │ screens (static/views/*.js)              │
 │    │  api.get("/api/decks/3/next")       │
 │    ▼                                     │
 │ static/local/router.js   (the "backend", │   1 request/s    api.inaturalist.org
 │   decks, quiz, FSRS, look-alikes, stats) │ ───────────────► (names, observations,
 │    │                                     │                   look-alikes)
 │    ▼                                     │
 │ IndexedDB (browser storage):             │   photos         inaturalist-open-data
 │   decks, cards, answers, iNat cache      │ ◄─────────────── .s3.amazonaws.com
 └──────────────────────────────────────────┘
```

* **No server, no account.** The Python code from `app/` is translated to
  JavaScript in `static/local/` (one file per Python module, same rules). The
  screens call the same `/api/...` addresses; in the website version
  `static/api.js` hands them to `static/local/router.js` instead of a server.
* **Each player talks to iNaturalist directly**, from their own browser. The
  1 request per second limit applies per player, so more players don't slow each
  other down and you never need an API key. Answers are cached in the browser
  (IndexedDB), like the local app caches them in SQLite.
* **It stays light.** The browser saves your decks, species and answers, plus a
  small, short-lived copy of recent iNaturalist results so the quiz is quick:
  - only the fields the app uses are saved, and search-as-you-type isn't saved;
  - saved results are deleted after 14 days, and at most the newest 1,500 are kept;
  - 12 observations per species, at most 4 photos each;
  - each time the page opens it tidies away old prepared questions, finished
    background jobs, photo lists for species you've removed, and extra copies on
    old answers. Nothing that counts as progress is deleted;
  - **Settings → Free up space** deletes the saved results and photo lists now,
    and keeps your progress. The next few questions take a moment longer.
* **Photos load straight from iNaturalist.** Nothing is copied or re-hosted.
  Only photos with an **open licence** (Creative Commons or public domain) are
  used, and the photographer and licence are shown under every photo. See
  [13 Putting it online responsibly](13-compliance.md) for all the rules the
  site follows.
* **A daily budget**: each browser makes at most 1 request per second and at
  most 9,000 a day (background work pauses at 7,000), within iNaturalist's guidance.
* **Progress is saved in the player's browser.** It survives closing the tab and
  restarting the computer, but it's tied to that browser on that computer. Use
  **Settings → Download backup** to keep a copy or move it to another computer
  (**Restore from a backup**). Clearing the browser's site data deletes it.
* **Background work only runs while the page is open.** If you close the tab
  while a big deck is being built, it shows as "interrupted"; add the rest from
  **Edit** (names already found are instant the second time).

| Local app (`python run.py`) | Website version |
|---|---|
| Python + SQLite on your computer | JavaScript + IndexedDB in the browser |
| Photos saved in `data/images` (work offline) | Photos load from iNaturalist (browser caches them a while) |
| All photos | Open-licence photos only |
| 50 observations kept per species | 12 observations kept per species, 4 photos each (keeps the browser light) |
| `http://127.0.0.1:8000` | `http://127.0.0.1:8000/play/` locally, or your GitHub Pages address |

## Try it on your computer

1. Start the app as usual:
   ```bash
   cd path/to/your/project/folder     # the folder with README.md in it
   source .venv/Scripts/activate
   python run.py
   ```
2. Open **http://127.0.0.1:8000/play/** in your browser.
3. Create a deck and study. Note the extra **Settings** link at the top.
   This version keeps its own decks (in the browser), separate from the local app's.
4. Open **http://127.0.0.1:8000/play/tests.html** to run its tests in your
   browser (about 2 seconds, everything should be green). And
   **http://127.0.0.1:8000/play/tests.html?live** checks it against the real
   iNaturalist (about a minute).

## Publish it on GitHub Pages (free)

GitHub Pages serves the website from your repository. The file
`.github/workflows/pages.yml` does the work: every time you push changes to
`web/` or `static/` on your main branch (`main` or `master`), GitHub puts the site together and
publishes it.

**Before you publish**, read [13 Putting it online responsibly](13-compliance.md)
(5 minutes): it lists what the app does to follow iNaturalist's, the photo
licences' and OpenStreetMap's rules, and the few things only you can decide.

**One-time setup:**

0. **Rename the repository** (once, before publishing): on GitHub open the
   repository → **Settings** → **General** → **Repository name** → type
   `second-nature` → **Rename**. Then in Git Bash, point your laptop at the new
   name (replace `YOUR-USERNAME`):
   ```bash
   cd path/to/your/project/folder     # the folder with README.md in it
   git remote set-url origin https://github.com/YOUR-USERNAME/second-nature.git
   git remote -v
   ```
   The web address becomes `https://YOUR-USERNAME.github.io/second-nature/`.
1. Push version 0.4 as usual (see the Git Bash block in the release notes or
   [03 Git workflow](03-git-workflow.md)).
2. On GitHub, open your repository → **Settings** → **Pages** (left menu).
3. Under **Build and deployment** → **Source**, choose **GitHub Actions**.
4. Open the **Actions** tab → **Publish website** → **Run workflow** → **Run
   workflow** (green button). Only needed this first time; after that it runs
   by itself on every push.
5. Wait about a minute until the run has a green tick. Click it: the address
   of your site is shown under **publish**, normally
   `https://<your-github-username>.github.io/second-nature/`.

**Good to know**

* GitHub Pages is free for **public** repositories. For a private repository it
  needs a paid GitHub plan. Making the repository public shows its code to
  everyone; there's nothing secret in it (no passwords or keys).
* Your site's address is public, but each visitor gets their own empty quiz:
  nobody can see anyone else's decks or progress.
* The tests are published too, at `.../inat-quiz/tests.html`.
* After an update, browsers pick up the new files because every script has the
  version number on it (`?v=0.4.0`).

## Files

| File | What it does |
|---|---|
| `web/index.html` | The website's page: loads `static/local/*` then the shared screens |
| `static/local/config.js` | Settings (rate limit, cache times, licences) and small helpers |
| `static/local/store.js` | Browser storage (IndexedDB), tidying up, free up space, backup and restore |
| `static/local/inat.js` | iNaturalist client: 1 req/s, quiz first, slim cache, open-licence filter |
| `static/local/fsrs.js`, `scheduler.js` | Spaced repetition (same numbers as `app/fsrs.py`, checked by a test) |
| `static/local/taxa.js`, `decks.js`, `distractors.js`, `quiz.js`, `warmup.js`, `stats.js`, `jobs.js` | Same as the Python modules with the same names |
| `static/local/router.js` | Answers the screens' `/api/...` requests |
| `static/updates.js` | What's new page (add an entry for each version players would notice) |
| `static/tutorial.js` | Welcome tour for new players (shared with the local app) |
| `static/views/settings.js` | Settings page: backup, restore, privacy, requests today, free up space, delete everything |
| `web/tests.html`, `web/tests/` | Tests for the website version (with a pretend iNaturalist) |
| `.github/workflows/pages.yml` | Publishes the website on GitHub Pages |

## Later

Sign-in, so progress follows you between computers without backup files, needs
a small server to store accounts and answers (not photos). That can come later;
the backup file format (`app: "inat-quiz"`, `version: 1`) is designed so it can
be uploaded to such a server.
