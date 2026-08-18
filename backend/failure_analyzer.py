"""
Dynamic Failure Analyzer
Analyzes real test execution results against the system graph to
produce evidence-based root cause hypotheses with exact file + line references.
Uses graph path analysis + test trace correlation + optional AI reasoning.
"""

import re
from typing import Dict, Any, List, Optional


class FailureAnalyzer:
    def __init__(self, graph_builder=None, ai_provider=None):
        self.graph = graph_builder
        self.ai    = ai_provider

    def analyze(self, test_result: Dict[str, Any],
                test_case: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Analyze a failed test result.
        Uses:
          1. Assertion comparison (expected vs actual)
          2. Graph path tracing (field → API → service → table)
          3. HTTP trace inspection
          4. DB verification mismatch detection
          5. Optional AI root cause inference
        """
        if test_result.get("overallStatus") == "PASS":
            return {"status": "PASS", "analysis": "No failures detected."}

        test_id = test_result.get("testId", "UNKNOWN")
        reasons = test_result.get("failureReasons", [])
        http_results = test_result.get("httpResults", [])
        db_results   = test_result.get("dbResults", [])
        pw_result    = test_result.get("playwrightResult", {})

        hypotheses = []

        # ── 1. HTTP assertion failures ────────────────────────────────────
        for hr in http_results:
            if not hr.get("passed") and not hr.get("skipped"):
                endpoint = hr.get("endpoint", "?")
                expected = hr.get("expectedStatus", "?")
                actual   = hr.get("actualStatus", "?")
                error    = hr.get("error", "")

                if "CONNECTION_REFUSED" in str(error):
                    hypotheses.append({
                        "type":       "INFRA",
                        "severity":   "critical",
                        "diagnosis":  f"Backend server unreachable. {endpoint} connection refused.",
                        "suggestion": "Start the ERP backend server before running tests.",
                        "confidence": 1.0,
                    })
                elif actual and actual != expected:
                    # Trace which controller handles this endpoint
                    affected_files = self._find_endpoint_files(endpoint)
                    hypotheses.append({
                        "type":        "API_STATUS_MISMATCH",
                        "severity":    "high",
                        "diagnosis":   f"API {endpoint} returned HTTP {actual}, expected {expected}.",
                        "affectedFiles": affected_files,
                        "suggestion":  f"Inspect controller/service handling {endpoint}. "
                                       f"Check request validation, auth middleware, and error handling.",
                        "confidence":  0.85,
                    })

        # ── 2. Database assertion failures ────────────────────────────────
        for dr in db_results:
            if not dr.get("passed") and not dr.get("skipped"):
                table  = dr.get("table", "?")
                column = dr.get("column", "?")
                expected_val = dr.get("expectedValue", dr.get("expectedRowsCount"))
                actual_val   = dr.get("actualValue", dr.get("actualRowsCount"))
                error        = dr.get("error", "")

                if error:
                    hypotheses.append({
                        "type":       "DB_ERROR",
                        "severity":   "high",
                        "diagnosis":  f"Database error on `{table}`: {error}",
                        "suggestion": "Check that the table exists and migrations have been applied.",
                        "confidence": 0.90,
                    })
                else:
                    # Trace which repository writes to this table
                    affected_repos = self._find_repos_for_table(table)
                    hypotheses.append({
                        "type":         "DB_ASSERTION_MISMATCH",
                        "severity":     "high",
                        "diagnosis":    f"DB assertion failed: `{table}.{column}` expected={expected_val}, actual={actual_val}.",
                        "affectedFiles": affected_repos,
                        "suggestion":   f"Inspect repository/service layer that writes to `{table}`. "
                                        f"Check field mapping (camelCase → snake_case), default values, and validation logic.",
                        "confidence":   0.88,
                    })

        # ── 3. Playwright browser failures ────────────────────────────────
        if pw_result and not pw_result.get("passed") and pw_result.get("error"):
            error = pw_result["error"]
            if "TimeoutError" in error or "timeout" in error.lower():
                hypotheses.append({
                    "type":       "UI_TIMEOUT",
                    "severity":   "medium",
                    "diagnosis":  f"Playwright element not found within timeout: {error}",
                    "suggestion": "Selector may be incorrect, element may not render, or page navigation failed.",
                    "confidence": 0.80,
                })
            else:
                hypotheses.append({
                    "type":       "UI_ERROR",
                    "severity":   "medium",
                    "diagnosis":  f"Playwright error: {error}",
                    "suggestion": "Check that frontend pages are accessible and all selectors match the DOM.",
                    "confidence": 0.75,
                })

        # ── 4. AI-enhanced root cause (if available) ──────────────────────
        if self.ai and self.ai.is_enabled() and hypotheses:
            failure_context = (
                f"Test {test_id} failed.\n"
                f"Failure reasons: {'; '.join(reasons)}\n"
                f"Hypotheses so far: {[h['diagnosis'] for h in hypotheses]}\n"
            )
            if self.graph:
                # Add relevant graph paths
                for h in hypotheses:
                    for af in h.get("affectedFiles", []):
                        failure_context += f"Affected: {af}\n"
            ai_result = self.ai.analyze_failure(failure_context)
            if ai_result.get("analysis"):
                hypotheses.append({
                    "type":       "AI_ANALYSIS",
                    "severity":   "medium",
                    "diagnosis":  ai_result["analysis"],
                    "confidence": ai_result.get("confidence", 0.85),
                    "source":     "AI",
                })

        return {
            "testId":     test_id,
            "status":     "FAIL",
            "hypotheses": hypotheses,
            "summary":    hypotheses[0]["diagnosis"] if hypotheses else "Unknown failure.",
        }

    # ── Graph-Assisted File Lookup ────────────────────────────────────────

    def _find_endpoint_files(self, endpoint: str) -> List[str]:
        """Find source files that implement a given API endpoint using graph."""
        if not self.graph:
            return []
        # Parse endpoint: "POST /api/v1/customers" → path = "/api/v1/customers"
        parts = endpoint.strip().split(" ", 1)
        path  = parts[1] if len(parts) > 1 else parts[0]

        files = []
        for node in self.graph.nodes.values():
            if node["type"] == "APIEndpoint" and path in node.get("metadata", {}).get("path", ""):
                # Traverse downstream: endpoint → controller → service
                ds = self.graph.get_downstream(node["id"], max_depth=3)
                for n in ds["nodes"]:
                    fp = n.get("metadata", {}).get("filePath")
                    if fp and fp not in files:
                        files.append(fp)
        return files

    def _find_repos_for_table(self, table_name: str) -> List[str]:
        """Find repository/service files that write to a given table using graph."""
        if not self.graph:
            return []
        table_id = f"table_{table_name}"
        if table_id not in self.graph.nodes:
            return []

        files = []
        upstream = self.graph.get_upstream(table_id, max_depth=3)
        for n in upstream["nodes"]:
            fp = n.get("metadata", {}).get("filePath")
            if fp and fp not in files:
                files.append(fp)
        return files
