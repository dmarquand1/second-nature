from app import decks


def test_deck_from_list(fake):
    d = decks.create_deck("Thrushes", "list", {"species": ["Turdus merula", "Song Thrush", "Nonexistent bird"]})
    assert d["num_cards"] == 2
    assert d["unmatched"] == ["Nonexistent bird"]
    assert {c["name"] for c in d["cards"]} == {"Turdus merula", "Turdus philomelos"}


def test_deck_from_taxon(fake):
    d = decks.create_deck("Turdus", "taxon", {"taxon_id": 12716, "limit": 3})
    assert d["num_cards"] == 3


def test_deck_from_place(fake):
    d = decks.create_deck("UK birds", "place", {"place_id": 6857, "place_name": "United Kingdom"})
    assert d["num_cards"] == 7
    assert d["place_id"] == 6857


def test_add_and_remove(fake):
    d = decks.create_deck("T", "list", {"species": ["Turdus merula"]})
    r = decks.add_species(d["id"], ["Redwing"])
    assert r["added"] == 1
    decks.remove_card(d["id"], 4)
    assert decks.get_deck(d["id"])["num_cards"] == 1
