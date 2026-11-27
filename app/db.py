"""SQLite database: schema and connection helper.

The schema is designed so spaced repetition (FSRS, step 6) and stats
(step 7) can be added without restructuring:
  * `cards` already carries the FSRS state columns.
  * `reviews` logs every answer with rating, timing and the choices shown.
"""
import sqlite3
import time
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


# Upgrades for databases created by older versions. Each entry runs once,
# in order; PRAGMA user_version records how far a database has got.
MIGRATIONS = [
    # 1: version 0.1.0 schema (created by SCHEMA above)
    "",
    # 2: FSRS (version 0.2.0)
    """
    ALTER TABLE decks ADD COLUMN new_per_day INTEGER NOT NULL DEFAULT 20;
    ALTER TABLE reviews ADD COLUMN card_before TEXT;   -- JSON of the card's FSRS state before this answer
    ALTER TABLE reviews ADD COLUMN card_after TEXT;    -- JSON of the card's FSRS state after this answer
    -- Cards answered with the old placeholder scheduler have no FSRS state yet: start them as new.
    UPDATE cards SET state = 0, due = NULL WHERE stability IS NULL;
    CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(deck_id, due);
    """,
    # 3: background jobs, faster lookups (version 0.3.0)
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL,              -- 'build' (find species for a deck) | 'warmup'
        deck_id     INTEGER REFERENCES decks(id) ON DELETE CASCADE,
        status      TEXT NOT NULL,              -- queued | running | done | failed | interrupted
        params      TEXT,                       -- JSON
        total       INTEGER NOT NULL DEFAULT 0,
        done        INTEGER NOT NULL DEFAULT 0,
        message     TEXT,
        result      TEXT,                       -- JSON (e.g. names not found)
        created_at  REAL NOT NULL,
        finished_at REAL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_deck ON jobs(deck_id, kind, status);
    CREATE INDEX IF NOT EXISTS idx_questions_pending ON questions(deck_id, answered, created_at);
    CREATE INDEX IF NOT EXISTS idx_reviews_time ON reviews(reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_taxa_name ON taxa(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_taxa_common ON taxa(common_name COLLATE NOCASE);
    """,
    # 4: hide photos of dead organisms (version 0.4.1)
    """
    ALTER TABLE decks ADD COLUMN hide_dead INTEGER NOT NULL DEFAULT 1;   -- 1 = skip observations annotated "Dead"
    ALTER TABLE observations ADD COLUMN dead INTEGER;                    -- 1 dead, 0 alive/unknown, NULL = not checked yet
    """,
    # 5: favour well-liked photos (version 0.4.2)
    """
    ALTER TABLE decks ADD COLUMN photo_choice TEXT NOT NULL DEFAULT 'mixed';  -- 'mixed' | 'best' | 'any'
    ALTER TABLE observations ADD COLUMN faves INTEGER;                       -- favourites on iNaturalist
    """,
    # 6: where wrong answers come from (version 0.4.5)
    """
    ALTER TABLE decks ADD COLUMN answer_source TEXT NOT NULL DEFAULT 'anywhere';  -- 'anywhere' | 'mostly_deck' | 'deck'
    """,
    # 7: order of new species (version 0.4.6)
    """
    ALTER TABLE decks ADD COLUMN new_order TEXT NOT NULL DEFAULT 'random';  -- see config.NEW_ORDERS
    ALTER TABLE taxa ADD COLUMN obs_count INTEGER;                          -- observations on iNaturalist (all of it)
    """,
    # 8: species taken out of a deck because they have no usable photos (version 0.4.8)
    """
    ALTER TABLE decks ADD COLUMN no_photos TEXT;   -- JSON list of {id, name, common_name}
    """,
]


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for i, script in enumerate(MIGRATIONS, start=1):
            if i > version:
                if script.strip():
                    conn.executescript(script)
                conn.execute(f"PRAGMA user_version = {i}")
        # Jobs that were running when the app was last stopped can't continue.
        conn.execute("UPDATE jobs SET status = 'interrupted', finished_at = ? "
                     "WHERE status IN ('queued', 'running')", (time.time(),))
