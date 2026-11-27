"""Test setup: a temporary database and a fake iNaturalist client,
so tests run offline and never hit the real API."""
import pytest

from app import config, db, images, inat_client, jobs

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


HIGHER = {ORDER: ("Passeriformes", "order"), FAMILY: ("Turdidae", "family"),
          GENUS: ("Turdus", "genus"), OTHER_GENUS: ("Erithacus", "genus")}


def taxon_obj(tid):
    name, common, genus = SPECIES[tid]
    return {"id": tid, "name": name, "preferred_common_name": common, "rank": "species",
            "iconic_taxon_name": "Aves", "ancestor_ids": [ORDER, FAMILY, genus, tid],
            "default_photo": {"square_url": f"https://img.test/{tid}/square.jpg"},
            "observations_count": 1000 * (8 - tid)}       # Blackbird (1) most observed, Nightingale (7) least


class FakeClient:
    def __init__(self):
        self.calls = []
        self.no_photos = set()

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

    omit_ancestors = False   # set True to test the "no ancestors in the batch response" path

    def taxa_by_ids(self, ids):
        self._log("taxa_by_ids", ids=list(ids))
        out = []
        for i in map(int, ids):
            if i in SPECIES:
                if self.omit_ancestors:
                    out.append(taxon_obj(i))
                else:
                    out.append(self.taxon(i))
                    self.calls.pop()   # don't log the inner taxon() call
            elif i in HIGHER:
                out.append({"id": i, "name": HIGHER[i][0], "rank": HIGHER[i][1]})
        return out

    def species_counts_many(self, limit, progress=None, **kw):
        res = self.species_counts(taxon_id=kw.get("taxon_id"), place_id=kw.get("place_id"), per_page=500)
        if progress:
            progress(len(res))
        return res[:limit]

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
        return self._obs(taxon_id)

    def _obs(self, taxon_id):
        if taxon_id in self.no_photos:      # a species with no research-grade photos
            return []
        return [
            {"id": taxon_id * 1000 + i, "uri": f"https://www.inaturalist.org/observations/{taxon_id * 1000 + i}",
             "observed_on": "2025-05-0%d" % (i + 1), "place_guess": "Oxford, UK", "location": "51.75,-1.25",
             "obscured": False, "positional_accuracy": 20, "user": {"login": "tester"}, "taxon": {"id": taxon_id},
             # The first observation of each species is annotated "Alive or Dead: Dead".
             "annotations": [{"controlled_attribute_id": 17, "controlled_value_id": 19 if i == 0 else 18}],
             # Observation 5 is the best-liked (12 favourites), observation 3 has 4.
             "faves_count": {5: 12, 3: 4}.get(i, 0),
             "photos": [{"url": f"https://inaturalist-open-data.s3.amazonaws.com/photos/{taxon_id}{i}{p}/square.jpg", "attribution": "(c) tester, CC BY",
                         "license_code": "cc-by"} for p in range(2)]}
            for i in range(6)
        ]

    def observations_many(self, taxon_ids, place_id=None, per_page=200):
        """Like iNat: one request, mixed results, uneven (Fieldfare, id 5, gets only 2)."""
        self._log("observations_many", taxon_ids=list(taxon_ids), place_id=place_id)
        out = []
        for t in taxon_ids:
            if t not in SPECIES:
                continue
            obs = self._obs(t)[: 2 if t == 5 else 6]
            for o in obs:   # pretend some are subspecies records with the species in their ancestry
                o["taxon"] = {"id": t * 100 + 1, "ancestor_ids": [ORDER, FAMILY, SPECIES[t][2], t]}
            out += obs
        return out


class FakeImageResponse:
    status_code = 200
    content = b"\xff\xd8fake-jpeg"


@pytest.fixture()
def fake(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "IMAGE_CACHE_DIR", tmp_path / "images")
    downloads = []

    def fake_download(url):
        downloads.append(url)
        return FakeImageResponse()

    monkeypatch.setattr(images._http, "get", fake_download)
    db.init_db()
    client = FakeClient()
    client.downloads = downloads
    inat_client.set_client(client)
    yield client
    jobs.wait_idle(10)          # let background jobs finish before the temp database goes away
    inat_client.set_client(None)


def make_deck(name="T", species=("Turdus merula", "Song Thrush", "Redwing"), **kw):
    """Create a list deck and wait for the background build to finish."""
    from app import decks
    d = decks.create_deck(name, "list", {"species": list(species)}, **kw)
    assert jobs.wait_idle(10)
    return decks.get_deck(d["id"])
