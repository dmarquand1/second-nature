// iNaturalist API client for the website version.
//
// Each player's browser talks to iNaturalist directly (no server in between):
//   * at most one request per second from this browser (iNaturalist's guideline),
//     with the quiz you're looking at going ahead of background work;
//   * answers are cached in IndexedDB, trimmed to the fields the app uses, so repeat lookups are instant;
//   * if two parts of the app ask for the same thing at once, only one request is made;
//   * if iNaturalist can't be reached, an older cached answer is used when there is one.
// Same endpoints and behaviour as app/inat_client.py.
IQ.inat = (() => {
  const cfg = IQ.config;
  const inFlight = new Map();       // cache key -> Promise
  let minInterval = cfg.MIN_SECONDS_BETWEEN_REQUESTS * 1000;
  let fetcher = defaultFetch;       // tests replace this with a fake iNaturalist

  // ---- rate limit with priority ---------------------------------------------
  const waiting = [];               // {bg, go}
  let last = 0, timer = null;
  function slot(bg) {
    return new Promise((go) => { waiting.push({ bg, go }); pump(); });
  }
  function pump() {
    if (timer || !waiting.length) return;
    const delay = Math.max(0, last + minInterval - Date.now());
    timer = setTimeout(() => {
      timer = null;
      let i = waiting.findIndex((w) => !w.bg);     // foreground first
      if (i < 0) i = 0;
      const [w] = waiting.splice(i, 1);
      last = Date.now();
      w.go();
      pump();
    }, delay);
  }

  function snapToGrid(value, grid) {
    return Math.round((Math.floor(Number(value) / grid) * grid + grid / 2) * 10000) / 10000;
  }

  function cacheKey(path, params) {
    const keys = Object.keys(params).filter((k) => params[k] != null).sort();
    return path + "?" + keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  }

  async function defaultFetch(path, query) {
    const res = await fetch(cfg.INAT_API_BASE + path + (query ? "?" + query : ""), {
      headers: { Accept: "application/json" },
    });
    return { status: res.status, json: () => res.json(), text: () => res.text() };
  }

  // Requests made today by this browser (study day, reset at DAY_STARTS_AT_HOUR).
  function todayCount() {
    const day = IQ.stats ? IQ.stats.dayKey(IQ.util.now()) : new Date().toDateString();
    const c = IQ.settings.get("requests", null);
    return c && c.day === day ? c : { day, n: 0 };
  }
  function countRequest() { const c = todayCount(); c.n++; IQ.settings.set("requests", c); }
  function checkBudget(bg) {
    const n = todayCount().n;
    if (n >= (bg ? cfg.DAILY_BACKGROUND_LIMIT : cfg.DAILY_REQUEST_LIMIT)) {
      throw IQ.util.error(bg
        ? "Paused getting decks ready for today, to stay within iNaturalist's daily limit. It carries on tomorrow; studying still works."
        : "This browser has reached today's limit of requests to iNaturalist. Practise what's ready, or come back tomorrow.", 502);
    }
  }

  // The real request: rate limited, retried on network errors, 429 and 5xx.
  async function fetchJson(path, params, bg) {
    const query = cacheKey("", params).slice(1);
    for (let attempt = 0; attempt < 3; attempt++) {
      checkBudget(bg);
      await slot(bg);
      countRequest();
      let res;
      try { res = await fetcher(path, query); }
      catch (e) {
        if (attempt === 2) throw IQ.util.error(`Could not reach iNaturalist: ${e.message}`, 502);
        await IQ.util.sleep(2000 * (attempt + 1) * (minInterval ? 1 : 0));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await IQ.util.sleep(5000 * (attempt + 1) * (minInterval ? 1 : 0));
        continue;
      }
      if (res.status >= 400) {
        const t = await res.text().catch(() => "");
        throw IQ.util.error(`iNaturalist returned ${res.status} for ${path}: ${t.slice(0, 200)}`, 502);
      }
      return res.json();
    }
    throw IQ.util.error(`iNaturalist kept failing for ${path}`, 502);
  }

  // ---- keep only what the app uses ---------------------------------------------
  // iNaturalist's answers are much bigger than what we need (every observation comes
  // with its full identification history, user profile and so on). We keep just the
  // fields the app reads, so saved answers take a small fraction of the space.
  const pick = (o, keys) => {
    const out = {};
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
    return out;
  };
  function slimTaxon(t) {
    if (!t) return t;
    const out = pick(t, ["id", "name", "preferred_common_name", "rank", "iconic_taxon_name", "ancestor_ids",
                         "wikipedia_url", "matched_term", "observations_count"]);
    if (t.ancestors) out.ancestors = t.ancestors.map((a) => ({ id: a.id, rank: a.rank }));
    if (t.default_photo) out.default_photo = pick(t.default_photo, ["square_url", "medium_url", "url", "license_code"]);
    return out;
  }
  function slimObservation(o) {
    const out = pick(o, ["id", "observed_on", "place_guess", "location", "obscured", "positional_accuracy", "faves_count"]);
    if (o.user) out.user = { login: o.user.login };
    if (o.taxon) out.taxon = pick(o.taxon, ["id", "ancestor_ids"]);
    const open = (p) => (cfg.OPEN_LICENCES.includes((p.license_code || "").toLowerCase()) ? 0 : 1);
    out.photos = (o.photos || []).filter((p) => p.url).sort((a, b) => open(a) - open(b))   // open-licence first
      .slice(0, cfg.PHOTOS_KEPT_PER_OBSERVATION)
      .map((p) => pick(p, ["url", "attribution", "license_code"]));
    const ann = (o.annotations || []).filter((a) => a.controlled_attribute_id === cfg.ALIVE_OR_DEAD_TERM)
      .map((a) => ({ controlled_attribute_id: a.controlled_attribute_id, controlled_value_id: a.controlled_value_id }));
    if (ann.length) out.annotations = ann;
    return out;
  }
  function slim(path, data) {
    if (!data || !Array.isArray(data.results)) return data;
    let fn;
    if (path.startsWith("/observations/species_counts") || path.startsWith("/identifications/similar_species")) {
      fn = (r) => ({ count: r.count, taxon: slimTaxon(r.taxon) });
    } else if (path.startsWith("/observations")) fn = slimObservation;
    else if (path.startsWith("/taxa")) fn = slimTaxon;
    else return data;
    return { total_results: data.total_results, results: data.results.map(fn) };
  }

  // GET with cache. o.bg = background priority (warm-up and deck building).
  // o.noCache = don't save it (search-as-you-type answers, which are rarely asked twice).
  function get(path, params = {}, ttlKind = "default", o = {}) {
    const key = cacheKey(path, params);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = (async () => {
      const ttl = cfg.CACHE_TTL[ttlKind] ?? cfg.CACHE_TTL.default;
      const row = o.noCache ? null : await IQ.store.cacheGet(key);
      if (row && IQ.util.now() - row.fetched_at < ttl) return row.response;
      let data;
      try { data = slim(path, await fetchJson(path, params, !!o.bg)); }
      catch (e) { if (row) return row.response; throw e; }
      if (!o.noCache) await IQ.store.cachePut(key, data);
      return data;
    })();
    inFlight.set(key, p);
    p.finally(() => inFlight.delete(key)).catch(() => {});
    return p;
  }

  async function cached(path, params = {}) {
    return (await IQ.store.cacheGet(cacheKey(path, params))) !== null;
  }

  // Only photos with an open licence, unless the player switched that off.
  const licenceParam = () => (IQ.settings.openLicenceOnly() ? cfg.OPEN_LICENCES.join(",") : null);

  // Most-favourited observations first (order_by=votes), so the photo pool includes the
  // photos people rated best. Falls back to iNat's default order if that's ever refused.
  async function byFaves(params, o) {
    try { return (await get("/observations", { ...params, order_by: "votes" }, "observations", o)).results; }
    catch (e) {
      if (!/ returned 4\d\d /.test(e.message)) throw e;
      return (await get("/observations", params, "observations", o)).results;
    }
  }

  // ---- endpoints ----------------------------------------------------------------
  const onlySpecies = (rs) => rs.filter((r) => (r.taxon || {}).rank === "species");

  return {
    snapToGrid, cacheKey, get, cached, slim, requestsToday: () => todayCount().n,
    setFetcher(fn) { fetcher = fn || defaultFetch; },
    setMinInterval(seconds) { minInterval = seconds * 1000; },

    async autocompleteTaxa(q, perPage = 10) {
      return (await get("/taxa/autocomplete", { q, per_page: perPage, is_active: "true" }, "taxa", { noCache: true })).results;
    },
    async searchTaxa(q, rank = null, perPage = 10, o = {}) {
      return (await get("/taxa", { q, rank, per_page: perPage, is_active: "true" }, "taxa", o)).results;
    },
    async taxaByIds(ids, o = {}) {           // 30 per request
      ids = ids.map(Number);
      let out = [];
      for (let i = 0; i < ids.length; i += 30) {
        out = out.concat((await get(`/taxa/${ids.slice(i, i + 30).join(",")}`, {}, "taxa", o)).results);
      }
      return out;
    },
    async autocompletePlaces(q, perPage = 10) {
      return (await get("/places/autocomplete", { q, per_page: perPage }, "places", { noCache: true })).results;
    },
    async speciesCounts({ taxon_id = null, place_id = null, lat = null, lng = null, radius_km = null,
                          per_page = 100, page = 1 } = {}, o = {}) {
      const g = cfg.NEARBY_GRID_DEG;
      const params = {
        quality_grade: "research", taxon_id, place_id,
        lat: lat == null ? null : snapToGrid(lat, g), lng: lng == null ? null : snapToGrid(lng, g),
        radius: radius_km, per_page: Math.min(per_page, 500), page: page > 1 ? page : null,
      };
      return onlySpecies((await get("/observations/species_counts", params, "species_counts", o)).results);
    },
    async speciesCountsMany(limit, progress, { taxon_id = null, place_id = null } = {}, o = {}) {
      let out = [], page = 1;
      while (out.length < limit) {
        const raw = await get("/observations/species_counts", {
          quality_grade: "research", taxon_id, place_id, per_page: 500, page: page > 1 ? page : null,
        }, "species_counts", o);
        const results = raw.results || [];
        out = out.concat(onlySpecies(results));
        if (progress) progress(Math.min(out.length, limit));
        if (results.length < 500 || page * 500 >= (raw.total_results || 0)) break;
        page++;
      }
      return out.slice(0, limit);
    },
    async similarSpecies(taxonId, placeId = null, o = {}) {
      const params = { taxon_id: taxonId, quality_grade: "research", place_id: placeId };
      return onlySpecies((await get("/identifications/similar_species", params, "similar_species", o)).results);
    },
    async observations(taxonId, placeId = null, perPage = 50, o = {}) {
      const params = { taxon_id: taxonId, place_id: placeId, quality_grade: "research", photos: "true",
                       photo_license: licenceParam(), per_page: perPage };
      return byFaves(params, o);
    },
    async observationsMany(taxonIds, placeId = null, perPage = 200, o = {}) {
      const params = { taxon_id: taxonIds.map(Number).join(","), place_id: placeId, quality_grade: "research",
                       photos: "true", photo_license: licenceParam(), per_page: Math.min(perPage, 200) };
      return byFaves(params, o);
    },
  };
})();
