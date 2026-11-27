# Changelog

## 0.1.0 (2026-11-27) - first local version

- Project setup: FastAPI backend, SQLite database, plain HTML/JS frontend, `python run.py` to start.
- iNaturalist API client with SQLite response cache and 1 request/second rate limit.
- Decks from a species list, a taxon, or common species in a place; optional place focus.
- Hard distractors: iNat similar species, same genus, related deck members, same family nearby.
- Quiz screen: up to 4 photos, map, date, 4-6 choices, keyboard shortcuts, reveal with links and attribution.
- Data model ready for FSRS spaced repetition (step 6) and stats (step 7).
- Offline test suite with a fake iNaturalist client.
