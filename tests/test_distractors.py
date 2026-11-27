import random

from app.distractors import gather_candidates, pick_distractors


def test_candidates_rank_similar_and_congeners_highest(fake):
    cands = gather_candidates(1, lat=51.7, lng=-1.2, needed=4)
    assert 1 not in cands  # never the answer itself
    ranked = sorted(cands.values(), key=lambda c: c["score"], reverse=True)
    top_ids = [c["taxon"]["id"] for c in ranked[:2]]
    assert set(top_ids) == {2, 3}  # similar species AND same genus
    assert "same family, found nearby" in cands[6]["reasons"]


def test_pick_distractors_unique_and_excludes_target(fake):
    picks = pick_distractors(1, 4, lat=51.7, lng=-1.2, rng=random.Random(1))
    ids = [p["id"] for p in picks]
    assert len(ids) == 4 and len(set(ids)) == 4 and 1 not in ids
