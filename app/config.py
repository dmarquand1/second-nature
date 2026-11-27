"""App settings. Override any of these with environment variables if needed."""
import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("INAT_QUIZ_DATA_DIR", ROOT_DIR / "data"))
DB_PATH = Path(os.environ.get("INAT_QUIZ_DB", DATA_DIR / "inat_quiz.db"))
STATIC_DIR = ROOT_DIR / "static"

INAT_API_BASE = "https://api.inaturalist.org/v1"
# iNaturalist asks API users to stay at or below ~1 request per second.
INAT_MIN_SECONDS_BETWEEN_REQUESTS = float(os.environ.get("INAT_RATE_LIMIT_SECONDS", "1.0"))
INAT_USER_AGENT = "inat-quiz-local/0.1 (personal species ID practice tool)"
INAT_TIMEOUT_SECONDS = 30.0

# How long cached API responses stay fresh, in seconds.
CACHE_TTL = {
    "taxa": 30 * 24 * 3600,
    "places": 30 * 24 * 3600,
    "similar_species": 14 * 24 * 3600,
    "species_counts": 7 * 24 * 3600,
    "observations": 3 * 24 * 3600,
    "default": 24 * 3600,
}

# Quiz defaults
DEFAULT_NUM_CHOICES = 5          # allowed range 4-6
MAX_PHOTOS_PER_QUESTION = 4
OBSERVATIONS_PER_TAXON = 50      # size of the photo pool fetched per species
NEARBY_RADIUS_KM = 100           # "co-occurring in the region" radius
NEARBY_GRID_DEG = 1.0            # photos in the same 1-degree cell share one "nearby" lookup

# Speed
PREFETCH_PENDING_MINUTES = 10    # questions prepared ahead count as "in use" for this long
WARMUP_IMAGES_FOR_NEXT = 15      # warm-up downloads photos for this many upcoming species

# Offline photo cache (data/images)
IMAGE_CACHE_DIR = DATA_DIR / "images"
IMAGE_CACHE_MAX_MB = int(os.environ.get("INAT_QUIZ_IMAGE_CACHE_MB", "1500"))
IMAGE_HOSTS = (
    "inaturalist-open-data.s3.amazonaws.com",
    "static.inaturalist.org",
    "www.inaturalist.org",
)

# Big lists
MAX_DECK_SPECIES = 5000

# Spaced repetition (FSRS)
DESIRED_RETENTION = float(os.environ.get("INAT_QUIZ_RETENTION", "0.9"))  # 0.7-0.97
DEFAULT_NEW_PER_DAY = 20         # new species introduced per deck per day
DAY_STARTS_AT_HOUR = 4           # like Anki: a "day" runs 4am to 4am, local time
