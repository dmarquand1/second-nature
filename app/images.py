"""Offline photo cache.

Photos are served to the browser through `/api/img?u=<iNat photo url>`.
The first time, the photo is downloaded from iNaturalist and saved in
`data/images/`; after that it comes straight from your disk (fast, and works
offline). Only iNaturalist photo hosts are allowed. The cache is trimmed to
IMAGE_CACHE_MAX_MB, removing the photos used least recently.
"""
import hashlib
import os
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx

from . import config

_http = httpx.Client(timeout=30, headers={"User-Agent": config.INAT_USER_AGENT}, follow_redirects=True)
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
# iNat asks apps not to hammer its photo servers either: at most 3 downloads at once.
_download_slots = threading.Semaphore(3)

CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
                 ".webp": "image/webp"}


class ImageError(Exception):
    pass


def allowed(url: str) -> bool:
    u = urlparse(url)
    return u.scheme == "https" and u.hostname in config.IMAGE_HOSTS


def local_url(url: str | None) -> str | None:
    """The URL the browser should use for an iNat photo (through the offline cache
    when it's an iNaturalist photo host)."""
    if not url:
        return None
    return f"/api/img?u={quote(url, safe='')}" if allowed(url) else url


def _path_for(url: str) -> Path:
    ext = Path(urlparse(url).path).suffix.lower()
    if ext not in CONTENT_TYPES:
        ext = ".jpg"
    h = hashlib.sha1(url.encode()).hexdigest()
    return config.IMAGE_CACHE_DIR / h[:2] / f"{h}{ext}"


def is_cached(url: str) -> bool:
    return _path_for(url).exists()


def get_image(url: str) -> tuple[Path, str]:
    """Return (path on disk, content type), downloading the photo if needed."""
    if not allowed(url):
        raise ImageError("Only iNaturalist photos can be loaded.")
    path = _path_for(url)
    ctype = CONTENT_TYPES.get(path.suffix, "image/jpeg")
    if path.exists():
        try:
            os.utime(path)  # mark as recently used
        except OSError:
            pass
        return path, ctype
    with _guard:
        lock = _locks.setdefault(url, threading.Lock())
    with lock:
        if path.exists():
            return path, ctype
        with _download_slots:
            try:
                resp = _http.get(url)
            except httpx.HTTPError as exc:
                raise ImageError(f"Could not download photo: {exc}") from exc
        if resp.status_code != 200:
            raise ImageError(f"Photo server returned {resp.status_code}")
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(resp.content)
        tmp.replace(path)
    return path, ctype


def prefetch(urls: list[str]) -> None:
    """Download photos ahead of time; errors are ignored."""
    for u in urls:
        try:
            get_image(u)
        except ImageError:
            pass


def cache_size_mb() -> float:
    if not config.IMAGE_CACHE_DIR.exists():
        return 0.0
    return sum(f.stat().st_size for f in config.IMAGE_CACHE_DIR.rglob("*") if f.is_file()) / 1e6


def trim_cache(max_mb: float | None = None) -> int:
    """Delete least-recently-used photos until the cache is under the limit. Returns files removed."""
    max_bytes = (config.IMAGE_CACHE_MAX_MB if max_mb is None else max_mb) * 1e6
    if not config.IMAGE_CACHE_DIR.exists():
        return 0
    files = [f for f in config.IMAGE_CACHE_DIR.rglob("*") if f.is_file()]
    total = sum(f.stat().st_size for f in files)
    removed = 0
    for f in sorted(files, key=lambda f: f.stat().st_mtime):
        if total <= max_bytes:
            break
        total -= f.stat().st_size
        f.unlink(missing_ok=True)
        removed += 1
    return removed
