"""FastAPI app: JSON API under /api, frontend served from /static."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, decks, images, jobs, quiz, stats, warmup
from .db import init_db
from .inat_client import InatError, get_client

__version__ = "0.3.1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    images.trim_cache()
    yield


app = FastAPI(title="iNat Quiz", version=__version__, lifespan=lifespan)


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
    limit: int = Field(default=30, ge=2, le=config.MAX_DECK_SPECIES)
    num_choices: int = Field(default=config.DEFAULT_NUM_CHOICES, ge=4, le=6)
    new_per_day: int = Field(default=config.DEFAULT_NEW_PER_DAY, ge=0, le=500)
    description: str | None = None


class DeckSettings(BaseModel):
    name: str | None = None
    description: str | None = None
    num_choices: int | None = Field(default=None, ge=4, le=6)
    new_per_day: int | None = Field(default=None, ge=0, le=500)
    place_id: int | None = None
    place_name: str | None = None
    clear_place: bool = False


class SpeciesAdd(BaseModel):
    species: list[str] | str


class TaxonIds(BaseModel):
    taxon_ids: list[int] = Field(min_length=1, max_length=config.MAX_DECK_SPECIES)


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
    except (decks.DeckError, quiz.QuizError, images.ImageError) as exc:
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


def _need_deck(deck_id: int) -> None:
    if not decks.get_deck(deck_id):
        raise HTTPException(404, "Deck not found")


@app.post("/api/decks/{deck_id}/species")
def add_species(deck_id: int, body: SpeciesAdd):
    """Add names (pasted or from a file). Runs in the background; returns a job id."""
    _need_deck(deck_id)
    return _inat_guard(decks.add_species, deck_id, body.species)


@app.post("/api/decks/{deck_id}/taxa")
def add_taxa(deck_id: int, body: TaxonIds):
    """Add species picked from the search box."""
    _need_deck(deck_id)
    return _inat_guard(decks.add_taxa_ids, deck_id, body.taxon_ids)


@app.post("/api/decks/{deck_id}/remove")
def remove_species_many(deck_id: int, body: TaxonIds):
    return {"removed": decks.remove_cards(deck_id, body.taxon_ids)}


@app.delete("/api/decks/{deck_id}/species/{taxon_id}")
def remove_species(deck_id: int, taxon_id: int):
    decks.remove_cards(deck_id, [taxon_id])
    return {"ok": True}


@app.post("/api/decks/{deck_id}/warmup")
def start_warmup(deck_id: int):
    """Fetch photos and look-alikes for the deck in the background."""
    _need_deck(deck_id)
    return {"job_id": warmup.start(deck_id)}


@app.get("/api/decks/{deck_id}/warmup")
def warmup_status(deck_id: int):
    return warmup.status(deck_id) or {}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: int):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


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


# ---- stats ----------------------------------------------------------------
@app.get("/api/stats")
def get_stats(deck_id: int | None = None):
    return stats.overview(deck_id)


# ---- photos (offline cache) -------------------------------------------------
@app.get("/api/img")
def image(u: str):
    try:
        path, ctype = images.get_image(u)
    except images.ImageError as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(path, media_type=ctype, headers={"Cache-Control": "public, max-age=2592000"})


@app.get("/api/info")
def info():
    return {"version": __version__, "image_cache_mb": round(images.cache_size_mb(), 1),
            "image_cache_max_mb": config.IMAGE_CACHE_MAX_MB}


# ---- frontend -------------------------------------------------------------
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(config.STATIC_DIR / "index.html")
