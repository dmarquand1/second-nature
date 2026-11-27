// Hard wrong answers ("look-alikes"), same scoring as app/distractors.py
// (see docs/06-distractors.md), including the deck setting "Wrong answers from".
IQ.distractors = (() => {
  const S = IQ.store, U = IQ.util, cfg = IQ.config, T = IQ.taxa, inat = IQ.inat;

  function add(cands, taxon, score, reason) {
    if (taxon.rank !== "species") return;
    let c = cands.get(taxon.id);
    if (!c) { c = { taxon, score: 0, reasons: [] }; cands.set(taxon.id, c); }
    c.score += score;
    if (!c.reasons.includes(reason)) c.reasons.push(reason);
  }

  function yourConfusions(targetId) {
    const counts = new Map();
    for (const r of S.where("reviews", (r) => !r.correct && (r.taxon_id === targetId || r.chosen_taxon_id === targetId))) {
      const other = r.taxon_id === targetId ? r.chosen_taxon_id : r.taxon_id;
      if (other == null) continue;
      counts.set(other, (counts.get(other) || 0) + 1);
    }
    return [...counts].map(([id, n]) => ({ t: S.get("taxa", id), n })).filter((x) => x.t)
      .sort((a, b) => b.n - a.n).slice(0, 10);
  }

  // Other species in the deck, weighted by how related they are.
  function addDeckMembers(cands, target, deckId, targetId) {
    for (const c of S.where("cards", (c) => c.deck_id === deckId && c.taxon_id !== targetId)) {
      const m = S.get("taxa", c.taxon_id);
      if (!m) continue;
      let score = 0.5;
      if (m.details_fetched) {
        if (target.genus_id && m.genus_id === target.genus_id) score += 2.0;
        else if (target.family_id && m.family_id === target.family_id) score += 1.5;
        else if (target.order_id && m.order_id === target.order_id) score += 1.0;
      } else if (target.iconic_taxon_name && m.iconic_taxon_name === target.iconic_taxon_name) score += 0.5;
      add(cands, { id: m.id, name: m.name, preferred_common_name: m.common_name, rank: m.rank,
                   iconic_taxon_name: m.iconic_taxon_name }, score, "in this deck");
    }
  }

  // Only species in the deck, scored by relatedness, iNat "similar species" and your mix-ups
  // (deck setting "Wrong answers from"). At most one iNaturalist lookup, usually already saved.
  async function deckCandidates(targetId, deckId, placeId = null, o = {}) {
    const target = await T.ensureDetails(targetId, o);
    const cands = new Map();
    addDeckMembers(cands, target, deckId, targetId);
    if (!cands.size) return cands;
    let similar = [];
    try { similar = await inat.similarSpecies(targetId, placeId, o); } catch (e) { if (e.status !== 502) throw e; }
    for (const r of similar) {
      const c = cands.get(r.taxon.id);
      if (c) add(cands, c.taxon, 3.0 + Math.log1p(r.count || 0) * 0.5, "similar species");
    }
    for (const { t, n } of yourConfusions(targetId)) {
      const c = cands.get(t.id);
      if (c) add(cands, c.taxon, 2.0 + Math.min(n * 0.5, 2.0), "you've mixed these up before");
    }
    cands.delete(targetId);
    return cands;
  }

  const answerSource = (deckId) => (deckId && (S.get("decks", deckId) || {}).answer_source) || "anywhere";
  // Whether lookalikes from outside the deck are needed for this setting. "Only this deck" with
  // no other species would leave nothing to choose from, so that tops up too.
  const needsOutside = (source, inside, needed) =>
    source === "anywhere" || (inside < needed && (source === "mostly_deck" || inside === 0));

  function weightedSample(cands, n) {
    const pool = [...cands.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(n * 3, 10));
    const chosen = [];
    while (pool.length && chosen.length < n) chosen.push(pool.splice(weightedIndex(pool.map((c) => c.score ** 2)), 1)[0]);
    return chosen;
  }

  // Look up (and so save) what pick() will need, for the deck's setting. Used by warm-up.
  async function prepare(targetId, deckId, placeId, lat, lng, needed, o = {}) {
    const source = answerSource(deckId);
    const inside = source !== "anywhere" ? await deckCandidates(targetId, deckId, placeId, o) : new Map();
    if (needsOutside(source, inside.size, needed)) await gatherCandidates(targetId, deckId, placeId, lat, lng, needed, o);
  }

  async function gatherCandidates(targetId, deckId = null, placeId = null, lat = null, lng = null, needed = 5, o = {}) {
    const target = await T.ensureDetails(targetId, o);
    const cands = new Map();
    const safe = async (p) => { try { return await p; } catch (e) { if (e.status === 502) return []; throw e; } };

    for (const r of (await safe(inat.similarSpecies(targetId, placeId, o))).slice(0, 15)) {
      add(cands, r.taxon, 3.0 + Math.log1p(r.count || 0) * 0.5, "similar species");
    }
    if (target.genus_id) {
      for (const r of await safe(inat.speciesCounts({ taxon_id: target.genus_id, place_id: placeId, per_page: 30 }, o))) {
        add(cands, r.taxon, 2.5, "same genus");
      }
    }
    if (deckId) addDeckMembers(cands, target, deckId, targetId);
    if (target.family_id && lat != null && lng != null) {
      for (const r of await safe(inat.speciesCounts({ taxon_id: target.family_id, lat, lng, radius_km: cfg.NEARBY_RADIUS_KM, per_page: 30 }, o))) {
        add(cands, r.taxon, 1.5, "same family, found nearby");
      }
    }
    for (const { t, n } of yourConfusions(targetId)) {
      add(cands, { id: t.id, name: t.name, preferred_common_name: t.common_name, rank: t.rank },
          2.0 + Math.min(n * 0.5, 2.0), "you've mixed these up before");
    }
    cands.delete(targetId);

    const enough = () => [...cands.values()].filter((c) => c.score >= 1.0).length >= needed + 2;
    if (!enough() && target.family_id) {
      for (const r of await safe(inat.speciesCounts({ taxon_id: target.family_id, place_id: placeId, per_page: 30 }, o))) {
        add(cands, r.taxon, 1.0, "same family");
      }
    }
    if (!enough() && target.order_id) {
      const rs = lat != null && lng != null
        ? await safe(inat.speciesCounts({ taxon_id: target.order_id, lat, lng, radius_km: cfg.NEARBY_RADIUS_KM, per_page: 30 }, o))
        : await safe(inat.speciesCounts({ taxon_id: target.order_id, place_id: placeId, per_page: 30 }, o));
      for (const r of rs) add(cands, r.taxon, 0.5, "same order");
    }
    cands.delete(targetId);
    return cands;
  }

  function weightedIndex(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = U.random() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }

  async function pick(targetId, n, { deckId = null, placeId = null, lat = null, lng = null } = {}, o = {}) {
    const source = answerSource(deckId);
    let chosen = [];
    if (source !== "anywhere") chosen = weightedSample(await deckCandidates(targetId, deckId, placeId, o), n);
    if (needsOutside(source, chosen.length, n)) {
      const cands = await gatherCandidates(targetId, deckId, placeId, lat, lng, n, o);
      for (const c of chosen) cands.delete(c.taxon.id);
      chosen = chosen.concat(weightedSample(cands, n - chosen.length));
    }
    for (const c of chosen) await T.upsert(c.taxon);
    return chosen.map((c) => ({ ...c.taxon, reasons: c.reasons }));
  }

  return { gatherCandidates, deckCandidates, prepare, pick };
})();
