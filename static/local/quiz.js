// Build questions and check answers, like app/quiz.py.
// Photos load straight from iNaturalist (nothing is copied or re-hosted).
IQ.quiz = (() => {
  const S = IQ.store, U = IQ.util, cfg = IQ.config, T = IQ.taxa, F = IQ.fsrs, Sch = IQ.scheduler;

  function licenceInfo(code) {
    if (!code) return { license_name: "All rights reserved", license_url: null };
    code = code.toLowerCase();
    if (code === "cc0") return { license_name: "CC0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/" };
    if (code.startsWith("cc-")) {
      const parts = code.slice(3);
      return { license_name: "CC " + parts.toUpperCase(), license_url: `https://creativecommons.org/licenses/${parts}/4.0/` };
    }
    return { license_name: code, license_url: null };
  }

  function photoUrl(url, size = "large") {
    for (const s of ["square", "small", "medium", "large", "thumb", "original"]) url = url.split(`/${s}.`).join(`/${size}.`);
    return url;
  }
  const photoSizes = (url) => ({ url: photoUrl(url, "medium"), large: photoUrl(url, "large"), original: photoUrl(url, "original") });

  const isOpen = (code) => cfg.OPEN_LICENCES.includes((code || "").toLowerCase());
  // The photos of an observation we're allowed to show with the current setting.
  const usablePhotos = (obs) => (obs.photos || []).filter((p) => !IQ.settings.openLicenceOnly() || isOpen(p.license));

  // True if the community annotated this observation "Alive or Dead: Dead".
  const isDead = (o) => (o.annotations || []).some((a) =>
    a.controlled_attribute_id === cfg.ALIVE_OR_DEAD_TERM && a.controlled_value_id === cfg.DEAD_VALUE);

  async function storeObservations(taxonId, results, poolPlaceId) {
    const recs = [];
    for (const o of results.slice(0, cfg.OBSERVATIONS_PER_TAXON)) {
      const photos = (o.photos || []).filter((p) => p.url).slice(0, cfg.PHOTOS_KEPT_PER_OBSERVATION)
        .map((p) => ({ url: photoUrl(p.url), attribution: p.attribution ?? null, license: p.license_code ?? null }));
      if (!photos.length) continue;
      let lat = null, lng = null;
      if (o.location) {
        const [a, b] = String(o.location).split(",").map(Number);
        if (!Number.isNaN(a) && !Number.isNaN(b)) { lat = a; lng = b; }
      }
      const old = S.get("observations", o.id);
      recs.push({
        id: o.id, taxon_id: taxonId, photos, latitude: lat, longitude: lng,
        obscured: o.obscured ? 1 : 0, positional_accuracy: o.positional_accuracy ?? null, place_guess: o.place_guess ?? null,
        observed_on: o.observed_on ?? null, observer: (o.user || {}).login ?? null,
        pool_place_id: poolPlaceId ?? old?.pool_place_id ?? null, dead: isDead(o) ? 1 : 0,
        faves: Number(o.faves_count) || 0,
        times_shown: old?.times_shown ?? 0, last_shown: old?.last_shown ?? null,
      });
    }
    await S.putMany("observations", recs);
  }

  const storedFor = (taxonId) => S.where("observations", (r) => r.taxon_id === taxonId && usablePhotos(r).length > 0);

  // Observations to quiz on for this species, fetching from iNat if needed.
  // Prefers the deck's place; falls back to worldwide if it has too few.
  async function observationPool(taxonId, placeId, o = {}) {
    let rows = storedFor(taxonId);
    // Photos saved before version 0.4.1 don't say whether the organism is dead yet:
    // look them up again once (usually straight from the cache).
    const unchecked = new Set(rows.filter((r) => r.dead == null || r.faves == null).map((r) => r.pool_place_id ?? null));
    for (const pid of unchecked) {
      await storeObservations(taxonId, await IQ.inat.observations(taxonId, pid, cfg.OBSERVATIONS_PER_TAXON, o), pid);
    }
    if (unchecked.size) {
      const left = S.where("observations", (r) => r.taxon_id === taxonId && (r.dead == null || r.faves == null))
        .map((r) => ({ ...r, dead: r.dead ?? 0, faves: r.faves ?? 0 }));
      await S.putMany("observations", left);
      rows = storedFor(taxonId);
    }
    let local = rows.filter((r) => placeId && r.pool_place_id === placeId);
    let fetched = false;
    if (placeId && !local.length) {
      const results = await IQ.inat.observations(taxonId, placeId, cfg.OBSERVATIONS_PER_TAXON, o);
      if (results.length >= 3) { await storeObservations(taxonId, results, placeId); fetched = true; }
    }
    if (!rows.length && !fetched) {
      await storeObservations(taxonId, await IQ.inat.observations(taxonId, null, cfg.OBSERVATIONS_PER_TAXON, o), null);
      fetched = true;
    }
    if (fetched) { rows = storedFor(taxonId); local = rows.filter((r) => placeId && r.pool_place_id === placeId); }
    return local.length ? local : rows;
  }

  // Photo pools for many species with one request per 10 species.
  async function fillPoolsBatched(taxonIds, placeId, group = 10, minEach = 5, o = {}) {
    const have = new Set(S.where("observations", (r) => (r.pool_place_id ?? null) === (placeId ?? null)).map((r) => r.taxon_id));
    const todo = U.unique(taxonIds).filter((t) => !have.has(t));
    let filled = 0;
    for (let i = 0; i < todo.length; i += group) {
      const chunk = todo.slice(i, i + group);
      const results = await IQ.inat.observationsMany(chunk, placeId, 200, o);
      const by = new Map(chunk.map((t) => [t, []]));
      for (const ob of results) {
        const tx = ob.taxon || {};
        for (const sid of [tx.id, ...(tx.ancestor_ids || [])]) if (by.has(sid)) { by.get(sid).push(ob); break; }
      }
      for (const [sid, obs] of by) if (obs.length >= minEach) { await storeObservations(sid, obs, placeId); filled++; }
    }
    return filled;
  }

  // Least shown first. Ties in a fixed shuffled order (so warm-up can prepare the next photo),
  // tilted by favourites, same as app/quiz.py _obs_order:
  //   best - most favourites first; mixed - favourites likelier first; any - ignored.
  function obsKey(r, choice) {
    const shuffle = Number((BigInt(r.id) * 2654435761n) % 4294967296n) / 4294967296;
    const faves = r.faves || 0;
    if (choice === "best") return [r.times_shown || 0, -faves, shuffle];
    if (choice === "mixed") return [r.times_shown || 0, shuffle / (1 + Math.log1p(faves))];
    return [r.times_shown || 0, shuffle];
  }
  const less = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  function minObs(rows, choice = "mixed") {
    let best = null, bk = null;
    for (const r of rows) {
      const k = obsKey(r, choice);
      if (!best || less(k, bk)) { best = r; bk = k; }
    }
    return best;
  }
  // With hideDead, observations annotated as dead are skipped (unless that's all there is).
  async function nextObservation(taxonId, placeId, o = {}, hideDead = true, photoChoice = "mixed") {
    let c = await observationPool(taxonId, placeId, o);
    if (hideDead) { const alive = c.filter((r) => !r.dead); if (alive.length) c = alive; }
    return c.length ? minObs(c, photoChoice) : null;
  }

  async function nextQuestion(deckId, { practice = false } = {}) {
    const deck = S.get("decks", deckId);
    if (!deck) throw U.error("Deck not found.", 404);
    if (!S.where("cards", (c) => c.deck_id === deckId).length) throw U.error("This deck has no species yet.");
    const card = Sch.pickNextCard(deckId, { practice });
    const counts = Sch.queueCounts(deckId);
    if (!card) return { done: true, counts };

    const obs = await nextObservation(card.taxon_id, deck.place_id, {}, deck.hide_dead !== false, deck.photo_choice || "mixed");
    if (!obs) throw U.error("No research-grade photos found for this species on iNaturalist.");
    const distractors = await IQ.distractors.pick(card.taxon_id, deck.num_choices - 1,
      { deckId, placeId: deck.place_id, lat: obs.latitude, lng: obs.longitude });
    const choiceIds = U.shuffle([card.taxon_id, ...distractors.map((d) => d.id)]);
    const q = await S.insert("questions", { deck_id: deckId, card_id: card.id, observation_id: obs.id, choices: choiceIds,
                                           created_at: U.now(), answered: 0 });
    await S.update("observations", obs.id, { times_shown: (obs.times_shown || 0) + 1, last_shown: U.now() });
    const choices = choiceIds.map((id) => { const t = S.get("taxa", id); return { id, name: t.name, common_name: t.common_name ?? null }; });
    return {
      question_id: q.id, deck_id: deckId,
      // Photographer and licence go with each photo (shown under it), as the licences require.
      photos: usablePhotos(obs).slice(0, cfg.MAX_PHOTOS_PER_QUESTION)
        .map((p) => ({ ...photoSizes(p.url), attribution: p.attribution, ...licenceInfo(p.license) })),
      location: { lat: obs.latitude, lng: obs.longitude, obscured: !!obs.obscured, accuracy_m: obs.positional_accuracy,
                  place_guess: obs.place_guess },
      observed_on: obs.observed_on, choices, is_new: card.state === F.NEW, counts,
    };
  }

  function fmtSeconds(sec) {
    if (sec < 3600) return `${Math.max(1, IQ.util.pyRound(sec / 60))} min`;
    if (sec < 86400) return `${IQ.util.pyRound(sec / 3600)} h`;
    const days = sec / 86400;
    if (days < 31) { const d = IQ.util.pyRound(days); return `${d} day` + (d !== 1 ? "s" : ""); }
    if (days < 365) return `${(days / 30.4).toFixed(1)} months`;
    return `${(days / 365).toFixed(1)} years`;
  }

  function ratingPreviews(before, reviewedAt) {
    if (!before || before.stability === undefined) return {};   // old answers keep only the state
    const out = {};
    for (const r of [1, 2, 3, 4]) out[r] = fmtSeconds(Sch.fsrs.review(before, r, reviewedAt).due - reviewedAt);
    return out;
  }

  async function answer(questionId, chosenTaxonId, responseMs = null) {
    const q = S.get("questions", questionId);
    if (!q) throw U.error("Question not found.", 404);
    const card = S.get("cards", q.card_id);
    const obs = S.get("observations", q.observation_id);
    if (!card || !obs) throw U.error("Question not found.", 404);
    chosenTaxonId = Number(chosenTaxonId);
    let review = S.where("reviews", (r) => r.question_id === questionId)[0];
    if (!q.answered || !review) {
      const correct = chosenTaxonId === card.taxon_id;
      const rating = Sch.ratingFromAnswer(correct, responseMs);
      const [before] = await Sch.applyRating(card, rating);
      review = await S.insert("reviews", {
        question_id: questionId, deck_id: q.deck_id, card_id: card.id, taxon_id: card.taxon_id, observation_id: obs.id,
        chosen_taxon_id: chosenTaxonId, correct: correct ? 1 : 0, rating, response_ms: responseMs ?? null,
        reviewed_at: U.now(), card_before: before,
      });
      await S.update("questions", questionId, { answered: 1 });
    }
    const ans = S.get("taxa", card.taxon_id), chosen = S.get("taxa", chosenTaxonId);
    return {
      correct: !!review.correct, rating: review.rating, intervals: ratingPreviews(review.card_before, review.reviewed_at),
      answer: T.public(ans), chosen: chosen ? T.public(chosen) : null,
      observation: {
        id: obs.id, uri: `https://www.inaturalist.org/observations/${obs.id}`, observer: obs.observer, observed_on: obs.observed_on, place_guess: obs.place_guess,
        photos: usablePhotos(obs).slice(0, cfg.MAX_PHOTOS_PER_QUESTION).map((p) => ({ ...p, ...licenceInfo(p.license) })),
      },
    };
  }

  async function rate(questionId, rating) {
    rating = Number(rating);
    if (![1, 2, 3, 4].includes(rating)) throw U.error("Rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).");
    const review = S.where("reviews", (r) => r.question_id === questionId)[0];
    if (!review) throw U.error("Answer the question first.");
    if (!review.correct && rating !== 1) throw U.error("A wrong answer is always rated Again.");
    if (S.where("reviews", (r) => r.card_id === review.card_id && r.id > review.id).length) {
      throw U.error("This species has been reviewed again since, so this rating can't change.");
    }
    const after = Sch.fsrs.review(review.card_before, rating, review.reviewed_at);
    await Sch.saveState(review.card_id, after);
    await S.update("reviews", review.id, { rating });
    return { rating, due: after.due, state: after.state, previous_state: review.card_before.state };
  }

  return { isDead, obsKey, minObs, licenceInfo, photoUrl, photoSizes, usablePhotos, storeObservations, observationPool, fillPoolsBatched,
           nextObservation, nextQuestion, answer, rate, ratingPreviews, fmtSeconds };
})();
