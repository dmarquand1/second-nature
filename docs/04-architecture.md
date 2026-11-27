# 04 Architecture

```
 Browser (static/)                FastAPI (app/)                    iNaturalist API
 ─────────────────                ──────────────                    ───────────────
 views/new-deck.js  ──POST /api/decks──▶ decks.py ─────┐
 views/quiz.js      ──GET  /next ──────▶ quiz.py ──────┤
                    ──POST /answer ────▶ quiz.py       ├──▶ inat_client.py ──(≤1 req/s)──▶ api.inaturalist.org
                                         distractors.py┤        │
                                         scheduler.py  │        ▼
                                         taxa.py ──────┘   SQLite api_cache
                                              │
                                              ▼
                                     SQLite data/inat_quiz.db
```

## Request flow for one question

1. `GET /api/decks/{id}/next`
2. `scheduler.pick_next_card` chooses a species (card): due cards, then new ones (daily limit), see [07](07-spaced-repetition.md).
3. `quiz._choose_observation` takes a research-grade observation of it from the
   local pool, fetching up to 50 from iNaturalist the first time (place-focused
   if the deck has a place, worldwide otherwise). Least-shown photos come first.
4. `distractors.pick_distractors` picks 3-5 hard wrong answers (see [06](06-distractors.md)).
5. The question is saved in `questions` and returned **without the answer**.
6. `POST /api/questions/{qid}/answer` checks it, writes a `reviews` row,
   runs FSRS on the card with a suggested rating (`scheduler.apply_rating`),
   and returns the answer, the observation link, photo attributions and the
   next interval for each rating.
7. If you pick a different rating, `POST /api/questions/{qid}/rate` resets the
   card to how it was and re-runs FSRS with your rating.

The frontend keeps 2 questions prepared ahead, and a background warm-up
fetches what each species needs before you get to it. See
[08 Speed and offline photos](08-speed-and-offline.md). Background work runs in
one worker thread (`app/jobs.py`) and always gives way to the quiz.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search/taxa?q=` | Taxon autocomplete |
| GET | `/api/search/places?q=` | Place autocomplete |
| GET | `/api/decks` | List decks with counts, accuracy, whether still being built |
| POST | `/api/decks` | Create a deck (`source_type`: `list`, `taxon`, `place`); species are found in a background job (`job_id`) |
| GET | `/api/decks/{id}` | Deck with its species |
| DELETE | `/api/decks/{id}` | Delete a deck and its history |
| POST | `/api/decks/{id}/species` | Add names (list or text) in the background; returns `job_id` |
| POST | `/api/decks/{id}/taxa` | Add species by taxon id (from the search box) |
| POST | `/api/decks/{id}/remove` | Remove several species (`taxon_ids`) |
| DELETE | `/api/decks/{id}/species/{taxon_id}` | Remove one species |
| POST / GET | `/api/decks/{id}/warmup` | Start / check the deck warm-up |
| GET | `/api/jobs/{id}` | Progress and result of a background job |
| GET | `/api/stats?deck_id=` | Everything on the Stats page (all decks without `deck_id`) |
| GET | `/api/img?u=` | A photo through the offline cache (iNat photo hosts only) |
| GET | `/api/info` | Version and photo cache size |
| PATCH | `/api/decks/{id}` | Change name, description, `new_per_day`, `num_choices`, `place_id`/`place_name`, `clear_place` |
| GET | `/api/decks/{id}/next` | Next question, or `{"done": true}` when nothing is due (`?practice=true` keeps going) |
| POST | `/api/questions/{id}/answer` | Answer (`taxon_id`, `response_ms`); returns suggested rating and intervals |
| POST | `/api/questions/{id}/rate` | Change the rating (`rating` 1-4) |

Interactive API docs are at <http://127.0.0.1:8000/docs> while the app runs.

## iNaturalist endpoints used

| Endpoint | Used for | Cached for |
|---|---|---|
| `/taxa/autocomplete`, `/taxa` | searching / resolving names | 30 days |
| `/taxa/{id}` | genus, family and order of a species | 30 days |
| `/places/autocomplete` | place search | 30 days |
| `/observations/species_counts` | building decks, congeners, nearby species | 7 days |
| `/identifications/similar_species` | commonly confused species | 14 days |
| `/observations` (research grade, with photos) | quiz photos | 3 days |

If iNaturalist can't be reached, an expired cached response is used instead.
Settings live in `app/config.py`.

## Frontend

Plain HTML/CSS/JS, no build step. `app.js` is a tiny hash router
(`#/`, `#/new`, `#/deck/3`, `#/quiz/3`), each screen is one file in
`static/views/`. The map uses Leaflet with OpenStreetMap tiles. `viewer.js`
is the zoomable photo viewer, `shortcuts.js` the `?` help. Each page checks
`stillHere()` after loading data, so a slow response never draws over the page
you've moved to.

## Website version (0.4)

The same screens also run without the Python server. `web/index.html` loads
`static/local/*.js`, a JavaScript translation of the `app/` modules that keeps
its data in the browser (IndexedDB) and calls iNaturalist straight from the
browser. `api.request()` in `static/api.js` sends each `/api/...` request to
`IQ.router.handle()` when that exists, so the views don't know which version
they're in. Details: [12 The website version](12-website.md).
