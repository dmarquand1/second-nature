# 08 Speed and offline photos

iNaturalist allows about **1 request per second**. A brand-new species needs
around 5-6 requests (taxonomy, photo pool, similar species, congeners, nearby
species), so the app works ahead of you instead of making you wait.

## What happens

| When | What the app does | Code |
|---|---|---|
| You create a deck | Species are found in the background (progress bar on the deck page). Then a **warm-up** starts. | `app/decks.py`, `app/jobs.py` |
| Warm-up | For each species, soonest-due first: taxonomy, the pool of research-grade observations, the look-alike candidates for the photo you'll see next, and the photos for the next 15 species. | `app/warmup.py` |
| You open a deck to study | The warm-up is started again if needed (it skips what's already cached). A small bar shows its progress. | `static/views/quiz.js` |
| You look at a question | The next **2 questions** are prepared and their photos downloaded. | `static/views/quiz.js` (`AHEAD`) |
| A photo is shown | It's served from `data/images/` if it's there, otherwise downloaded once and saved. | `app/images.py` |

Requests for the question you're looking at always **go before** background
work in the 1-per-second queue (`RateLimiter` in `app/inat_client.py`).

"Same family found nearby" lookups are shared by all photos in the same
1° × 1° grid cell (about 110 × 70 km in the UK), instead of one per photo.

## What to expect

- A **brand-new deck**: the first question takes about 10-20 seconds while the
  first species are found. Questions get faster as the warm-up progresses.
- A **warmed-up deck**: the next question appears almost instantly.

## Offline photo cache

- Location: `data/images/` (ignored by git).
- Size limit: 1.5 GB, set with `IMAGE_CACHE_MAX_MB` in `app/config.py` or the
  environment variable `INAT_QUIZ_IMAGE_CACHE_MB`. When the app starts, the
  least recently viewed photos are deleted until it's under the limit.
- Only iNaturalist photo servers are fetched through it.
- To clear it: stop the app and delete the `data/images` folder.

With a warmed-up deck and the photo cache, you can keep studying without internet
(the map tiles need internet, though).

## Settings (`app/config.py`)

| Setting | Default | Meaning |
|---|---|---|
| `NEARBY_GRID_DEG` | 1.0 | Grid size for shared "nearby" lookups |
| `WARMUP_IMAGES_FOR_NEXT` | 15 | How many upcoming species get their photos downloaded by the warm-up |
| `PREFETCH_PENDING_MINUTES` | 10 | How long a prepared-but-unanswered question keeps its species reserved |
| `IMAGE_CACHE_MAX_MB` | 1500 | Photo cache size limit |
