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
2. `scheduler.pick_next_card` chooses a species (card) from the deck.
3. `quiz._choose_observation` takes a research-grade observation of it from the
   local pool, fetching up to 50 from iNaturalist the first time (place-focused
   if the deck has a place, worldwide otherwise). Least-shown photos come first.
4. `distractors.pick_distractors` picks 3-5 hard wrong answers (see [06](06-distractors.md)).
5. The question is saved in `questions` and returned **without the answer**.
6. `POST /api/questions/{qid}/answer` checks it, writes a `reviews` row,
   updates the card via `scheduler.apply_rating`, and returns the answer,
   the observation link and the photo attributions.

The frontend starts loading the next question while you read the answer,
so the wait is mostly hidden.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search/taxa?q=` | Taxon autocomplete |
| GET | `/api/search/places?q=` | Place autocomplete |
| GET | `/api/decks` | List decks with counts and accuracy |
| POST | `/api/decks` | Create a deck (`source_type`: `list`, `taxon`, `place`) |
| GET | `/api/decks/{id}` | Deck with its species |
| DELETE | `/api/decks/{id}` | Delete a deck and its history |
| POST | `/api/decks/{id}/species` | Add species by name |
| DELETE | `/api/decks/{id}/species/{taxon_id}` | Remove a species |
| GET | `/api/decks/{id}/next` | Next question |
| POST | `/api/questions/{id}/answer` | Answer (`taxon_id`, `response_ms`) |

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
`static/views/`. The map uses Leaflet with OpenStreetMap tiles.
