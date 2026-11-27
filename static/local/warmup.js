// Deck warm-up, like app/warmup.py: get taxonomy, photo pools and look-alikes
// ready before you study, soonest-due species first. The browser also starts
// downloading the first photos so they appear instantly.
IQ.warmup = (() => {
  const S = IQ.store, cfg = IQ.config, Q = IQ.quiz;

  function cardsInStudyOrder(deckId) {
    return S.where("cards", (c) => c.deck_id === deckId)
      .sort((a, b) => ((a.state === 0) - (b.state === 0)) || ((a.due ?? 0) - (b.due ?? 0)) || (a.id - b.id));
  }

  function preload(urls) {
    if (typeof Image === "undefined" || IQ.warmup.noPreload) return;
    for (const u of urls) { const im = new Image(); im.src = u; }
  }

  IQ.jobs.handler("warmup", async (jobId, deckId, params, progress, o) => {
    const deck = S.get("decks", deckId);
    if (!deck) return {};
    const cards = cardsInStudyOrder(deckId);
    const total = cards.length;
    const ids = cards.map((c) => c.taxon_id);
    let failed = 0;
    try {
      progress(0, total, "Fetching taxonomy for all species", true);
      await IQ.taxa.ensureDetailsMany(ids, o);
      progress(0, total, "Fetching photos for all species", true);
      await Q.fillPoolsBatched(ids, deck.place_id, 10, 5, o);
    } catch (e) { if (e.status !== 502) throw e; }
    for (let i = 1; i <= cards.length; i++) {
      const card = cards[i - 1];
      if (!S.get("decks", deckId)) break;
      if (!S.get("cards", card.id)) continue;
      try {
        await IQ.taxa.ensureDetails(card.taxon_id, o);
        const obs = await Q.nextObservation(card.taxon_id, deck.place_id, o, deck.hide_dead !== false, deck.photo_choice || "mixed");
        if (obs) {
          await IQ.distractors.gatherCandidates(card.taxon_id, deckId, deck.place_id, obs.latitude, obs.longitude,
                                                deck.num_choices - 1, o);
          if (i <= cfg.WARMUP_IMAGES_FOR_NEXT) {
            preload(Q.usablePhotos(obs).slice(0, cfg.MAX_PHOTOS_PER_QUESTION).map((p) => Q.photoUrl(p.url, "medium")));
          }
        }
      } catch (e) { if (e.status !== 502) throw e; failed++; }
      progress(i, total, `Ready: ${i} of ${total} species`);
    }
    progress(total, total, null, true);
    return { species: total, failed };
  });

  const start = (deckId) => IQ.jobs.submit("warmup", deckId, {}, true);
  function status(deckId) {
    const js = S.where("jobs", (j) => j.deck_id === deckId && j.kind === "warmup");
    return js.length ? js.reduce((a, b) => (b.id > a.id ? b : a)) : null;
  }

  return { start, status, noPreload: false };
})();
