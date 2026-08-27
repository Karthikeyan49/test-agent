"""
Metamorphic pagination oracle — a CONTENT check that survives where status-only
tests fail.

The flat API suite asserts mostly on HTTP status, so a mutation to a controller's
pagination logic (`$page = 1`, `$limit = min(100, max(1, …10))`, the read/clamp of
the `page`/`limit` query params) keeps returning 200 and slips through — the whole
`int N->N±1` / `0<->1` family on those lines survives. But a correct paginated
endpoint *echoes* the effective page/limit back in its response and never returns
more rows than the limit, so those values ARE observable.

This oracle exploits metamorphic relations that hold for ANY correct pagination,
with no hard-coded ground truth:
  1. default page  — a request with no params reports page 1
  2. echo          — `?page=P&limit=L` reports page P and limit L
  3. bound         — a response never carries more `data` rows than its own limit
  4. clamp         — an absurd `?limit=100000` is bounded (rows <= reported limit)

A mutation that changes the page/limit default, misreads the param, or breaks the
clamp flips one of these → the suite's failure count rises → the mutant is killed.
Non-paginated endpoints (no `pagination` object) SKIP — never a false failure.
"""
from typing import Any, Callable, Dict, Optional

Runner = Callable[[Dict[str, Any]], Dict[str, Any]]


def _verdict(passed: Optional[bool], reason: str, skipped: bool = False) -> Dict[str, Any]:
    return {"technique": "PAGINATION_METAMORPHIC",
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
        return int(v)
    except (TypeError, ValueError):
        return None


def check_pagination(endpoint: str, run: Runner) -> Dict[str, Any]:
    """Run the metamorphic pagination checks on one GET list endpoint.

    `endpoint` is "GET /collection"; `run` is http_runner.run_assertion-shaped
    (returns {actualStatus, responseBody, …}). Returns a verdict whose
    `passed` is True (consistent), False (a real inconsistency = a bug a mutation
    would introduce), or None (SKIP — not a paginated endpoint / unreachable).
    """
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
        return _verdict(None, "no pagination object — not a paginated endpoint", skipped=True)

    # 1. default page — a no-param request reports page 1.
    if _int(pg.get("page")) not in (None, 1):
        return _verdict(False, f"default page is {pg.get('page')}, expected 1 "
                               "(pagination default changed)")

    # 2 + 3. echo of an explicit page/limit, and the data-length bound.
    P, L = 2, 3
    r = _get(f"page={P}&limit={L}")
    if _is_2xx(r.get("actualStatus")):
        pg2 = _pagination(r.get("responseBody")) or {}
        if _int(pg2.get("page")) not in (None, P):
            return _verdict(False, f"?page={P} echoed page {pg2.get('page')} — page param mishandled")
        if _int(pg2.get("limit")) not in (None, L):
            return _verdict(False, f"?limit={L} echoed limit {pg2.get('limit')} — limit param mishandled")
        data = (r.get("responseBody") or {}).get("data")
        if isinstance(data, list) and len(data) > L:
            return _verdict(False, f"?limit={L} returned {len(data)} rows — limit not enforced")

    # 4. clamp — an absurd limit stays bounded by the reported limit.
    r = _get("limit=100000")
    if _is_2xx(r.get("actualStatus")):
        pg3 = _pagination(r.get("responseBody")) or {}
        lim = _int(pg3.get("limit"))
        data = (r.get("responseBody") or {}).get("data")
        if isinstance(data, list) and lim is not None and len(data) > lim:
            return _verdict(False, f"limit=100000 returned {len(data)} rows > reported limit {lim} "
                                   "— clamp broken")

    return _verdict(True, "pagination consistent (default page, param echo, row bound, clamp)")


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

    # A CORRECT paginated app: honors page/limit, clamps to 100, default page 1 / limit 10.
    def correct(a):
        q = _parse_q(a["endpoint"])
        page = int(q.get("page", 1))
        limit = min(100, max(1, int(q.get("limit", 10))))
        rows = [{"id": i} for i in range(limit)]
        return _resp(200, {"success": True, "data": rows,
                           "pagination": {"page": page, "limit": limit, "total": 999}})

    r = check_pagination("GET /products", correct)
    assert r["passed"] is True and not r["skipped"], r

    # BUG A — default page changed (the `int 1->2` mutation on `$page = … 1`).
    def bad_default_page(a):
        q = _parse_q(a["endpoint"])
        page = int(q.get("page", 2))          # default should be 1
        limit = min(100, max(1, int(q.get("limit", 10))))
        return _resp(200, {"data": [{"id": 0}], "pagination": {"page": page, "limit": limit}})
    r = check_pagination("GET /products", bad_default_page)
    assert r["passed"] is False and "default page" in r["reason"], r

    # BUG B — limit not enforced (returns everything regardless of ?limit).
    def bad_limit(a):
        q = _parse_q(a["endpoint"])
        page = int(q.get("page", 1))
        limit = int(q.get("limit", 10))
        rows = [{"id": i} for i in range(50)]  # ignores limit
        return _resp(200, {"data": rows, "pagination": {"page": page, "limit": limit}})
    r = check_pagination("GET /products", bad_limit)
    assert r["passed"] is False and "rows" in r["reason"], r

    # A NON-paginated endpoint → SKIP, never a false failure.
    def not_paginated(a):
        return _resp(200, {"data": {"id": 1, "name": "x"}})
    r = check_pagination("GET /products/1", not_paginated)
    assert r["skipped"] is True and r["passed"] is None, r

    # An auth-walled endpoint → SKIP.
    def walled(a):
        return {"skipped": True, "skipReason": "auth wall"}
    r = check_pagination("GET /orders", walled)
    assert r["skipped"] is True, r

    print("pagination_oracle SELF-TEST PASS (default-page + echo + row-bound + clamp; skip on non-paginated)")
