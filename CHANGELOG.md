# Changelog

## 0.2.0 (2026-11-27) - spaced repetition

- FSRS-5 scheduler (`app/fsrs.py`): stability, difficulty and intervals per species, 90% target retention.
- Queue like Anki: due cards first, mixed with new species up to a daily limit per deck (default 20),
  learning steps of 1 and 5 minutes, relearning after 10 minutes.
- After each answer: Again / Hard / Good / Easy buttons showing the next interval. A rating is suggested
  from correctness and answer speed; wrong answers are always Again.
- "All done for now" screen with time of next review, plus a Keep practising mode.
- Due / new counts on the decks page, deck page and quiz header. Deck settings (name, new per day, choices).
- Database upgrades itself on start (keeps existing decks); answers from 0.1 are kept, those cards start as new.
- New endpoints: `POST /api/questions/{id}/rate`, `PATCH /api/decks/{id}`, `?practice=true` on `/next`.

## 0.1.0 (2026-11-27) - first local version

- Project setup: FastAPI backend, SQLite database, plain HTML/JS frontend, `python run.py` to start.
- iNaturalist API client with SQLite response cache and 1 request/second rate limit.
- Decks from a species list, a taxon, or common species in a place; optional place focus.
- Hard distractors: iNat similar species, same genus, related deck members, same family nearby.
- Quiz screen: up to 4 photos, map, date, 4-6 choices, keyboard shortcuts, reveal with links and attribution.
- Data model ready for FSRS spaced repetition (step 6) and stats (step 7).
- Offline test suite with a fake iNaturalist client.
