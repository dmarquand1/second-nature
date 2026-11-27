"""SQLite database: schema and connection helper.

The schema is designed so spaced repetition (FSRS, step 6) and stats
(step 7) can be added without restructuring:
  * `cards` already carries the FSRS state columns.
  * `reviews` logs every answer with rating, timing and the choices shown.
"""
import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_cache (
    cache_key   TEXT PRIMARY KEY,
    response    TEXT NOT NULL,          -- JSON body from iNaturalist
    fetched_at  REAL NOT NULL           -- unix time
);

CREATE TABLE IF NOT EXISTS taxa (
    id                  INTEGER PRIMARY KEY,   -- iNaturalist taxon id
    name                TEXT NOT NULL,         -- scientific name
    common_name         TEXT,
    rank                TEXT,
    iconic_taxon_name   TEXT,
    ancestor_ids        TEXT,                  -- JSON list
    genus_id            INTEGER,
    family_id           INTEGER,
    order_id            INTEGER,
    photo_url           TEXT,
    wikipedia_url       TEXT,
    details_fetched     INTEGER NOT NULL DEFAULT 0,  -- 1 once ancestors are known
    updated_at          REAL
);

CREATE TABLE IF NOT EXISTS decks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    source_type     TEXT NOT NULL,      -- 'list' | 'taxon' | 'place'
    source_params   TEXT NOT NULL,      -- JSON of the options used to build it
    place_id        INTEGER,            -- optional iNat place to focus photos/distractors on
    place_name      TEXT,
    num_choices     INTEGER NOT NULL DEFAULT 5,
    created_at      REAL NOT NULL
);

-- One card per species per deck. FSRS columns are filled in by step 6.
CREATE TABLE IF NOT EXISTS cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id         INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    taxon_id        INTEGER NOT NULL REFERENCES taxa(id),
    added_at        REAL NOT NULL,
    -- FSRS state (step 6)
    state           INTEGER NOT NULL DEFAULT 0,   -- 0 new, 1 learning, 2 review, 3 relearning
    due             REAL,                         -- unix time the card is next due
    stability       REAL,
    difficulty      REAL,
    elapsed_days    REAL NOT NULL DEFAULT 0,
    scheduled_days  REAL NOT NULL DEFAULT 0,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    last_review     REAL,
    UNIQUE (deck_id, taxon_id)
);

CREATE TABLE IF NOT EXISTS observations (
    id                  INTEGER PRIMARY KEY,   -- iNaturalist observation id
    taxon_id            INTEGER NOT NULL,      -- species it belongs to (deck species)
    obs_taxon_id        INTEGER,               -- exact taxon on iNat (may be a subspecies)
    photos              TEXT NOT NULL,         -- JSON list of {url, attribution, license}
    latitude            REAL,
    longitude           REAL,
    obscured            INTEGER NOT NULL DEFAULT 0,
    positional_accuracy REAL,
    place_guess         TEXT,
    observed_on         TEXT,
    observer            TEXT,
    uri                 TEXT,
    pool_place_id       INTEGER,               -- place filter used when fetched (NULL = worldwide)
    times_shown         INTEGER NOT NULL DEFAULT 0,
    last_shown          REAL,
    fetched_at          REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_taxon ON observations(taxon_id);

-- A question that has been shown but maybe not yet answered.
CREATE TABLE IF NOT EXISTS questions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id         INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    observation_id  INTEGER NOT NULL,
    choices         TEXT NOT NULL,      -- JSON list of taxon ids, in display order
    created_at      REAL NOT NULL,
    answered        INTEGER NOT NULL DEFAULT 0
);

-- Review log: one row per answer. Feeds FSRS (step 6) and stats (step 7).
CREATE TABLE IF NOT EXISTS reviews (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id         INTEGER REFERENCES questions(id) ON DELETE SET NULL,
    deck_id             INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_id             INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    taxon_id            INTEGER NOT NULL,
    observation_id      INTEGER,
    chosen_taxon_id     INTEGER,
    correct             INTEGER NOT NULL,
    rating              INTEGER,        -- FSRS rating 1 Again, 2 Hard, 3 Good, 4 Easy
    response_ms         INTEGER,
    choices             TEXT,           -- JSON list of taxon ids shown
    reviewed_at         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_reviews_deck ON reviews(deck_id);
"""


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def get_conn():
    """Open a connection, commit on success, always close."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
