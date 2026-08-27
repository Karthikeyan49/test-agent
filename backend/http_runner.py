"""
Real HTTP API Assertion Runner
Makes actual HTTP requests to a running ERP backend and verifies
response status codes, response body fields, and headers.
Uses httpx for async-capable HTTP with timeout control.
"""

import httpx
import json
import time
from typing import Dict, Any, List, Optional


def _body_text_lower(resp: Any) -> str:
    """Lowercased text of a response body (dict/list serialized) for keyword scans."""
    if isinstance(resp, str):
        return resp.lower()
    try:
        return json.dumps(resp, default=str).lower()
    except Exception:
        return str(resp).lower()


class HTTPRunner:
    # Auth endpoints that invalidate the caller's own session/token. Testing
    # these with the shared --auth-token silently revokes it for every phase
    # that runs afterwards (scenarios, authz/IDOR, later API tests all 401).
    import re as _re
    _SESSION_INVALIDATING = _re.compile(r"/auth/(logout(-all)?|revoke)\b", _re.I)

    def __init__(self, base_url: str = "http://localhost:3000", timeout: float = 10.0,
                 transport=None, protect_session: bool = False):
        self.base_url    = base_url.rstrip('/')
        self.timeout     = timeout
        self.request_log = []
        # Optional httpx transport (used by the offline self-test to inject
        # canned responses). None → real network.
        self._transport  = transport
        # When True, SKIP session-invalidating auth endpoints (logout/revoke) so
        # a shared --auth-token survives the whole run. Set by the CLI whenever a
        # bearer token is supplied and reused across phases.
        self.protect_session = protect_session

    def _full_url(self, path: str) -> str:
        if path.startswith('http://') or path.startswith('https://'):
            # S7 SSRF/token-leak guard: an absolute URL that points off the
            # configured base-url origin is refused — otherwise a crafted
            # graph/OpenAPI `servers` entry could redirect the request (and the
            # bearer token) to an attacker host. Same-origin absolute URLs pass.
            if not self._same_origin(path):
                raise ValueError(
                    f"off-origin absolute URL refused: {path} is not on {self.base_url} "
                    "(would leak credentials / enable SSRF)")
            return path
        return f"{self.base_url}{path}"

    def _same_origin(self, url: str) -> bool:
        from urllib.parse import urlparse
        a, b = urlparse(url), urlparse(self.base_url)
        # Normalize implicit default ports so http://host and http://host:80 are
        # treated as the same origin (avoids a false off-origin BLOCK).
        _def = {"http": 80, "https": 443}
        pa = a.port or _def.get((a.scheme or "").lower())
        pb = b.port or _def.get((b.scheme or "").lower())
        return (a.scheme, a.hostname, pa) == (b.scheme, b.hostname, pb)

    def run_assertion(self, assertion: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a single HTTP assertion.
        assertion keys:
          endpoint        - e.g. "POST /api/v1/customers"
          body            - dict payload to send as JSON
          headers         - optional dict of extra headers
          expectedStatus  - int HTTP status code
          expectedBodyKey - optional key to check in response JSON
          expectedBodyVal - optional value for that key
        """
        method_path     = assertion.get('endpoint', 'GET /')
        parts           = method_path.strip().split(' ', 1)
        method          = parts[0].upper() if len(parts) > 1 else 'GET'
        path            = parts[1] if len(parts) > 1 else parts[0]

        # Session-preservation guard: skip logout/revoke so a shared --auth-token
        # is not silently invalidated for the rest of the run. Honest SKIP, not a
        # PASS. A caller that explicitly wants to exercise logout can pass
        # allowSessionInvalidation:true on the assertion (e.g. an auth self-test).
        if (self.protect_session and self._SESSION_INVALIDATING.search(path or "")
                and not assertion.get("allowSessionInvalidation")):
            r = {"type": "API", "endpoint": method_path, "method": method,
                 "actualStatus": None, "passed": False, "skipped": True,
                 "skipReason": ("session-invalidating auth endpoint skipped to preserve the "
                                "shared --auth-token for the rest of the run (scenarios, authz, "
                                "later API tests). Test logout in isolation to exercise it."),
                 "durationMs": 0.0, "error": None}
            self.request_log.append(r)
            return r
        try:
            url = self._full_url(path)
        except ValueError as e:
            # S7: off-origin absolute URL refused before any request is sent.
            r = {"type": "API", "endpoint": method_path, "method": method,
                 "passed": False, "error": f"OFF_ORIGIN_REFUSED: {e}", "durationMs": 0.0}
            self.request_log.append(r)
            return r
        body            = assertion.get('body', assertion.get('testData', {}))
        headers         = dict(assertion.get('headers', {'Content-Type': 'application/json'}))
        auth_token      = assertion.get('authToken') or assertion.get('bearerToken')
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'
        # Q2 credential detection must recognise a credential supplied ANY way:
        # the assertion's authToken/bearerToken key OR an Authorization/Cookie
        # header already merged in by the caller (this is how a global
        # --auth-token / --auth-cookie arrives — see cli.py auth_headers()).
        # Without this, a token sent via header would not credit the auth-skip
        # decision and a real 401/403 outcome would be wrongly SKIPPED.
        _hdr_keys       = {k.lower() for k in headers}
        has_credential  = bool(auth_token) or 'authorization' in _hdr_keys or 'cookie' in _hdr_keys
        expected_status = assertion.get('expectedStatusCode', assertion.get('expectedStatus', 200))
        expected_in     = assertion.get('expectedStatusIn')     # e.g. [400, 422] — any of these
        expected_class  = assertion.get('expectedStatusClass')  # "2xx"|"4xx"|"5xx"|"!5xx"|"!2xx"
        expected_key    = assertion.get('expectedBodyKey')
        expected_val    = assertion.get('expectedBodyVal')

        start_ms = time.time() * 1000
        result = {
            "type":           "API",
            "endpoint":       method_path,
            "url":            url,
            "method":         method,
            "requestBody":    body,
            "expectedStatus": expected_status,
        }

        try:
            # follow_redirects pinned False: only the pre-redirect URL is
            # origin-checked, so a 3xx must not silently carry the request (and
            # bearer token) to another host.
            with httpx.Client(timeout=self.timeout, transport=self._transport,
                              follow_redirects=False) as client:
                if method == 'GET':
                    resp = client.get(url, headers=headers)
                elif method == 'POST':
                    resp = client.post(url, json=body, headers=headers)
                elif method == 'PUT':
                    resp = client.put(url, json=body, headers=headers)
                elif method == 'PATCH':
                    resp = client.patch(url, json=body, headers=headers)
                elif method == 'DELETE':
                    resp = client.delete(url, headers=headers)
                else:
                    resp = client.get(url, headers=headers)

            duration_ms = round(time.time() * 1000 - start_ms, 2)
            actual_status = resp.status_code

            # Try parse response JSON
            try:
                resp_body = resp.json()
            except Exception:
                resp_body = resp.text

            # ── Q2: auth-precondition guard ────────────────────────────────
            # A 401/403 on a test that was NOT probing auth, sent with no token,
            # means the request never reached the validation / business-logic
            # layer we intended to exercise. Scoring it PASS (it is technically a
            # 4xx) or FAIL (it is not 2xx) are BOTH wrong — the real behaviour is
            # UNTESTED. Mark it SKIPPED so it neither inflates nor deflates the
            # pass rate. Tests that legitimately probe auth set expectedStatus
            # 401/403 (or authSensitive=False) and are left to decide normally.
            auth_sensitive = assertion.get('authSensitive', True)
            expected_auth  = (expected_status in (401, 403)) or (
                bool(expected_in) and any(c in (401, 403) for c in expected_in))
            if (actual_status in (401, 403) and auth_sensitive
                    and not expected_auth and not has_credential):
                result.update({
                    "actualStatus": actual_status,
                    "responseBody": resp_body,
                    "passed":       False,
                    "skipped":      True,
                    "skipReason":   (f"auth precondition unmet: HTTP {actual_status} with no "
                                     "token — validation/business logic behind auth was not "
                                     "exercised. Supply --auth-token (a role token for authz "
                                     "tests) to actually test this endpoint."),
                    "durationMs":   round(time.time() * 1000 - start_ms, 2),
                    "error":        None,
                })
                self.request_log.append(result)
                return result

            # Status match supports an exact code, a set (expectedStatusIn), or a
            # class (expectedStatusClass) — the last two let per-field negative tests
            # accept "any 4xx" (apps differ: 400 vs 422) or "not 5xx" (injection must
            # not crash the server).
            def _class_ok(s, cls):
                cls = str(cls).lower()
                if cls == "2xx":  return 200 <= s < 300
                if cls == "4xx":  return 400 <= s < 500
                if cls == "5xx":  return 500 <= s < 600
                if cls == "!5xx": return s < 500
                if cls == "!2xx": return not (200 <= s < 300)
                return s == expected_status

            if expected_in:
                status_ok = actual_status in expected_in
                expected_status = expected_in            # report what we wanted
            elif expected_class:
                status_ok = _class_ok(actual_status, expected_class)
                expected_status = expected_class
            else:
                status_ok = (actual_status == expected_status)

            body_ok = True
            body_mismatch_detail = None
            if expected_key and isinstance(resp_body, dict):
                actual_val = resp_body.get(expected_key)
                body_ok = (str(actual_val) == str(expected_val))
                if not body_ok:
                    body_mismatch_detail = f"Key '{expected_key}': expected '{expected_val}', got '{actual_val}'"

            passed = status_ok and body_ok

            # Q5: for a single-fault negative that got its expected 4xx, check the
            # response actually references the injected field. If not, the 4xx may
            # be an UNRELATED rejection (auth/CSRF/content-type) — record it as
            # unattributed so a genuinely unenforced rule isn't hidden behind a
            # coincidental 4xx. Advisory only (apps that return generic errors
            # shouldn't false-FAIL), surfaced in the result for honest reporting.
            fault_field = assertion.get('faultField')
            attribution = None
            if fault_field and 400 <= (actual_status or 0) < 500:
                import re as _re_q5
                blob = _body_text_lower(resp_body)
                names = {fault_field.lower(),
                         _re_q5.sub(r'[^a-z0-9]', '', fault_field.lower())}
                attributed = any(nm and nm in blob for nm in names)
                attribution = {
                    "faultField": fault_field,
                    "confirmed":  attributed,
                    "note": (f"4xx references '{fault_field}' — rejection attributable to the injected fault"
                             if attributed else
                             f"4xx did NOT reference '{fault_field}' — may be an unrelated rejection; "
                             "per-rule validation not confirmed"),
                }

            result.update({
                "actualStatus":       actual_status,
                "expectedStatus":     expected_status,
                "responseBody":       resp_body,
                "statusMatched":      status_ok,
                "bodyMatched":        body_ok,
                "bodyMismatch":       body_mismatch_detail,
                "attribution":        attribution,
                "passed":             passed,
                "durationMs":         duration_ms,
                "error":              None,
            })

        except httpx.ConnectError:
            result.update({
                "passed":   False,
                "error":    f"CONNECTION_REFUSED: Cannot connect to {url}. Is the ERP backend running?",
                "durationMs": round(time.time() * 1000 - start_ms, 2),
            })
        except httpx.TimeoutException:
            result.update({
                "passed":   False,
                "error":    f"TIMEOUT: Request to {url} exceeded {self.timeout}s",
                "durationMs": self.timeout * 1000,
            })
        except Exception as e:
            result.update({
                "passed":   False,
                "error":    f"UNEXPECTED_ERROR: {type(e).__name__}: {e}",
                "durationMs": round(time.time() * 1000 - start_ms, 2),
            })

        self.request_log.append(result)
        return result

    def run_assertions(self, assertions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run a list of HTTP assertions in order."""
        return [self.run_assertion(a) for a in assertions if a.get('type') == 'API']

    def print_result(self, result: Dict[str, Any]):
        status_color = "\033[32m" if result.get("passed") else "\033[31m"
        reset = "\033[0m"
        passed_label = "PASS" if result.get("passed") else "FAIL"
        print(f"  {status_color}[{passed_label}]{reset} {result['endpoint']} "
              f"→ HTTP {result.get('actualStatus', 'ERR')} "
              f"(expected {result['expectedStatus']}, {result.get('durationMs', 0):.0f}ms)")
        if result.get("error"):
            print(f"         \033[33m⚠ {result['error']}\033[0m")
        if result.get("bodyMismatch"):
            print(f"         \033[31m✗ Body mismatch: {result['bodyMismatch']}\033[0m")


if __name__ == "__main__":
    # ── Offline self-test (no network): inject canned responses via a mock
    #    transport and assert the verdict logic (Q2 auth-skip, S7 off-origin).
    def _mock(status: int):
        def handler(request):
            return httpx.Response(status, json={"ok": status < 400})
        return httpx.MockTransport(handler)

    # Q2a: a negative test (expects 4xx) that gets 401 with NO token → SKIPPED,
    #      not PASS. This is the false-green the audit flagged.
    r = HTTPRunner(transport=_mock(401)).run_assertion(
        {"type": "API", "endpoint": "POST /vendors",
         "expectedStatusClass": "4xx"})
    assert r.get("skipped") is True and r.get("passed") is False, r
    assert not r.get("statusMatched"), "401 must not be scored as a passing 4xx"

    # Q2b: a real auth-boundary test (expects 401) that gets 401 → PASS (correct).
    r = HTTPRunner(transport=_mock(401)).run_assertion(
        {"type": "API", "endpoint": "GET /orders",
         "expectedStatusCode": 401, "noAuth": True})
    assert r.get("passed") is True and not r.get("skipped"), r

    # Q2c: a token IS supplied and the endpoint still 401s → a real result
    #      (skip only masks the "we never sent credentials" case).
    r = HTTPRunner(transport=_mock(401)).run_assertion(
        {"type": "API", "endpoint": "POST /vendors",
         "expectedStatusClass": "4xx", "authToken": "tok"})
    assert not r.get("skipped"), "a 401 with a token present is a genuine outcome"

    # Q2d: a normal 4xx (422 validation reject) with no token → real PASS.
    r = HTTPRunner(transport=_mock(422)).run_assertion(
        {"type": "API", "endpoint": "POST /vendors",
         "expectedStatusClass": "4xx"})
    assert r.get("passed") is True and not r.get("skipped"), r

    # Q2e: a global --auth-token arrives as an Authorization *header* (not the
    #      authToken key). A 401 must then be a genuine result, NOT a skip —
    #      otherwise --auth-token silently fails to unlock protected endpoints.
    r = HTTPRunner(transport=_mock(401)).run_assertion(
        {"type": "API", "endpoint": "GET /orders",
         "expectedStatusClass": "2xx",
         "headers": {"Content-Type": "application/json", "Authorization": "Bearer tok"}})
    assert not r.get("skipped"), "a 401 with an Authorization header is a genuine outcome, not a skip"

    # Q2f: same for cookie-mode auth (Cookie header credits the credential).
    r = HTTPRunner(transport=_mock(403)).run_assertion(
        {"type": "API", "endpoint": "GET /admin",
         "expectedStatusClass": "2xx",
         "headers": {"Cookie": "session=abc"}})
    assert not r.get("skipped"), "a 403 with a Cookie header is a genuine authz outcome, not a skip"

    # S7: an off-origin absolute URL is refused (SSRF / token-leak guard).
    r = HTTPRunner(base_url="http://localhost:8080", transport=_mock(200)).run_assertion(
        {"type": "API", "endpoint": "POST http://evil.example/steal"})
    assert r.get("passed") is False and "off-origin" in (r.get("error") or ""), r

    # Session-preservation guard: with protect_session on, logout/revoke SKIP
    # (never fire) so the shared token survives; off by default it fires normally;
    # and an explicit allowSessionInvalidation override fires even when protected.
    r = HTTPRunner(transport=_mock(200), protect_session=True).run_assertion(
        {"type": "API", "endpoint": "POST /auth/logout", "authToken": "tok"})
    assert r.get("skipped") is True and "session-invalidating" in r.get("skipReason", ""), r
    r = HTTPRunner(transport=_mock(200), protect_session=False).run_assertion(
        {"type": "API", "endpoint": "POST /auth/logout", "authToken": "tok"})
    assert not r.get("skipped"), "logout must fire normally when the session is not protected"
    r = HTTPRunner(transport=_mock(200), protect_session=True).run_assertion(
        {"type": "API", "endpoint": "POST /auth/logout", "authToken": "tok",
         "allowSessionInvalidation": True})
    assert not r.get("skipped"), "explicit allowSessionInvalidation must let logout fire"

    # Q5: a negative that got 4xx but whose body names the injected field →
    #     attribution confirmed; one that does not → flagged unattributed.
    def _mock_body(status, body):
        return httpx.MockTransport(lambda req: httpx.Response(status, json=body))

    r = HTTPRunner(transport=_mock_body(422, {"errors": {"email": "invalid"}})).run_assertion(
        {"type": "API", "endpoint": "POST /vendors",
         "expectedStatusClass": "4xx", "faultField": "email"})
    assert r["attribution"]["confirmed"] is True, r["attribution"]

    r = HTTPRunner(transport=_mock_body(400, {"message": "Bad Request"})).run_assertion(
        {"type": "API", "endpoint": "POST /vendors",
         "expectedStatusClass": "4xx", "faultField": "email"})
    assert r["attribution"]["confirmed"] is False, r["attribution"]

    print("http_runner SELF-TEST PASS (Q2 auth-skip + S7 off-origin + Q5 attribution)")
