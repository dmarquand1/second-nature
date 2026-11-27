# 05 Data model

SQLite file: `data/inat_quiz.db` (created automatically). Schema: `app/db.py`.

| Table | One row per | Key columns |
|---|---|---|
| `api_cache` | iNat API response | `cache_key` (path + params), `response` JSON, `fetched_at` |
| `taxa` | species we've seen | names, photo, `genus_id`, `family_id`, `order_id` |
| `decks` | deck | `source_type`, `source_params` JSON, `place_id`, `num_choices`, `new_per_day` |
| `cards` | species in a deck | `deck_id`, `taxon_id`, **FSRS state columns** |
| `observations` | iNat observation in the photo pool | `photos` JSON (url, attribution, licence), lat/lng, date, `times_shown` |
| `questions` | question shown | `card_id`, `observation_id`, `choices` JSON, `answered` |
| `jobs` | background job | `kind` (build / warmup), `status`, `done` / `total` progress, `result` JSON |
| `reviews` | answer given | `correct`, `rating` (1-4), `response_ms`, `chosen_taxon_id`, `reviewed_at`, `card_before` / `card_after` (FSRS state JSON) |

## FSRS state (step 6, done in 0.2.0)

`cards` holds each species' FSRS state:
`state` (0 new, 1 learning, 2 review, 3 relearning), `due` (unix time),
`stability` (days), `difficulty` (1-10), `elapsed_days`, `scheduled_days`,
`reps`, `lapses`, `last_review`. See [07 Spaced repetition](07-spaced-repetition.md).

Each `reviews` row stores the card's state before and after the answer, so
a rating can be changed afterwards and the full history can later be used to
tune FSRS to you.

## Upgrading the database

`app/db.py` has a `MIGRATIONS` list. On start, the app runs any upgrades
your database hasn't had yet (tracked with SQLite's `PRAGMA user_version`),
so you never need to delete `data/inat_quiz.db` when updating.

| Version | Change |
|---|---|
| 1 | Original 0.1.0 tables |
| 2 | `decks.new_per_day`, `reviews.card_before`/`card_after`; 0.1 cards reset to new |
| 3 | `jobs` table; indexes for pending questions, review times and name lookups |

Photos are not in the database: they're files in `data/images/` (see [08](08-speed-and-offline.md)).

## Version 0.4.1 (migration 4)

* `decks.hide_dead`: 1 (default) skips observations annotated "Alive or Dead: Dead".
* `observations.dead`: 1 if annotated dead, 0 if not, empty for photos saved
  before 0.4.1 (checked again the next time the species comes up).

## Version 0.4.2 (migration 5)

* `decks.photo_choice`: `mixed` (default), `best` or `any` (see [09 Decks](09-decks.md)).
* `observations.faves`: how many iNaturalist users favourited the observation.

## Version 0.4.5 (migration 6)

* `decks.answer_source`: `anywhere` (default), `mostly_deck` or `deck`: where wrong answers
  come from (see [06 Distractors](06-distractors.md)).

## Version 0.4.6 (migration 7)

* `decks.new_order`: the order new species are introduced in (see [09 Decks](09-decks.md#new-species-order)).
* `taxa.obs_count`: how many observations the species has on iNaturalist (for common/rare first).

## Version 0.4.8 (migration 8)

* `decks.no_photos`: JSON list of species (`id`, `name`, `common_name`) taken out of the deck because
  iNaturalist has no research-grade photos of them that can be shown.

## Ready for stats (step 7)

`reviews` records every answer with time, rating, response time, what you
chose and which options were shown. That supports accuracy per species,
"most confused with" pairs, progress over time, and so on, with plain SQL.
