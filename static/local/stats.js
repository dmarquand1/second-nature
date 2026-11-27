// Numbers for the Stats page, like app/stats.py.
IQ.stats = (() => {
  const S = IQ.store, U = IQ.util, cfg = IQ.config, T = IQ.taxa, Sch = IQ.scheduler;
  const MATURE_DAYS = 21;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Study day (starting DAY_STARTS_AT_HOUR) a timestamp belongs to, as YYYY-MM-DD.
  const dayKey = (ts) => iso(new Date((ts - cfg.DAY_STARTS_AT_HOUR * 3600) * 1000));
  const addDays = (key, n) => { const [y, m, d] = key.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };

  function streak(days, today) {
    let d = days.has(today) ? today : addDays(today, -1), n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  const tx = (t) => ({ id: t.id, name: t.name, common_name: t.common_name ?? null, photo_url: T.photoFor(t) });

  function overview(deckId = null, now = null, days = 30) {
    now = now ?? U.now();
    const inDeck = (r) => deckId == null || r.deck_id === deckId;
    const today = dayKey(now);
    const rev = S.where("reviews", inDeck);
    const cards = S.where("cards", inDeck);
    const cardById = new Map(cards.map((c) => [c.id, c]));

    // Struggles: species seen at least twice with at least one miss.
    const perCard = new Map();
    for (const r of rev) {
      const p = perCard.get(r.card_id) || { seen: 0, right: 0 };
      p.seen++; p.right += r.correct ? 1 : 0;
      perCard.set(r.card_id, p);
    }
    const struggles = [...perCard].map(([cid, p]) => ({ c: cardById.get(cid), ...p }))
      .filter((x) => x.c && x.seen >= 2 && x.seen > x.right && S.get("taxa", x.c.taxon_id))
      .sort((a, b) => ((b.seen - b.right) / b.seen - (a.seen - a.right) / a.seen) ||
        ((b.seen - b.right) - (a.seen - a.right)) || ((b.c.difficulty || 0) - (a.c.difficulty || 0)))
      .slice(0, 15)
      .map((x) => ({ ...tx(S.get("taxa", x.c.taxon_id)), deck_id: x.c.deck_id, deck_name: (S.get("decks", x.c.deck_id) || {}).name,
                     seen: x.seen, right: x.right, accuracy: r3(x.right / x.seen), lapses: x.c.lapses,
                     difficulty: x.c.difficulty ? Math.round(x.c.difficulty * 10) / 10 : null }));

    const pairs = new Map();
    for (const r of rev) {
      if (r.correct || r.chosen_taxon_id == null) continue;
      const k = `${r.taxon_id}:${r.chosen_taxon_id}`;
      const p = pairs.get(k) || { a: r.taxon_id, b: r.chosen_taxon_id, n: 0, last: 0 };
      p.n++; p.last = Math.max(p.last, r.reviewed_at);
      pairs.set(k, p);
    }
    const confusions = [...pairs.values()].filter((p) => S.get("taxa", p.a) && S.get("taxa", p.b))
      .sort((x, y) => (y.n - x.n) || (y.last - x.last)).slice(0, 15)
      .map((p) => ({ answer: tx(S.get("taxa", p.a)), chosen: tx(S.get("taxa", p.b)), count: p.n, last: p.last }));

    const strongest = cards.filter((c) => c.state === 2 && S.get("taxa", c.taxon_id))
      .sort((a, b) => b.stability - a.stability).slice(0, 10)
      .map((c) => ({ ...tx(S.get("taxa", c.taxon_id)), stability_days: Math.round(c.stability) }));

    const perDeck = deckId != null ? [] : S.all("decks").sort((a, b) => (a.name < b.name ? -1 : 1)).map((d) => {
      const rs = S.where("reviews", (r) => r.deck_id === d.id), cs = S.where("cards", (c) => c.deck_id === d.id);
      const right = rs.filter((r) => r.correct).length;
      return { id: d.id, name: d.name, species: cs.length, studied: cs.filter((c) => c.state !== 0).length,
               mature: cs.filter((c) => c.state === 2 && c.stability >= MATURE_DAYS).length,
               due: cs.filter((c) => c.state !== 0 && c.due <= now).length, reviews: rs.length,
               accuracy: rs.length ? r3(right / rs.length) : null };
    });

    const total = rev.length, right = rev.filter((r) => r.correct).length;
    const studyDays = new Set(rev.map((r) => dayKey(r.reviewed_at)));
    const ds = Sch.dayStart(now);
    const todayRev = rev.filter((r) => r.reviewed_at >= ds);
    const totals = {
      reviews: total, correct: right, accuracy: total ? r3(right / total) : null, days_studied: studyDays.size,
      streak: streak(studyDays, today), today_reviews: todayRev.length,
      today_accuracy: todayRev.length ? r3(todayRev.filter((r) => r.correct).length / todayRev.length) : null,
      minutes: Math.round(rev.reduce((n, r) => n + Math.min(r.response_ms || 0, 120000), 0) / 60000),
    };

    const byDay = new Map();
    for (const r of rev) { const k = dayKey(r.reviewed_at); const b = byDay.get(k) || [0, 0]; b[0]++; b[1] += r.correct ? 1 : 0; byDay.set(k, b); }
    const daily = [];
    for (let i = days - 1; i >= 0; i--) { const k = addDays(today, -i); const [n, c] = byDay.get(k) || [0, 0]; daily.push({ date: k, reviews: n, correct: c }); }

    const states = { new: 0, learning: 0, young: 0, mature: 0 };
    for (const c of cards) {
      if (c.state === 0) states.new++;
      else if (c.state === 1 || c.state === 3) states.learning++;
      else if ((c.stability || 0) >= MATURE_DAYS) states.mature++;
      else states.young++;
    }

    const endToday = ds + 86400;
    const fc = new Array(14).fill(0);
    for (const c of cards) {
      if (c.state === 0 || c.due == null) continue;
      const i = c.due < endToday ? 0 : Math.floor((c.due - endToday) / 86400) + 1;
      if (i < 14) fc[i]++;
    }
    const forecast = fc.map((n, i) => ({ day: i, date: addDays(today, i), due: n }));

    return { deck_id: deckId, totals, daily, states, forecast, struggles, confusions, strongest, per_deck: perDeck };
  }

  return { overview, dayKey };
})();
