"""Test setup: a temporary database and a fake iNaturalist client,
so tests run offline and never hit the real API."""
import pytest

from app import config, db, inat_client

ORDER, FAMILY, GENUS, OTHER_GENUS = 7251, 12705, 12716, 9999

SPECIES = {
    1: ("Turdus merula", "Eurasian Blackbird", GENUS),
    2: ("Turdus philomelos", "Song Thrush", GENUS),
    3: ("Turdus viscivorus", "Mistle Thrush", GENUS),
    4: ("Turdus iliacus", "Redwing", GENUS),
    5: ("Turdus pilaris", "Fieldfare", GENUS),
    6: ("Erithacus rubecula", "European Robin", OTHER_GENUS),
    7: ("Luscinia megarhynchos", "Common Nightingale", OTHER_GENUS),
}


def taxon_obj(tid):
    name, common, genus = SPECIES[tid]
    return {"id": tid, "name": name, "preferred_common_name": common, "rank": "species",
            "iconic_taxon_name": "Aves", "ancestor_ids": [ORDER, FAMILY, genus, tid],
            "default_photo": {"square_url": f"https://img.test/{tid}/square.jpg"}}


class FakeClient:
    def __init__(self):
        self.calls = []

    def _log(self, name, **kw):
        self.calls.append((name, kw))

    def autocomplete_taxa(self, q, per_page=10):
        self._log("autocomplete_taxa", q=q)
        return [taxon_obj(t) for t in SPECIES if q.lower() in SPECIES[t][0].lower() or q.lower() in SPECIES[t][1].lower()]

    def search_taxa(self, q, rank=None, per_page=10):
        self._log("search_taxa", q=q)
        return self.autocomplete_taxa(q)

    def taxon(self, tid):
        self._log("taxon", tid=tid)
        if tid not in SPECIES:
            return None
        t = taxon_obj(tid)
        genus = SPECIES[tid][2]
        t["ancestors"] = [{"id": ORDER, "rank": "order"}, {"id": FAMILY, "rank": "family"},
                          {"id": genus, "rank": "genus"}]
        return t

    def autocomplete_places(self, q, per_page=10):
        return [{"id": 6857, "display_name": "United Kingdom", "place_type": 12}]

    def place(self, pid):
        return {"id": pid, "display_name": "United Kingdom"}

    def species_counts(self, *, taxon_id=None, place_id=None, lat=None, lng=None, radius_km=None,
                       iconic_taxa=None, per_page=100):
        self._log("species_counts", taxon_id=taxon_id, place_id=place_id, lat=lat)
        ids = [t for t in SPECIES if taxon_id in (None, ORDER, FAMILY) or SPECIES[t][2] == taxon_id]
        return [{"count": 100 - t, "taxon": taxon_obj(t)} for t in ids][:per_page]

    def similar_species(self, taxon_id, place_id=None):
        self._log("similar_species", taxon_id=taxon_id)
        return [{"count": 40, "taxon": taxon_obj(t)} for t in (2, 3) if t != taxon_id]

    def observations(self, taxon_id, place_id=None, per_page=50):
        self._log("observations", taxon_id=taxon_id, place_id=place_id)
        return [
            {"id": taxon_id * 1000 + i, "uri": f"https://www.inaturalist.org/observations/{taxon_id * 1000 + i}",
             "observed_on": "2025-05-0%d" % (i + 1), "place_guess": "Oxford, UK", "location": "51.75,-1.25",
             "obscured": False, "positional_accuracy": 20, "user": {"login": "tester"}, "taxon": {"id": taxon_id},
             "photos": [{"url": f"https://img.test/o{taxon_id}{i}{p}/square.jpg", "attribution": "(c) tester, CC BY",
                         "license_code": "cc-by"} for p in range(2)]}
            for i in range(3)
        ]


@pytest.fixture()
def fake(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    client = FakeClient()
    inat_client.set_client(client)
    yield client
    inat_client.set_client(None)
