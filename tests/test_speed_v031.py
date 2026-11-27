"""v0.3.1 speed-ups: batched lookups, fewer fallback lookups, medium photos, first species first."""
from app import decks, jobs, quiz
from app.db import get_conn
from app.distractors import gather_candidates
from app.taxa import ensure_details_many
from tests.conftest import GENUS, make_deck


def _names(fake):
    return [n for n, _ in fake.calls]


def test_taxonomy_is_batched(fake):
    assert ensure_details_many([1, 2, 3, 4]) == 4
    assert _names(fake).count("taxa_by_ids") == 1 and "taxon" not in _names(fake)
    with get_conn() as conn:
        assert {r[0] for r in conn.execute("SELECT genus_id FROM taxa WHERE id IN (1,2,3,4)")} == {GENUS}
    assert ensure_details_many([1, 2]) == 0      # already known: no request


def test_taxonomy_batch_without_ancestor_list(fake):
    fake.omit_ancestors = True
    ensure_details_many([1, 6])
    # one batch for the species, one batch for their (shared) ancestors
    assert _names(fake).count("taxa_by_ids") == 2
    with get_conn() as conn:
        row = conn.execute("SELECT genus_id, family_id, order_id FROM taxa WHERE id = 1").fetchone()
    assert all(row)


def test_photo_pools_are_batched_and_uneven_species_fall_back(fake):
    filled = quiz.fill_pools_batched([1, 2, 3, 4, 5, 6, 7], None)
    assert filled == 6                              # Fieldfare (5) only got 2 photos in the batch
    assert _names(fake).count("observations_many") == 1
    fake.calls.clear()
    assert quiz.next_observation(1, None) is not None
    assert "observations" not in _names(fake)       # already in the pool
    assert quiz.next_observation(5, None) is not None
    assert _names(fake).count("observations") == 1  # fetched on its own


def test_subspecies_records_count_for_their_species(fake):
    quiz.fill_pools_batched([1], None)
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) FROM observations WHERE taxon_id = 1").fetchone()[0]
    assert n == 6


def test_warmup_uses_batched_requests(fake):
    make_deck(species=["Turdus merula", "Song Thrush", "Redwing", "Mistle Thrush"])
    jobs.wait_idle(10)
    names = _names(fake)
    assert "taxon" not in names                     # taxonomy came from the batch
    assert "observations" not in names              # photos came from the batch


def test_fallback_lookups_skipped_when_enough_options(fake):
    gather_candidates(1, lat=51.7, lng=-1.2, needed=3)
    order_calls = [kw for n, kw in fake.calls if n == "species_counts" and kw.get("taxon_id") == 7251]
    assert not order_calls


def test_quiz_shows_medium_photo_with_large_and_original(fake):
    sizes = quiz.photo_sizes("https://static.inaturalist.org/photos/9/large.jpg")
    assert "medium.jpg" in sizes["url"] and "large.jpg" in sizes["large"] and "original.jpg" in sizes["original"]


def test_first_species_added_straight_away(fake, monkeypatch):
    sizes = []
    real = decks._add_taxa

    def spy(conn, deck_id, taxa):
        if taxa:
            sizes.append(len(taxa))
        return real(conn, deck_id, taxa)

    monkeypatch.setattr(decks, "_add_taxa", spy)
    names = ["Turdus merula", "Song Thrush", "Redwing", "Fieldfare", "Mistle Thrush", "European Robin",
             "Common Nightingale"] * 2
    decks.create_deck("x", "list", {"species": names})
    jobs.wait_idle(10)
    assert sizes[0] == 1                          # first one on its own, so studying can start
