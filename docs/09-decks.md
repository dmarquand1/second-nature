# 09 Decks: big lists and editing

## Building a deck

**New deck** offers three sources:

| Source | You give | Notes |
|---|---|---|
| A species list | Names, one per line, or a **.txt / .csv file** | Scientific names, common names or iNat taxon ids. For CSV the first column is used; a header row and `#` comments are skipped; duplicates removed. |
| A group (taxon) | e.g. *Turdus*, Odonata, Fungi | The most-observed species in it (optionally in a place). |
| Common species in a place | e.g. United Kingdom | Optionally only one group, e.g. Odonata in Norfolk. |

Up to **5,000 species** per deck (`MAX_DECK_SPECIES` in `app/config.py`).

### Big lists take a while

Each name is one request at 1 per second, so 600 names take about 10 minutes.
This runs in the background:

- The deck page shows a progress bar.
- Species appear as they're found (in batches of 10), so you can **start
  studying straight away**.
- Faster cases: taxon ids are looked up 30 per request; species already known
  from another deck need no request.

When it finishes, the deck page reports:

- **added**
- **not found on iNaturalist**: check the spelling
- **matched by best guess**: no exact name match, so iNat's top result was used. Check these.
- **skipped (not a species)**: e.g. a genus name

If you stop the app while a list is being looked up, the job is marked
"interrupted"; add the missing names again from **Edit deck**.

## The deck page

Search box, sort (A–Z, most mistakes, due soonest, new first) and "Show more"
paging, so decks with thousands of species stay quick.

## Editing a deck

Deck page > **Edit deck**:

| Section | What you can do |
|---|---|
| Details | Name, description, new species per day, choices per question, **focus place** (photos and look-alikes come from there; clear it for worldwide). |
| Add species | Search iNaturalist and click a result to add it; or paste names; or load a .txt/.csv file. |
| Species | Filter, tick species (or "Select all shown"), **Remove selected**. Removing deletes that species' history in this deck. |
| Delete deck | Deletes the deck and all its history. |

## Hiding photos of dead organisms

iNaturalist users can annotate an observation **Alive or Dead: Dead** (roadkill,
a bird found dead, pinned insects, shed skins). Each deck has a setting,
**Hide photos of dead organisms**, on the New deck and Edit pages. It's **on by
default**: those observations are skipped and the next photo is used instead.

* Only observations someone has annotated are recognised, so an occasional
  un-annotated dead one can still appear.
* If every photo of a species is annotated dead, one is shown anyway rather than
  leaving the species out.
* Photos saved by earlier versions are checked once, the first time each species
  comes up (usually from the saved iNaturalist answers, so no extra waiting).
