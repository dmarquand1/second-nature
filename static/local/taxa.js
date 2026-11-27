// Species we know about (names, photos, genus/family/order), like app/taxa.py.
IQ.taxa = (() => {
  const S = IQ.store, U = IQ.util, cfg = IQ.config;
  const RANKS = ["genus", "family", "order"];

  async function upsert(t) {
    const old = S.get("taxa", t.id) || {};
    const p = t.default_photo || {};
    const photo = p.medium_url || p.square_url || p.url || null;
    const rec = {
      ...old,
      id: t.id, name: t.name,
      common_name: t.preferred_common_name ?? old.common_name ?? null,
      rank: t.rank ?? old.rank ?? null,
      iconic_taxon_name: t.iconic_taxon_name ?? old.iconic_taxon_name ?? null,
      ancestor_ids: t.ancestor_ids?.length ? t.ancestor_ids : (old.ancestor_ids ?? null),
      photo_url: photo ?? old.photo_url ?? null,
      photo_license: photo ? (p.license_code ?? null) : (old.photo_license ?? null),
      wikipedia_url: t.wikipedia_url ?? old.wikipedia_url ?? null,
      obs_count: t.observations_count ?? old.obs_count ?? null,
      genus_id: old.genus_id ?? null, family_id: old.family_id ?? null, order_id: old.order_id ?? null,
      details_fetched: old.details_fetched ?? 0,
      updated_at: U.now(),
    };
    await S.put("taxa", rec);
    return rec;
  }

  async function saveDetails(t, rankOf) {
    const ids = { genus: null, family: null, order: null };
    if (t.ancestors?.length) {
      for (const a of t.ancestors) if (a.rank in ids) ids[a.rank] = a.id;
    } else if (rankOf) {
      for (const aid of t.ancestor_ids || []) { const r = rankOf.get(aid); if (r in ids) ids[r] = aid; }
    }
    await upsert(t);
    await S.update("taxa", t.id, { genus_id: ids.genus, family_id: ids.family, order_id: ids.order, details_fetched: 1 });
  }

  // Genus/family/order for many taxa at once: 30 per iNaturalist request.
  async function ensureDetailsMany(taxonIds, o = {}) {
    const todo = U.unique(taxonIds.map(Number)).filter((id) => !(S.get("taxa", id) || {}).details_fetched);
    if (!todo.length) return 0;
    const found = await IQ.inat.taxaByIds(todo, o);
    const missing = new Set();
    for (const t of found) if (!t.ancestors?.length) for (const a of t.ancestor_ids || []) if (a !== t.id) missing.add(a);
    let rankOf = null;
    if (missing.size) {
      rankOf = new Map((await IQ.inat.taxaByIds([...missing].sort((a, b) => a - b), o)).map((a) => [a.id, a.rank]));
    }
    for (const t of found) await saveDetails(t, rankOf);
    return found.length;
  }

  async function ensureDetails(taxonId, o = {}) {
    const row = S.get("taxa", taxonId);
    if (row && row.details_fetched) return row;
    await ensureDetailsMany([taxonId], o);
    return S.get("taxa", taxonId) || {};
  }

  // Thumbnail for a species, respecting the open-licence setting.
  function photoFor(t) {
    if (!t.photo_url) return null;
    if (IQ.settings.openLicenceOnly() && !cfg.OPEN_LICENCES.includes((t.photo_license || "").toLowerCase())) return null;
    return t.photo_url;
  }

  function pub(t) {
    return {
      id: t.id, name: t.name, common_name: t.common_name ?? null, rank: t.rank ?? null,
      photo_url: photoFor(t), url: `https://www.inaturalist.org/taxa/${t.id}`, wikipedia_url: t.wikipedia_url ?? null,
    };
  }

  // How often each species in the deck has been observed on iNaturalist, for species saved
  // before version 0.4.6 (30 per request). Used by the common/rare orders.
  async function ensureObsCounts(deckId, o = {}) {
    const todo = S.where("cards", (c) => c.deck_id === deckId).map((c) => c.taxon_id)
      .filter((id) => (S.get("taxa", id) || {}).obs_count == null);
    if (!todo.length) return 0;
    const found = await IQ.inat.taxaByIds(todo, o);
    for (const t of found) if (t.observations_count != null) await S.update("taxa", t.id, { obs_count: t.observations_count });
    return found.length;
  }

  return { ensureObsCounts, upsert, ensureDetails, ensureDetailsMany, photoFor, public: pub, get: (id) => S.get("taxa", id) };
})();
