"""
Metamorphic COLLECTION oracle — content checks on a paginated list endpoint that
survive where the status-only suite (and even the pagination oracle) fail.

The flat API suite asserts mostly on HTTP status, so a mutation to a controller's
`total_pages` formula (`ceil($total / $limit)` → `$total * $limit`), its OFFSET math
(`$offset = ($page - 1) * $limit` → `+`/`/`), or its COUNT query keeps returning 200
and slips through. The sibling `pagination_oracle` closes the page/limit *echo*,
row-bound and clamp family — but it never inspects `total`, `total_pages`, or whether
successive pages actually WALK the collection. Those are exactly the survivors here.

This oracle exploits metamorphic relations that hold for ANY correct paginated
collection, with NO hard-coded ground truth:
  1. total invariant   — `pagination.total` is the same on page 1 and page 2
  2. total_pages sanity — the reported page-count brackets total: (tp-1)*L < total <= tp*L
  3. single-page count  — when the whole collection fits (total <= effective limit),
                          the response carries exactly `total` rows
  4. coverage / offset  — paging with a small limit reconstructs the SAME row sequence
                          as one big fetch: page1 == full[0:L], page2 == full[L:2L]
                          (by a stable per-row id) — page N really starts at (N-1)*L

A mutation that corrupts the count, the page-count formula, or the offset flips one of
these → the suite's failure count rises → the mutant is killed. Non-paginated
endpoints (no `pagination` object with a numeric `total`) SKIP — never a false failure.
"""
from math import ceil
from typing import Any, Callable, Dict, List, Optional

Runner = Callable[[Dict[str, Any]], Dict[str, Any]]


def _verdict(passed: Optional[bool], reason: str, skipped: bool = False) -> Dict[str, Any]:
    return {"technique": "COLLECTION_METAMORPHIC",
            "passed": (None if skipped else passed),
            "skipped": bool(skipped), "reason": reason}


def _is_2xx(s: Any) -> bool:
    return isinstance(s, int) and 200 <= s < 300


def _pagination(body: Any) -> Optional[Dict[str, Any]]:
    if isinstance(body, dict) and isinstance(body.get("pagination"), dict):
        return body["pagination"]
    return None


def _int(v: Any) -> Optional[int]:
    try:
        # bools are ints in python; a real count is never a bool
        if isinstance(v, bool):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def _data(body: Any) -> Optional[List[Any]]:
    if isinstance(body, dict) and isinstance(body.get("data"), list):
        return body["data"]
    return None


def _id_field(rows: List[Any]) -> Optional[str]:
    """Pick a per-row key whose values are present, hashable and UNIQUE across the
    rows — a stable identity to compare page slices by. Prefer an `id`/`*_id` key."""
    if not rows or not all(isinstance(r, dict) for r in rows):
        return None
    keys = list(rows[0].keys())
    # prefer id-ish keys, in a deterministic order
    keys.sort(key=lambda k: (0 if k == "id" else (1 if str(k).endswith("id") else 2), str(k)))
    for k in keys:
        try:
            vals = [r.get(k) for r in rows]
        except AttributeError:
            continue
        if any(v is None for v in vals):
            continue
        try:
            if len(set(vals)) == len(vals):   # unique → usable identity
                return k
        except TypeError:                     # unhashable value (list/dict) — skip key
            continue
    return None


def _ids(rows: List[Any], key: str) -> List[Any]:
    return [r.get(key) for r in rows]


def check_collection(endpoint: str, run: Runner) -> Dict[str, Any]:
    """Run the metamorphic collection checks on one GET list endpoint.

    `endpoint` is "GET /collection"; `run` is http_runner.run_assertion-shaped
    (returns {actualStatus, responseBody, …}). Returns a verdict whose `passed` is
    True (consistent), False (a real inconsistency a mutation would introduce), or
    None (SKIP — not a paginated collection / unreachable)."""
    def _get(extra_qs: str = "") -> Dict[str, Any]:
        ep = endpoint
        if extra_qs:
            ep = f"{endpoint}{'&' if '?' in endpoint else '?'}{extra_qs}"
        return run({"type": "API", "endpoint": ep, "authSensitive": False})

    base = _get()
    if base.get("skipped"):
        return _verdict(None, base.get("skipReason", "auth wall"), skipped=True)
    if not _is_2xx(base.get("actualStatus")):
        return _verdict(None, f"not a 2xx list ({base.get('actualStatus')})", skipped=True)
    pg = _pagination(base.get("responseBody"))
    if pg is None:
        return _verdict(None, "no pagination object — not a paginated collection", skipped=True)
    total = _int(pg.get("total"))
    if total is None:
        return _verdict(None, "no numeric pagination.total — nothing to cross-check", skipped=True)
    if total < 0:
        return _verdict(False, f"pagination.total is negative ({total})")

    # 1. total_pages sanity — the page count must bracket the total (for total>0).
    #    Holds whether the impl uses ceil() or max(1, ceil()); breaks on the classic
    #    `ceil($total / $limit)` → `* / other` mutation which explodes the value.
    base_lim = _int(pg.get("limit"))
    tp = _int(pg.get("total_pages"))
    if tp is not None and total > 0 and base_lim and base_lim > 0:
        if tp < 1:
            return _verdict(False, f"total_pages {tp} < 1 with total {total}")
        if not ((tp - 1) * base_lim < total <= tp * base_lim):
            return _verdict(False, f"total_pages {tp} inconsistent with total {total} / limit "
                                   f"{base_lim} (expected ~{ceil(total / base_lim)})")

    # 2. Big fetch — reconstruct the whole (clamped) collection once. Effective limit
    #    is whatever the server clamps to; total must not move.
    full = _get("page=1&limit=1000")
    full_rows: Optional[List[Any]] = None
    full_total = total
    full_lim = base_lim
    if _is_2xx(full.get("actualStatus")):
        fpg = _pagination(full.get("responseBody")) or {}
        ft = _int(fpg.get("total"))
        if ft is not None and ft != total:
            return _verdict(False, f"pagination.total changed with page size: {total} vs {ft}")
        full_lim = _int(fpg.get("limit")) or base_lim
        full_rows = _data(full.get("responseBody"))
        # 3. single-page count — when the collection fits, we get exactly `total` rows.
        if full_rows is not None and full_lim is not None and total <= full_lim:
            if len(full_rows) != total:
                return _verdict(False, f"collection fits (total {total} <= limit {full_lim}) but "
                                       f"returned {len(full_rows)} rows — total/rows disagree")

    # 4. coverage / offset — walk the collection with a small page size and require it
    #    to reproduce the big fetch's ordering slice-for-slice. This is what pins page N
    #    to offset (N-1)*L: an offset mutation makes page1 no longer start at the top,
    #    or page2 repeat page1. Metamorphic: no hard-coded rows, only self-consistency.
    L = 2
    p1 = _get(f"page=1&limit={L}")
    if _is_2xx(p1.get("actualStatus")):
        p1pg = _pagination(p1.get("responseBody")) or {}
        p1_total = _int(p1pg.get("total"))
        if p1_total is not None and p1_total != total:
            return _verdict(False, f"pagination.total changed on page 1 (limit {L}): {total} vs {p1_total}")
        eff_L = _int(p1pg.get("limit")) or L
        p1_rows = _data(p1.get("responseBody"))
        if p1_rows is not None:
            expect_p1 = min(eff_L, total)
            if len(p1_rows) != expect_p1:
                return _verdict(False, f"page 1 (limit {eff_L}) has {len(p1_rows)} rows, "
                                       f"expected {expect_p1} (min of limit and total {total})")
            # id-keyed coverage against the big fetch
            key = _id_field(full_rows) if full_rows else None
            if key and full_rows is not None and all(isinstance(r, dict) for r in p1_rows):
                if _ids(p1_rows, key) != _ids(full_rows, key)[:len(p1_rows)]:
                    return _verdict(False, "page 1 does not start at the top of the collection "
                                           "— offset/ordering broken")
            if total > eff_L:
                p2 = _get(f"page=2&limit={eff_L}")
                if _is_2xx(p2.get("actualStatus")):
                    p2pg = _pagination(p2.get("responseBody")) or {}
                    p2_total = _int(p2pg.get("total"))
                    if p2_total is not None and p2_total != total:
                        return _verdict(False, f"pagination.total changed on page 2: {total} vs {p2_total}")
                    p2_rows = _data(p2.get("responseBody"))
                    if p2_rows is not None:
                        expect_p2 = min(eff_L, total - eff_L)
                        if len(p2_rows) != expect_p2:
                            return _verdict(False, f"page 2 has {len(p2_rows)} rows, expected "
                                                   f"{expect_p2} — offset/limit walk broken")
                        if key and full_rows is not None and all(isinstance(r, dict) for r in p2_rows):
                            got = _ids(p2_rows, key)
                            want = _ids(full_rows, key)[eff_L:eff_L + len(p2_rows)]
                            if got != want:
                                return _verdict(False, "page 2 rows are not the next slice of the "
                                                       "collection — offset broken (page repeat/skip)")

    return _verdict(True, "collection consistent (total invariant, page-count sanity, "
                          "single-page count, offset coverage)")


if __name__ == "__main__":
    # ── Offline self-test with scripted fake apps (no network). ───────────────
    def _resp(status, body):
        return {"actualStatus": status, "responseBody": body}

    def _parse_q(ep):
        q = {}
        if "?" in ep:
            for kv in ep.split("?", 1)[1].split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    q[k] = v
        return q

    N = 15                                   # a fixed backing collection of 15 rows
    ROWS = [{"product_id": i, "name": f"p{i}"} for i in range(1, N + 1)]

    def _page(q, mut=None):
        """Shared helper: read page/limit like the real controller and slice ROWS.
        `mut` injects a specific bug for the broken apps below."""
        page = max(1, int(q.get("page", 1)))
        limit = min(100, max(1, int(q.get("limit", 10))))
        total = N
        offset = (page - 1) * limit
        total_pages = ceil(total / limit)
        if mut == "total_pages_mul":
            total_pages = total * limit          # ceil($total / $limit) -> * mutation
        if mut == "offset_plus":
            offset = (page + 1) * limit          # ($page - 1) -> ($page + 1)
        if mut == "offset_div":
            offset = (page - 1) // limit         # ($page - 1) * $limit -> / (int div)
        if mut == "page_total":
            total = min(limit, N - (page - 1) * limit)   # total counts only THIS page
        rows = ROWS[offset:offset + limit]
        return _resp(200, {"success": True, "data": rows,
                           "pagination": {"page": page, "limit": limit,
                                          "total": total, "total_pages": total_pages}})

    # A CORRECT paginated app.
    def correct(a):
        return _page(_parse_q(a["endpoint"]))
    r = check_collection("GET /products", correct)
    assert r["passed"] is True and not r["skipped"], r

    # BUG A — total_pages formula divide→multiply (explodes the page count).
    def bad_total_pages(a):
        return _page(_parse_q(a["endpoint"]), mut="total_pages_mul")
    r = check_collection("GET /products", bad_total_pages)
    assert r["passed"] is False and "total_pages" in r["reason"], r

    # BUG B — offset minus→plus: page 1 no longer starts at the top.
    def bad_offset_plus(a):
        return _page(_parse_q(a["endpoint"]), mut="offset_plus")
    r = check_collection("GET /products", bad_offset_plus)
    assert r["passed"] is False, r

    # BUG C — offset multiply→divide: page 2 repeats page 1.
    def bad_offset_div(a):
        return _page(_parse_q(a["endpoint"]), mut="offset_div")
    r = check_collection("GET /products", bad_offset_div)
    assert r["passed"] is False, r

    # BUG D — total is page-local instead of the whole collection.
    def bad_page_total(a):
        return _page(_parse_q(a["endpoint"]), mut="page_total")
    r = check_collection("GET /products", bad_page_total)
    assert r["passed"] is False and "total" in r["reason"], r

    # A small collection that fits on one page — single-page count must equal total.
    def correct_small(a):
        q = _parse_q(a["endpoint"])
        page = max(1, int(q.get("page", 1)))
        limit = min(100, max(1, int(q.get("limit", 10))))
        rows = [{"id": i} for i in range(3)]
        rows = rows[(page - 1) * limit:(page - 1) * limit + limit]
        return _resp(200, {"data": rows, "pagination": {"page": page, "limit": limit,
                                                        "total": 3, "total_pages": ceil(3 / limit)}})
    r = check_collection("GET /small", correct_small)
    assert r["passed"] is True, r

    def bad_small_count(a):
        # claims total 3 but only ever returns 1 row even when it all fits
        q = _parse_q(a["endpoint"])
        limit = min(100, max(1, int(q.get("limit", 10))))
        return _resp(200, {"data": [{"id": 1}], "pagination": {"page": 1, "limit": limit,
                                                              "total": 3, "total_pages": 1}})
    r = check_collection("GET /small", bad_small_count)
    assert r["passed"] is False, r

    # A NON-paginated endpoint → SKIP, never a false failure.
    def not_paginated(a):
        return _resp(200, {"data": {"id": 1, "name": "x"}})
    r = check_collection("GET /products/1", not_paginated)
    assert r["skipped"] is True and r["passed"] is None, r

    # A list with a `data` array but no pagination object → SKIP.
    def list_no_pag(a):
        return _resp(200, {"data": [{"id": 1}, {"id": 2}]})
    r = check_collection("GET /tags", list_no_pag)
    assert r["skipped"] is True, r

    # An auth-walled endpoint → SKIP.
    def walled(a):
        return {"skipped": True, "skipReason": "auth wall"}
    r = check_collection("GET /orders", walled)
    assert r["skipped"] is True, r

    # A non-2xx endpoint → SKIP.
    def not_ok(a):
        return _resp(404, {"success": False})
    r = check_collection("GET /nope", not_ok)
    assert r["skipped"] is True, r

    print("collection_oracle SELF-TEST PASS (total invariant + page-count sanity + "
          "single-page count + offset coverage; skip on non-paginated)")
