// A pretend iNaturalist for the browser tests (same species as tests/conftest.py),
// so the tests run offline and never touch the real API.
const FakeInat = (() => {
  const ORDER = 7251, FAMILY = 12705, GENUS = 12716, OTHER_GENUS = 9999;
  const SPECIES = {
    1: ["Turdus merula", "Eurasian Blackbird", GENUS],
    2: ["Turdus philomelos", "Song Thrush", GENUS],
    3: ["Turdus viscivorus", "Mistle Thrush", GENUS],
    4: ["Turdus iliacus", "Redwing", GENUS],
    5: ["Turdus pilaris", "Fieldfare", GENUS],
    6: ["Erithacus rubecula", "European Robin", OTHER_GENUS],
    7: ["Luscinia megarhynchos", "Common Nightingale", OTHER_GENUS],
  };
  const HIGHER = { [ORDER]: ["Passeriformes", "order"], [FAMILY]: ["Turdidae", "family"],
                   [GENUS]: ["Turdus", "genus"], [OTHER_GENUS]: ["Erithacus", "genus"] };
  const state = { calls: [], omitAncestors: false, fail: false, noPhotos: new Set() };   // noPhotos: species with no research-grade photos

  const taxon = (id, withAncestors) => {
    const [name, common, genus] = SPECIES[id];
    const t = { id, name, preferred_common_name: common, rank: "species", iconic_taxon_name: "Aves",
                ancestor_ids: [ORDER, FAMILY, genus, id],
                default_photo: { square_url: `https://img.test/${id}/square.jpg`, license_code: "cc-by" },
                observations_count: 1000 * (8 - id) };      // Blackbird (1) most observed, Nightingale (7) least
    if (withAncestors) t.ancestors = [{ id: ORDER, rank: "order" }, { id: FAMILY, rank: "family" }, { id: genus, rank: "genus" }];
    return t;
  };
  const match = (q) => Object.keys(SPECIES).map(Number).filter((t) =>
    SPECIES[t][0].toLowerCase().includes(q.toLowerCase()) || SPECIES[t][1].toLowerCase().includes(q.toLowerCase()));

  // Species 7 has one "all rights reserved" photo per observation (to test the licence filter).
  const obs = (tid) => Array.from({ length: 6 }, (_, i) => ({
    id: tid * 1000 + i, uri: `https://www.inaturalist.org/observations/${tid * 1000 + i}`,
    observed_on: `2025-05-0${i + 1}`, place_guess: "Oxford, UK", location: "51.75,-1.25", obscured: false,
    positional_accuracy: 20, user: { login: "tester" }, taxon: { id: tid },
    // The first observation of each species is annotated "Alive or Dead: Dead".
    annotations: [{ controlled_attribute_id: 17, controlled_value_id: i === 0 ? 19 : 18 }],
    // Observation 5 is the best-liked (12 favourites), observation 3 has 4.
    faves_count: { 5: 12, 3: 4 }[i] || 0,
    // The real API sends lots the app never reads (identifications, comments, profiles...).
    identifications: [{ id: i, body: "x".repeat(500), user: { login: "someone", icon_url: "https://example.org/x.png" } }],
    photos: [0, 1].map((p) => ({ url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${tid}${i}${p}/square.jpg`,
      attribution: "(c) tester, CC BY", license_code: tid === 7 && p === 1 ? null : "cc-by" })),
  }));

  function respond(path, params) {
    let m;
    if (path === "/taxa/autocomplete" || path === "/taxa") return { results: match(params.get("q") || "").map((t) => taxon(t)) };
    if ((m = path.match(/^\/taxa\/([\d,]+)$/))) {
      return { results: m[1].split(",").map(Number).flatMap((i) => SPECIES[i] ? [taxon(i, !state.omitAncestors)]
        : HIGHER[i] ? [{ id: i, name: HIGHER[i][0], rank: HIGHER[i][1] }] : []) };
    }
    if (path === "/places/autocomplete") return { results: [{ id: 6857, display_name: "United Kingdom", place_type: 12 }] };
    if (path === "/observations/species_counts") {
      const tx = params.get("taxon_id") ? Number(params.get("taxon_id")) : null;
      const ids = Object.keys(SPECIES).map(Number).filter((t) => [null, ORDER, FAMILY].includes(tx) || SPECIES[t][2] === tx);
      const results = ids.map((t) => ({ count: 100 - t, taxon: taxon(t) }));
      return { total_results: results.length, results };
    }
    if (path === "/identifications/similar_species") {
      const tx = Number(params.get("taxon_id"));
      return { results: [2, 3].filter((t) => t !== tx).map((t) => ({ count: 40, taxon: taxon(t) })) };
    }
    if (path === "/observations") {
      const ids = params.get("taxon_id").split(",").map(Number).filter((t) => SPECIES[t] && !state.noPhotos.has(t));
      let out;
      if (ids.length === 1 && !params.get("taxon_id").includes(",")) out = obs(ids[0]);
      else out = ids.flatMap((t) => obs(t).slice(0, t === 5 ? 2 : 6).map((o) => ({
        ...o, taxon: { id: t * 100 + 1, ancestor_ids: [ORDER, FAMILY, SPECIES[t][2], t] } })));
      // Like iNat's photo_license filter: drop observations with no photo under those licences.
      if (params.get("order_by") === "votes") out.sort((a, b) => b.faves_count - a.faves_count);
      const lic = params.get("photo_license");
      if (lic) out = out.filter((o) => o.photos.some((p) => lic.split(",").includes(p.license_code)));
      return { total_results: out.length, results: out };
    }
    return null;
  }

  async function fetcher(path, query) {
    const params = new URLSearchParams(query);
    state.calls.push({ path, params: Object.fromEntries(params) });
    if (state.fail) throw new Error("network down");
    if (state.busy) return { status: 429, json: async () => ({}), text: async () => "Too Many Requests" };
    const body = respond(path, params);
    if (!body) return { status: 404, json: async () => ({}), text: async () => "not found" };
    return { status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
  }

  function reset() { state.calls = []; state.omitAncestors = false; state.fail = false; state.busy = false; state.noPhotos = new Set(); }
  const calls = (path) => state.calls.filter((c) => (path instanceof RegExp ? path.test(c.path) : c.path === path));

  return { fetcher, reset, calls, state, SPECIES, ORDER, FAMILY, GENUS, OTHER_GENUS };
})();
