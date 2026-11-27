"""FSRS (Free Spaced Repetition Scheduler), version 5 formulas.

This is a small, dependency-free implementation of the algorithm used by
Anki. Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

Each card has:
  * stability  S - days until recall probability drops to 90%
  * difficulty D - 1 (easy) to 10 (hard)
  * state        - NEW, LEARNING, REVIEW or RELEARNING

After each answer you give a rating (AGAIN, HARD, GOOD, EASY) and
`review()` returns the card's new S, D, state and next due time.
"""
import math
from dataclasses import dataclass, replace

NEW, LEARNING, REVIEW, RELEARNING = 0, 1, 2, 3
AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4

# FSRS-5 default parameters (fitted on a large Anki dataset).
DEFAULT_W = (
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621,
)
DECAY = -0.5
FACTOR = 0.9 ** (1 / DECAY) - 1  # = 19/81, so that R(t=S) = 0.9

DAY = 86400.0
MINUTE = 60.0
LEARNING_STEPS = {AGAIN: 1 * MINUTE, HARD: 5 * MINUTE}   # same-session repeats
RELEARNING_STEP = 10 * MINUTE
MAX_INTERVAL_DAYS = 36500


@dataclass(frozen=True)
class CardState:
    state: int = NEW
    stability: float | None = None
    difficulty: float | None = None
    due: float | None = None
    last_review: float | None = None
    reps: int = 0
    lapses: int = 0
    scheduled_days: float = 0.0
    elapsed_days: float = 0.0


def _clamp_d(d: float) -> float:
    return min(max(d, 1.0), 10.0)


class FSRS:
    def __init__(self, w=DEFAULT_W, desired_retention: float = 0.9):
        self.w = w
        self.desired_retention = desired_retention

    # ---- core formulas ---------------------------------------------------
    def retrievability(self, elapsed_days: float, stability: float) -> float:
        """Probability of recalling the card after `elapsed_days`."""
        return (1 + FACTOR * max(elapsed_days, 0) / stability) ** DECAY

    def interval_days(self, stability: float) -> int:
        """Days until recall probability falls to `desired_retention`."""
        days = stability / FACTOR * (self.desired_retention ** (1 / DECAY) - 1)
        return int(min(max(round(days), 1), MAX_INTERVAL_DAYS))

    def init_stability(self, rating: int) -> float:
        return max(self.w[rating - 1], 0.1)

    def init_difficulty(self, rating: int) -> float:
        return _clamp_d(self.w[4] - math.exp(self.w[5] * (rating - 1)) + 1)

    def next_difficulty(self, d: float, rating: int) -> float:
        delta = -self.w[6] * (rating - 3)
        d_new = d + delta * (10 - d) / 9                  # linear damping
        d_new = self.w[7] * self.init_difficulty(EASY) + (1 - self.w[7]) * d_new  # mean reversion
        return _clamp_d(d_new)

    def recall_stability(self, d: float, s: float, r: float, rating: int) -> float:
        hard_penalty = self.w[15] if rating == HARD else 1.0
        easy_bonus = self.w[16] if rating == EASY else 1.0
        return s * (1 + math.exp(self.w[8]) * (11 - d) * s ** -self.w[9]
                    * (math.exp(self.w[10] * (1 - r)) - 1) * hard_penalty * easy_bonus)

    def forget_stability(self, d: float, s: float, r: float) -> float:
        s_new = (self.w[11] * d ** -self.w[12] * ((s + 1) ** self.w[13] - 1)
                 * math.exp(self.w[14] * (1 - r)))
        return min(s_new, s)

    def short_term_stability(self, s: float, rating: int) -> float:
        """Stability change for a repeat on the same day (learning steps)."""
        return s * math.exp(self.w[17] * (rating - 3 + self.w[18]))

    # ---- one review ------------------------------------------------------
    def review(self, card: CardState, rating: int, now: float) -> CardState:
        if rating not in (AGAIN, HARD, GOOD, EASY):
            raise ValueError(f"rating must be 1-4, got {rating}")
        elapsed = 0.0 if card.last_review is None else max(now - card.last_review, 0) / DAY

        if card.state == NEW or card.stability is None:
            s = self.init_stability(rating)
            d = self.init_difficulty(rating)
            lapses = card.lapses
            if rating in LEARNING_STEPS:
                state, due, sched = LEARNING, now + LEARNING_STEPS[rating], 0.0
            else:
                ivl = self.interval_days(s)
                state, due, sched = REVIEW, now + ivl * DAY, float(ivl)

        elif card.state in (LEARNING, RELEARNING) or elapsed < 1:
            # Same-day repeat: short-term stability update.
            s = self.short_term_stability(card.stability, rating)
            d = self.next_difficulty(card.difficulty, rating)
            lapses = card.lapses
            if card.state == REVIEW and rating == AGAIN:
                lapses += 1
                state, due, sched = RELEARNING, now + RELEARNING_STEP, 0.0
            elif card.state == REVIEW:
                ivl = max(self.interval_days(s), int(card.scheduled_days) if rating >= GOOD else 1)
                state, due, sched = REVIEW, now + ivl * DAY, float(ivl)
            elif rating in (AGAIN, HARD):
                step = RELEARNING_STEP if card.state == RELEARNING else LEARNING_STEPS[rating]
                state, due, sched = card.state, now + step, 0.0
            else:
                ivl = self.interval_days(s)
                state, due, sched = REVIEW, now + ivl * DAY, float(ivl)

        else:  # REVIEW state, at least a day since last review
            r = self.retrievability(elapsed, card.stability)
            d = self.next_difficulty(card.difficulty, rating)
            if rating == AGAIN:
                s = self.forget_stability(card.difficulty, card.stability, r)
                lapses = card.lapses + 1
                state, due, sched = RELEARNING, now + RELEARNING_STEP, 0.0
            else:
                s = self.recall_stability(card.difficulty, card.stability, r, rating)
                lapses = card.lapses
                ivl = self.interval_days(s)
                state, due, sched = REVIEW, now + ivl * DAY, float(ivl)

        return replace(
            card, state=state, stability=s, difficulty=d, due=due, last_review=now,
            reps=card.reps + 1, lapses=lapses, scheduled_days=sched, elapsed_days=elapsed,
        )
