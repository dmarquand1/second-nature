# Requested changes

Wish list. Each item moves to the CHANGELOG when it ships.
Status: **Planned** (agreed, not started), **In progress**, **Done (version)**.

## Shipped in v0.3

### 1. Faster loading between questions
*Requested 2026-11-27.* Status: **Done (0.3.0)**.

Why it's slow now: the next question is only prepared after you answer; the
first question for each species needs about 5-6 iNaturalist calls at 1 per
second; the "related species found nearby" lookup depends on each photo's
exact location, so it repeats almost every question; photos only download
once shown.

Plan:
- Keep 2-3 questions ready ahead while you look at the current one, and
  download their photos in the background.
- When a deck is opened, fetch photos and look-alikes for all its species in
  the background ("warm-up"), with a small progress indicator.
- Group nearby locations into a coarser grid so the "found nearby" lookup is reused.

### 2. Edit a deck
*Requested 2026-11-27.* Status: **Done (0.3.0)**.

A proper edit page: rename; add species with a search box (same as New deck)
or by pasting a list; remove species (one at a time or several at once);
change or clear the focus place; new species per day; choices per question.

### 3. Much bigger species lists
*Requested 2026-11-27.* Status: **Done (0.3.0)**.

Now: pasted lists are looked up one name per second while the page waits,
and group/place decks stop at 200 species.

Plan:
- Build decks in the background with a progress bar, so lists of hundreds or
  thousands of names work and the page never times out.
- Look up iNat taxon ids in batches (many per request) when ids are given.
- Group/place decks up to 1,000+ species (paged requests).
- Upload a text or CSV file of names as well as pasting.
- Deck page copes with big decks: search/filter box and paging instead of one huge grid.
- Report names that weren't found or matched more than one species, so you can fix them.

### 4. Stats page
*Requested 2026-11-27.* Status: **Done (0.3.0)** (step 7 of the original plan).

- Overall: answers, accuracy, study streak, reviews per day chart.
- Progress: species by state (new / learning / known / mature), how this changes over time.
- Species you struggle with: lowest accuracy, most lapses, highest FSRS difficulty.
- Confusion pairs: "you picked X when it was Y" most often, with links to compare.
- Upcoming reviews: how many are due over the next days.
- Per deck and across all decks.

### 5. Zoom into photos
*Requested 2026-11-27.* Status: **Done (0.3.0)**.

Click the photo (or press `Z`) to open it full screen; zoom with the mouse
wheel or pinch, drag to pan, double-click to reset; arrow keys switch photos.
Loads the original-resolution image when zoomed in.

### 6. Polish (step 8 of the original plan)
*Requested 2026-11-27.* Status: **Done (0.3.0)**.

Keyboard shortcuts help (`?`), photo licences with links, offline photo cache,
your past mix-ups used as wrong-answer options.

### 7. Tests for every new feature
*Requested 2026-11-27.* Status: **Done (0.3.0)**. See [11 Testing](11-testing.md).

## Shipped in v0.3.1

### 8. Even faster
*Requested 2026-11-27.* Status: **Done (0.3.1)**.

Batched lookups, fewer fallback lookups, medium photos first, first question
sooner on a new deck, optional live iNaturalist checks. See [08](08-speed-and-offline.md).

### 9. Tests on a locked-down work laptop
*Reported 2026-11-27.* Status: **Done (0.3.1)**.

Browser tests are skipped instead of erroring when Playwright is blocked.

## Shipped in v0.4.0

### 10. A website version
*Requested 2026-11-27.* Status: **Done (0.4.0)**. See [12 The website version](12-website.md).

Runs entirely in the browser: each player's browser talks to iNaturalist
directly, progress is kept in the browser with backup/restore, free hosting on
GitHub Pages. The local app keeps working.

### 11. Photo licences
*Discussed 2026-11-27.* Status: **Done (0.4.0)**.

The website version doesn't copy photos (they load from iNaturalist) and uses
open-licence photos only by default, switchable in Settings.

## Shipped in v0.4.2

### 18. Option to keep wrong answers within the deck
*Noted 2026-11-27.* Status: **Done (0.4.5)**.

Should the possible answers be limited to species in the deck? It matters more
the smaller the deck is, so make it a deck option rather than the rule:
anywhere (default), mostly this deck, or only this deck.

### 17. Welcome tour for new players
*Noted 2026-11-27.* Status: **Done (0.4.4)**.

Add a tutorial for new users (those with no data), and make it possible to skip it.

### 16. Keep the website's saved data small
*Noted 2026-11-27.* Status: **Done (0.4.3)**.

The website may be saving more than most people would like. Cut right back on
what is saved, without losing progress: keep only the fields the app uses from
iNaturalist, delete saved results sooner, keep fewer photos per species, tidy
up old questions and jobs, and add a "Free up space" button.

### 15. Favour photos with more favourites
*Requested 2026-11-27.* Status: **Done (0.4.2)**. See [09 Decks](09-decks.md#which-photos-favouring-well-liked-photos).

A deck setting: Mixed (default), Best first, or Any.

## Shipped in v0.4.1

### 14. Hide photos of dead organisms
*Requested 2026-11-27.* Status: **Done (0.4.1)**. See [09 Decks](09-decks.md#hiding-photos-of-dead-organisms).

A deck setting, on by default, that skips observations annotated "Dead" on iNaturalist.

### 12. Friendlier message when the app is already running
*Noted 2026-11-27.* Status: **Done (0.4.1)**.

`python run.py` shows a confusing "[Errno 10048] error while attempting to bind"
when another copy is already using port 8000. It should say so in plain words
and suggest stopping the other copy or using `--port 8001`.

### 13. Ask the browser to keep progress permanently
*Noted 2026-11-27.* Status: **Done (0.4.1)**.

Call `navigator.storage.persist()` in the website version, so the browser
(especially Safari, which can clear sites unused for 7 days) is less likely to
delete saved progress. Show the result in Settings.

## Open

Nothing yet. Add new requests here.

## Done

| Change | Version |
|---|---|
| "Wrong answers from" deck setting | 0.4.5 |
| Welcome tour for new players (skippable) | 0.4.4 |
| Lighter website storage, Free up space button | 0.4.3 |
| Favour well-liked photos (Which photos setting) | 0.4.2 |
| Hide dead organisms, plain "already running" message, keep browser progress | 0.4.1 |
| Website version (browser only, GitHub Pages, backup, open-licence photos) | 0.4.0 |
| Batched lookups, medium photos first, live checks, skip blocked browser tests | 0.3.1 |
| Faster loading, offline photos, big lists, edit deck, stats, zoom, polish, tests | 0.3.0 |
| FSRS spaced repetition | 0.2.0 |
| First local version (decks, distractors, quiz) | 0.1.0 |
