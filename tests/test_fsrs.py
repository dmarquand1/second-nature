import pytest

from app.fsrs import AGAIN, DAY, EASY, FSRS, GOOD, HARD, LEARNING, NEW, RELEARNING, REVIEW, CardState

f = FSRS()
NOW = 1_700_000_000.0


def test_retrievability_is_90_percent_after_stability_days():
    assert f.retrievability(10, 10) == pytest.approx(0.9)
    assert f.interval_days(10) == 10


def test_new_card_good_graduates_to_review():
    c = f.review(CardState(), GOOD, NOW)
    assert c.state == REVIEW
    assert c.stability == pytest.approx(3.173)
    assert c.due == NOW + 3 * DAY
    assert c.reps == 1


def test_new_card_again_goes_to_learning_for_a_minute():
    c = f.review(CardState(), AGAIN, NOW)
    assert c.state == LEARNING
    assert c.due == NOW + 60


def test_easy_beats_good_beats_hard():
    s = {r: f.review(CardState(), r, NOW).stability for r in (AGAIN, HARD, GOOD, EASY)}
    assert s[AGAIN] < s[HARD] < s[GOOD] < s[EASY]
    d = {r: f.review(CardState(), r, NOW).difficulty for r in (AGAIN, HARD, GOOD, EASY)}
    assert d[AGAIN] > d[HARD] > d[GOOD] > d[EASY]


def test_successful_review_grows_interval_and_lapse_shrinks_stability():
    c = f.review(CardState(), GOOD, NOW)
    later = c.due
    good = f.review(c, GOOD, later)
    assert good.state == REVIEW and good.stability > c.stability
    assert good.scheduled_days > c.scheduled_days
    bad = f.review(c, AGAIN, later)
    assert bad.state == RELEARNING and bad.stability < c.stability and bad.lapses == 1


def test_learning_card_graduates_on_good():
    c = f.review(CardState(), AGAIN, NOW)
    c = f.review(c, GOOD, NOW + 60)
    assert c.state == REVIEW and c.due >= NOW + DAY


def test_difficulty_stays_in_range():
    c = CardState()
    t = NOW
    for _ in range(30):
        c = f.review(c, AGAIN, t)
        t += 600
        assert 1 <= c.difficulty <= 10


def test_bad_rating_rejected():
    with pytest.raises(ValueError):
        f.review(CardState(state=NEW), 5, NOW)
