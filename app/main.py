"""FastAPI app: JSON API under /api, frontend served from /static."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, decks, quiz
from .db import init_db
from .inat_client import InatError, get_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="iNat Quiz", version="0.2.0", lifespan=lifespan)


# ---- request bodies -------------------------------------------------------
class DeckCreate(BaseModel):
    name: str
    source_type: str = Field(pattern="^(list|taxon|place)$")
    species: list[str] | str | None = None       # for 'list'
    taxon_id: int | None = None                  # for 'taxon' (or a filter for 'place')
    taxon_name: str | None = None
    place_id: int | None = None                  # for 'place' (or a focus for 'taxon'/'list')
    place_name: str | None = None
    lat: float | None = None
    lng: float | None = None
    radius_km: float | None = None
    limit: int = 30
    num_choices: int = Field(default=config.DEFAULT_NUM_CHOICES, ge=4, le=6)
    new_per_day: int = Field(default=config.DEFAULT_NEW_PER_DAY, ge=0, le=500)
    description: str | None = None


class DeckSettings(BaseModel):
    name: str | None = None
    num_choices: int | None = Field(default=None, ge=4, le=6)
    new_per_day: int | None = Field(default=None, ge=0, le=500)


class SpeciesAdd(BaseModel):
    species: list[str]


class Answer(BaseModel):
    taxon_id: int
    response_ms: int | None = None


class Rating(BaseModel):
    rating: int = Field(ge=1, le=4)


def _inat_guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except InatError as exc:
        raise HTTPException(502, str(exc)) from exc
    except (decks.DeckError, quiz.QuizError) as exc:
        raise HTTPException(400, str(exc)) from exc


# ---- search helpers -------------------------------------------------------
@app.get("/api/search/taxa")
def search_taxa(q: str):
    results = _inat_guard(get_client().autocomplete_taxa, q)
    return [
        {"id": t["id"], "name": t["name"], "common_name": t.get("preferred_common_name"),
         "rank": t.get("rank"), "photo_url": (t.get("default_photo") or {}).get("square_url")}
        for t in results
    ]


@app.get("/api/search/places")
def search_places(q: str):
    results = _inat_guard(get_client().autocomplete_places, q)
    return [{"id": p["id"], "name": p.get("display_name") or p.get("name"), "type": p.get("place_type")}
            for p in results]


# ---- decks ----------------------------------------------------------------
@app.get("/api/decks")
def list_decks():
    return decks.list_decks()


@app.post("/api/decks")
def create_deck(body: DeckCreate):
    params = body.model_dump(exclude={"name", "source_type", "num_choices", "new_per_day", "description"},
                             exclude_none=True)
    return _inat_guard(decks.create_deck, body.name, body.source_type, params,
                       num_choices=body.num_choices, new_per_day=body.new_per_day,
                       description=body.description)


@app.get("/api/decks/{deck_id}")
def get_deck(deck_id: int):
    d = decks.get_deck(deck_id)
    if not d:
        raise HTTPException(404, "Deck not found")
    return d


@app.patch("/api/decks/{deck_id}")
def update_deck(deck_id: int, body: DeckSettings):
    if not decks.get_deck(deck_id):
        raise HTTPException(404, "Deck not found")
    decks.update_settings(deck_id, **body.model_dump(exclude_none=True))
    return decks.get_deck(deck_id)


@app.delete("/api/decks/{deck_id}")
def delete_deck(deck_id: int):
    decks.delete_deck(deck_id)
    return {"ok": True}


@app.post("/api/decks/{deck_id}/species")
def add_species(deck_id: int, body: SpeciesAdd):
    if not decks.get_deck(deck_id):
        raise HTTPException(404, "Deck not found")
    return _inat_guard(decks.add_species, deck_id, body.species)


@app.delete("/api/decks/{deck_id}/species/{taxon_id}")
def remove_species(deck_id: int, taxon_id: int):
    decks.remove_card(deck_id, taxon_id)
    return {"ok": True}


# ---- quiz -----------------------------------------------------------------
@app.get("/api/decks/{deck_id}/next")
def next_question(deck_id: int, practice: bool = False):
    return _inat_guard(quiz.next_question, deck_id, practice=practice)


@app.post("/api/questions/{question_id}/answer")
def answer(question_id: int, body: Answer):
    return _inat_guard(quiz.answer_question, question_id, body.taxon_id, body.response_ms)


@app.post("/api/questions/{question_id}/rate")
def rate(question_id: int, body: Rating):
    return _inat_guard(quiz.rate_question, question_id, body.rating)


# ---- frontend -------------------------------------------------------------
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(config.STATIC_DIR / "index.html")
