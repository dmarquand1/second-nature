// Which card to show next, and how answers update the schedule.
// Same rules as app/scheduler.py: due cards mixed with new ones (up to the daily
// limit), then learning cards due within 20 minutes, then practice mode.
IQ.scheduler = (() => {
  const F = IQ.fsrs, cfg = IQ.config, S = IQ.store, U = IQ.util;
  const LEARN_AHEAD_SECONDS = 20 * 60;
  const fsrs = F.make(F.DEFAULT_W, cfg.DESIRED_RETENTION);
  const STATE_FIELDS = ["state", "stability", "difficulty", "due", "last_review", "reps", "lapses",
                        "scheduled_days", "elapsed_days"];

  function ratingFromAnswer(correct, responseMs) {
    if (!correct) return F.AGAIN;
    if (responseMs != null && responseMs < 4000) return F.EASY;
    if (responseMs != null && responseMs > 15000) return F.HARD;
    return F.GOOD;
  }

  // Unix time when today's study day began (local time, DAY_STARTS_AT_HOUR).
  function dayStart(now) {
    const d = new Date((now ?? U.now()) * 1000);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), cfg.DAY_STARTS_AT_HOUR);
    if (d < start) start.setDate(start.getDate() - 1);
    return start.getTime() / 1000;
  }

  function toState(card) {
    const s = {};
    for (const k of STATE_FIELDS) s[k] = card[k] ?? (["reps", "lapses", "scheduled_days", "elapsed_days", "state"].includes(k) ? 0 : null);
    return s;
  }
  async function saveState(cardId, s) {
    const fields = {};
    for (const k of STATE_FIELDS) fields[k] = s[k];
    await S.update("cards", cardId, fields);
  }
  async function applyRating(card, rating, now) {
    now = now ?? U.now();
    const before = toState(card);
    const after = fsrs.review(before, rating, now);
    await saveState(card.id, after);
    return [before, after];
  }

  const deckCards = (deckId) => S.where("cards", (c) => c.deck_id === deckId);

  function queueCounts(deckId, now) {
    now = now ?? U.now();
    const deck = S.get("decks", deckId);
    const newPerDay = deck ? deck.new_per_day : cfg.DEFAULT_NEW_PER_DAY;
    const cards = deckCards(deckId);
    const due = cards.filter((c) => c.state !== F.NEW && c.due <= now).length;
    const newTotal = cards.filter((c) => c.state === F.NEW).length;
    const ds = dayStart(now);
    const newToday = new Set(S.where("reviews", (r) => r.deck_id === deckId && r.reviewed_at >= ds &&
      r.card_before && r.card_before.state === F.NEW).map((r) => r.card_id)).size;
    const later = cards.filter((c) => c.state !== F.NEW && c.due > now).map((c) => c.due);
    return {
      due, new_available: Math.max(0, Math.min(newTotal, newPerDay - newToday)), new_total: newTotal,
      new_today: newToday, new_per_day: newPerDay, next_due: later.length ? Math.min(...later) : null,
    };
  }

  // Sort a deck's new cards for its "New species order" setting (same as app/scheduler.py
  // order_new). Ties, and species we know nothing about yet, are in a fixed shuffled order
  // (so the warm-up can prepare the species the quiz will actually pick next).
  const RELATED = [["genus_id", 1.0], ["family_id", 0.6], ["order_id", 0.3]];
  function orderNew(deckId, rows, order) {
    const mix = (r) => Number((BigInt(r.id) * 2654435761n) % 4294967296n);
    rows = [...rows].sort((a, b) => mix(a) - mix(b));
    if (order === "random" || !rows.length) return rows;
    const by = (key) => (a, b) => { const x = key(a), y = key(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
    if (order === "added") return rows.sort((a, b) => a.id - b.id);
    const tx = (r) => S.get("taxa", r.taxon_id) || {};
    if (order === "common" || order === "rare") {
      const sign = order === "common" ? -1 : 1;
      return rows.sort(by((r) => [tx(r).obs_count == null ? 1 : 0, sign * (tx(r).obs_count || 0)]));
    }
    const started = deckCards(deckId).filter((c) => c.state !== F.NEW);
    if (order === "grouped") {         // finish the groups you've started, then the next, genus by genus
      const fams = new Set(started.map((c) => tx(c).family_id).filter(Boolean));
      const gens = new Set(started.map((c) => tx(c).genus_id).filter(Boolean));
      return rows.sort(by((r) => { const t = tx(r); return [fams.has(t.family_id) ? 0 : 1, gens.has(t.genus_id) ? 0 : 1,
        t.order_id || 0, t.family_id || 0, t.genus_id || 0, t.name || ""]; }));
    }
    if (order === "varied") {          // groups you've seen least of first
      const seen = { order_id: new Map(), family_id: new Map(), genus_id: new Map() };
      for (const c of started) for (const k in seen) { const v = tx(c)[k]; if (v) seen[k].set(v, (seen[k].get(v) || 0) + 1); }
      return rows.sort(by((r) => ["order_id", "family_id", "genus_id"].map((k) => seen[k].get(tx(r)[k]) || 0)));
    }
    // "hard" / "easy": relatives of the species you find hardest / know best first (FSRS difficulty 1-10).
    const best = { genus_id: new Map(), family_id: new Map(), order_id: new Map() };
    for (const c of started) {
      const d = c.difficulty ?? 5.5;
      const w = order === "hard" ? (d - 1) / 9 : (10 - d) / 9;
      for (const [k] of RELATED) { const v = tx(c)[k]; if (v) best[k].set(v, Math.max(best[k].get(v) || 0, w)); }
    }
    const score = (r) => Math.max(0, ...RELATED.map(([k, rel]) => (best[k].get(tx(r)[k]) || 0) * rel));
    return rows.sort(by((r) => [-score(r)]));
  }

  function pickNextCard(deckId, { now, practice = false } = {}) {
    now = now ?? U.now();
    const qs = S.where("questions", (q) => q.deck_id === deckId);
    const lastId = qs.length ? qs.reduce((a, b) => (b.id > a.id ? b : a)).card_id : null;
    const pending = new Set(qs.filter((q) => !q.answered && q.created_at > now - cfg.PREFETCH_PENDING_MINUTES * 60)
      .map((q) => q.card_id));
    const avoid = new Set([...pending, lastId]);
    const first = (rows) => { const others = rows.filter((r) => !avoid.has(r.id)); return (others.length ? others : rows)[0] || null; };
    const byDue = (a, b) => (a.due - b.due) || (a.id - b.id);

    const cards = deckCards(deckId);
    const due = cards.filter((c) => c.state !== F.NEW && c.due <= now).sort(byDue);
    const counts = queueCounts(deckId, now);
    const newRows = counts.new_available > 0
      ? orderNew(deckId, cards.filter((c) => c.state === F.NEW), (S.get("decks", deckId) || {}).new_order || "random") : [];

    const freshDue = due.filter((r) => !avoid.has(r.id));
    const freshNew = newRows.filter((r) => !avoid.has(r.id));
    if (freshDue.length && freshNew.length) {
      if (U.random() < counts.new_available / (counts.new_available + freshDue.length)) return freshNew[0];
      return freshDue[0];
    }
    if (freshDue.length || freshNew.length) return (freshDue.length ? freshDue : freshNew)[0];

    const ahead = cards.filter((c) => (c.state === F.LEARNING || c.state === F.RELEARNING) &&
      c.due <= now + LEARN_AHEAD_SECONDS).sort(byDue);
    const card = ahead.length ? first(ahead) : null;
    if (card && !(practice && avoid.has(card.id))) return card;
    if (practice) {
      const soonest = [...cards].sort((a, b) => ((a.state === F.NEW) - (b.state === F.NEW)) ||
        ((a.due ?? 0) - (b.due ?? 0)) || (a.id - b.id)).slice(0, 5);
      return first(soonest);
    }
    return card;
  }

  return { fsrs, LEARN_AHEAD_SECONDS, ratingFromAnswer, dayStart, toState, saveState, applyRating,
           queueCounts, orderNew, pickNextCard };
})();
