# Requested changes

Dan's wish list. Each item moves to the CHANGELOG when it ships.
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

## Open

Nothing yet. Add new requests here.

## Done

| Change | Version |
|---|---|
| Faster loading, offline photos, big lists, edit deck, stats, zoom, polish, tests | 0.3.0 |
| FSRS spaced repetition | 0.2.0 |
| First local version (decks, distractors, quiz) | 0.1.0 |
