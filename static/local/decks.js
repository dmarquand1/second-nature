// Build and edit decks, like app/decks.py. Finding species runs as a background
// job (see jobs.js) and cards appear as they're found.
IQ.decks = (() => {
  const S = IQ.store, U = IQ.util, cfg = IQ.config, T = IQ.taxa, J = IQ.jobs;
  const HEADERS = new Set(["name", "species", "scientific_name", "scientific name", "common_name", "taxon_id", "taxon"]);

  // Split pasted text / CSV lines into names: first column, no blanks, comments, header or repeats.
  function cleanNames(names) {
    if (typeof names === "string") names = names.split(/\r?\n|\r/);
    const out = [], seen = new Set();
    for (let line of names || []) {
      line = String(line).trim().replace(/^﻿/, "");
      if (!line || line.startsWith("#")) continue;
      const first = line.split(/[,;\t]/)[0].trim().replace(/^"+|"+$/g, "").trim();
      if (!first || HEADERS.has(first.toLowerCase())) continue;
      const key = first.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(first); }
    }
    return out;
  }

  // Exact match against species we already know (no request needed).
  function localMatch(name) {
    const lower = name.toLowerCase();
    const row = S.all("taxa").find((t) => t.rank === "species" &&
      (t.name.toLowerCase() === lower || (t.common_name || "").toLowerCase() === lower));
    return row ? { id: row.id, name: row.name, preferred_common_name: row.common_name, rank: row.rank,
                   iconic_taxon_name: row.iconic_taxon_name } : null;
  }

  // One name -> [taxon, exact]; exact is false when we took iNaturalist's best guess.
  async function resolveName(name, o = {}) {
    name = name.trim();
    if (!name) return [null, true];
    const local = localMatch(name);
    if (local) return [local, true];
    let results = await IQ.inat.searchTaxa(name, "species", 10, o);
    if (!results.length) results = await IQ.inat.searchTaxa(name, null, 10, o);
    if (!results.length) return [null, true];
    const lower = name.toLowerCase();
    for (const t of results) {
      if ((t.name || "").toLowerCase() === lower || (t.preferred_common_name || "").toLowerCase() === lower) return [t, true];
    }
    for (const t of results) if ((t.matched_term || "").toLowerCase() === lower) return [t, true];
    return [results[0], false];
  }

  async function addTaxa(deckId, taxa) {
    let added = 0;
    const have = new Set(S.where("cards", (c) => c.deck_id === deckId).map((c) => c.taxon_id));
    for (const t of taxa) {
      await T.upsert(t);
      if (have.has(t.id)) continue;
      have.add(t.id);
      await S.insert("cards", { deck_id: deckId, taxon_id: t.id, added_at: U.now(), ...IQ.fsrs.newCard() });
      added++;
    }
    return added;
  }

  const cardCount = (deckId) => S.where("cards", (c) => c.deck_id === deckId).length;

  J.handler("build", async (jobId, deckId, params, progress, o) => {
    const source = params.source_type || "list";
    const room = cfg.MAX_DECK_SPECIES - cardCount(deckId);
    const result = { added: 0, not_found: [], guessed: [], not_species: [] };
    const add = async (taxa) => {
      const species = taxa.filter((t) => t.rank === "species");
      result.not_species.push(...taxa.filter((t) => t.rank !== "species").map((t) => `${t.name} (${t.rank})`));
      if (S.get("decks", deckId)) result.added += await addTaxa(deckId, species);
    };

    if (source === "list") {
      const names = cleanNames(params.species || []).slice(0, Math.max(room, 0));
      const total = names.length;
      progress(0, total, `Looking up ${total} names`, true);
      const ids = names.filter((n) => /^\d+$/.test(n));
      const words = names.filter((n) => !/^\d+$/.test(n));
      let done = 0;
      if (ids.length) {
        const found = await IQ.inat.taxaByIds(ids.map(Number), o);
        const foundIds = new Set(found.map((t) => String(t.id)));
        result.not_found.push(...ids.filter((i) => !foundIds.has(i)));
        await add(found);
        done += ids.length;
        progress(done, total, null, true);
      }
      let batch = [];
      for (const name of words) {
        if (!S.get("decks", deckId)) break;       // deck deleted while building
        let taxon = null, exact = true;
        try { [taxon, exact] = await resolveName(name, o); }
        catch (e) { result.not_found.push(`${name} (error: ${e.message})`); taxon = undefined; }
        if (taxon === null) result.not_found.push(name);
        else if (taxon) {
          if (!exact) result.guessed.push({ input: name, name: taxon.name, common_name: taxon.preferred_common_name ?? null });
          batch.push(taxon);
        }
        done++;
        // The very first species goes in at once (so studying can start), then in tens.
        if (batch.length >= (result.added === 0 ? 1 : 10)) { await add(batch); batch = []; }
        progress(done, total, `Looked up ${done} of ${total} names`);
      }
      await add(batch);
      progress(total, total, null, true);
    } else {
      const limit = Math.max(2, Math.min(Number(params.limit) || 30, room));
      progress(0, limit, "Asking iNaturalist for the most-observed species", true);
      let counts;
      if (params.lat != null && !params.place_id) {
        counts = await IQ.inat.speciesCounts({ taxon_id: params.taxon_id ?? null, lat: params.lat, lng: params.lng,
                                               radius_km: params.radius_km ?? null, per_page: Math.min(limit, 500) }, o);
      } else {
        counts = await IQ.inat.speciesCountsMany(limit, (n) => progress(n, limit, `Found ${n} species`),
          { taxon_id: params.taxon_id ?? null, place_id: params.place_id ?? null }, o);
      }
      await add(counts.slice(0, limit).map((c) => c.taxon));
      progress(limit, limit, null, true);
    }
    if (S.get("decks", deckId)) await J.submit("warmup", deckId, {}, true);
    return result;
  });

  function validateSource(type, p) {
    if (type === "list") { if (!cleanNames(p.species || []).length) throw U.error("Add at least one species name."); }
    else if (type === "taxon") { if (!p.taxon_id) throw U.error("Choose a group (taxon) first."); }
    else if (type === "place") { if (!p.place_id && p.lat == null) throw U.error("Choose a place first."); }
    else throw U.error(`Unknown deck type: ${type}`);
  }

  const clampInt = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isNaN(n) ? dflt : Math.max(lo, Math.min(n, hi)); };

  async function create(body) {
    const { name = "", source_type, num_choices, new_per_day, description = null, ...rest } = body || {};
    const params = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null));
    validateSource(source_type, params);
    const stored = { ...params }; delete stored.species;
    if (source_type === "list") stored.count = cleanNames(params.species || []).length;
    if (params.limit != null) params.limit = clampInt(params.limit, 2, cfg.MAX_DECK_SPECIES, 30);
    const deck = await S.insert("decks", {
      name: String(name).trim() || "Untitled deck", description, source_type, source_params: stored,
      place_id: params.place_id ?? null, place_name: params.place_name ?? null,
      num_choices: clampInt(num_choices, 4, 6, cfg.DEFAULT_NUM_CHOICES),
      new_per_day: clampInt(new_per_day, 0, 500, cfg.DEFAULT_NEW_PER_DAY), created_at: U.now(),
    });
    const jobId = await J.submit("build", deck.id, { source_type, ...params });
    return { ...getDeck(deck.id), job_id: jobId };
  }

  async function addSpecies(deckId, names) {
    names = cleanNames(names);
    if (!names.length) throw U.error("Add at least one species name.");
    return { job_id: await J.submit("build", deckId, { source_type: "list", species: names }), count: names.length };
  }

  async function addTaxaIds(deckId, ids) {
    const found = await IQ.inat.taxaByIds(ids);
    const added = await addTaxa(deckId, found.filter((t) => t.rank === "species"));
    await J.submit("warmup", deckId, {}, true);
    return { added, not_species: found.filter((t) => t.rank !== "species").map((t) => `${t.name} (${t.rank})`) };
  }

  async function removeCards(deckId, taxonIds) {
    const ids = new Set(taxonIds.map(Number));
    const cards = S.where("cards", (c) => c.deck_id === deckId && ids.has(c.taxon_id)).map((c) => c.id);
    await dropCards(cards);
    return cards.length;
  }

  async function dropCards(cardIds) {
    const set = new Set(cardIds);
    await S.remove("questions", S.where("questions", (q) => set.has(q.card_id)).map((q) => q.id));
    await S.remove("reviews", S.where("reviews", (r) => set.has(r.card_id)).map((r) => r.id));
    await S.remove("cards", cardIds);
  }

  async function updateSettings(deckId, b) {
    const f = {};
    if (b.name != null && String(b.name).trim()) f.name = String(b.name).trim();
    if (b.description != null) f.description = String(b.description).trim() || null;
    if (b.num_choices != null) f.num_choices = clampInt(b.num_choices, 4, 6, 5);
    if (b.new_per_day != null) f.new_per_day = clampInt(b.new_per_day, 0, 500, cfg.DEFAULT_NEW_PER_DAY);
    if (b.clear_place) { f.place_id = null; f.place_name = null; }
    else if (b.place_id != null) { f.place_id = Number(b.place_id); f.place_name = b.place_name ?? null; }
    await S.update("decks", deckId, f);
    if (b.clear_place || b.place_id != null) await J.submit("warmup", deckId, {}, true);
  }

  async function remove(deckId) {
    await dropCards(S.where("cards", (c) => c.deck_id === deckId).map((c) => c.id));
    await S.remove("questions", S.where("questions", (q) => q.deck_id === deckId).map((q) => q.id));
    await S.remove("decks", deckId);
  }

  function summary(d) {
    const revs = S.where("reviews", (r) => r.deck_id === d.id);
    const right = revs.reduce((n, r) => n + (r.correct ? 1 : 0), 0);
    return {
      ...d, source_params: d.source_params || {},
      num_cards: cardCount(d.id), num_reviews: revs.length,
      accuracy: revs.length ? Math.round((right / revs.length) * 1000) / 1000 : null,
      queue: IQ.scheduler.queueCounts(d.id),
      building: S.where("jobs", (j) => j.deck_id === d.id && j.kind === "build" && ["queued", "running"].includes(j.status)).length > 0,
    };
  }

  const list = () => S.all("decks").sort((a, b) => b.created_at - a.created_at).map(summary);

  function getDeck(deckId) {
    const row = S.get("decks", deckId);
    if (!row) return null;
    const d = summary(row);
    const stats = new Map();
    for (const r of S.where("reviews", (r) => r.deck_id === deckId)) {
      const s = stats.get(r.card_id) || { seen: 0, right: 0 };
      s.seen++; s.right += r.correct ? 1 : 0;
      stats.set(r.card_id, s);
    }
    d.cards = S.where("cards", (c) => c.deck_id === deckId).map((c) => {
      const t = S.get("taxa", c.taxon_id) || { name: "?" };
      const s = stats.get(c.id) || { seen: 0, right: 0 };
      return { card_id: c.id, taxon_id: c.taxon_id, name: t.name, common_name: t.common_name ?? null,
               photo_url: T.photoFor(t), seen: s.seen, right: s.right, lapses: c.lapses, state: c.state,
               due: c.due, stability: c.stability };
    }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    d.jobs = J.deckJobs(deckId);
    return d;
  }

  return { cleanNames, resolveName, create, addSpecies, addTaxaIds, removeCards, updateSettings, remove, list, get: getDeck };
})();
