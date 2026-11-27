# 07 Spaced repetition (FSRS)

The app uses **FSRS** (Free Spaced Repetition Scheduler), the algorithm
built into Anki. Code: `app/fsrs.py` (the maths) and `app/scheduler.py`
(the queue). Each species in a deck is one card.

## What FSRS tracks per card

| Value | Meaning |
|---|---|
| **Stability** | Days until your chance of remembering drops to 90%. Grows every time you get it right. |
| **Difficulty** | 1 (easy for you) to 10 (hard for you). Goes up on Again, down on Easy. |
| **Retrievability** | Your chance of remembering right now. Falls the longer since the last review. |

A card comes back when its retrievability is about to fall below the
target retention (90% by default), so the interval grows as you learn it.

## Ratings

After each answer you rate it. The app **suggests** a rating; press
`Enter` to accept it or `1`-`4` to choose.

| Rating | Key | When | Suggested if |
|---|---|---|---|
| **Again** | 1 | Got it wrong, or guessed | the answer was wrong (forced) |
| **Hard** | 2 | Right, but it was a struggle | right but took over 15 s |
| **Good** | 3 | Right after normal thinking | right in 4-15 s |
| **Easy** | 4 | Knew it instantly | right in under 4 s |

Tip: if you got it right by luck, choose **Again** or **Hard** so FSRS
doesn't think you know it.

Each button shows when you'd see the species next with that rating,
e.g. *Again 1 min · Hard 5 min · Good 3 days · Easy 16 days* for a new card.

## The card's life

```
 NEW ──Again/Hard──▶ LEARNING (back in 1 / 5 min) ──Good/Easy──▶ REVIEW (days → months)
  │                                                                │   ▲
  └────────Good/Easy───────────────────────────────────────────────┘   │
                                                       Again           │ Good/Easy
                                              REVIEW ──────▶ RELEARNING (10 min)
```

## The daily queue

1. **Due cards** (reviews and learning steps), most overdue first, mixed with
2. **New species**, up to the deck's *new species per day* (default 20,
   change it under **Settings** on the deck page). A "day" starts at 4 am.
3. Learning cards due within the next 20 minutes.
4. Then **All done for now**. You can **Keep practising**: extra reviews
   still update FSRS, but because the card wasn't due yet they count for little.

The same species never appears twice in a row when there's another option.

## Settings

| Setting | Where | Default |
|---|---|---|
| New species per day | Deck page > Settings, or when creating a deck | 20 |
| Target retention | `DESIRED_RETENTION` in `app/config.py` (or env var `INAT_QUIZ_RETENTION`) | 0.9 |
| Day starts at | `DAY_STARTS_AT_HOUR` in `app/config.py` | 4 (am) |

Higher target retention means more reviews and fewer forgotten species.

## Upgrading from 0.1

Your decks and past answers are kept. Cards answered with the 0.1
placeholder scheduler had no FSRS state, so they start as new cards.
