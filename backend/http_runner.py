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
    def __init__(self, base_url: str = "http://localhost:3000", timeout: float = 10.0):
        self.base_url    = base_url.rstrip('/')
        self.timeout     = timeout
        self.request_log = []

    def _full_url(self, path: str) -> str:
        if path.startswith('http://') or path.startswith('https://'):
            return path
        return f"{self.base_url}{path}"

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
        url             = self._full_url(path)
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
            with httpx.Client(timeout=self.timeout) as client:
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
