// Settings and small helpers for the website version (everything runs in the browser).
// These match app/config.py, so both versions behave the same.
window.IQ = window.IQ || {};

IQ.config = {
  INAT_API_BASE: "https://api.inaturalist.org/v1",
  // iNaturalist asks API users to stay at or below ~1 request per second.
  // Each visitor's browser keeps to this on its own.
  MIN_SECONDS_BETWEEN_REQUESTS: 1.0,
  CACHE_TTL: {                       // seconds a cached iNat answer stays fresh
    taxa: 30 * 86400, places: 30 * 86400, similar_species: 14 * 86400,
    species_counts: 7 * 86400, observations: 3 * 86400, default: 86400,
  },
  // Kept small so the site stays light: saved iNaturalist answers only make repeat visits
  // faster, so old ones are simply dropped (and fetched again if ever needed).
  CACHE_MAX_AGE_DAYS: 14,            // older cached answers are deleted when the page opens
  CACHE_MAX_ENTRIES: 1500,           // and only the newest this many are kept
  QUESTIONS_KEPT_DAYS: 2,            // prepared questions older than this are deleted (answers are kept)
  DEFAULT_NUM_CHOICES: 5,
  MAX_PHOTOS_PER_QUESTION: 4,
  OBSERVATIONS_PER_TAXON: 12,       // observations kept per species (50 in the local app; smaller here to save space)
  PHOTOS_KEPT_PER_OBSERVATION: 4,   // photos kept per observation (a question shows at most 4)
  NEARBY_RADIUS_KM: 100,
  NEARBY_GRID_DEG: 1.0,
  PREFETCH_PENDING_MINUTES: 10,
  WARMUP_IMAGES_FOR_NEXT: 15,
  MAX_DECK_SPECIES: 5000,
  // Where wrong answers come from (deck setting, see app/config.py ANSWER_SOURCES).
  ANSWER_SOURCES: ["anywhere", "mostly_deck", "deck"],
  // The order new species are introduced in (deck setting, see app/config.py NEW_ORDERS).
  MAX_NO_PHOTO_SKIPS: 10,            // species without usable photos one question may skip (and take out)
  NEW_ORDERS: ["random", "added", "common", "rare", "hard", "easy", "grouped", "varied"],
  DESIRED_RETENTION: 0.9,
  DEFAULT_NEW_PER_DAY: 20,
  DAY_STARTS_AT_HOUR: 4,
  // iNaturalist's "Alive or Dead" annotation (controlled term 17; value 19 = Dead).
  ALIVE_OR_DEAD_TERM: 17,
  DEAD_VALUE: 19,
  // Daily request budget per browser. iNaturalist asks API users to stay well under
  // 10,000 requests a day; background work (warm-up, building big decks) stops at the
  // lower number so there's always room left for studying.
  DAILY_REQUEST_LIMIT: 9000,
  DAILY_BACKGROUND_LIMIT: 7000,
  // The only photo licences the website shows: Creative Commons and public domain.
  // "All rights reserved" photos may not be shown on a public website.
  OPEN_LICENCES: ["cc0", "cc-by", "cc-by-nc", "cc-by-sa", "cc-by-nd", "cc-by-nc-sa", "cc-by-nc-nd"],
};

// Settings the player can change (kept in this browser only).
IQ.settings = {
  get(key, fallback) {
    try { const v = localStorage.getItem((IQ.config.SETTINGS_PREFIX || "iq.") + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem((IQ.config.SETTINGS_PREFIX || "iq.") + key, JSON.stringify(value)); } catch {} },
  // Always true on the website (see OPEN_LICENCES above). Tests can switch it off with
  // IQ.config.ALLOW_ALL_LICENCES to check the filter really works.
  openLicenceOnly() { return !(IQ.config.ALLOW_ALL_LICENCES && this.get("openLicenceOnly", true) === false); },
};

IQ.util = {
  now: () => Date.now() / 1000,             // unix seconds, like Python's time.time()
  random: Math.random,                      // tests swap this for a seeded one
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

  // Python's round(): halves go to the even number (round(2.5) == 2).
  pyRound(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  },

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(IQ.util.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  unique: (arr) => [...new Set(arr)],

  // An error with an HTTP-like status, shown to the player as a message.
  error(message, status = 400) { const e = new Error(message); e.status = status; return e; },

  clone: (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x))),
};
