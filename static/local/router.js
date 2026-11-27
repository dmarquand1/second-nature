// The website version's "backend": the screens call the same /api/... addresses
// as the local app, and this answers them inside the browser instead of a server.
// (static/api.js sends requests here when IQ.router exists.)
IQ.VERSION = "0.4.5";

IQ.ready = (async () => {
  await IQ.store.open();
  // Ask the browser to keep saved progress even when disk space runs low or the
  // site isn't visited for a while (Safari otherwise clears sites after 7 days).
  try { if (navigator.storage && navigator.storage.persist) IQ.persisted = await navigator.storage.persist(); } catch {}
  await IQ.jobs.markInterrupted();          // jobs only run while the page is open
  // Keep what's saved small: tidy away anything that isn't progress (see store.compact).
  await IQ.store.compact(IQ.config.QUESTIONS_KEPT_DAYS).catch(() => {});
  IQ.store.trimCache(IQ.config.CACHE_MAX_AGE_DAYS, IQ.config.CACHE_MAX_ENTRIES).catch(() => {});
})();

IQ.router = (() => {
  const U = IQ.util, D = IQ.decks;
  const routes = [];
  const on = (method, pattern, fn) => routes.push([method, new RegExp("^" + pattern + "$"), fn]);
  const needDeck = (id) => { if (!IQ.store.get("decks", id)) throw U.error("Deck not found", 404); };
  const ids = (b) => {
    const list = (b && b.taxon_ids) || [];
    if (!Array.isArray(list) || !list.length) throw U.error("Pick at least one species.", 422);
    return list.map(Number);
  };

  on("GET", "/api/search/taxa", async (m, q) => (await IQ.inat.autocompleteTaxa(q.get("q") || "")).map((t) => ({
    id: t.id, name: t.name, common_name: t.preferred_common_name ?? null, rank: t.rank ?? null,
    photo_url: IQ.taxa.photoFor({ photo_url: (t.default_photo || {}).square_url, photo_license: (t.default_photo || {}).license_code }),
  })));
  on("GET", "/api/search/places", async (m, q) => (await IQ.inat.autocompletePlaces(q.get("q") || "")).map((p) => ({
    id: p.id, name: p.display_name || p.name, type: p.place_type ?? null,
  })));

  on("GET", "/api/decks", () => D.list());
  on("POST", "/api/decks", (m, q, b) => {
    if (!["list", "taxon", "place"].includes(b.source_type)) throw U.error("Choose how to build the deck.", 422);
    return D.create(b);
  });
  on("GET", "/api/decks/(\\d+)", (m) => { const d = D.get(+m[1]); if (!d) throw U.error("Deck not found", 404); return d; });
  on("PATCH", "/api/decks/(\\d+)", async (m, q, b) => { needDeck(+m[1]); await D.updateSettings(+m[1], b || {}); return D.get(+m[1]); });
  on("DELETE", "/api/decks/(\\d+)", async (m) => { await D.remove(+m[1]); return { ok: true }; });
  on("POST", "/api/decks/(\\d+)/species", (m, q, b) => { needDeck(+m[1]); return D.addSpecies(+m[1], b.species); });
  on("POST", "/api/decks/(\\d+)/taxa", (m, q, b) => { needDeck(+m[1]); return D.addTaxaIds(+m[1], ids(b)); });
  on("POST", "/api/decks/(\\d+)/remove", async (m, q, b) => ({ removed: await D.removeCards(+m[1], ids(b)) }));
  on("DELETE", "/api/decks/(\\d+)/species/(\\d+)", async (m) => { await D.removeCards(+m[1], [+m[2]]); return { ok: true }; });
  on("POST", "/api/decks/(\\d+)/warmup", async (m) => { needDeck(+m[1]); return { job_id: await IQ.warmup.start(+m[1]) }; });
  on("GET", "/api/decks/(\\d+)/warmup", (m) => IQ.warmup.status(+m[1]) || {});
  on("GET", "/api/jobs/(\\d+)", (m) => { const j = IQ.jobs.get(+m[1]); if (!j) throw U.error("Job not found", 404); return j; });

  on("GET", "/api/decks/(\\d+)/next", (m, q) => IQ.quiz.nextQuestion(+m[1], { practice: q.get("practice") === "true" }));
  on("POST", "/api/questions/(\\d+)/answer", (m, q, b) => IQ.quiz.answer(+m[1], b.taxon_id, b.response_ms ?? null));
  on("POST", "/api/questions/(\\d+)/rate", (m, q, b) => IQ.quiz.rate(+m[1], b.rating));

  on("GET", "/api/stats", (m, q) => IQ.stats.overview(q.get("deck_id") ? +q.get("deck_id") : null));
  on("GET", "/api/info", () => ({ version: IQ.VERSION, mode: "browser" }));

  async function handle(method, url, body) {
    await IQ.ready;
    const u = new URL(url, "http://x");
    for (const [mth, re, fn] of routes) {
      const m = u.pathname.match(re);
      if (m && mth === method) return U.clone(await fn(m, u.searchParams, body || {}));
    }
    throw U.error(`Not found: ${method} ${u.pathname}`, 404);
  }

  return { handle };
})();
