# 06 How the wrong answers are chosen

Code: `app/distractors.py`. The goal is options that are genuinely
plausible for *this* photo, from *this* place.

## Candidate sources and scores

| Source | Score |
|---|---|
| iNaturalist **similar species** (species identifiers often confuse with it) | 3.0 + bonus for how often |
| **Same genus** (most-observed congeners, in the deck's place if set) | 2.5 |
| **Other species in the deck** | 0.5, +2.0 same genus, +1.5 same family, +1.0 same order |
| **Same family observed within 100 km** of the photo | 1.5 |
| Same family anywhere (only if still short) | 1.0 |
| Same order nearby (only if still short) | 0.5 |

A species found by several sources adds up its scores, so a congener that is
also commonly confused and also lives nearby ranks highest.

## Picking

The top `3 × needed` candidates form a pool, and the wrong answers are drawn
at random weighted by score², so the hardest options appear most often but
the set still varies between questions.

## Wrong answers from (deck setting)

Each deck chooses where its wrong answers come from (**New deck** and **Edit** pages):

| Setting | What you get |
|---|---|
| **Lookalikes from anywhere** (default) | Everything above: iNaturalist lookalikes, relatives, nearby species and deck species |
| **Mostly this deck** | Species in the deck first. Only if the deck has fewer species than wrong answers needed are lookalikes from outside added |
| **Only this deck** | Only species in the deck. A small deck shows fewer choices (a 3-species deck shows 3) |

With the two deck options, deck species are scored by how related they are
(genus 2.5, family 2.0, order 1.5, otherwise 0.5), plus the iNaturalist
"similar species" score and your own mix-ups, so the closest lookalikes
in the deck still come up most often. Only one iNaturalist lookup is needed
(similar species, usually already saved). A deck with a single species falls
back to lookalikes, so there is always something to choose from.

Why "anywhere" is the default: in the field you may meet species that aren't
in your deck, and in a small deck, answers from the deck alone get too easy
(you can answer by elimination). "Only this deck" suits a fixed list, such
as a survey checklist, especially a big one that already contains the real
lookalikes.

## Tuning

- Radius for "nearby": `NEARBY_RADIUS_KM` in `app/config.py`.
- Number of choices per deck: 4-6, set when creating the deck.
