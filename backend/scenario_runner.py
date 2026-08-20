"""
Scenario Runner — 3-way cross-layer execution engine
======================================================
Executes a Scenario (see backend/scenario_contracts.py) end-to-end across the
THREE verification layers — browser UI (Playwright), HTTP API (httpx), and DB
(sqlite/postgres/mysql) — in a single ordered run, and returns a
ScenarioResult built exclusively through scenario_contracts' builders.

Design law (kept from scenario_contracts.py): pass/fail is ALWAYS a
deterministic check (HTTP status, DB row count, DOM presence) — never an LLM
opinion. This module only executes and compares; it never judges via AI.

A down/unreachable service (browser not started, API connection refused, DB
not connected) is a SKIP for that step, never a FAIL — a scenario should not
be marked broken just because one layer's service happens to be offline.

Variable store: an api step may `store` a value extracted from its JSON
response (dotted path, e.g. "data.id") under a name; any later step may
reference "${name}" anywhere in its route/endpoint/body/value and it is
substituted before execution. This is what lets "create X, then read/delete
that same X" scenarios work without hardcoding ids.
"""

import re
import time
from typing import Any, Dict, List, Optional

from scenario_contracts import make_step_result, make_scenario_result

# ── variable substitution ──────────────────────────────────────────────────
_TOKEN_RE = re.compile(r"\$\{([A-Za-z0-9_]+)\}")


def _substitute_value(value: Any, store: Dict[str, Any]) -> Any:
    """Recursively replace ${name} tokens with values from `store`.
    A string that is *exactly* "${name}" is replaced with the stored value
    as-is (preserves type — an int id stays an int for a DB `equals` match).
    A string containing "${name}" among other text gets str()-interpolated
    (e.g. an API path "/things/${id}")."""
    if isinstance(value, str):
        m = _TOKEN_RE.fullmatch(value)
        if m and m.group(1) in store:
            return store[m.group(1)]

        def _repl(match):
            name = match.group(1)
            return str(store[name]) if name in store else match.group(0)

        return _TOKEN_RE.sub(_repl, value)
    if isinstance(value, dict):
        return {k: _substitute_value(v, store) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute_value(v, store) for v in value]
    return value


def _extract_path(obj: Any, path: str) -> Any:
    """Extract a dotted path (e.g. "data.id") from a nested dict. Returns
    None if any segment is missing or the object isn't dict-shaped there."""
    cur = obj
    for part in (path or "").split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


# ── SQL literal helpers for DB steps that need an unparameterized WHERE ────
# (query_absent needs an EXACT row-count match, which db_runner only offers
# via its `condition` string path — see db_runner.run_assertion docstring.
# Identifiers are stripped to safe chars; values are SQL-literal-quoted.
# This mirrors db_runner._safe_ident's own trust model: a local, deliberately
# duplicated helper rather than importing a "private" name cross-module.)
def _safe_ident(name: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.]', '', str(name or ''))


def _sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


_UNREACHABLE_HINTS = ("ERR_CONNECTION", "net::", "ERR_NAME", "NS_ERROR", "Timeout", "ECONNREFUSED")


class ScenarioRunner:
    """Drives a single Scenario across ui/api/db layers in step order."""

    def __init__(self, base_url: str,
                 http_runner: Optional[Any] = None,
                 db_runner: Optional[Any] = None,
                 playwright_runner: Optional[Any] = None,
                 auth_headers: Optional[Dict[str, str]] = None):
        self.base_url          = (base_url or "").rstrip("/")
        self.http_runner       = http_runner
        self.db_runner         = db_runner
        self.playwright_runner = playwright_runner
        self.auth_headers      = auth_headers
        self.store: Dict[str, Any] = {}

    # ── public entrypoint ───────────────────────────────────────────────
    def run(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        self.store = {}
        step_results: List[Dict[str, Any]] = []
        exec_steps: List[Dict[str, Any]] = []   # substituted steps as actually sent

        steps = sorted(scenario.get("steps", []) or [], key=lambda s: s.get("n", 0))
        for raw_step in steps:
            step = self._substitute_step(raw_step)
            exec_steps.append(step)
            layer = step.get("layer")

            t0 = time.perf_counter()
            try:
                if layer == "ui":
                    out = self._run_ui_step(step)
                elif layer == "api":
                    out = self._run_api_step(step)
                elif layer == "db":
                    out = self._run_db_step(step)
                else:
                    out = {"skipped": True, "error": f"unknown layer '{layer}'"}
            except Exception as e:
                out = {"passed": False, "error": f"UNEXPECTED_RUNNER_ERROR: {type(e).__name__}: {e}"}
            duration_ms = round((time.perf_counter() - t0) * 1000, 2)

            step_results.append(make_step_result(
                step,
                out.get("passed"),
                actual=out.get("actual"),
                expected=out.get("expected"),
                error=out.get("error"),
                skipped=bool(out.get("skipped", False)),
                api_response=out.get("api_response"),
                db_rows=out.get("db_rows"),
                duration_ms=duration_ms,
            ))

        result = make_scenario_result(scenario, step_results)
        # ADDITIVE: run the in/out edge oracle and the requirement (intent) oracle
        # over evidence this scenario already collected (submitted body → DB row →
        # read-back response). Attached under "oracleFindings" — it NEVER changes the
        # scenario's own PASS/FAIL (which make_scenario_result already decided); it
        # only surfaces round-trip corruption and requirement violations for triage.
        try:
            findings = self._derive_oracle_findings(scenario, exec_steps, step_results)
            if findings:
                result["oracleFindings"] = findings
        except Exception as e:   # an oracle must never break a scenario run
            result["oracleFindings"] = {"error": f"{type(e).__name__}: {e}"}
        return result

    # ── oracle findings (additive) ───────────────────────────────────────
    def _derive_oracle_findings(self, scenario: Dict[str, Any],
                                exec_steps: List[Dict[str, Any]],
                                step_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        findings: Dict[str, Any] = {}

        # submitted: the first write (POST/PUT/PATCH) api step's body actually sent.
        submitted: Dict[str, Any] = {}
        for st in exec_steps:
            if st.get("layer") == "api" and (st.get("method") or "").upper() in ("POST", "PUT", "PATCH"):
                b = st.get("body") or st.get("testData") or {}
                if isinstance(b, dict) and b:
                    submitted = b
                    break
        # stored: the first DB step's first returned row (column -> value).
        stored: Dict[str, Any] = {}
        for sr in step_results:
            rows = sr.get("dbRows")
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                stored = rows[0]
                break
        # read-back: the last api response that returned a JSON object (unwrap data/result).
        readback: Dict[str, Any] = {}
        for sr in reversed(step_results):
            resp = sr.get("apiResponse")
            if isinstance(resp, dict):
                for wrap in ("data", "result", "item", "record"):
                    if isinstance(resp.get(wrap), dict):
                        readback = resp[wrap]
                        break
                else:
                    readback = resp
                break

        # ── in/out edge oracle: only for fields with SOME outgoing evidence ──
        if submitted and (stored or readback):
            try:
                from field_edge_oracle import check_field_edge
            except ImportError:
                from backend.field_edge_oracle import check_field_edge  # type: ignore
            edge: List[Dict[str, Any]] = []
            for fld, val in submitted.items():
                if fld not in stored and fld not in readback:
                    continue   # no outgoing leg for this field — nothing to compare
                kwargs: Dict[str, Any] = {"submitted": val}
                if fld in stored:
                    kwargs["stored"] = stored[fld]
                if fld in readback:
                    kwargs["read_back"] = readback[fld]
                edge.append(check_field_edge(fld, **kwargs))
            if edge:
                findings["fieldEdge"] = edge

        # ── requirement (intent) oracle: only if the scenario carries a source ──
        req_source = (scenario.get("requirements") or scenario.get("use_cases")
                      or scenario.get("useCases"))
        if req_source and readback:
            try:
                from requirement_oracle import evaluate_requirements
            except ImportError:
                from backend.requirement_oracle import evaluate_requirements  # type: ignore
            findings["requirement"] = evaluate_requirements(req_source, readback)

        return findings

    # ── substitution ────────────────────────────────────────────────────
    def _substitute_step(self, step: Dict[str, Any]) -> Dict[str, Any]:
        if not self.store:
            return dict(step)
        return {k: _substitute_value(v, self.store) for k, v in step.items()}

    # ── UI layer ────────────────────────────────────────────────────────
    def _run_ui_step(self, step: Dict[str, Any]) -> Dict[str, Any]:
        pw = self.playwright_runner
        if pw is None or getattr(pw, "page", None) is None:
            return {"skipped": True, "error": "Playwright runner not started — UI layer unavailable"}

        page = pw.page
        action = step.get("action")
        try:
            if action == "navigate":
                route = step.get("route") or step.get("page") or "/"
                url = route if str(route).startswith(("http://", "https://")) else f"{self.base_url}{route}"
                page.goto(url, timeout=15000)
                try:
                    page.wait_for_load_state("domcontentloaded")
                except Exception:
                    pass
                return {"passed": True, "actual": f"navigated to {url}", "expected": url}

            elif action == "fill":
                field = step.get("field")
                value = step.get("value", "")
                loc = pw._locate_field(field, step.get("selector"))
                if loc is None:
                    return {"passed": False, "expected": field, "error": f"field '{field}' not found on page"}
                loc.fill(str(value), timeout=3000)
                return {"passed": True, "actual": f"filled '{field}'", "expected": value}

            elif action == "select":
                field = step.get("field")
                value = step.get("value", "")
                loc = pw._locate_field(field, step.get("selector"))
                if loc is None:
                    return {"passed": False, "expected": field, "error": f"field '{field}' not found on page"}
                loc.select_option(str(value), timeout=3000)
                return {"passed": True, "actual": f"selected '{value}'", "expected": value}

            elif action in ("click", "submit"):
                selector = step.get("selector") or 'button[type="submit"]'
                loc = page.locator(selector).first
                if loc.count() == 0:
                    return {"passed": False, "expected": selector, "error": f"selector '{selector}' not found"}
                loc.click(timeout=3000)
                return {"passed": True, "actual": f"clicked '{selector}'", "expected": selector}

            elif action == "assert_text":
                selector = step.get("selector")
                expected = step.get("text", step.get("value", ""))
                actual_text = page.locator(selector).inner_text(timeout=4000).strip()
                passed = str(expected) in actual_text
                return {"passed": passed, "actual": actual_text, "expected": expected}

            elif action == "assert_visible":
                selector = step.get("selector")
                cnt = page.locator(selector).count()
                return {"passed": cnt > 0, "actual": cnt, "expected": ">0"}

            else:
                return {"skipped": True, "error": f"unknown ui action '{action}'"}

        except Exception as e:
            msg = str(e)
            if action == "navigate" or any(h in msg for h in _UNREACHABLE_HINTS):
                return {"skipped": True, "error": f"UI unreachable/timeout: {msg}"}
            return {"passed": False, "error": f"{type(e).__name__}: {msg}"}

    # ── API layer ───────────────────────────────────────────────────────
    def _run_api_step(self, step: Dict[str, Any]) -> Dict[str, Any]:
        if self.http_runner is None:
            return {"skipped": True, "error": "No HTTP runner configured — API layer unavailable"}

        method = step.get("method", "GET")
        assertion: Dict[str, Any] = {
            "type":     "API",
            "method":   method,
            "endpoint": step.get("endpoint", f"{method} /"),
            "body":     step.get("body", {}),
        }
        if self.auth_headers:
            assertion["headers"] = self.auth_headers

        for src, dst in (
            ("expectStatusClass", "expectedStatusClass"),
            ("expectStatusIn",    "expectedStatusIn"),
            ("expectStatusCode",  "expectedStatusCode"),
            # tolerate scenarios that already use the "expected..." spelling
            ("expectedStatusClass", "expectedStatusClass"),
            ("expectedStatusIn",    "expectedStatusIn"),
            ("expectedStatusCode",  "expectedStatusCode"),
        ):
            if src in step:
                assertion[dst] = step[src]

        result = self.http_runner.run_assertion(assertion)
        err = result.get("error")
        api_response = result.get("responseBody")

        if err and ("CONNECTION_REFUSED" in err or "Cannot connect" in err):
            return {"skipped": True, "error": err, "api_response": api_response}

        # capture ${name} bindings for later steps, regardless of pass/fail —
        # the resource may exist even if the *assertion* about it differs.
        store_map = step.get("store")
        if store_map and isinstance(api_response, dict):
            for name, path in store_map.items():
                val = _extract_path(api_response, path)
                if val is not None:
                    self.store[name] = val

        return {
            "passed":       result.get("passed"),
            "actual":       result.get("actualStatus"),
            "expected":     result.get("expectedStatus"),
            "error":        err,
            "api_response": api_response,
        }

    # ── DB layer ────────────────────────────────────────────────────────
    def _run_db_step(self, step: Dict[str, Any]) -> Dict[str, Any]:
        if self.db_runner is None:
            return {"skipped": True, "error": "No DB runner configured — DB layer unavailable"}

        table  = step.get("table")
        column = step.get("column")
        value  = step.get("value", step.get("equals"))
        action = step.get("action")

        if action == "query_equals":
            assertion = {"type": "DB", "table": table, "column": column,
                         "equals": value, "expectedRowsCount": 1}

        elif action == "query_exists":
            if column is not None and value is not None:
                assertion = {"type": "DB", "table": table, "column": column,
                             "equals": value, "expectedRowsCount": 1}
            else:
                # no column filter given → "does the table have any row at all"
                assertion = {"type": "DB", "table": table}

        elif action == "query_absent":
            # needs an EXACT 0-row match — db_runner's parameterized `equals`
            # path only supports ">= N", so use its `condition` (exact-count)
            # path instead, with the value safely SQL-literal-quoted here.
            if column is not None:
                cond = f'"{_safe_ident(column)}" = {_sql_literal(value)}'
                assertion = {"type": "DB", "table": table, "expectedRowsCount": 0, "condition": cond}
            else:
                assertion = {"type": "DB", "table": table, "expectedRowsCount": 0, "condition": "1=1"}

        else:
            return {"skipped": True, "error": f"unknown db action '{action}'"}

        result = self.db_runner.run_assertion(assertion)
        err = result.get("error")

        if err and "No active database connection" in err:
            return {"skipped": True, "error": err}

        db_rows = result.get("matchingRows", result.get("actualRowsCount", result.get("rowCount")))
        actual = result.get("actualValue")
        if actual is None:
            actual = db_rows
        expected = result.get("expectedValue")
        if expected is None:
            expected = result.get("expectedRowsCount", value)

        return {
            "passed":   result.get("passed"),
            "actual":   actual,
            "expected": expected,
            "error":    err,
            "db_rows":  db_rows,
        }


# ── SELF-TEST (no live web services required) ──────────────────────────────
if __name__ == "__main__":
    import os
    import tempfile

    from scenario_contracts import make_scenario, make_step, validate_scenario
    from db_runner import DBRunner

    # ── 1) DB-only scenario: query_equals (pass), query_absent (pass),
    #        query_equals against a missing value (fail) ────────────────────
    db_fd, db_path = tempfile.mkstemp(suffix=".db", prefix="scenario_runner_selftest_")
    os.close(db_fd)
    try:
        db_runner = DBRunner({"driver": "sqlite", "path": db_path})
        assert db_runner.connect()
        cur = db_runner.connection.cursor()
        cur.execute("CREATE TABLE t (name TEXT)")
        cur.execute("INSERT INTO t (name) VALUES (?)", ("Acme",))
        db_runner.connection.commit()
        cur.close()

        scenario_db = make_scenario(
            "SC-DB-1", "DB equals/absent self-test", "crud_lifecycle",
            steps=[
                make_step(1, "db", "query_equals", table="t", column="name", value="Acme"),
                make_step(2, "db", "query_absent", table="t", column="name", value="Nope"),
                make_step(3, "db", "query_equals", table="t", column="name", value="Missing"),
            ],
        )
        assert validate_scenario(scenario_db) == [], validate_scenario(scenario_db)

        runner_db = ScenarioRunner(base_url="http://localhost:9999", db_runner=db_runner)
        result_db = runner_db.run(scenario_db)

        assert result_db["steps"][0]["passed"] is True, result_db["steps"][0]
        assert result_db["steps"][1]["passed"] is True, result_db["steps"][1]
        assert result_db["steps"][2]["passed"] is False, result_db["steps"][2]
        assert result_db["status"] == "FAIL", result_db["status"]
        assert result_db["layers"]["db"] == "FAIL", result_db["layers"]
        assert result_db["failureReasons"], "expected a recorded failure reason"
        print(f"[db scenario] status={result_db['status']} layers={result_db['layers']} "
              f"failureReasons={result_db['failureReasons']}")

        db_runner.disconnect()
    finally:
        try:
            os.remove(db_path)
        except OSError:
            pass

    # ── 2) API-only scenario with a STUB http_runner + variable store/subst ─
    class _StubHTTPRunner:
        def __init__(self):
            self.calls = []

        def run_assertion(self, assertion):
            self.calls.append(assertion)
            return {
                "passed":       True,
                "actualStatus": 201,
                "expectedStatus": assertion.get("expectedStatusClass", 200),
                "responseBody": {"data": {"id": 7}},
                "error":        None,
            }

    stub = _StubHTTPRunner()
    scenario_api = make_scenario(
        "SC-API-1", "Create then reference id via ${} substitution", "crud_lifecycle",
        steps=[
            make_step(1, "api", "request", method="POST", endpoint="POST /things",
                      body={"name": "Acme Co"}, expectStatusClass="2xx", store={"id": "data.id"}),
            make_step(2, "api", "request", method="GET", endpoint="GET /things/${id}",
                      body={}, expectStatusClass="2xx"),
        ],
    )
    runner_api = ScenarioRunner(base_url="http://localhost:9999", http_runner=stub)
    result_api = runner_api.run(scenario_api)

    assert result_api["steps"][0]["passed"] is True, result_api["steps"][0]
    assert runner_api.store.get("id") == 7, runner_api.store
    assert stub.calls[1]["endpoint"] == "GET /things/7", stub.calls[1]["endpoint"]
    assert result_api["status"] == "PASS", result_api["status"]
    print(f"[api scenario] status={result_api['status']} store={runner_api.store} "
          f"second-call endpoint={stub.calls[1]['endpoint']!r}")

    # ── 3) UI step with no playwright_runner configured → SKIPPED, not FAIL ─
    scenario_ui = make_scenario(
        "SC-UI-1", "UI step is skipped without a live browser", "use_case_flow",
        steps=[make_step(1, "ui", "navigate", route="/somewhere")],
    )
    runner_ui = ScenarioRunner(base_url="http://localhost:9999")
    result_ui = runner_ui.run(scenario_ui)
    assert result_ui["steps"][0]["skipped"] is True, result_ui["steps"][0]
    assert result_ui["status"] == "SKIPPED", result_ui["status"]
    print(f"[ui scenario]  status={result_ui['status']} step0={result_ui['steps'][0]['error']!r}")

    # ── 4) shape sanity: ScenarioResult carries status/layers/failureReasons ─
    for res in (result_db, result_api, result_ui):
        assert set(("scenarioId", "name", "category", "priority", "status",
                    "layers", "steps", "failureReasons", "durationMs")) <= set(res.keys())

    # ── 5) ADDITIVE oracle findings: in/out edge + requirement (intent) ─────
    #     Feed evidence the runner would have collected (submitted body → DB row →
    #     read-back response). A silent truncation and a violated requirement must be
    #     surfaced WITHOUT changing the scenario's own verdict.
    runner_or = ScenarioRunner(base_url="http://localhost:9999")
    scen_or = {"id": "SC-OR-1", "requirements": ["status must be active", "total at least 100"]}
    exec_steps = [
        {"layer": "api", "method": "POST", "endpoint": "POST /products",
         "body": {"name": "Widget", "price": "50", "status": "active"}},
        {"layer": "db", "action": "query_exists"},
        {"layer": "api", "method": "GET", "endpoint": "GET /products/1"},
    ]
    step_results_or = [
        {"layer": "api", "apiResponse": {"data": {"id": 1}}, "dbRows": None},
        {"layer": "db", "dbRows": [{"name": "Widget", "price": 50, "status": "active"}]},
        {"layer": "api", "apiResponse": {"data": {"name": "Wid", "price": 50,
                                                  "status": "active", "total": 40}}},
    ]
    findings = runner_or._derive_oracle_findings(scen_or, exec_steps, step_results_or)
    edge = {f["field"]: f for f in findings.get("fieldEdge", [])}
    assert edge["name"]["verdict"] == "FAIL" and edge["name"]["mismatch"]["kind"] == "truncation", edge["name"]
    assert edge["price"]["verdict"] == "PASS" and edge["status"]["verdict"] == "PASS", edge
    assert findings["requirement"]["verdict"] == "FAIL", findings["requirement"]
    assert findings["requirement"]["failed"] == 1 and findings["requirement"]["passed"] == 1, findings["requirement"]
    print(f"[oracle findings] fieldEdge: name={edge['name']['verdict']} "
          f"price={edge['price']['verdict']} status={edge['status']['verdict']}; "
          f"requirement verdict={findings['requirement']['verdict']}")

    print("scenario_runner SELF-TEST PASS (db + api + ui + oracle findings)")

    print("SELF-TEST PASS")
