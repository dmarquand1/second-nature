"""Background jobs, so slow iNaturalist work never blocks the page.

Two kinds:
  * build  - find the species for a deck (big pasted lists, big groups/places)
  * warmup - fetch photos and look-alikes for a deck's species ahead of time

One worker thread runs jobs one at a time. Building a deck goes ahead of
warming up (a new deck shouldn't wait for photos of another deck), and a
running warm-up pauses between species to let a waiting build go first,
then carries on. iNaturalist requests run with background priority, so the
quiz you're looking at always goes first.
Progress is stored in the `jobs` table and shown in the app.
"""
import json
import queue
import threading
import time
import traceback

from .db import get_conn
from .inat_client import background_priority

_queue: "queue.PriorityQueue[tuple[int, int]]" = queue.PriorityQueue()   # (priority, job id)
_handlers = {}
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()
_idle = threading.Event()
_idle.set()


def handler(kind: str):
    """Decorator: register the function that runs jobs of this kind.
    It's called as fn(job_id, deck_id, params, progress)."""
    def wrap(fn):
        _handlers[kind] = fn
        return fn
    return wrap


def _ensure_worker() -> None:
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="inat-quiz-jobs", daemon=True)
            _worker.start()


def submit(kind: str, deck_id: int | None, params: dict | None = None, dedupe: bool = False) -> int:
    """Queue a job and return its id. With dedupe, an unfinished job of the same
    kind for the same deck is reused instead of queueing another."""
    with get_conn() as conn:
        if dedupe:
            row = conn.execute(
                "SELECT id FROM jobs WHERE kind = ? AND deck_id IS ? AND status IN ('queued', 'running')",
                (kind, deck_id),
            ).fetchone()
            if row:
                return row["id"]
        cur = conn.execute(
            "INSERT INTO jobs (kind, deck_id, status, params, created_at) VALUES (?, ?, 'queued', ?, ?)",
            (kind, deck_id, json.dumps(params or {}), time.time()),
        )
        job_id = cur.lastrowid
    _idle.clear()
    _queue.put((0 if kind == "build" else 1, job_id))
    _ensure_worker()
    return job_id


def build_waiting() -> bool:
    """True if a deck build is queued (a running warm-up then pauses to let it go first)."""
    with get_conn() as conn:
        return conn.execute("SELECT 1 FROM jobs WHERE kind = 'build' AND status = 'queued' LIMIT 1").fetchone() is not None


def _update(job_id: int, **fields) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))


def _run() -> None:
    while True:
        _, job_id = _queue.get()
        try:
            with get_conn() as conn:
                job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not job or job["status"] != "queued":
                continue
            from . import decks, warmup  # noqa: F401  (make sure every job kind is registered)
            fn = _handlers.get(job["kind"])
            if not fn:
                _update(job_id, status="failed", message=f"Unknown job kind {job['kind']}")
                continue
            _update(job_id, status="running")
            last_write = [0.0]

            def progress(done: int, total: int | None = None, message: str | None = None, force=False):
                # Write progress at most twice a second.
                now = time.monotonic()
                if force or now - last_write[0] > 0.5:
                    fields = {"done": done}
                    if total is not None:
                        fields["total"] = total
                    if message is not None:
                        fields["message"] = message
                    _update(job_id, **fields)
                    last_write[0] = now

            try:
                with background_priority():
                    result = fn(job_id, job["deck_id"], json.loads(job["params"] or "{}"), progress)
                _update(job_id, status="done", result=json.dumps(result or {}), finished_at=time.time())
            except Exception as exc:  # keep the worker alive whatever happens
                traceback.print_exc()
                _update(job_id, status="failed", message=str(exc)[:500], finished_at=time.time())
        finally:
            _queue.task_done()
            if _queue.empty():
                _idle.set()


def get_job(job_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _public(row) if row else None


def deck_jobs(deck_id: int) -> list[dict]:
    """Unfinished jobs plus the latest finished build job for a deck."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM jobs WHERE deck_id = ? AND (status IN ('queued', 'running')
                   OR id = (SELECT MAX(id) FROM jobs WHERE deck_id = ? AND kind = 'build'))
               ORDER BY id""",
            (deck_id, deck_id),
        ).fetchall()
    return [_public(r) for r in rows]


def _public(row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d["params"] or "{}")
    d["result"] = json.loads(d["result"]) if d["result"] else None
    return d


def wait_idle(timeout: float = 30) -> bool:
    """Wait until all queued jobs are finished (used by tests)."""
    return _idle.wait(timeout)
