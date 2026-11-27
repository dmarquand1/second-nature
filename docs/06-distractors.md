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

## Tuning

- Radius for "nearby": `NEARBY_RADIUS_KM` in `app/config.py`.
- Number of choices per deck: 4-6, set when creating the deck.
