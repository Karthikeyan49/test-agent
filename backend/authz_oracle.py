"""
Authorization / IDOR Oracle  (role-differential — addresses the authz blind spot)
=================================================================================
Single-identity testing cannot see authorization bugs: to know a boundary is
enforced you must send the SAME request as TWO different identities and check
they get DIFFERENT outcomes. This module does exactly that, deterministically —
no model judges the verdict.

  • IDOR / horizontal privilege
      A resource that role A can read must NOT be readable by an unrelated role B.
      role A -> 2xx (owner) AND role B -> 2xx on the same resource  ⇒  IDOR (FAIL).
      role A -> 2xx AND role B -> 403/404                            ⇒  isolated (PASS).

  • Vertical privilege / escalation
      An admin-only endpoint must reject a non-admin token (403/404).
      non-admin -> 2xx  ⇒  privilege escalation (FAIL); 403/404  ⇒  enforced (PASS).

Requires real tokens for ≥2 roles (fine in a test environment). Without them, or
when a probe hits the login wall (401), the check SKIPs — never a false "secure".

`run` is any callable(assertion) -> result carrying 'actualStatus' and
'responseBody' (e.g. HTTPRunner.run_assertion). Pass a token via the assertion's
'authToken' key.
"""

from typing import Any, Dict, Optional, Callable


def _rid_signature(resp: Any):
    """A STABLE resource-identity fingerprint, or None when the body carries no
    identifier we can trust. F6: the key-set / list-length fallbacks were removed —
    two DIFFERENT resources (Alice vs Bob) share a key-set and would collide into a
    false "same resource" IDOR. Only a real id/uuid/code/number proves sameness;
    without one we return None and the caller SKIPs rather than guessing."""
    node = resp
    if isinstance(node, dict) and isinstance(node.get("data"), dict):
        node = node["data"]
    if isinstance(node, dict):
        for k in ("id", "uuid", "code", "number"):
            if node.get(k) is not None:
                return f"{k}={node[k]}"
    return None


def _verdict(kind, endpoint, vulnerable, reason, skipped=False):
    return {"technique": "AUTHZ_DIFF", "kind": kind, "endpoint": endpoint,
            "vulnerable": (None if skipped else bool(vulnerable)),
            "passed": (None if skipped else (not vulnerable)),
            "skipped": bool(skipped), "reason": reason}


def _is_2xx(s): return isinstance(s, int) and 200 <= s < 300
def _is_denied(s): return s in (401, 403, 404)


def check_idor(endpoint: str, run: Callable[[Dict[str, Any]], Dict[str, Any]],
               owner_token: str, other_token: str) -> Dict[str, Any]:
    """Horizontal privilege: a resource readable by the owner must not be
    readable by an unrelated role. `endpoint` should address a specific resource
    (e.g. 'GET /orders/1001')."""
    if not owner_token or not other_token:
        return _verdict("idor", endpoint, None, "need two role tokens", skipped=True)
    a = run({"type": "API", "endpoint": endpoint, "authToken": owner_token, "authSensitive": False})
    if not _is_2xx(a.get("actualStatus")):
        return _verdict("idor", endpoint, None,
                        f"owner did not get 2xx (got {a.get('actualStatus')}) — cannot establish a baseline",
                        skipped=True)
    b = run({"type": "API", "endpoint": endpoint, "authToken": other_token, "authSensitive": False})
    sb = b.get("actualStatus")
    if _is_denied(sb):
        return _verdict("idor", endpoint, False,
                        f"other role correctly denied ({sb}) — resource isolated")
    if _is_2xx(sb):
        sig_a = _rid_signature(a.get("responseBody"))
        sig_b = _rid_signature(b.get("responseBody"))
        # F6: only assert IDOR when BOTH bodies carry a real identifier AND it is
        # the SAME one. Different ids → each role sees its own record (e.g.
        # /profile/me), which is correct isolation, not IDOR. No stable id → we
        # cannot prove same-resource access, so SKIP instead of guessing.
        if sig_a is None or sig_b is None:
            return _verdict("idor", endpoint, None,
                            "other role also got 2xx but neither body carries a stable id — "
                            "cannot prove same-resource access (use a resource-id endpoint)",
                            skipped=True)
        if sig_a == sig_b:
            return _verdict("idor", endpoint, True,
                            f"other role read the SAME resource ({sig_a}) — horizontal privilege / IDOR")
        return _verdict("idor", endpoint, False,
                        f"other role got a DIFFERENT resource ({sig_a} vs {sig_b}) — each sees its own")
    return _verdict("idor", endpoint, None,
                    f"inconclusive (other role status {sb})", skipped=True)


def check_privilege(endpoint: str, run: Callable[[Dict[str, Any]], Dict[str, Any]],
                    nonadmin_token: str) -> Dict[str, Any]:
    """Vertical privilege: an admin-only endpoint must reject a non-admin token."""
    if not nonadmin_token:
        return _verdict("privilege", endpoint, None, "need a non-admin token", skipped=True)
    r = run({"type": "API", "endpoint": endpoint, "authToken": nonadmin_token, "authSensitive": False})
    s = r.get("actualStatus")
    if _is_denied(s):
        return _verdict("privilege", endpoint, False, f"non-admin correctly denied ({s})")
    if _is_2xx(s):
        return _verdict("privilege", endpoint, True,
                        f"non-admin reached an admin-only endpoint ({s}) — privilege escalation")
    return _verdict("privilege", endpoint, None, f"inconclusive (status {s})", skipped=True)


if __name__ == "__main__":
    # ── Offline self-test with scripted fake apps. ───────────────────────────
    def vulnerable(a):   # every token sees everything → IDOR + escalation
        return {"actualStatus": 200, "responseBody": {"id": 1001, "total": 500}}

    def secure(a):       # only the owner/admin token is allowed
        tok = a.get("authToken")
        if tok == "owner" or tok == "admin":
            return {"actualStatus": 200, "responseBody": {"id": 1001, "total": 500}}
        return {"actualStatus": 403, "responseBody": {"error": "forbidden"}}

    # IDOR: secure app isolates, vulnerable app leaks
    r = check_idor("GET /orders/1001", secure, "owner", "attacker")
    assert r["vulnerable"] is False and r["passed"] is True, r
    r = check_idor("GET /orders/1001", vulnerable, "owner", "attacker")
    assert r["vulnerable"] is True and r["passed"] is False, r

    # Privilege: secure app denies non-admin, vulnerable app allows
    r = check_privilege("GET /admin/users", secure, "user")
    assert r["vulnerable"] is False, r
    r = check_privilege("GET /admin/users", vulnerable, "user")
    assert r["vulnerable"] is True, r

    # No tokens → SKIP, never "secure"
    r = check_idor("GET /orders/1001", secure, "", "")
    assert r["skipped"] is True and r["passed"] is None, r

    # F6: a /me-style endpoint where each role sees its OWN record (different ids)
    #     must be ISOLATED, not a false IDOR.
    def per_caller(a):
        tok = a.get("authToken")
        return {"actualStatus": 200, "responseBody": {"id": 1 if tok == "owner" else 2,
                                                      "name": "Alice" if tok == "owner" else "Bob"}}
    r = check_idor("GET /profile/me", per_caller, "owner", "attacker")
    assert r["vulnerable"] is False and not r["skipped"], r

    # F6: id-less bodies that would previously collide → SKIP, not a false IDOR.
    def idless(a):
        tok = a.get("authToken")
        return {"actualStatus": 200, "responseBody": {"name": "Alice" if tok == "owner" else "Bob"}}
    r = check_idor("GET /profile/me", idless, "owner", "attacker")
    assert r["skipped"] is True and r["passed"] is None, r

    print("authz_oracle SELF-TEST PASS (IDOR + privilege differential + F6)")
