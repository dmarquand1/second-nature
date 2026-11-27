"""Pick hard wrong answers ("distractors") for a target species.

Candidates come from several sources, each adding to a score:

  source                                   weight
  ---------------------------------------  ------
  iNat "similar species" (commonly          3.0 + log(confusions)
    confused in identifications)
  same genus (most observed congeners)      2.5
  other species in the same deck that       2.0 / 1.5 / 1.0
    share genus / family / order (also +0.5 for any deck member)
  same family seen near the observation     1.5   (co-occurring in region)
  same family anywhere                      1.0   (fallback)
  species YOU have mixed up with it before  2.0 + 0.5 per mix-up (max +2)
  same order near the observation           0.5   (fallback)

Then a weighted random sample from the best candidates, so the same
question does not always show the same options.
"""
import math
import random

from . import config
from .db import get_conn
from .inat_client import InatError, get_client
from .taxa import ensure_details, upsert_taxon


def _add(cands: dict, taxon: dict, score: float, reason: str) -> None:
    if taxon.get("rank") != "species":
        return
    c = cands.setdefault(taxon["id"], {"taxon": taxon, "score": 0.0, "reasons": []})
    c["score"] += score
    if reason not in c["reasons"]:
        c["reasons"].append(reason)


def _deck_members(deck_id: int, target_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT t.* FROM cards c JOIN taxa t ON t.id = c.taxon_id
               WHERE c.deck_id = ? AND c.taxon_id != ?""",
            (deck_id, target_id),
        ).fetchall()
    return [dict(r) for r in rows]


def _your_confusions(target_id: int) -> list:
    with get_conn() as conn:
        return conn.execute(
            """SELECT t.id, t.name, t.common_name, t.rank, COUNT(*) AS n FROM reviews r
               JOIN taxa t ON t.id = CASE WHEN r.taxon_id = ? THEN r.chosen_taxon_id ELSE r.taxon_id END
               WHERE r.correct = 0 AND (r.taxon_id = ? OR r.chosen_taxon_id = ?)
               GROUP BY t.id ORDER BY n DESC LIMIT 10""",
            (target_id, target_id, target_id),
        ).fetchall()


def gather_candidates(target_id: int, deck_id: int | None = None, place_id: int | None = None,
                      lat: float | None = None, lng: float | None = None, needed: int = 5) -> dict:
    client = get_client()
    target = ensure_details(target_id)
    cands: dict = {}

    def safe(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except InatError:
            return []

    # 1. Species people actually confuse it with on iNat.
    for r in safe(client.similar_species, target_id, place_id=place_id)[:15]:
        _add(cands, r["taxon"], 3.0 + math.log1p(r.get("count", 0)) * 0.5, "similar species")

    # 2. Congeners.
    if target.get("genus_id"):
        for r in safe(client.species_counts, taxon_id=target["genus_id"], place_id=place_id, per_page=30):
            _add(cands, r["taxon"], 2.5, "same genus")

    # 3. Other species in this deck, weighted by how related they are.
    if deck_id:
        for m in _deck_members(deck_id, target_id):
            m_full = m if m.get("details_fetched") else None
            score, reason = 0.5, "in this deck"
            if m_full:
                if target.get("genus_id") and m_full["genus_id"] == target["genus_id"]:
                    score += 2.0
                elif target.get("family_id") and m_full["family_id"] == target["family_id"]:
                    score += 1.5
                elif target.get("order_id") and m_full["order_id"] == target["order_id"]:
                    score += 1.0
            elif target.get("iconic_taxon_name") and m.get("iconic_taxon_name") == target["iconic_taxon_name"]:
                score += 0.5
            _add(cands, {"id": m["id"], "name": m["name"], "preferred_common_name": m["common_name"],
                         "rank": m["rank"], "iconic_taxon_name": m["iconic_taxon_name"]}, score, reason)

    # 4. Same family that co-occurs near where this photo was taken.
    if target.get("family_id") and lat is not None and lng is not None:
        for r in safe(client.species_counts, taxon_id=target["family_id"], lat=lat, lng=lng,
                      radius_km=config.NEARBY_RADIUS_KM, per_page=30):
            _add(cands, r["taxon"], 1.5, "same family, found nearby")

    # 5. Species you've confused with this one before (either way round).
    for row in _your_confusions(target_id):
        t = {"id": row["id"], "name": row["name"], "preferred_common_name": row["common_name"], "rank": row["rank"]}
        _add(cands, t, 2.0 + min(row["n"] * 0.5, 2.0), "you've mixed these up before")

    cands.pop(target_id, None)

    # 6. Fallbacks when we are still short of options.
    def enough():
        # A couple more strong options than we need is plenty: skip the extra lookups.
        return len([c for c in cands.values() if c["score"] >= 1.0]) >= needed + 2

    if not enough() and target.get("family_id"):
        for r in safe(client.species_counts, taxon_id=target["family_id"], place_id=place_id, per_page=30):
            _add(cands, r["taxon"], 1.0, "same family")
    if not enough() and target.get("order_id"):
        if lat is not None and lng is not None:
            rs = safe(client.species_counts, taxon_id=target["order_id"], lat=lat, lng=lng,
                      radius_km=config.NEARBY_RADIUS_KM, per_page=30)
        else:
            rs = safe(client.species_counts, taxon_id=target["order_id"], place_id=place_id, per_page=30)
        for r in rs:
            _add(cands, r["taxon"], 0.5, "same order")
    cands.pop(target_id, None)
    return cands


def pick_distractors(target_id: int, n: int, deck_id: int | None = None, place_id: int | None = None,
                     lat: float | None = None, lng: float | None = None,
                     rng: random.Random | None = None) -> list[dict]:
    """Return `n` distractor taxa (iNat-style dicts with a 'reasons' list)."""
    rng = rng or random.Random()
    cands = gather_candidates(target_id, deck_id, place_id, lat, lng, needed=n)
    ranked = sorted(cands.values(), key=lambda c: c["score"], reverse=True)
    pool = ranked[: max(n * 3, 10)]
    chosen = []
    while pool and len(chosen) < n:
        weights = [c["score"] ** 2 for c in pool]
        pick = rng.choices(range(len(pool)), weights=weights, k=1)[0]
        chosen.append(pool.pop(pick))
    with get_conn() as conn:
        for c in chosen:
            upsert_taxon(conn, c["taxon"])
    return [{**c["taxon"], "reasons": c["reasons"]} for c in chosen]
