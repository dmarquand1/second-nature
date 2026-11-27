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
    const newRows = counts.new_available > 0 ? U.shuffle(cards.filter((c) => c.state === F.NEW)) : [];

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
           queueCounts, pickNextCard };
})();
