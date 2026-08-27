"""
Differential Injection Oracle  (real vulnerability detection — closes S2)
========================================================================
The per-field "fuzz_robustness" case only checks the server does not 5xx on a
hostile string — a *successful* SQL injection that returns 200 PASSES it. That is
robustness, not security. This module adds a real, deterministic oracle that
actually distinguishes "injectable" from "safe" without a human writing the
expected answer:

  • SQL injection (boolean differential)
      Send a tautology (`' OR '1'='1`) and a contradiction (`' AND '1'='2`) into
      the SAME field. If the field is concatenated into a SQL WHERE, the two
      requests diverge — the TRUE payload returns rows/data the FALSE payload
      does not. A safe (parameterised) field treats both as the same literal
      string, so the responses match. Divergence ⇒ VULNERABLE (a real finding).

  • Reflected XSS
      Send a unique marked <script> payload; if it comes back UNESCAPED in the
      response body, it is reflected ⇒ VULNERABLE. If absent or escaped, safe.

The verdict is computed here from observed responses — never judged by a model.
An auth wall (401/403) or an identical error on both probes ⇒ SKIP (can't tell),
never a false "secure".

`run` is any callable(assertion) -> result carrying 'actualStatus' and
'responseBody' (e.g. HTTPRunner.run_assertion).
"""

from typing import Any, Dict, List, Optional, Callable

_SQLI_TRUE  = "' OR '1'='1"
_SQLI_FALSE = "' AND '1'='2"
_XSS_MARK   = "xssprobe9713"
_XSS_PAYLOAD = f"<script>{_XSS_MARK}</script>"


def _body_text(resp: Any) -> str:
    if isinstance(resp, str):
        return resp
    try:
        import json
        return json.dumps(resp, sort_keys=True, default=str)
    except Exception:
        return str(resp)


def _rowcount(resp: Any) -> Optional[int]:
    if isinstance(resp, list):
        return len(resp)
    if isinstance(resp, dict):
        for k in ("data", "items", "results", "rows", "records"):
            if isinstance(resp.get(k), list):
                return len(resp[k])
    return None


def _verdict(kind, field, vulnerable, reason, skipped=False):
    # passed==True means "no vulnerability found" (safe); passed==False means a
    # real vulnerability was detected (a finding the suite should surface).
    return {"technique": "INJECTION_DIFF", "kind": kind, "field": field,
            "vulnerable": (None if skipped else bool(vulnerable)),
            "passed": (None if skipped else (not vulnerable)),
            "skipped": bool(skipped), "reason": reason}


def check_sql_injection(endpoint: str, field: str, baseline: Dict[str, Any],
                        run: Callable[[Dict[str, Any]], Dict[str, Any]]) -> Dict[str, Any]:
    """Boolean-differential SQLi probe on one field."""
    # Baseline-trust probe: send the UNMODIFIED benign body first. If the
    # endpoint already 5xxs on a clean request, its server errors come from
    # something other than our payload (a missing backend service, infra, a
    # broken sibling field), so a later 5xx is NOT attributable to injection.
    # Establish a clean baseline before trusting the error-based signal — the
    # same guard the browser layer uses. Prevents false "SQLi" on endpoints
    # that 5xx for infrastructure reasons (LLM/SMS backend down, etc.).
    b = run({"type": "API", "endpoint": endpoint,
             "body": dict(baseline), "authSensitive": True})
    if b.get("skipped"):
        return _verdict("sqli", field, None, b.get("skipReason", "auth wall"), skipped=True)
    sb = b.get("actualStatus")
    baseline_clean = isinstance(sb, int) and sb < 500

    t = run({"type": "API", "endpoint": endpoint,
             "body": {**baseline, field: _SQLI_TRUE}, "authSensitive": True})
    if t.get("skipped"):
        return _verdict("sqli", field, None, t.get("skipReason", "auth wall"), skipped=True)
    f = run({"type": "API", "endpoint": endpoint,
             "body": {**baseline, field: _SQLI_FALSE}, "authSensitive": True})
    if f.get("skipped"):
        return _verdict("sqli", field, None, f.get("skipReason", "auth wall"), skipped=True)

    st, sf = t.get("actualStatus"), f.get("actualStatus")
    # A payload 5xx is an error-based injection signal ONLY when the benign
    # baseline was clean. If the baseline already 5xxs, the error is not
    # attributable to the payload → honest SKIP, never a false "vulnerable".
    if (isinstance(st, int) and st >= 500) or (isinstance(sf, int) and sf >= 500):
        if baseline_clean:
            return _verdict("sqli", field, True,
                            f"server 5xx on a SQLi payload (true={st} false={sf}) while a benign "
                            f"baseline was clean ({sb}) — error-based injection signal")
        return _verdict("sqli", field, None,
                        f"endpoint 5xx on a benign baseline too (baseline={sb}, true={st} false={sf}) — "
                        "server error not attributable to injection", skipped=True)

    rt, rf = _rowcount(t.get("responseBody")), _rowcount(f.get("responseBody"))
    if rt is not None and rf is not None:
        if rt > rf:
            return _verdict("sqli", field, True,
                            f"TRUE payload returned {rt} rows vs FALSE {rf} — boolean SQL injection")
        return _verdict("sqli", field, False, f"row counts equal ({rt}=={rf}) — not injectable on this field")

    # No countable rows. F5: a bare status/body divergence is NOT proof of
    # injection on its own (a WAF, length validation, or content check can differ
    # benignly). The only strong signal without row counts — a 5xx — was already
    # handled above. So: identical responses → safe; anything else → inconclusive
    # SKIP (needs a token / a differential we can count), never a false "vulnerable".
    bt, bf = _body_text(t.get("responseBody")), _body_text(f.get("responseBody"))
    if st == sf and bt == bf:
        return _verdict("sqli", field, False, "identical response to both probes — not injectable")
    return _verdict("sqli", field, None,
                    f"responses differ (status {st}/{sf}) but no countable-row signal — "
                    "inconclusive, supply a token / a list endpoint to get a differential",
                    skipped=True)


def check_reflected_xss(endpoint: str, field: str, baseline: Dict[str, Any],
                        run: Callable[[Dict[str, Any]], Dict[str, Any]]) -> Dict[str, Any]:
    """Reflected-XSS probe: is the payload echoed back unescaped?"""
    r = run({"type": "API", "endpoint": endpoint,
             "body": {**baseline, field: _XSS_PAYLOAD}, "authSensitive": True})
    if r.get("skipped"):
        return _verdict("xss", field, None, r.get("skipReason", "auth wall"), skipped=True)
    resp = r.get("responseBody")
    # F4: reflected XSS only matters when the browser will RENDER the reflection as
    # HTML. An API that echoes the term inside a JSON body ({"query":"<script>…"})
    # is not exploitable XSS — the browser shows JSON, it doesn't execute it. The
    # http_runner parses JSON into a dict/list and leaves an HTML page as a raw
    # str, so only flag when the body is raw text (a candidate HTML response).
    if isinstance(resp, (dict, list)):
        return _verdict("xss", field, False,
                        "payload echoed in a JSON body (not rendered as HTML) — not exploitable XSS")
    text = resp if isinstance(resp, str) else _body_text(resp)
    if _XSS_PAYLOAD in text:
        return _verdict("xss", field, True,
                        "payload reflected UNESCAPED in a text/HTML response — reflected XSS")
    if _XSS_MARK in text:
        return _verdict("xss", field, False, "payload present but escaped/encoded — not exploitable as-is")
    return _verdict("xss", field, False, "payload not reflected — safe")


if __name__ == "__main__":
    # ── Offline self-test with scripted fake apps (no network). ───────────────
    base = {"q": "x"}

    # A VULNERABLE search endpoint: the TRUE tautology dumps all rows, the FALSE
    # contradiction returns none — classic boolean SQLi.
    def vulnerable(a):
        v = a["body"]["q"]
        if v == _SQLI_TRUE:  return {"actualStatus": 200, "responseBody": {"data": [1, 2, 3, 4, 5]}}
        if v == _SQLI_FALSE: return {"actualStatus": 200, "responseBody": {"data": []}}
        if _XSS_MARK in v:   return {"actualStatus": 200, "responseBody": f"<html>{v}</html>"}
        return {"actualStatus": 200, "responseBody": {"data": []}}

    # A SAFE endpoint: the payload is treated as a literal string, so both SQLi
    # probes return the same (zero) rows and XSS comes back HTML-escaped.
    def safe(a):
        v = a["body"]["q"]
        if _XSS_MARK in v:
            esc = v.replace("<", "&lt;").replace(">", "&gt;")
            return {"actualStatus": 200, "responseBody": f"<html>{esc}</html>"}
        return {"actualStatus": 200, "responseBody": {"data": []}}

    # An AUTH-WALLED endpoint: both probes 401 → SKIP, never "secure".
    def walled(a):
        return {"actualStatus": 401, "skipped": True, "skipReason": "auth wall"}

    r = check_sql_injection("POST /search", "q", base, vulnerable)
    assert r["vulnerable"] is True and r["passed"] is False, r

    r = check_sql_injection("POST /search", "q", base, safe)
    assert r["vulnerable"] is False and r["passed"] is True, r

    r = check_sql_injection("POST /search", "q", base, walled)
    assert r["skipped"] is True and r["passed"] is None, r

    # An INFRA-BROKEN endpoint: 5xx on EVERYTHING, including the benign baseline
    # (e.g. an unreachable LLM/SMS backend). A payload 5xx here is NOT injection —
    # the baseline-trust guard must SKIP, never report a false "vulnerable".
    def infra5xx(a):
        return {"actualStatus": 500, "responseBody": {"message": "Internal server error"}}
    r = check_sql_injection("POST /otp", "q", base, infra5xx)
    assert r["skipped"] is True and r["passed"] is None, r

    # A REAL error-based SQLi: benign baseline is clean (200) but a quote in the
    # payload crashes the query (500). The guard must still flag this.
    def errbased(a):
        v = a["body"]["q"]
        if v in (_SQLI_TRUE, _SQLI_FALSE):
            return {"actualStatus": 500, "responseBody": {"message": "SQL syntax error"}}
        return {"actualStatus": 200, "responseBody": {"data": []}}
    r = check_sql_injection("POST /search", "q", base, errbased)
    assert r["vulnerable"] is True and r["passed"] is False, r

    r = check_reflected_xss("POST /search", "q", base, vulnerable)
    assert r["vulnerable"] is True and r["passed"] is False, r

    r = check_reflected_xss("POST /search", "q", base, safe)
    assert r["vulnerable"] is False and r["passed"] is True, r

    # F4: a JSON API that echoes the term in its body is NOT XSS → must not flag.
    def json_echo(a):
        return {"actualStatus": 200, "responseBody": {"query": a["body"]["q"], "results": []}}
    r = check_reflected_xss("POST /search", "q", base, json_echo)
    assert r["vulnerable"] is False, r

    # F5: two probes differing only by status (no countable rows) → inconclusive
    # SKIP, not a false "vulnerable".
    def status_wobble(a):
        v = a["body"]["q"]
        return {"actualStatus": 200 if v == _SQLI_TRUE else 400, "responseBody": {"ok": True}}
    r = check_sql_injection("POST /search", "q", base, status_wobble)
    assert r["skipped"] is True and r["passed"] is None, r

    print("injection_oracle SELF-TEST PASS (differential SQLi + reflected XSS + F4/F5)")
