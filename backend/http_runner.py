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


class HTTPRunner:
    def __init__(self, base_url: str = "http://localhost:3000", timeout: float = 10.0,
                 transport=None):
        self.base_url    = base_url.rstrip('/')
        self.timeout     = timeout
        self.request_log = []
        # Optional httpx transport (used by the offline self-test to inject
        # canned responses). None → real network.
        self._transport  = transport

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
        return (a.scheme, a.hostname, a.port) == (b.scheme, b.hostname, b.port)

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
            with httpx.Client(timeout=self.timeout, transport=self._transport) as client:
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
                    and not expected_auth and not auth_token):
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

            result.update({
                "actualStatus":       actual_status,
                "expectedStatus":     expected_status,
                "responseBody":       resp_body,
                "statusMatched":      status_ok,
                "bodyMatched":        body_ok,
                "bodyMismatch":       body_mismatch_detail,
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

    # S7: an off-origin absolute URL is refused (SSRF / token-leak guard).
    r = HTTPRunner(base_url="http://localhost:8080", transport=_mock(200)).run_assertion(
        {"type": "API", "endpoint": "POST http://evil.example/steal"})
    assert r.get("passed") is False and "off-origin" in (r.get("error") or ""), r

    print("http_runner SELF-TEST PASS (Q2 auth-skip + S7 off-origin)")
