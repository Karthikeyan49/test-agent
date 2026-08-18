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

    print("SELF-TEST PASS")
