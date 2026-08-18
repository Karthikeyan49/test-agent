"""
Scenario Layer — REPORTS
=========================
Turns a list of ``ScenarioResult`` dicts (see ``scenario_contracts.py`` ::
``make_scenario_result``) into four human/machine outputs:

  1. Per-scenario Markdown — ``<out_dir>/scenarios/<scenarioId>.md``
  2. Machine JSON          — ``<out_dir>/results.json``
  3. Visual HTML report    — ``<out_dir>/report.html``  (self-contained, theme-aware)
  4. Failures digest       — ``<out_dir>/FAILURES.md``  (only what did NOT match
     expectations — the fast path for "what's broken")

Design law (from ``scenario_contracts.py``): a ``ScenarioResult``'s pass/fail is
always a deterministic check, never an LLM opinion — this module only *renders*
what the runner already decided; it never re-judges pass/fail.

Pure standard library: ``json``, ``html``, ``os``, ``datetime``. Deterministic —
no wall-clock content is embedded in a way that would break repeat runs against
the same input (the report DOES stamp a generated-at timestamp, since that is
expected of a report, but no other output depends on the current time).

Public API
----------
    write_scenario_reports(results: list, out_dir: str, scenarios: list = None) -> dict
        -> {"per_scenario_dir": str, "json": str, "html": str, "failures_md": str}
"""

from __future__ import annotations

import html
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _status_badge(status: str) -> str:
    """Return an emoji-prefixed label for a scenario/layer status string."""
    s = (status or "").upper()
    if s == "PASS":
        return "✅ PASS"
    if s == "FAIL":
        return "❌ FAIL"
    if s == "SKIPPED":
        return "⏭ SKIPPED"
    return s or "—"


def _find_scenario(scenarios: Optional[List[Dict[str, Any]]], scenario_id: Any) -> Optional[Dict[str, Any]]:
    """Best-effort lookup of the source Scenario matching a ScenarioResult's id."""
    if not scenarios:
        return None
    for sc in scenarios:
        if sc.get("id") == scenario_id:
            return sc
    return None


def _pretty_json(value: Any) -> str:
    """Pretty-print an arbitrary value as JSON text (stringifying non-JSON-able bits)."""
    try:
        return json.dumps(value, indent=2, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _step_verdict(step: Dict[str, Any]) -> str:
    if step.get("skipped"):
        return "SKIP"
    if step.get("passed") is True:
        return "PASS"
    if step.get("passed") is False:
        return "FAIL"
    return "—"


def _md_escape_cell(value: Any) -> str:
    """Make a value safe to sit inside a Markdown table cell (single line, no pipes)."""
    text = "" if value is None else str(value)
    text = text.replace("|", "\\|").replace("\n", " ")
    if len(text) > 300:
        text = text[:297] + "..."
    return text


def _tally(results: List[Dict[str, Any]]) -> Dict[str, int]:
    total = len(results)
    passed = sum(1 for r in results if (r.get("status") or "").upper() == "PASS")
    failed = sum(1 for r in results if (r.get("status") or "").upper() == "FAIL")
    skipped = sum(1 for r in results if (r.get("status") or "").upper() == "SKIPPED")
    executed = passed + failed
    pass_rate = (100.0 * passed / executed) if executed else 0.0
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "executed": executed,
        "passRate": round(pass_rate, 1),
    }


# --------------------------------------------------------------------------- #
# 1. Per-scenario Markdown
# --------------------------------------------------------------------------- #
def _render_scenario_markdown(result: Dict[str, Any], scenario: Optional[Dict[str, Any]]) -> str:
    sid = result.get("scenarioId")
    name = result.get("name") or sid or "(unnamed scenario)"
    category = result.get("category") or "—"
    priority = result.get("priority") or "—"
    status = result.get("status") or "—"

    lines: List[str] = []
    lines.append(f"# {name}")
    lines.append("")
    lines.append(f"**Scenario ID:** `{sid}`  ")
    lines.append(f"**Category:** {category}  ")
    lines.append(f"**Priority:** {priority}  ")
    lines.append(f"**Status:** {_status_badge(status)}  ")
    lines.append(f"**Duration:** {result.get('durationMs', 0)} ms")
    lines.append("")

    layers = result.get("layers") or {}
    lines.append("**Layers:** "
                 + " · ".join(f"{lyr.upper()}: {_status_badge(layers.get(lyr)) if layers.get(lyr) else '—'}"
                               for lyr in ("ui", "api", "db")))
    lines.append("")

    preconditions = (scenario or {}).get("preconditions") or []
    if preconditions:
        lines.append("## Preconditions")
        lines.append("")
        for p in preconditions:
            lines.append(f"- {p}")
        lines.append("")

    steps = result.get("steps") or []
    lines.append("## Steps")
    lines.append("")
    lines.append("| # | Layer | Action | Expected | Actual | Result |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for step in steps:
        lines.append(
            f"| {step.get('n', '')} | {_md_escape_cell(step.get('layer'))} | "
            f"{_md_escape_cell(step.get('action'))} | {_md_escape_cell(step.get('expected'))} | "
            f"{_md_escape_cell(step.get('actual'))} | {_step_verdict(step)} |"
        )
    lines.append("")

    # Per-step detail: API JSON responses and DB rows get their own fenced blocks.
    detail_steps = [s for s in steps if s.get("layer") in ("api", "db") and
                     (s.get("apiResponse") is not None or s.get("dbRows") is not None or s.get("error"))]
    if detail_steps:
        lines.append("## Step Detail")
        lines.append("")
        for step in detail_steps:
            lines.append(f"### Step {step.get('n')} — {step.get('layer')}/{step.get('action')} ({_step_verdict(step)})")
            lines.append("")
            if step.get("error"):
                lines.append(f"**Error:** {step.get('error')}")
                lines.append("")
            if step.get("layer") == "api" and step.get("apiResponse") is not None:
                lines.append("**API response:**")
                lines.append("")
                lines.append("```json")
                lines.append(_pretty_json(step.get("apiResponse")))
                lines.append("```")
                lines.append("")
            if step.get("layer") == "db" and step.get("dbRows") is not None:
                lines.append("**DB rows:**")
                lines.append("")
                lines.append("```json")
                lines.append(_pretty_json(step.get("dbRows")))
                lines.append("```")
                lines.append("")

    lines.append("## Verdict")
    lines.append("")
    lines.append(f"**{_status_badge(status)}**")
    lines.append("")
    failure_reasons = result.get("failureReasons") or []
    if failure_reasons:
        lines.append("**Failure reasons:**")
        lines.append("")
        for reason in failure_reasons:
            lines.append(f"- {reason}")
        lines.append("")

    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# 2. Visual HTML report
# --------------------------------------------------------------------------- #
_HTML_HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    --bg: #f5f6f8;
    --card-bg: #ffffff;
    --text: #1a1d23;
    --text-muted: #5b6270;
    --border: #e1e4e9;
    --pass: #1a7f37;
    --pass-bg: #e6f4ea;
    --fail: #c0392b;
    --fail-bg: #fbeaea;
    --skip: #8a6d00;
    --skip-bg: #fdf3d6;
    --accent: #2b5cd9;
    --code-bg: #f0f1f4;
    --shadow: 0 1px 3px rgba(0,0,0,0.08);
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #14161a;
      --card-bg: #1d2026;
      --text: #e7e9ee;
      --text-muted: #9aa1ad;
      --border: #2c3038;
      --pass: #4cc471;
      --pass-bg: #103322;
      --fail: #ff6b60;
      --fail-bg: #3a1616;
      --skip: #e6c65c;
      --skip-bg: #3a3116;
      --accent: #6f9bff;
      --code-bg: #101216;
      --shadow: 0 1px 3px rgba(0,0,0,0.4);
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }}
  .wrap {{ max-width: 980px; margin: 0 auto; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 0.25rem; }}
  .meta {{ color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }}
  .tiles {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
    margin-bottom: 2rem;
  }}
  .tile {{
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.9rem 1rem;
    box-shadow: var(--shadow);
  }}
  .tile .n {{ font-size: 1.6rem; font-weight: 700; }}
  .tile .l {{ font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }}
  .tile.pass .n {{ color: var(--pass); }}
  .tile.fail .n {{ color: var(--fail); }}
  .tile.skip .n {{ color: var(--skip); }}
  .card {{
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: var(--shadow);
  }}
  .card-head {{
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    justify-content: space-between;
  }}
  .card-title {{ font-weight: 600; font-size: 1.02rem; }}
  .card-sub {{ color: var(--text-muted); font-size: 0.8rem; }}
  .badge {{
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }}
  .badge.pass {{ background: var(--pass-bg); color: var(--pass); }}
  .badge.fail {{ background: var(--fail-bg); color: var(--fail); }}
  .badge.skip {{ background: var(--skip-bg); color: var(--skip); }}
  .lanes {{ display: flex; gap: 0.4rem; margin: 0.6rem 0; flex-wrap: wrap; }}
  .lane-chip {{
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border);
  }}
  .lane-chip.pass {{ background: var(--pass-bg); color: var(--pass); border-color: transparent; }}
  .lane-chip.fail {{ background: var(--fail-bg); color: var(--fail); border-color: transparent; }}
  .lane-chip.skip {{ background: var(--skip-bg); color: var(--skip); border-color: transparent; }}
  .lane-chip.none {{ color: var(--text-muted); }}
  details {{ margin-top: 0.5rem; }}
  summary {{
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--accent);
    font-weight: 600;
    padding: 0.25rem 0;
  }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.82rem; }}
  th, td {{ text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }}
  th {{ color: var(--text-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }}
  tr.step-fail td {{ background: var(--fail-bg); }}
  .step-badge {{ font-weight: 700; font-size: 0.75rem; }}
  .step-badge.pass {{ color: var(--pass); }}
  .step-badge.fail {{ color: var(--fail); }}
  .step-badge.skip {{ color: var(--skip); }}
  pre {{
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    overflow-x: auto;
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
  }}
  code {{ font-family: "SF Mono", Menlo, Consolas, monospace; }}
  .failbox {{
    margin-top: 0.6rem;
    border-left: 3px solid var(--fail);
    background: var(--fail-bg);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
  }}
  .failbox ul {{ margin: 0.3rem 0 0; padding-left: 1.1rem; }}
  footer {{ margin-top: 2rem; color: var(--text-muted); font-size: 0.75rem; text-align: center; }}
</style>
</head>
<body>
<div class="wrap">
"""

_HTML_TAIL = """
</div>
</body>
</html>
"""


def _lane_class(status: Optional[str]) -> str:
    s = (status or "").upper()
    if s == "PASS":
        return "pass"
    if s == "FAIL":
        return "fail"
    if s == "SKIPPED":
        return "skip"
    return "none"


def _render_html_scenario_card(result: Dict[str, Any]) -> str:
    e = html.escape
    sid = e(str(result.get("scenarioId") or ""))
    name = e(str(result.get("name") or sid or "(unnamed scenario)"))
    category = e(str(result.get("category") or "—"))
    priority = e(str(result.get("priority") or "—"))
    status = str(result.get("status") or "")
    status_cls = _lane_class(status)
    layers = result.get("layers") or {}

    lanes_html = "".join(
        f'<span class="lane-chip {_lane_class(layers.get(lyr))}">{lyr.upper()}: '
        f'{e(str(layers.get(lyr)) if layers.get(lyr) else "n/a")}</span>'
        for lyr in ("ui", "api", "db")
    )

    steps = result.get("steps") or []
    step_rows = []
    for step in steps:
        verdict = _step_verdict(step)
        verdict_cls = {"PASS": "pass", "FAIL": "fail", "SKIP": "skip"}.get(verdict, "")
        row_cls = ' class="step-fail"' if verdict == "FAIL" else ""
        expected = e(str(step.get("expected")) if step.get("expected") is not None else "")
        actual = e(str(step.get("actual")) if step.get("actual") is not None else "")
        step_rows.append(
            f"<tr{row_cls}><td>{step.get('n', '')}</td><td>{e(str(step.get('layer') or ''))}</td>"
            f"<td>{e(str(step.get('action') or ''))}</td><td>{expected}</td><td>{actual}</td>"
            f'<td><span class="step-badge {verdict_cls}">{verdict}</span></td></tr>'
        )
        if verdict == "FAIL":
            extra_bits = []
            if step.get("error"):
                extra_bits.append(f"<div><strong>error:</strong> {e(str(step.get('error')))}</div>")
            if step.get("apiResponse") is not None:
                extra_bits.append(
                    f"<div><strong>API response:</strong><pre><code>{e(_pretty_json(step.get('apiResponse')))}</code></pre></div>"
                )
            if step.get("dbRows") is not None:
                extra_bits.append(
                    f"<div><strong>DB rows:</strong><pre><code>{e(_pretty_json(step.get('dbRows')))}</code></pre></div>"
                )
            if extra_bits:
                step_rows.append(
                    f'<tr class="step-fail"><td colspan="6">{"".join(extra_bits)}</td></tr>'
                )

    failure_reasons = result.get("failureReasons") or []
    failbox_html = ""
    if failure_reasons:
        items = "".join(f"<li>{e(str(r))}</li>" for r in failure_reasons)
        failbox_html = f'<div class="failbox"><strong>Failure reasons</strong><ul>{items}</ul></div>'

    return f"""
<div class="card">
  <div class="card-head">
    <div>
      <div class="card-title">{name}</div>
      <div class="card-sub">{sid} &middot; {category} &middot; priority: {priority}</div>
    </div>
    <span class="badge {status_cls}">{e(status)}</span>
  </div>
  <div class="lanes">{lanes_html}</div>
  {failbox_html}
  <details{' open' if status_cls == 'fail' else ''}>
    <summary>Steps ({len(steps)})</summary>
    <table>
      <thead><tr><th>#</th><th>Layer</th><th>Action</th><th>Expected</th><th>Actual</th><th>Result</th></tr></thead>
      <tbody>{"".join(step_rows)}</tbody>
    </table>
  </details>
</div>
"""


def _render_html_report(results: List[Dict[str, Any]]) -> str:
    e = html.escape
    tally = _tally(results)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    tiles = f"""
<div class="tiles">
  <div class="tile"><div class="n">{tally['total']}</div><div class="l">Total</div></div>
  <div class="tile pass"><div class="n">{tally['passed']}</div><div class="l">Pass</div></div>
  <div class="tile fail"><div class="n">{tally['failed']}</div><div class="l">Fail</div></div>
  <div class="tile skip"><div class="n">{tally['skipped']}</div><div class="l">Skipped</div></div>
  <div class="tile"><div class="n">{tally['passRate']}%</div><div class="l">Pass rate</div></div>
</div>
"""

    cards = "".join(_render_html_scenario_card(r) for r in results)

    body = _HTML_HEAD.format(title="SystemIntel Scenario Report")
    body += f"<h1>SystemIntel Scenario Report</h1>\n"
    body += f'<div class="meta">Generated {e(generated_at)} &middot; {tally["total"]} scenarios</div>\n'
    body += tiles
    body += cards if cards else '<div class="card">No scenarios.</div>'
    body += '<footer>SystemIntel &middot; scenario_reports.py</footer>'
    body += _HTML_TAIL
    return body


# --------------------------------------------------------------------------- #
# 4. FAILURES.md
# --------------------------------------------------------------------------- #
def _render_failures_markdown(results: List[Dict[str, Any]]) -> str:
    failing = [r for r in results if (r.get("status") or "").upper() == "FAIL"]
    if not failing:
        return "# Failures\n\nNo failures 🎉\n"

    lines: List[str] = ["# Failures", ""]
    lines.append(f"{len(failing)} scenario(s) did not match expectations.")
    lines.append("")

    for result in failing:
        name = result.get("name") or result.get("scenarioId") or "(unnamed scenario)"
        lines.append(f"## {name}")
        lines.append("")
        lines.append(f"- **Scenario ID:** `{result.get('scenarioId')}`")
        lines.append(f"- **Category:** {result.get('category') or '—'}")
        lines.append(f"- **Priority:** {result.get('priority') or '—'}")
        lines.append("")

        failing_steps = [s for s in (result.get("steps") or []) if s.get("passed") is False]
        for step in failing_steps:
            lines.append(
                f"- Step {step.get('n')} [{step.get('layer')}/{step.get('action')}]: "
                f"expected: {step.get('expected')} | actual: {step.get('actual')} | "
                f"error: {step.get('error') or '—'}"
            )
            if step.get("apiResponse") is not None:
                lines.append("")
                lines.append("  API response:")
                lines.append("")
                lines.append("  ```json")
                for json_line in _pretty_json(step.get("apiResponse")).splitlines():
                    lines.append(f"  {json_line}")
                lines.append("  ```")
                lines.append("")
            if step.get("dbRows") is not None:
                lines.append("")
                lines.append("  DB rows:")
                lines.append("")
                lines.append("  ```json")
                for json_line in _pretty_json(step.get("dbRows")).splitlines():
                    lines.append(f"  {json_line}")
                lines.append("  ```")
                lines.append("")

        reasons = result.get("failureReasons") or []
        if reasons:
            lines.append("")
            lines.append("  Failure reasons:")
            for reason in reasons:
                lines.append(f"  - {reason}")
        lines.append("")

    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# Public entrypoint
# --------------------------------------------------------------------------- #
def write_scenario_reports(results: List[Dict[str, Any]], out_dir: str,
                            scenarios: Optional[List[Dict[str, Any]]] = None) -> Dict[str, str]:
    """Write per-scenario Markdown, machine JSON, a visual HTML report, and a
    FAILURES.md digest for ``results`` (a list of ``ScenarioResult`` dicts) into
    ``out_dir``. ``scenarios`` (optional) supplies preconditions for context.

    Returns ``{"per_scenario_dir", "json", "html", "failures_md"}`` — the paths
    written.
    """
    os.makedirs(out_dir, exist_ok=True)
    per_scenario_dir = os.path.join(out_dir, "scenarios")
    os.makedirs(per_scenario_dir, exist_ok=True)

    # 1. Per-scenario Markdown
    for result in results:
        sid = result.get("scenarioId") or "unknown"
        scenario = _find_scenario(scenarios, sid)
        md = _render_scenario_markdown(result, scenario)
        path = os.path.join(per_scenario_dir, f"{sid}.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(md)

    # 2. Machine JSON
    json_path = os.path.join(out_dir, "results.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, default=str, indent=2)

    # 3. Visual HTML report
    html_path = os.path.join(out_dir, "report.html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(_render_html_report(results))

    # 4. FAILURES.md
    failures_path = os.path.join(out_dir, "FAILURES.md")
    with open(failures_path, "w", encoding="utf-8") as fh:
        fh.write(_render_failures_markdown(results))

    return {
        "per_scenario_dir": per_scenario_dir,
        "json": json_path,
        "html": html_path,
        "failures_md": failures_path,
    }


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    import shutil
    import tempfile

    from scenario_contracts import make_scenario, make_step, make_scenario_result, make_step_result

    # --- Scenario 1: all PASS ---------------------------------------------
    sc_pass = make_scenario(
        "SC-PASS-001", "Dealer views customer list", "use_case_flow",
        steps=[
            make_step(1, "ui", "navigate", page="CustomerList", route="/dealer/customers"),
            make_step(2, "api", "request", method="GET", endpoint="GET /dealer/customers"),
        ],
        preconditions=["logged in as dealer"],
    )
    steps_pass = [
        make_step_result(sc_pass["steps"][0], True, actual="rendered", expected="rendered", duration_ms=50),
        make_step_result(sc_pass["steps"][1], True, actual=200, expected="2xx",
                          api_response={"success": True, "data": [{"id": 1, "name": "Acme"}]}, duration_ms=15),
    ]
    res_pass = make_scenario_result(sc_pass, steps_pass)

    # --- Scenario 2: FAIL (db step expected 1 got 0, api step has a body) --
    sc_fail = make_scenario(
        "SC-FAIL-001", "Dealer creates a customer then it appears in the list", "use_case_flow",
        steps=[
            make_step(1, "ui", "fill", field="name", value="Acme Co"),
            make_step(2, "api", "request", method="POST", endpoint="POST /dealer/customers",
                      body={"name": "Acme Co"}, expectStatusClass="2xx"),
            make_step(3, "db", "query_equals", table="dealer_customers", column="name", value="Acme Co"),
        ],
        preconditions=["logged in as dealer"],
    )
    steps_fail = [
        make_step_result(sc_fail["steps"][0], True, actual="filled", expected="filled", duration_ms=30),
        make_step_result(sc_fail["steps"][1], True, actual=201, expected="2xx",
                          api_response={"success": True, "data": {"id": 5, "name": "Acme Co"}}, duration_ms=12),
        make_step_result(sc_fail["steps"][2], False, actual=0, expected=1, error="row not found",
                          db_rows=0, duration_ms=8),
    ]
    res_fail = make_scenario_result(sc_fail, steps_fail)
    assert res_fail["status"] == "FAIL", res_fail["status"]

    # --- Scenario 3: SKIPPED (nothing executed) -----------------------------
    sc_skip = make_scenario(
        "SC-SKIP-001", "Dealer deletes a customer", "crud_lifecycle",
        steps=[make_step(1, "ui", "click", selector="button.delete")],
    )
    steps_skip = [
        make_step_result(sc_skip["steps"][0], None, skipped=True, duration_ms=0),
    ]
    res_skip = make_scenario_result(sc_skip, steps_skip)
    assert res_skip["status"] == "SKIPPED", res_skip["status"]

    results = [res_pass, res_fail, res_skip]
    scenarios = [sc_pass, sc_fail, sc_skip]

    tmp_dir = tempfile.mkdtemp(prefix="scenario_reports_selftest_")
    try:
        paths = write_scenario_reports(results, tmp_dir, scenarios=scenarios)

        # per-scenario markdown files exist
        for r in results:
            p = os.path.join(paths["per_scenario_dir"], f"{r['scenarioId']}.md")
            assert os.path.isfile(p), f"missing per-scenario md: {p}"

        # results.json parses back and matches
        with open(paths["json"], "r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        assert len(loaded) == 3, "results.json should round-trip 3 scenarios"
        assert loaded[1]["scenarioId"] == "SC-FAIL-001"

        # report.html exists and contains scenario names + PASS/FAIL
        assert os.path.isfile(paths["html"])
        with open(paths["html"], "r", encoding="utf-8") as fh:
            html_text = fh.read()
        assert "Dealer views customer list" in html_text
        assert "Dealer creates a customer then it appears in the list" in html_text
        assert "Dealer deletes a customer" in html_text
        assert "PASS" in html_text and "FAIL" in html_text
        assert "<!DOCTYPE html>" in html_text

        # FAILURES.md contains ONLY the failing scenario
        assert os.path.isfile(paths["failures_md"])
        with open(paths["failures_md"], "r", encoding="utf-8") as fh:
            failures_text = fh.read()
        assert "Dealer creates a customer then it appears in the list" in failures_text
        assert "expected: 1" in failures_text and "actual: 0" in failures_text
        assert "Dealer views customer list" not in failures_text
        assert "Dealer deletes a customer" not in failures_text

        print("---- FAILURES.md ----")
        print(failures_text)
        print("---- end FAILURES.md ----")
        print("SELF-TEST PASS")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
