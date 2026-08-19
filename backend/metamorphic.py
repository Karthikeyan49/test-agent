"""
Metamorphic Oracle
A pragmatic partial oracle: it checks RELATIONS that must hold without knowing the
exact expected value — the way you verify business logic you have no spec for.
Generates test scenarios from real graph endpoints:
  • idempotency   — PUT/DELETE applied twice → same outcome
  • round-trip    — POST a resource, GET it back → echoes what was sent
  • additive      — count a list, POST one, count again → +1
  • sum-invariant — order/invoice total == sum(line items)   (documented relation)
Every scenario is grounded on endpoints that actually exist in the graph.
"""

import re
from typing import Dict, Any, List, Optional


def _norm_path(path: str) -> str:
    return re.sub(r'\{[^}]+\}|:[A-Za-z_]\w*', '{id}', path or '')


def _stem(path: str) -> str:
    """The collection stem of a path: /orders/{id} -> /orders, /orders -> /orders."""
    p = _norm_path(path).rstrip('/')
    return p[:-len('/{id}')] if p.endswith('/{id}') else p


def _index(endpoints: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """(METHOD, normalized-path) -> endpoint."""
    out = {}
    for ep in endpoints:
        out[(ep.get("method", "").upper(), _norm_path(ep.get("path", "")))] = ep
    return out


def generate_metamorphic_tests(graph_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    endpoints = graph_data.get("apiEndpoints", []) or []
    if not endpoints:
        return []

    idx = _index(endpoints)
    tests: List[Dict[str, Any]] = []
    n = [0]

    def add(title, target, relation, assertions, evidence):
        n[0] += 1
        tests.append({
            "id":            f"MR-{n[0]:03d}",
            "title":         title,
            "category":      "Metamorphic / Relation",
            "technique":     "METAMORPHIC",
            "priority":      "high",
            "status":        "CONFIRMED",
            "confidence":    0.85,
            "steps":         [],
            "targetEndpoint": target,
            "relation":      relation,
            "assertions":    assertions,
            "sourceEvidence": evidence,
        })

    for ep in endpoints:
        method = ep.get("method", "").upper()
        path   = ep.get("path", "")
        npath  = _norm_path(path)
        ep_str = f"{method} {path}"

        # 1. Idempotency — PUT/DELETE twice yields the same status
        if method in ("PUT", "DELETE"):
            add(f"[Metamorphic] {ep_str} is idempotent (applied twice → same result)",
                ep_str, "idempotent",
                [{"type": "API", "endpoint": ep_str, "relation": "idempotent",
                  "note": "second identical request must return the same status/state as the first"}],
                [{"endpoint": ep_str}])

        # 2. Create → Read round-trip: POST /things + GET /things/{id}
        if method == "POST":
            stem = _stem(path)
            get_ep = idx.get(("GET", stem + "/{id}"))
            if get_ep:
                get_str = f"GET {get_ep.get('path')}"
                add(f"[Metamorphic] round-trip: {ep_str} then {get_str} echoes the created resource",
                    ep_str, "round_trip",
                    [{"type": "API", "endpoint": ep_str, "expectedStatusCode": 201, "relation": "round_trip"},
                     {"type": "API", "endpoint": get_str, "relation": "round_trip",
                      "note": "GET of the new id must return the fields that were POSTed"}],
                    [{"create": ep_str, "read": get_str}])

            # 3. List-count monotonicity: GET /things + POST /things → count +1
            list_ep = idx.get(("GET", stem))
            if list_ep:
                list_str = f"GET {list_ep.get('path')}"
                add(f"[Metamorphic] additive: {ep_str} increases {list_str} count by exactly 1",
                    ep_str, "additive",
                    [{"type": "API", "endpoint": list_str, "relation": "additive",
                      "note": "count list; POST one; re-count; assert count increased by 1"}],
                    [{"list": list_str, "create": ep_str}])

            # 4. Sum invariant heuristic for order/invoice/cart resources
            if re.search(r'order|invoice|cart|quote|bill', npath, re.IGNORECASE):
                add(f"[Metamorphic] sum-invariant on {ep_str}: total == Σ(line items) (+ tax − discount)",
                    ep_str, "sum_invariant",
                    [{"type": "API", "endpoint": ep_str, "relation": "sum_invariant",
                      "note": "document/total field must equal the sum of its line-item amounts"}],
                    [{"endpoint": ep_str}])

    return tests


# ══════════════════════════════════════════════════════════════════════════════
#  EXECUTOR — actually PERFORM the paired requests and evaluate the relation.
#  (Previously the generator emitted `relation`/`note` but no runner read them, so
#   every metamorphic test silently degraded to a plain GET→200. This closes Q1.)
#  `run` is any callable(assertion) -> result dict carrying 'responseBody' and
#  'actualStatus' (e.g. HTTPRunner.run_assertion). Deterministic: the relation is
#  computed here, never judged by a model.
# ══════════════════════════════════════════════════════════════════════════════

def _count(resp: Any) -> Optional[int]:
    """Best-effort element count of a list response or a common envelope."""
    if isinstance(resp, list):
        return len(resp)
    if isinstance(resp, dict):
        for k in ("data", "items", "results", "rows", "records"):
            if isinstance(resp.get(k), list):
                return len(resp[k])
        for k in ("count", "total", "totalCount", "total_count"):
            if isinstance(resp.get(k), int):
                return resp[k]
    return None


def _id_from(resp: Any) -> Optional[str]:
    """Best-effort id extraction from a create response."""
    node = resp
    if isinstance(node, dict) and isinstance(node.get("data"), dict):
        node = node["data"]
    if isinstance(node, dict):
        if node.get("id") is not None:
            return str(node["id"])
        for k, v in node.items():
            if k.lower().endswith("id") and isinstance(v, (int, str)):
                return str(v)
    return None


def _total_and_sum(resp: Any) -> (Optional[float], Optional[float]):
    """Extract (document total, Σ line-item amounts) for the sum invariant."""
    node = resp.get("data") if isinstance(resp, dict) and isinstance(resp.get("data"), dict) else resp
    if not isinstance(node, dict):
        return None, None
    total = None
    for k in ("total", "grand_total", "grandTotal", "amount", "total_amount"):
        if isinstance(node.get(k), (int, float)):
            total = float(node[k]); break
    items = None
    for k in ("items", "line_items", "lineItems", "lines", "products"):
        if isinstance(node.get(k), list):
            items = node[k]; break
    if total is None or items is None:
        return total, None
    s = 0.0
    for it in items:
        if not isinstance(it, dict):
            return total, None
        amt = next((it[f] for f in ("amount", "line_total", "subtotal", "total") if isinstance(it.get(f), (int, float))), None)
        if amt is None:
            qty = next((it[f] for f in ("qty", "quantity", "count") if isinstance(it.get(f), (int, float))), None)
            price = next((it[f] for f in ("price", "unit_price", "rate") if isinstance(it.get(f), (int, float))), None)
            if qty is None or price is None:
                return total, None
            amt = qty * price
        s += float(amt)
    return total, s


def _verdict(rel, target, passed, reason, skipped=False):
    return {"technique": "METAMORPHIC", "relation": rel, "targetEndpoint": target,
            "passed": (None if skipped else bool(passed)), "skipped": bool(skipped),
            "reason": reason}


def _class(s):
    return s // 100 if isinstance(s, int) else None


def execute_metamorphic_test(test: Dict[str, Any], run, *, body: Optional[dict] = None) -> Dict[str, Any]:
    """Execute one metamorphic test and return a real PASS/FAIL/SKIP verdict.

    SKIP (never PASS) whenever a precondition is missing — no body to POST, no id
    returned, an un-bound {id} path, or unrecognisable response shape — so an
    un-runnable relation can never masquerade as a passing check.
    """
    rel    = test.get("relation")
    target = test.get("targetEndpoint", "")
    ev     = (test.get("sourceEvidence") or [{}])[0]
    try:
        if rel == "idempotent":
            if "{id}" in target or "{" in target:
                return _verdict(rel, target, None, "no concrete id bound for the {id} path", skipped=True)
            r1 = run({"type": "API", "endpoint": target, "body": body or {}, "authSensitive": True})
            if r1.get("skipped"):
                return _verdict(rel, target, None, r1.get("skipReason", "first call skipped"), skipped=True)
            r2 = run({"type": "API", "endpoint": target, "body": body or {}, "authSensitive": True})
            c1, c2 = _class(r1.get("actualStatus")), _class(r2.get("actualStatus"))
            return _verdict(rel, target, c1 == c2 and c1 is not None,
                            f"idempotent: first={r1.get('actualStatus')} second={r2.get('actualStatus')} "
                            "(status class must match)")

        if rel == "round_trip":
            create, read = ev.get("create", target), ev.get("read")
            if not read:
                return _verdict(rel, target, None, "no read endpoint", skipped=True)
            if body is None:
                return _verdict(rel, target, None, "no request body available to POST", skipped=True)
            cr = run({"type": "API", "endpoint": create, "body": body, "authSensitive": True})
            if cr.get("skipped"):
                return _verdict(rel, target, None, cr.get("skipReason", "create skipped"), skipped=True)
            rid = _id_from(cr.get("responseBody"))
            if rid is None:
                return _verdict(rel, target, None, "create returned no id to read back", skipped=True)
            read_ep = re.sub(r"\{[^}]+\}", rid, read)
            rd = run({"type": "API", "endpoint": read_ep, "authSensitive": True})
            got = rd.get("responseBody")
            got = got.get("data") if isinstance(got, dict) and isinstance(got.get("data"), dict) else got
            if not isinstance(got, dict):
                return _verdict(rel, target, None, "read response not an object", skipped=True)
            mismatches = [f"{k}: sent {v!r} got {got.get(k)!r}"
                          for k, v in body.items()
                          if k in got and str(got.get(k)) != str(v)]
            return _verdict(rel, read_ep, not mismatches,
                            "round-trip echoed all sent fields" if not mismatches
                            else "round-trip mismatch — " + "; ".join(mismatches))

        if rel == "additive":
            list_ep = ev.get("list")
            create  = ev.get("create", target)
            if not list_ep or body is None:
                return _verdict(rel, target, None, "no list endpoint or no body", skipped=True)
            b4 = _count(run({"type": "API", "endpoint": list_ep, "authSensitive": True}).get("responseBody"))
            cr = run({"type": "API", "endpoint": create, "body": body, "authSensitive": True})
            if cr.get("skipped"):
                return _verdict(rel, target, None, cr.get("skipReason", "create skipped"), skipped=True)
            af = _count(run({"type": "API", "endpoint": list_ep, "authSensitive": True}).get("responseBody"))
            if b4 is None or af is None:
                return _verdict(rel, target, None, "could not count the list response", skipped=True)
            return _verdict(rel, list_ep, af == b4 + 1,
                            f"additive: count {b4} -> {af} (expected +1)")

        if rel == "sum_invariant":
            if body is None:
                return _verdict(rel, target, None, "no body to create the document", skipped=True)
            cr = run({"type": "API", "endpoint": target, "body": body, "authSensitive": True})
            if cr.get("skipped"):
                return _verdict(rel, target, None, cr.get("skipReason", "create skipped"), skipped=True)
            total, s = _total_and_sum(cr.get("responseBody"))
            if total is None or s is None:
                return _verdict(rel, target, None, "could not identify total / line-item amounts in response", skipped=True)
            return _verdict(rel, target, abs(total - s) < 0.01,
                            f"sum-invariant: total={total} Σ(items)={s}")

        return _verdict(rel, target, None, f"unknown relation {rel!r}", skipped=True)
    except Exception as e:
        return _verdict(rel, target, None, f"executor error: {type(e).__name__}: {e}", skipped=True)


if __name__ == "__main__":
    graph = {"apiEndpoints": [
        {"method": "PUT",  "path": "/orders/{id}"},
        {"method": "POST", "path": "/orders"},
        {"method": "GET",  "path": "/orders/{id}"},
        {"method": "GET",  "path": "/orders"},
    ]}
    ts = generate_metamorphic_tests(graph)
    for t in ts:
        print(f"  {t['relation']:14s} {t['title']}")

    relations = {t["relation"] for t in ts}
    assert "idempotent" in relations, "PUT should get an idempotency test"
    assert "round_trip" in relations, "POST+GET/{id} should get a round-trip test"
    assert "additive"   in relations, "GET list + POST should get an additive test"
    assert all(t["technique"] == "METAMORPHIC" for t in ts)
    # everything references only real endpoints
    real = {(e["method"].upper(), _norm_path(e["path"])) for e in graph["apiEndpoints"]}
    for t in ts:
        m, p = t["targetEndpoint"].split(" ", 1)
        assert (m.upper(), _norm_path(p)) in real, f"ungrounded target {t['targetEndpoint']}"
    assert generate_metamorphic_tests({"apiEndpoints": []}) == []

    # ── EXECUTOR self-tests (offline, via a scripted fake `run`) ──────────────
    def make_run(script):
        """script: callable(endpoint) -> (status, responseBody)."""
        def run(a):
            status, body = script(a["endpoint"])
            return {"actualStatus": status, "responseBody": body, "skipped": False}
        return run

    by_rel = {t["relation"]: t for t in ts}

    # additive — a CORRECT app: count goes 2 -> 3 after a create → PASS
    state = {"n": 2}
    def additive_ok(ep):
        if ep.startswith("GET"):  return 200, {"data": [{}] * state["n"]}
        state["n"] += 1;          return 201, {"id": 99}
    r = execute_metamorphic_test(by_rel["additive"], make_run(additive_ok), body={"x": 1})
    assert r["passed"] is True and not r["skipped"], r

    # additive — a BUGGY app: create succeeds but list count never changes → FAIL
    def additive_bug(ep):
        if ep.startswith("GET"):  return 200, {"data": [{}, {}]}
        return 201, {"id": 7}
    r = execute_metamorphic_test(by_rel["additive"], make_run(additive_bug), body={"x": 1})
    assert r["passed"] is False and not r["skipped"], r

    # round_trip — app echoes what was sent → PASS
    def rt_ok(ep):
        if ep.startswith("POST"): return 201, {"id": 5}
        return 200, {"id": 5, "name": "Acme", "email": "a@b.com"}
    r = execute_metamorphic_test(by_rel["round_trip"], make_run(rt_ok),
                                 body={"name": "Acme", "email": "a@b.com"})
    assert r["passed"] is True, r

    # round_trip — app silently mangles a field (data-drop bug) → FAIL
    def rt_bug(ep):
        if ep.startswith("POST"): return 201, {"id": 5}
        return 200, {"id": 5, "name": "WRONG", "email": "a@b.com"}
    r = execute_metamorphic_test(by_rel["round_trip"], make_run(rt_bug),
                                 body={"name": "Acme", "email": "a@b.com"})
    assert r["passed"] is False and "mismatch" in r["reason"], r

    # round_trip — no body available → SKIP, never PASS
    r = execute_metamorphic_test(by_rel["round_trip"], make_run(rt_ok), body=None)
    assert r["skipped"] is True and r["passed"] is None, r

    # sum_invariant — correct math (100 + 50 == 150) → PASS; wrong total → FAIL
    sum_test = {"relation": "sum_invariant", "targetEndpoint": "POST /orders",
                "sourceEvidence": [{"endpoint": "POST /orders"}]}
    good = lambda ep: (201, {"total": 150, "items": [{"amount": 100}, {"amount": 50}]})
    bad  = lambda ep: (201, {"total": 140, "items": [{"amount": 100}, {"amount": 50}]})
    assert execute_metamorphic_test(sum_test, make_run(good), body={})["passed"] is True
    r = execute_metamorphic_test(sum_test, make_run(bad), body={})
    assert r["passed"] is False and "sum-invariant" in r["reason"], r

    print("SELF-TEST PASS (generator + executor)")
