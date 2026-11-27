from fastapi.testclient import TestClient

from app.main import app


def test_full_quiz_round(fake):
    with TestClient(app) as c:
        d = c.post("/api/decks", json={"name": "Thrushes", "source_type": "list",
                                       "species": ["Turdus merula", "Song Thrush", "Redwing"],
                                       "num_choices": 4}).json()
        q = c.get(f"/api/decks/{d['id']}/next").json()
        assert len(q["choices"]) == 4
        assert 1 <= len(q["photos"]) <= 4
        assert q["location"]["lat"] == 51.75
        assert "large.jpg" in q["photos"][0]["url"]
        assert "answer" not in q  # the answer must not leak

        wrong = c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": 999999}).json()
        assert wrong["correct"] is False
        right_id = wrong["answer"]["id"]
        assert wrong["observation"]["uri"].startswith("https://www.inaturalist.org/observations/")

        # answering twice does not double-count
        c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": right_id})
        deck = c.get(f"/api/decks/{d['id']}").json()
        assert deck["num_reviews"] == 1


def test_no_repeat_species_in_a_row(fake):
    with TestClient(app) as c:
        d = c.post("/api/decks", json={"name": "T", "source_type": "list",
                                       "species": ["Turdus merula", "Song Thrush"]}).json()
        last = None
        for _ in range(6):
            q = c.get(f"/api/decks/{d['id']}/next").json()
            r = c.post(f"/api/questions/{q['question_id']}/answer", json={"taxon_id": q["choices"][0]["id"]}).json()
            assert r["answer"]["id"] != last
            last = r["answer"]["id"]
