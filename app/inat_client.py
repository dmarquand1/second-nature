"""Small iNaturalist API client with an SQLite response cache and a
global rate limit (default: at most one request per second).

Only GET requests are made. Every response is cached in the `api_cache`
table, so repeating a quiz mostly works offline.
"""
import json
import math
import threading
import time
from contextlib import contextmanager
from urllib.parse import urlencode

import httpx

from . import config
from .db import get_conn


class InatError(Exception):
    pass


_local = threading.local()


@contextmanager
def background_priority():
    """Requests made inside this block give way to requests for the quiz you're
    looking at (used by the deck warm-up and big-list jobs)."""
    _local.background = True
    try:
        yield
    finally:
        _local.background = False


def is_background() -> bool:
    return getattr(_local, "background", False)


class RateLimiter:
    """Blocks so that calls are at least `min_interval` seconds apart.
    Background callers wait while any foreground caller is queued."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last = 0.0
        self._foreground_waiting = 0
        self._count_lock = threading.Lock()

    def wait(self) -> None:
        background = is_background()
        if background:
            while self._foreground_waiting > 0:
                time.sleep(0.05)
        else:
            with self._count_lock:
                self._foreground_waiting += 1
        try:
            with self._lock:
                now = time.monotonic()
                delay = self._last + self.min_interval - now
                if delay > 0:
                    time.sleep(delay)
                self._last = time.monotonic()
        finally:
            if not background:
                with self._count_lock:
                    self._foreground_waiting -= 1


def snap_to_grid(value: float, grid_deg: float) -> float:
    """Round a coordinate to the centre of a grid cell, so nearby photos share
    one cached "species near here" lookup."""
    return round(math.floor(float(value) / grid_deg) * grid_deg + grid_deg / 2, 4)


def _cache_key(path: str, params: dict) -> str:
    clean = {k: v for k, v in params.items() if v is not None}
    return f"{path}?{urlencode(sorted(clean.items()), doseq=True)}"


class InatClient:
    def __init__(self, base_url: str = config.INAT_API_BASE,
                 min_interval: float = config.INAT_MIN_SECONDS_BETWEEN_REQUESTS):
        self.base_url = base_url.rstrip("/")
        self.limiter = RateLimiter(min_interval)
        self._key_locks: dict[str, threading.Lock] = {}
        self._key_locks_guard = threading.Lock()
        self._http = httpx.Client(
            timeout=config.INAT_TIMEOUT_SECONDS,
            headers={"User-Agent": config.INAT_USER_AGENT, "Accept": "application/json"},
        )

    # ---- low level -------------------------------------------------------
    def _fetch(self, path: str, params: dict) -> dict:
        """Make the real HTTP request (rate limited, one retry on 429/5xx)."""
        clean = {k: v for k, v in params.items() if v is not None}
        for attempt in range(3):
            self.limiter.wait()
            try:
                resp = self._http.get(f"{self.base_url}{path}", params=clean)
            except httpx.HTTPError as exc:
                if attempt == 2:
                    raise InatError(f"Could not reach iNaturalist: {exc}") from exc
                time.sleep(2 * (attempt + 1))
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(5 * (attempt + 1))
                continue
            if resp.status_code >= 400:
                raise InatError(f"iNaturalist returned {resp.status_code} for {path}: {resp.text[:200]}")
            return resp.json()
        raise InatError(f"iNaturalist kept failing for {path}")

    def get(self, path: str, params: dict | None = None, ttl_kind: str = "default") -> dict:
        """GET with cache. Fresh cached responses are returned without a request.
        If the request fails but an old cached copy exists, the old copy is used."""
        params = params or {}
        key = _cache_key(path, params)
        # One fetch per key at a time: if the warm-up is already fetching this,
        # wait for it and use its result instead of asking iNaturalist twice.
        with self._key_locks_guard:
            lock = self._key_locks.setdefault(key, threading.Lock())
        with lock:
            return self._get_locked(path, params, key, ttl_kind)

    def cached(self, path: str, params: dict | None = None) -> bool:
        """True if a response for this request is already cached (fresh or not)."""
        with get_conn() as conn:
            return conn.execute("SELECT 1 FROM api_cache WHERE cache_key = ?",
                                (_cache_key(path, params or {}),)).fetchone() is not None

    def _get_locked(self, path: str, params: dict, key: str, ttl_kind: str) -> dict:
        ttl = config.CACHE_TTL.get(ttl_kind, config.CACHE_TTL["default"])
        with get_conn() as conn:
            row = conn.execute(
                "SELECT response, fetched_at FROM api_cache WHERE cache_key = ?", (key,)
            ).fetchone()
        if row and time.time() - row["fetched_at"] < ttl:
            return json.loads(row["response"])
        try:
            data = self._fetch(path, params)
        except InatError:
            if row:
                return json.loads(row["response"])
            raise
        with get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO api_cache (cache_key, response, fetched_at) VALUES (?, ?, ?)",
                (key, json.dumps(data), time.time()),
            )
        return data

    # ---- endpoints -------------------------------------------------------
    def autocomplete_taxa(self, q: str, per_page: int = 10) -> list[dict]:
        return self.get("/taxa/autocomplete", {"q": q, "per_page": per_page, "is_active": "true"},
                        "taxa")["results"]

    def search_taxa(self, q: str, rank: str | None = None, per_page: int = 10) -> list[dict]:
        return self.get("/taxa", {"q": q, "rank": rank, "per_page": per_page, "is_active": "true"},
                        "taxa")["results"]

    def taxa_by_ids(self, ids: list[int]) -> list[dict]:
        """Look up many taxa at once (30 per request)."""
        out = []
        ids = [int(i) for i in ids]
        for i in range(0, len(ids), 30):
            chunk = ",".join(str(x) for x in ids[i:i + 30])
            out += self.get(f"/taxa/{chunk}", {}, "taxa")["results"]
        return out

    def taxon(self, taxon_id: int) -> dict | None:
        results = self.get(f"/taxa/{int(taxon_id)}", {}, "taxa")["results"]
        return results[0] if results else None

    def autocomplete_places(self, q: str, per_page: int = 10) -> list[dict]:
        return self.get("/places/autocomplete", {"q": q, "per_page": per_page}, "places")["results"]

    def place(self, place_id: int) -> dict | None:
        results = self.get(f"/places/{int(place_id)}", {}, "places")["results"]
        return results[0] if results else None

    def species_counts(self, *, taxon_id=None, place_id=None, lat=None, lng=None,
                       radius_km=None, iconic_taxa=None, per_page: int = 100, page: int = 1) -> list[dict]:
        """Most-observed research-grade species, optionally within a taxon/place.
        lat/lng are snapped to a grid (NEARBY_GRID_DEG) so nearby photos share the cache."""
        grid = config.NEARBY_GRID_DEG
        params = {
            "quality_grade": "research",
            "taxon_id": taxon_id,
            "place_id": place_id,
            "lat": None if lat is None else snap_to_grid(lat, grid),
            "lng": None if lng is None else snap_to_grid(lng, grid),
            "radius": radius_km,
            "iconic_taxa": iconic_taxa,
            "per_page": min(per_page, 500),
            "page": page if page > 1 else None,
        }
        results = self.get("/observations/species_counts", params, "species_counts")["results"]
        return [r for r in results if r.get("taxon", {}).get("rank") == "species"]

    def species_counts_many(self, limit: int, progress=None, **kwargs) -> list[dict]:
        """Like species_counts but pages through results to get up to `limit` species."""
        out, page = [], 1
        while len(out) < limit:
            batch_raw = self.get("/observations/species_counts", {
                "quality_grade": "research", "taxon_id": kwargs.get("taxon_id"),
                "place_id": kwargs.get("place_id"), "per_page": 500, "page": page if page > 1 else None,
            }, "species_counts")
            results = batch_raw.get("results", [])
            out += [r for r in results if r.get("taxon", {}).get("rank") == "species"]
            if progress:
                progress(min(len(out), limit))
            if len(results) < 500 or page * 500 >= batch_raw.get("total_results", 0):
                break
            page += 1
        return out[:limit]

    def similar_species(self, taxon_id: int, place_id=None) -> list[dict]:
        """Species that iNat users commonly confuse with this one."""
        params = {"taxon_id": taxon_id, "quality_grade": "research", "place_id": place_id}
        results = self.get("/identifications/similar_species", params, "similar_species")["results"]
        return [r for r in results if r.get("taxon", {}).get("rank") == "species"]

    def observations(self, taxon_id: int, place_id=None, per_page: int = 50) -> list[dict]:
        params = {
            "taxon_id": taxon_id,
            "place_id": place_id,
            "quality_grade": "research",
            "photos": "true",
            "per_page": per_page,
        }
        return self.get("/observations", params, "observations")["results"]

    def observations_many(self, taxon_ids: list[int], place_id=None, per_page: int = 200) -> list[dict]:
        """Research-grade observations with photos for several species in ONE request."""
        params = {
            "taxon_id": ",".join(str(int(t)) for t in taxon_ids),
            "place_id": place_id,
            "quality_grade": "research",
            "photos": "true",
            "per_page": min(per_page, 200),
        }
        return self.get("/observations", params, "observations")["results"]


_client: InatClient | None = None


def get_client() -> InatClient:
    global _client
    if _client is None:
        _client = InatClient()
    return _client


def set_client(client) -> None:
    """Used by tests to swap in a fake client."""
    global _client
    _client = client
