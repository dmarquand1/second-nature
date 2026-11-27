# 05 Data model

SQLite file: `data/inat_quiz.db` (created automatically). Schema: `app/db.py`.

| Table | One row per | Key columns |
|---|---|---|
| `api_cache` | iNat API response | `cache_key` (path + params), `response` JSON, `fetched_at` |
| `taxa` | species we've seen | names, photo, `genus_id`, `family_id`, `order_id` |
| `decks` | deck | `source_type`, `source_params` JSON, `place_id`, `num_choices` |
| `cards` | species in a deck | `deck_id`, `taxon_id`, **FSRS state columns** |
| `observations` | iNat observation in the photo pool | `photos` JSON (url, attribution, licence), lat/lng, date, `times_shown` |
| `questions` | question shown | `card_id`, `observation_id`, `choices` JSON, `answered` |
| `reviews` | answer given | `correct`, `rating` (1-4), `response_ms`, `chosen_taxon_id`, `reviewed_at` |

## Ready for FSRS (step 6)

`cards` already has the fields FSRS needs:
`state` (0 new, 1 learning, 2 review, 3 relearning), `due`, `stability`,
`difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `last_review`.

Each answer is turned into an FSRS-style rating in
`scheduler.rating_from_answer`: wrong = 1 Again, slow (>15 s) = 2 Hard,
normal = 3 Good, fast (<4 s) = 4 Easy. Step 6 only needs to replace
`pick_next_card` (choose due cards) and `apply_rating` (update FSRS state)
in `app/scheduler.py`.

## Ready for stats (step 7)

`reviews` records every answer with time, rating, response time, what you
chose and which options were shown. That supports accuracy per species,
"most confused with" pairs, progress over time, and so on, with plain SQL.
