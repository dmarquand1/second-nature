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

## Which photos: favouring well-liked photos

iNaturalist users can **favourite** observations, and favourited ones tend to have
sharp, well-lit photos. The app fetches each species' photos most-favourited first,
and each deck has a **Which photos** setting (New deck and Edit pages):

| Choice | What you see |
|---|---|
| **Mixed** (default) | Favourited photos are likelier to come up first, but ordinary field photos still appear. A good balance: "textbook" shots to learn from, real-life ones to test you. |
| **Best first** | Most-favourited photos first, until you've seen them all. |
| **Any** | Favourites make no difference. |

Whatever you choose, a photo you've seen fewer times always comes before one you've
seen more, so you work through all of a species' photos. Many good photos have no
favourites at all, especially for less popular species, so favourites are a
preference, not a filter.

## Wrong answers from

Choose whether wrong answers are lookalikes from anywhere (default), mostly
from this deck, or only from this deck. See
[06 How the wrong answers are chosen](06-distractors.md#wrong-answers-from-deck-setting).

## New species order

Choose the order each deck introduces new species in (**New deck** and **Edit**).
Due reviews always come first; this only changes which *new* species comes next.

| Setting | Order |
|---|---|
| **Mixed up** (default) | Random |
| **In the order added** | As added. Group and place decks add the most-seen species first |
| **Common species first** | Most observations on iNaturalist first (worldwide) |
| **Rare species first** | Fewest observations first |
| **Relatives of the ones you find hardest** | Species in the same genus (then family, then order) as the ones you find hardest, by FSRS difficulty. Tackles the tricky groups head on |
| **Relatives of the ones you know best** | Builds out from what you already know |
| **One group at a time** | Finishes the genus and family you've started, then moves on, genus by genus |
| **Variety first** | Species unlike any you've started, for a broad sweep before the fine detail |

Until you've studied a few species, the relative-based orders have nothing to go
on and behave like **Mixed up**. Ties are always in random order. Code:
`order_new` in `app/scheduler.py` and `orderNew` in `static/local/scheduler.js`.

## Species with no usable photos

Some species, usually very rare ones, have no research-grade photos on
iNaturalist (and on the website, only openly licensed photos can be shown).
These are taken out of the deck automatically, either by the warm-up after the
deck is built or as soon as the quiz meets one, and the next species is shown
instead. The deck page lists them under **"N species taken out"**, with links to
iNaturalist. If photos appear later, add them again from **Edit deck**. A failed
connection never takes a species out: only an answer from iNaturalist saying
there are no usable photos does.
