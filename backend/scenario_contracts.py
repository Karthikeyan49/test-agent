"""
Scenario Layer — SHARED CONTRACTS  (single source of truth)
===========================================================
Every module in the professional scenario upgrade speaks these exact shapes, so
the pieces (repo-memory → scenario generation → 3-way runner → reports) integrate
without guesswork. Import the builders/validators from here; do not redefine shapes.

Pipeline the shapes flow through:

  repo_memory.build_repo_memory(graph)  -> RepoMemory  ─┐
                                                        ├─► scenarios.generate(...) -> [Scenario]
  graph_data (system_graph.json) ───────────────────────┘                              │
                                                                                        ▼
  scenario_runner.run(scenarios, runners) -> [ScenarioResult] ──► scenario_reports.write(...)

Design law (never broken): AI may PROPOSE scenarios and expected values, but a
ScenarioResult's pass/fail is ALWAYS a deterministic check (HTTP status, DB row
count, DOM presence) — never an LLM opinion.
"""

from typing import Any, Dict, List, Optional

# ── enums ─────────────────────────────────────────────────────────────────────
LAYERS = ("ui", "api", "db")

UI_ACTIONS  = ("navigate", "fill", "select", "click", "submit", "assert_text", "assert_visible")
API_ACTIONS = ("request",)                       # method + endpoint + body
DB_ACTIONS  = ("query_exists", "query_absent", "query_equals")

SCENARIO_CATEGORIES = (
    "use_case_flow",     # multi-page user journey (login → create → verify)
    "crud_lifecycle",    # create → read → update → delete → verify-gone
    "cross_page_data",   # a value entered on page A must appear on page B
    "field_validation",  # a field rejects bad input (per-field, scenario-wrapped)
)

SCENARIO_SOURCES = ("static", "har", "ai")


# ── Scenario ──────────────────────────────────────────────────────────────────
def make_step(n: int, layer: str, action: str, **kw) -> Dict[str, Any]:
    """One step of a scenario. Extra keys per layer:
       ui : page, route, field, value, selector, text
       api: method, endpoint ("POST /x"), body(dict), expectStatusClass|expectStatus
       db : table, column, value  (for query_equals / query_exists / query_absent)
       Every step may carry `expect` (human-readable) and `store` (bind a response
       value to a name reusable by later steps as "${name}")."""
    assert layer in LAYERS, f"bad layer {layer}"
    step = {"n": n, "layer": layer, "action": action}
    step.update(kw)
    return step


def make_scenario(sid: str, name: str, category: str, steps: List[Dict[str, Any]],
                  preconditions: Optional[List[str]] = None,
                  source: str = "static", priority: str = "medium",
                  risk: Optional[str] = None,
                  evidence: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    return {
        "id":            sid,
        "name":          name,
        "category":      category,
        "technique":     "SCENARIO",
        "source":        source,          # static | har | ai
        "priority":      priority,        # low | medium | high | critical
        "risk":          risk,            # optional AI risk note
        "preconditions": preconditions or [],
        "steps":         steps,           # ordered [make_step(...)]
        "evidence":      evidence or [],  # graph lineage that grounds this scenario
    }


def validate_scenario(s: Dict[str, Any]) -> List[str]:
    """Return a list of problems (empty == valid). Cheap structural check."""
    errs = []
    for k in ("id", "name", "category", "steps"):
        if k not in s:
            errs.append(f"missing '{k}'")
    if s.get("category") and s["category"] not in SCENARIO_CATEGORIES:
        errs.append(f"unknown category '{s['category']}'")
    for i, st in enumerate(s.get("steps", []) or []):
        if st.get("layer") not in LAYERS:
            errs.append(f"step {i}: bad layer '{st.get('layer')}'")
    if not s.get("steps"):
        errs.append("scenario has no steps")
    return errs


# ── ScenarioResult ────────────────────────────────────────────────────────────
def make_step_result(step: Dict[str, Any], passed: Optional[bool],
                     actual: Any = None, expected: Any = None,
                     error: Optional[str] = None, skipped: bool = False,
                     api_response: Any = None, db_rows: Any = None,
                     duration_ms: float = 0.0) -> Dict[str, Any]:
    return {
        "n":           step.get("n"),
        "layer":       step.get("layer"),
        "action":      step.get("action"),
        "passed":      passed,
        "skipped":     skipped,
        "expected":    expected,
        "actual":      actual,
        "error":       error,
        "apiResponse": api_response,   # raw JSON body for the visual/JSON report
        "dbRows":      db_rows,
        "durationMs":  duration_ms,
    }


def make_scenario_result(scenario: Dict[str, Any], step_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate step results into a scenario verdict. A scenario PASSES only if
    every executed step passed; SKIPPED if nothing executed; else FAIL."""
    executed = [r for r in step_results if not r.get("skipped")]
    any_fail = any(r.get("passed") is False for r in executed)
    status = "FAIL" if any_fail else ("SKIPPED" if not executed else "PASS")
    layers = {}
    for lyr in LAYERS:
        lr = [r for r in step_results if r.get("layer") == lyr]
        le = [r for r in lr if not r.get("skipped")]
        layers[lyr] = ("SKIPPED" if not le else ("FAIL" if any(r.get("passed") is False for r in le) else "PASS")) if lr else None
    return {
        "scenarioId":     scenario.get("id"),
        "name":           scenario.get("name"),
        "category":       scenario.get("category"),
        "priority":       scenario.get("priority"),
        "status":         status,
        "layers":         layers,          # {"ui":..,"api":..,"db":..}
        "steps":          step_results,
        "failureReasons": [f"step {r['n']} [{r['layer']}/{r['action']}]: {r.get('error') or 'expected '+str(r.get('expected'))+' got '+str(r.get('actual'))}"
                           for r in executed if r.get("passed") is False],
        "durationMs":     round(sum(r.get("durationMs", 0) for r in step_results), 2),
    }


# ── RepoMemory (from repo_memory.build_repo_memory) ───────────────────────────
def make_repo_memory(pages, fields, use_cases, connections, cross_page) -> Dict[str, Any]:
    return {
        "pages":       pages,        # [{name, route, file, fields:[...]}]
        "fields":      fields,       # [{name, page, type, required}]
        "use_cases":   use_cases,    # [{name, description, pages:[...], endpoints:[...]}]
        "connections": connections,  # [{from, to, via}]  (field→api, api→table, page→page)
        "cross_page":  cross_page,   # [{source_page,source_field,target_page,target_field,reason}]
    }


def validate_repo_memory(m: Dict[str, Any]) -> List[str]:
    return [f"missing '{k}'" for k in ("pages", "fields", "use_cases", "connections", "cross_page") if k not in m]


if __name__ == "__main__":
    s = make_scenario(
        "SC-001", "Dealer creates a customer then it appears in the list", "use_case_flow",
        steps=[
            make_step(1, "ui", "navigate", page="CustomerForm", route="/dealer/customers/new"),
            make_step(2, "ui", "fill", field="name", value="Acme Co"),
            make_step(3, "ui", "submit", selector="button[type=submit]"),
            make_step(4, "api", "request", method="POST", endpoint="POST /dealer/customers",
                      body={"name": "Acme Co"}, expectStatusClass="2xx", store={"id": "data.id"}),
            make_step(5, "db", "query_equals", table="dealer_customers", column="name", value="Acme Co"),
        ],
        preconditions=["logged in as dealer"], source="static",
        evidence=[{"lineage": "CustomerForm.name → POST /dealer/customers → dealer_customers.name"}],
    )
    assert validate_scenario(s) == [], validate_scenario(s)

    srs = [
        make_step_result(s["steps"][0], True, duration_ms=120),
        make_step_result(s["steps"][3], True, actual=201, expected="2xx", api_response={"success": True, "data": {"id": 5}}, duration_ms=8),
        make_step_result(s["steps"][4], False, actual=0, expected=1, error="row not found", db_rows=0, duration_ms=1),
    ]
    res = make_scenario_result(s, srs)
    assert res["status"] == "FAIL", res["status"]
    assert res["layers"]["api"] == "PASS" and res["layers"]["db"] == "FAIL", res["layers"]
    assert res["failureReasons"], "should record the db failure"

    m = make_repo_memory([{"name": "CustomerForm", "route": "/dealer/customers/new", "fields": ["name"]}],
                         [{"name": "name", "page": "CustomerForm"}], [], [], [])
    assert validate_repo_memory(m) == []
    print("SELF-TEST PASS")
