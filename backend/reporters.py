"""
CI reporters for SystemIntel — JUnit XML + Markdown summary + exit codes.

SystemIntel already produces a rich JSON report (and an HTML view), but to be a
first-class *CI citizen* a test tool needs two more things:

  1. A machine-readable **JUnit XML** report that Jenkins / GitLab CI /
     GitHub Actions / CircleCI all natively ingest to render per-test results,
     track flakiness, and annotate PRs.
  2. A meaningful **process exit code** so a pipeline step goes red when real
     failures occurred (and stays green when tests were merely skipped because
     the live app/DB wasn't reachable — skips must never fail CI).

This module is deliberately pure-stdlib (``xml.sax.saxutils``, ``json``) so it
adds no dependency and can run anywhere the CLI runs. It consumes the report
dict emitted by ``cli.py`` ``cmd_test`` — the shape is::

    {
      "timestamp": "...", "baseUrl": "...",
      "summary": {"total": int, "passed": int, "failed": int, "skipped": int,
                  "executed": int, "passRate": "42.6%", "durationMs": float},
      "testResults": [
        {"testId": str, "title": str, "category": str,
         "overallStatus": "PASS"|"FAIL"|"SKIPPED", "durationMs": float,
         "failureReasons": [str], ...},
        ...
      ],
    }

Public API
----------
    to_junit_xml(report: dict) -> str
    to_markdown_summary(report: dict) -> str
    exit_code(report: dict) -> int
    write_junit(report: dict, path: str) -> None
"""

from __future__ import annotations

import json
from collections import OrderedDict
from typing import Any, Dict, List, Tuple
from xml.sax.saxutils import escape, quoteattr


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _attr(value: Any) -> str:
    """Return ``value`` XML-escaped and wrapped in double quotes for an attribute.

    ``xml.sax.saxutils.quoteattr`` handles ``& < > " '`` and picks a safe quote
    character, so the result is drop-in for ``name=<here>`` in a serialized tag.
    """
    return quoteattr("" if value is None else str(value))


def _seconds(duration_ms: Any) -> float:
    """Convert a millisecond duration to seconds, tolerating bad/missing input."""
    try:
        return round(float(duration_ms) / 1000.0, 3)
    except (TypeError, ValueError):
        return 0.0


def _status_of(test: Dict[str, Any]) -> str:
    """Normalize a test's ``overallStatus`` into ``PASS`` / ``FAIL`` / ``SKIPPED``.

    Anything unrecognised is treated as a failure — an unknown state is never
    silently counted as a pass in CI.
    """
    raw = str(test.get("overallStatus", "")).strip().upper()
    if raw in ("PASS", "PASSED"):
        return "PASS"
    if raw in ("SKIP", "SKIPPED"):
        return "SKIPPED"
    return "FAIL"


def _group_by_category(
    results: List[Dict[str, Any]]
) -> "OrderedDict[str, List[Dict[str, Any]]]":
    """Group test-result dicts by their ``category`` (insertion-ordered)."""
    groups: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
    for test in results:
        category = str(test.get("category") or "Uncategorized")
        groups.setdefault(category, []).append(test)
    return groups


def _tally(results: List[Dict[str, Any]]) -> Tuple[int, int, int, int, float]:
    """Return ``(total, failures, skipped, passed, seconds)`` for ``results``."""
    total = len(results)
    failures = skipped = passed = 0
    seconds = 0.0
    for test in results:
        status = _status_of(test)
        if status == "FAIL":
            failures += 1
        elif status == "SKIPPED":
            skipped += 1
        else:
            passed += 1
        seconds += _seconds(test.get("durationMs"))
    return total, failures, skipped, passed, round(seconds, 3)


# --------------------------------------------------------------------------- #
# JUnit XML
# --------------------------------------------------------------------------- #
def to_junit_xml(report: Dict[str, Any]) -> str:
    """Render ``report`` as a JUnit-XML document string.

    Structure: a root ``<testsuites>`` carrying aggregate counts, containing one
    ``<testsuite name="SystemIntel — <category>">`` per test ``category``. Each
    test becomes a ``<testcase name=title classname=category time=seconds>``:

      * a ``FAIL`` adds a child ``<failure message="…">`` whose message is the
        joined ``failureReasons`` (also placed in the element text for viewers
        that show the body);
      * a ``SKIPPED`` adds an empty ``<skipped/>`` child.

    All attribute and text values are XML-escaped. Times are in **seconds**
    (``durationMs`` / 1000). The document is deterministic and parses cleanly
    via ``xml.etree.ElementTree.fromstring``.
    """
    results: List[Dict[str, Any]] = list(report.get("testResults") or [])

    # Aggregate counts come from the derived tally so the XML is internally
    # consistent even if summary counters drift from testResults.
    g_total, g_fail, g_skip, _g_pass, g_seconds = _tally(results)

    lines: List[str] = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append(
        "<testsuites "
        f"name={_attr('SystemIntel')} "
        f"tests={_attr(g_total)} "
        f"failures={_attr(g_fail)} "
        f"errors={_attr(0)} "
        f"skipped={_attr(g_skip)} "
        f"time={_attr(g_seconds)}>"
    )

    for category, tests in _group_by_category(results).items():
        s_total, s_fail, s_skip, _s_pass, s_seconds = _tally(tests)
        lines.append(
            "  <testsuite "
            f"name={_attr('SystemIntel — ' + category)} "
            f"tests={_attr(s_total)} "
            f"failures={_attr(s_fail)} "
            f"errors={_attr(0)} "
            f"skipped={_attr(s_skip)} "
            f"time={_attr(s_seconds)}>"
        )

        for test in tests:
            status = _status_of(test)
            title = test.get("title") or test.get("testId") or "unnamed test"
            case_attrs = (
                f"name={_attr(title)} "
                f"classname={_attr(category)} "
                f"time={_attr(_seconds(test.get('durationMs')))}"
            )

            if status == "FAIL":
                reasons = test.get("failureReasons") or []
                message = "; ".join(str(r) for r in reasons) or "Test failed"
                lines.append(f"    <testcase {case_attrs}>")
                lines.append(
                    f"      <failure message={_attr(message)}>"
                    f"{escape(message)}</failure>"
                )
                lines.append("    </testcase>")
            elif status == "SKIPPED":
                reasons = test.get("failureReasons") or []
                message = "; ".join(str(r) for r in reasons)
                lines.append(f"    <testcase {case_attrs}>")
                if message:
                    lines.append(f"      <skipped message={_attr(message)}/>")
                else:
                    lines.append("      <skipped/>")
                lines.append("    </testcase>")
            else:  # PASS
                lines.append(f"    <testcase {case_attrs}/>")

        lines.append("  </testsuite>")

    lines.append("</testsuites>")
    return "\n".join(lines)


def write_junit(report: Dict[str, Any], path: str) -> None:
    """Serialize ``report`` to JUnit XML and write it (UTF-8) to ``path``."""
    xml = to_junit_xml(report)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)
        if not xml.endswith("\n"):
            fh.write("\n")


# --------------------------------------------------------------------------- #
# Markdown summary (PR comment / job summary)
# --------------------------------------------------------------------------- #
def to_markdown_summary(report: Dict[str, Any]) -> str:
    """Render a short GitHub-flavored Markdown summary suitable for a PR comment.

    Includes a headline pass-rate line and a per-category table of
    pass / fail / skip counts. Safe to post as-is to a GitHub job summary
    (``$GITHUB_STEP_SUMMARY``) or a PR comment.
    """
    summary: Dict[str, Any] = report.get("summary") or {}
    results: List[Dict[str, Any]] = list(report.get("testResults") or [])

    total = summary.get("total", len(results))
    passed = summary.get("passed")
    failed = summary.get("failed")
    skipped = summary.get("skipped")
    executed = summary.get("executed")
    pass_rate = summary.get("passRate")

    # Fill any missing summary fields from a fresh tally so the summary is
    # always complete even for a bare report.
    t_total, t_fail, t_skip, t_pass, _sec = _tally(results)
    if passed is None:
        passed = t_pass
    if failed is None:
        failed = t_fail
    if skipped is None:
        skipped = t_skip
    if executed is None:
        executed = t_pass + t_fail
    if pass_rate is None:
        pass_rate = f"{(100.0 * t_pass / executed) if executed else 0.0:.1f}%"

    verdict = "❌ FAILED" if int(failed or 0) > 0 else "✅ PASSED"

    out: List[str] = []
    out.append("## SystemIntel Test Report")
    out.append("")
    out.append(f"**Result:** {verdict}  ·  **Pass rate:** {pass_rate} "
               f"({passed}/{executed} executed)")
    out.append("")
    out.append(
        f"**Total:** {total}  ·  "
        f"**Passed:** {passed}  ·  "
        f"**Failed:** {failed}  ·  "
        f"**Skipped:** {skipped}"
    )
    base_url = report.get("baseUrl")
    if base_url:
        out.append("")
        out.append(f"_Target:_ `{base_url}`")
    out.append("")
    out.append("| Category | ✅ Pass | ❌ Fail | ⏭ Skip |")
    out.append("| --- | ---: | ---: | ---: |")
    for category, tests in _group_by_category(results).items():
        _c_total, c_fail, c_skip, c_pass, _c_sec = _tally(tests)
        out.append(f"| {category} | {c_pass} | {c_fail} | {c_skip} |")
    out.append("")

    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Exit code
# --------------------------------------------------------------------------- #
def exit_code(report: Dict[str, Any]) -> int:
    """Return the CI process exit code for ``report``.

    ``1`` when any test genuinely failed (``summary.failed > 0``), else ``0``.
    Skipped tests do **not** fail CI — an offline run that verified nothing live
    is honestly green, not red.
    """
    summary: Dict[str, Any] = report.get("summary") or {}
    failed = summary.get("failed")
    if failed is None:
        # Derive from testResults if the summary omitted the counter.
        _t, failed, _s, _p, _sec = _tally(list(report.get("testResults") or []))
    try:
        return 1 if int(failed) > 0 else 0
    except (TypeError, ValueError):
        return 1


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    import xml.etree.ElementTree as ET

    _SAMPLE_REPORT: Dict[str, Any] = {
        "timestamp": "2026-08-18T00:00:00Z",
        "baseUrl": "http://localhost:3000",
        "summary": {
            "total": 3,
            "passed": 1,
            "failed": 1,
            "skipped": 1,
            "executed": 2,
            "passRate": "50.0%",
            "durationMs": 345.0,
        },
        "testResults": [
            {
                "testId": "T1",
                "title": "GET /products returns 200",
                "category": "API contract",
                "overallStatus": "PASS",
                "durationMs": 120.0,
                "failureReasons": [],
            },
            {
                "testId": "T2",
                "title": "POST /customers persists email <special & chars>",
                "category": "Cross-layer consistency",
                "overallStatus": "FAIL",
                "durationMs": 200.0,
                "failureReasons": ["Expected 201, got 500", "DB row not found"],
            },
            {
                "testId": "T3",
                "title": "UI form renders CustomerForm",
                "category": "API contract",
                "overallStatus": "SKIPPED",
                "durationMs": 25.0,
                "failureReasons": ["Frontend not reachable"],
            },
        ],
    }

    # (1) JUnit XML parses cleanly.
    xml_str = to_junit_xml(_SAMPLE_REPORT)
    root = ET.fromstring(xml_str)  # raises on malformed XML
    assert root.tag == "testsuites", f"unexpected root tag: {root.tag}"

    # (2) Aggregate counts on the root are correct.
    assert root.get("tests") == "3", f"tests attr == {root.get('tests')!r}, want '3'"
    assert root.get("failures") == "1", \
        f"failures attr == {root.get('failures')!r}, want '1'"

    # (3) Exactly one <failure> and one <skipped> in the whole tree.
    failures = root.findall(".//failure")
    skips = root.findall(".//skipped")
    assert len(failures) == 1, f"expected 1 <failure>, found {len(failures)}"
    assert len(skips) == 1, f"expected 1 <skipped>, found {len(skips)}"
    # The failure message must carry the joined reasons.
    assert "Expected 201, got 500" in (failures[0].get("message") or ""), \
        "failure message missing joined failureReasons"

    # (4) exit_code: 1 for a failing report, 0 when failed == 0.
    assert exit_code(_SAMPLE_REPORT) == 1, "exit_code should be 1 when failed > 0"
    _clean = json.loads(json.dumps(_SAMPLE_REPORT))
    _clean["summary"]["failed"] = 0
    assert exit_code(_clean) == 0, "exit_code should be 0 when failed == 0"

    # (5) Markdown summary is non-empty and mentions the pass rate.
    md = to_markdown_summary(_SAMPLE_REPORT)
    assert isinstance(md, str) and md.strip(), "markdown summary is empty"
    assert "50.0%" in md, "markdown summary missing the pass rate"

    print("SELF-TEST PASS")
