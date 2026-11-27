"""Small iNaturalist API client with an SQLite response cache and a
global rate limit (default: at most one request per second).

Only GET requests are made. Every response is cached in the `api_cache`
table, so repeating a quiz mostly works offline.
"""
import json
import threading
import time
from urllib.parse import urlencode

import httpx

from . import config
from .db import get_conn


class InatError(Exception):
    pass


class RateLimiter:
    """Blocks so that calls are at least `min_interval` seconds apart."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._last + self.min_interval - now
            if delay > 0:
                time.sleep(delay)
            self._last = time.monotonic()


def _cache_key(path: str, params: dict) -> str:
    clean = {k: v for k, v in params.items() if v is not None}
    return f"{path}?{urlencode(sorted(clean.items()), doseq=True)}"


class InatClient:
    def __init__(self, base_url: str = config.INAT_API_BASE,
                 min_interval: float = config.INAT_MIN_SECONDS_BETWEEN_REQUESTS):
        self.base_url = base_url.rstrip("/")
        self.limiter = RateLimiter(min_interval)
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

    def taxon(self, taxon_id: int) -> dict | None:
        results = self.get(f"/taxa/{int(taxon_id)}", {}, "taxa")["results"]
        return results[0] if results else None

    def autocomplete_places(self, q: str, per_page: int = 10) -> list[dict]:
        return self.get("/places/autocomplete", {"q": q, "per_page": per_page}, "places")["results"]

    def place(self, place_id: int) -> dict | None:
        results = self.get(f"/places/{int(place_id)}", {}, "places")["results"]
        return results[0] if results else None

    def species_counts(self, *, taxon_id=None, place_id=None, lat=None, lng=None,
                       radius_km=None, iconic_taxa=None, per_page: int = 100) -> list[dict]:
        """Most-observed research-grade species, optionally within a taxon/place."""
        params = {
            "quality_grade": "research",
            "taxon_id": taxon_id,
            "place_id": place_id,
            "lat": None if lat is None else round(float(lat), 1),
            "lng": None if lng is None else round(float(lng), 1),
            "radius": radius_km,
            "iconic_taxa": iconic_taxa,
            "per_page": min(per_page, 500),
        }
        results = self.get("/observations/species_counts", params, "species_counts")["results"]
        return [r for r in results if r.get("taxon", {}).get("rank") == "species"]

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
