"""Live checks against the REAL iNaturalist API (internet needed, ~15 seconds).

Skipped in normal test runs. Run them on purpose with:
    pytest -m live
They make about 12 requests (1 per second), so please don't run them in a loop.
They check that iNaturalist still answers the way the app expects.
"""
import pytest

from app import config, db, images, inat_client, quiz
from app.inat_client import InatClient
from app.taxa import ensure_details_many

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    tmp = tmp_path_factory.mktemp("live")
    mp.setattr(config, "DB_PATH", tmp / "live.db")
    mp.setattr(config, "IMAGE_CACHE_DIR", tmp / "images")
    db.init_db()
    client = InatClient()
    inat_client.set_client(client)
    yield client
    inat_client.set_client(None)
    mp.undo()


@pytest.fixture(scope="module")
def blackbird(live):
    results = live.search_taxa("Turdus merula", rank="species")
    match = [t for t in results if t["name"] == "Turdus merula"]
    assert match, "iNat search no longer finds Turdus merula"
    return match[0]


def test_search_finds_species_with_common_name(blackbird):
    assert blackbird["rank"] == "species"
    assert blackbird.get("preferred_common_name")


def test_batched_taxonomy_gives_genus_family_order(live, blackbird):
    song_thrush = live.search_taxa("Turdus philomelos", rank="species")[0]
    assert ensure_details_many([blackbird["id"], song_thrush["id"]]) == 2
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM taxa WHERE id IN (?, ?)", (blackbird["id"], song_thrush["id"])).fetchall()
    for r in rows:
        assert r["genus_id"] and r["family_id"] and r["order_id"]
    assert rows[0]["genus_id"] == rows[1]["genus_id"]   # both Turdus


def test_observations_have_photos_location_and_licence(live, blackbird):
    obs = live.observations(blackbird["id"], per_page=10)
    assert obs
    o = obs[0]
    assert o["photos"] and o["photos"][0]["url"]
    assert "attribution" in o["photos"][0] and "license_code" in o["photos"][0]
    assert o.get("location") and o.get("observed_on")
    assert images.allowed(o["photos"][0]["url"].replace("square", "medium"))


def test_batched_observations_cover_several_species(live, blackbird):
    robin = live.search_taxa("Erithacus rubecula", rank="species")[0]
    filled = quiz.fill_pools_batched([blackbird["id"], robin["id"]], None)
    assert filled >= 1


def test_similar_species_and_counts(live, blackbird):
    assert live.similar_species(blackbird["id"])
    uk = [p for p in live.autocomplete_places("United Kingdom") if "United Kingdom" in (p.get("display_name") or "")]
    assert uk
    from app.taxa import ensure_details
    genus_id = ensure_details(blackbird["id"])["genus_id"]
    counts = live.species_counts(taxon_id=genus_id, place_id=uk[0]["id"], per_page=10)
    assert any(c["taxon"]["id"] == blackbird["id"] for c in counts)


def test_photo_downloads_into_cache(live, blackbird):
    url = live.observations(blackbird["id"], per_page=10)[0]["photos"][0]["url"].replace("square", "medium")
    path, ctype = images.get_image(url)
    assert path.exists() and path.stat().st_size > 1000 and ctype.startswith("image/")
