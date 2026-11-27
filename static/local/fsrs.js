// FSRS-5 spaced repetition, the same formulas as app/fsrs.py (see docs/07-spaced-repetition.md).
IQ.fsrs = (() => {
  const NEW = 0, LEARNING = 1, REVIEW = 2, RELEARNING = 3;
  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
  const DEFAULT_W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621,
  ];
  const DECAY = -0.5;
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
  const DAY = 86400, MINUTE = 60;
  const LEARNING_STEPS = { [AGAIN]: 1 * MINUTE, [HARD]: 5 * MINUTE };
  const RELEARNING_STEP = 10 * MINUTE;
  const MAX_INTERVAL_DAYS = 36500;

  const newCard = () => ({ state: NEW, stability: null, difficulty: null, due: null, last_review: null,
                           reps: 0, lapses: 0, scheduled_days: 0, elapsed_days: 0 });
  const clampD = (d) => Math.min(Math.max(d, 1), 10);

  function make(w = DEFAULT_W, desiredRetention = 0.9) {
    const f = {
      w, desiredRetention,
      retrievability: (elapsed, s) => Math.pow(1 + FACTOR * Math.max(elapsed, 0) / s, DECAY),
      intervalDays(s) {
        const days = s / FACTOR * (Math.pow(f.desiredRetention, 1 / DECAY) - 1);
        return Math.trunc(Math.min(Math.max(IQ.util.pyRound(days), 1), MAX_INTERVAL_DAYS));
      },
      initStability: (r) => Math.max(w[r - 1], 0.1),
      initDifficulty: (r) => clampD(w[4] - Math.exp(w[5] * (r - 1)) + 1),
      nextDifficulty(d, r) {
        const delta = -w[6] * (r - 3);
        let dn = d + delta * (10 - d) / 9;
        dn = w[7] * f.initDifficulty(EASY) + (1 - w[7]) * dn;
        return clampD(dn);
      },
      recallStability(d, s, r, rating) {
        const hard = rating === HARD ? w[15] : 1, easy = rating === EASY ? w[16] : 1;
        return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy);
      },
      forgetStability(d, s, r) {
        const sn = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
        return Math.min(sn, s);
      },
      shortTermStability: (s, r) => s * Math.exp(w[17] * (r - 3 + w[18])),

      review(card, rating, now) {
        if (![AGAIN, HARD, GOOD, EASY].includes(rating)) throw new Error(`rating must be 1-4, got ${rating}`);
        const elapsed = card.last_review == null ? 0 : Math.max(now - card.last_review, 0) / DAY;
        let s, d, lapses = card.lapses, state, due, sched;
        if (card.state === NEW || card.stability == null) {
          s = f.initStability(rating);
          d = f.initDifficulty(rating);
          if (LEARNING_STEPS[rating]) { state = LEARNING; due = now + LEARNING_STEPS[rating]; sched = 0; }
          else { const ivl = f.intervalDays(s); state = REVIEW; due = now + ivl * DAY; sched = ivl; }
        } else if (card.state === LEARNING || card.state === RELEARNING || elapsed < 1) {
          s = f.shortTermStability(card.stability, rating);
          d = f.nextDifficulty(card.difficulty, rating);
          if (card.state === REVIEW && rating === AGAIN) {
            lapses += 1; state = RELEARNING; due = now + RELEARNING_STEP; sched = 0;
          } else if (card.state === REVIEW) {
            const ivl = Math.max(f.intervalDays(s), rating >= GOOD ? Math.trunc(card.scheduled_days) : 1);
            state = REVIEW; due = now + ivl * DAY; sched = ivl;
          } else if (rating === AGAIN || rating === HARD) {
            const step = card.state === RELEARNING ? RELEARNING_STEP : LEARNING_STEPS[rating];
            state = card.state; due = now + step; sched = 0;
          } else {
            const ivl = f.intervalDays(s); state = REVIEW; due = now + ivl * DAY; sched = ivl;
          }
        } else {
          const r = f.retrievability(elapsed, card.stability);
          d = f.nextDifficulty(card.difficulty, rating);
          if (rating === AGAIN) {
            s = f.forgetStability(card.difficulty, card.stability, r);
            lapses += 1; state = RELEARNING; due = now + RELEARNING_STEP; sched = 0;
          } else {
            s = f.recallStability(card.difficulty, card.stability, r, rating);
            const ivl = f.intervalDays(s); state = REVIEW; due = now + ivl * DAY; sched = ivl;
          }
        }
        return { ...card, state, stability: s, difficulty: d, due, last_review: now,
                 reps: card.reps + 1, lapses, scheduled_days: sched, elapsed_days: elapsed };
      },
    };
    return f;
  }

  return { NEW, LEARNING, REVIEW, RELEARNING, AGAIN, HARD, GOOD, EASY, DEFAULT_W, FACTOR, newCard, make };
})();
