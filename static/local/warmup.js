// Deck warm-up, like app/warmup.py: get taxonomy and photo pools for the deck,
// and photos and look-alikes ready for the next few species you'll study (not
// all of them: a big deck would mean thousands of requests). The browser also
// starts downloading the first photos so they appear instantly.
IQ.warmup = (() => {
  const S = IQ.store, cfg = IQ.config, Q = IQ.quiz;

  // Species due soonest, then new ones in the deck's "New species order".
  function cardsInStudyOrder(deckId) {
    const cards = S.where("cards", (c) => c.deck_id === deckId);
    const started = cards.filter((c) => c.state !== 0).sort((a, b) => ((a.due ?? 0) - (b.due ?? 0)) || (a.id - b.id));
    const order = (S.get("decks", deckId) || {}).new_order || "random";
    return started.concat(IQ.scheduler.orderNew(deckId, cards.filter((c) => c.state === 0), order));
  }

  function preload(urls) {
    if (typeof Image === "undefined" || IQ.warmup.noPreload) return;
    for (const u of urls) { const im = new Image(); im.src = u; }
  }

  IQ.jobs.handler("warmup", async (jobId, deckId, params, progress, o) => {
    const deck = S.get("decks", deckId);
    if (!deck) return {};
    const all = cardsInStudyOrder(deckId);
    const cards = all.slice(0, cfg.WARMUP_SPECIES_AHEAD);
    const total = cards.length;
    const ids = all.map((c) => c.taxon_id);
    let failed = 0, removed = 0;
    try {
      progress(0, total, "Fetching taxonomy for all species", true);
      await IQ.taxa.ensureDetailsMany(ids, o);
      if (["common", "rare"].includes(deck.new_order)) await IQ.taxa.ensureObsCounts(deckId, o);
      progress(0, total, "Fetching photos for all species", true);
      await Q.fillPoolsBatched(cards.map((c) => c.taxon_id), deck.place_id, 10, 5, o);
    } catch (e) {
      if (e.status !== 502) throw e;
      if (e.busy) return { species: total, failed, busy: true };   // carries on next time you study
    }
    for (let i = 1; i <= cards.length; i++) {
      const card = cards[i - 1];
      if (!S.get("decks", deckId)) break;
      if (IQ.jobs.buildWaiting()) {
        // A new deck is waiting to be built: let it go first, then carry on from scratch
        // (what's done so far is saved, so the second run is quick).
        await IQ.jobs.submit("warmup", deckId, {});
        return { species: total, failed, paused: true };
      }
      if (!S.get("cards", card.id)) continue;
      try {
        await IQ.taxa.ensureDetails(card.taxon_id, o);
        const obs = await Q.nextObservation(card.taxon_id, deck.place_id, o, deck.hide_dead !== false, deck.photo_choice || "mixed");
        if (!obs) { await IQ.decks.dropNoPhotoSpecies(deckId, card.taxon_id); removed++; }
        if (obs) {
          await IQ.distractors.prepare(card.taxon_id, deckId, deck.place_id, obs.latitude, obs.longitude,
                                       deck.num_choices - 1, o);
          if (i <= cfg.WARMUP_IMAGES_FOR_NEXT) {
            preload(Q.usablePhotos(obs).slice(0, cfg.MAX_PHOTOS_PER_QUESTION).map((p) => Q.photoUrl(p.url, "medium")));
          }
        }
      } catch (e) {
        if (e.status !== 502) throw e;
        if (e.busy) return { species: total, failed, busy: true };   // iNaturalist wants a break: stop for now
        failed++;
      }
      progress(i, total, `Ready: ${i} of ${total} species`);
    }
    progress(total, total, null, true);
    return { species: total, failed, no_photos: removed };
  });

  const start = (deckId) => IQ.jobs.submit("warmup", deckId, {}, true);
  function status(deckId) {
    const js = S.where("jobs", (j) => j.deck_id === deckId && j.kind === "warmup");
    return js.length ? js.reduce((a, b) => (b.id > a.id ? b : a)) : null;
  }

  return { start, status, noPreload: false };
})();
