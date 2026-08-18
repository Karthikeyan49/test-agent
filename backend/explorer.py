"""
Agentic Exploratory Tester  (EXPERIMENTAL PROTOTYPE)

⚠️  EXPERIMENTAL — this is a prototype, not part of the deterministic core.
    It asks an LLM to *propose* unusual, edge-case test scenarios that the
    template-based generator would never emit — boundary values, out-of-order
    workflow sequences (e.g. invoice before its order), double-submit /
    idempotency, mass-assignment, type confusion, auth-bypass on protected
    routes, unicode / oversized inputs, etc.

    Because an LLM will happily hallucinate endpoints that do not exist, every
    proposed scenario is passed through a GROUNDING FILTER: any scenario whose
    `targetEndpoint` does not correspond to a real endpoint in the System Graph
    is dropped. Survivors are tagged `"grounded": true`.

    Interface note: this module talks to the LLM exclusively through
    `backend/ai_provider.py::AIProvider` (`is_enabled()` + `_call_llm()`), so it
    inherits the same retry/backoff, provider selection and graceful-degradation
    behaviour as the rest of SystemIntel. When the provider is disabled (or the
    call returns None) `propose_scenarios()` returns `[]` and never raises.

    Public API (for wiring into cli.py as an experimental `test --explore` mode):
        tester = ExploratoryTester(ai_provider, graph_data)
        scenarios = tester.propose_scenarios(max_scenarios=8)  # -> list[dict]
"""

import json
import re
from typing import Any, Dict, List, Optional


# HTTP verbs we recognise when parsing a "METHOD /path" target string.
_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}


class ExploratoryTester:
    """Propose (and ground-check) LLM-generated edge-case test scenarios.

    Args:
        ai_provider: An ``AIProvider``-like object exposing ``is_enabled() -> bool``
            and ``_call_llm(prompt, system_prompt="") -> Optional[str]``.
        graph_data: A System Graph dict containing (at least) an ``apiEndpoints``
            list; ``fields`` and ``dbTables`` are used to enrich the prompt.
    """

    def __init__(self, ai_provider: Any, graph_data: Dict[str, Any]) -> None:
        self.ai = ai_provider
        self.graph = graph_data or {}
        # Precompute the set of real endpoints as (METHOD, [segment-regex...]) so
        # the grounding filter is O(candidates * endpoints) with no re-parsing.
        self._real_endpoints: List[tuple] = self._index_endpoints(self.graph)

    # ── Public API ────────────────────────────────────────────────────────

    def propose_scenarios(self, max_scenarios: int = 8) -> List[Dict[str, Any]]:
        """Ask the LLM for edge-case scenarios, then keep only the grounded ones.

        Returns an empty list (never raises) when the AI provider is disabled,
        the call fails, or nothing parseable / grounded comes back.
        """
        if not self.ai or not self.ai.is_enabled():
            return []

        summary = self._build_compact_summary(max_endpoints=40,
                                               max_fields=30,
                                               max_tables=25)

        system_prompt = (
            "You are an adversarial exploratory tester. Given a compact summary "
            "of a real software system, you propose UNUSUAL, high-value test "
            "scenarios that a naive template generator would miss. Focus on: "
            "boundary values; out-of-order workflow sequences (e.g. creating an "
            "invoice before its order exists); double-submit / idempotency; "
            "mass-assignment (POSTing fields the user should not be allowed to "
            "set, like isAdmin or ownerId); type confusion (string where a number "
            "is expected, arrays where scalars are expected); auth-bypass on "
            "protected routes; and unicode / oversized / malformed inputs. "
            "Only target endpoints that appear in the provided list. "
            "Respond with a JSON array and NOTHING else."
        )

        prompt = (
            f"SYSTEM SUMMARY\n{summary}\n\n"
            f"Propose up to {max_scenarios} edge-case test scenarios that "
            "templated generation would miss. Every `targetEndpoint` MUST be one "
            "of the endpoints listed above, written exactly as \"METHOD /path\".\n\n"
            "Return a JSON array where each element is an object with EXACTLY "
            "these keys:\n"
            '  "title"          : short human-readable name\n'
            '  "hypothesis"     : what weakness this probes and why it matters\n'
            '  "technique"      : the string "EXPLORATORY"\n'
            '  "category"       : the string "Exploratory / Edge-case"\n'
            '  "targetEndpoint" : "METHOD /path" (must exist in the list above)\n'
            '  "steps"          : array of ordered step strings\n'
            '  "assertions"     : array of expected-outcome strings\n\n'
            "Output the JSON array only — no prose, no markdown fences."
        )

        raw = self.ai._call_llm(prompt, system_prompt)
        if not raw:
            return []

        proposed = self._parse_scenarios(raw)
        if not proposed:
            return []

        grounded: List[Dict[str, Any]] = []
        for scenario in proposed:
            if not isinstance(scenario, dict):
                continue
            normalized = self._normalize_scenario(scenario)
            if self._is_grounded(normalized.get("targetEndpoint")):
                normalized["grounded"] = True
                grounded.append(normalized)
            if len(grounded) >= max_scenarios:
                break

        return grounded

    # ── Prompt construction ───────────────────────────────────────────────

    def _build_compact_summary(self, max_endpoints: int = 40,
                               max_fields: int = 30,
                               max_tables: int = 25) -> str:
        """Render a small, prompt-friendly digest of the real graph.

        Lists are capped so the prompt stays small even for large graphs.
        """
        endpoints = self.graph.get("apiEndpoints", []) or []
        fields    = self.graph.get("fields", []) or []
        tables    = self.graph.get("dbTables", []) or []

        ep_lines: List[str] = []
        for ep in endpoints[:max_endpoints]:
            method = str(ep.get("method", "")).upper().strip()
            path   = str(ep.get("path", "")).strip()
            if not method or not path:
                continue
            protected = " [auth]" if ep.get("auth") else ""
            ep_lines.append(f"{method} {path}{protected}")

        # De-duplicate field / table names while preserving order.
        field_names = self._unique(
            str(f.get("fieldName", "")).strip()
            for f in fields
        )[:max_fields]
        table_names = self._unique(
            str(t.get("name", "")).strip()
            for t in tables
        )[:max_tables]

        parts: List[str] = []
        parts.append(
            f"ENDPOINTS ({len(ep_lines)} of {len(endpoints)} shown; "
            "'[auth]' = protected):"
        )
        parts.extend(f"  - {line}" for line in ep_lines)
        if field_names:
            parts.append("\nFORM FIELDS (names): " + ", ".join(field_names))
        if table_names:
            parts.append("\nDB TABLES: " + ", ".join(table_names))
        return "\n".join(parts)

    # ── Response parsing ──────────────────────────────────────────────────

    def _parse_scenarios(self, raw: str) -> List[Any]:
        """Robustly extract the outermost JSON array from an LLM response.

        Strips markdown fences, then slices from the first ``[`` to the last
        ``]`` and ``json.loads`` it. Returns ``[]`` on any failure.
        """
        text = raw.strip()
        # Strip ```json ... ``` / ``` ... ``` fences if present.
        fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text,
                         flags=re.DOTALL | re.IGNORECASE)
        if fence:
            text = fence.group(1).strip()

        start = text.find("[")
        end   = text.rfind("]")
        if start < 0 or end <= start:
            return []
        try:
            parsed = json.loads(text[start:end + 1])
        except (json.JSONDecodeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []

    def _normalize_scenario(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """Coerce a raw scenario dict into the canonical shape / defaults."""
        return {
            "title":          str(scenario.get("title", "")).strip() or "Untitled scenario",
            "hypothesis":     str(scenario.get("hypothesis", "")).strip(),
            "technique":      "EXPLORATORY",
            "category":       "Exploratory / Edge-case",
            "targetEndpoint": str(scenario.get("targetEndpoint", "")).strip(),
            "steps":          self._as_str_list(scenario.get("steps")),
            "assertions":     self._as_str_list(scenario.get("assertions")),
        }

    # ── Grounding filter ──────────────────────────────────────────────────

    def _index_endpoints(self, graph_data: Dict[str, Any]) -> List[tuple]:
        """Build ``(METHOD, [compiled-segment-matchers])`` for every real endpoint."""
        index: List[tuple] = []
        for ep in (graph_data.get("apiEndpoints", []) or []):
            method = str(ep.get("method", "")).upper().strip()
            path   = str(ep.get("path", "")).strip()
            if not method or not path:
                continue
            index.append((method, self._segments(path)))
        return index

    def _is_grounded(self, target_endpoint: Optional[str]) -> bool:
        """True iff ``target_endpoint`` ("METHOD /path") matches a real endpoint.

        Path params are treated as wildcards on BOTH sides — so ``{id}`` in the
        real path matches a concrete ``42`` in the candidate, and vice-versa —
        but literal segments and segment counts must line up. This lets honest
        variations through while rejecting invented routes.
        """
        if not target_endpoint:
            return False
        method, path = self._split_target(target_endpoint)
        if not path:
            return False
        cand_segments = self._segments(path)

        for real_method, real_segments in self._real_endpoints:
            if method and method != real_method:
                continue
            if self._segments_match(real_segments, cand_segments):
                return True
        return False

    def _segments_match(self, real: List[str], cand: List[str]) -> bool:
        """Compare two segment lists, allowing param wildcards on either side."""
        if len(real) != len(cand):
            return False
        for r_seg, c_seg in zip(real, cand):
            if r_seg == "*" or c_seg == "*":
                continue
            if r_seg.lower() != c_seg.lower():
                return False
        return True

    # ── Small helpers ─────────────────────────────────────────────────────

    def _split_target(self, target: str) -> tuple:
        """Parse "METHOD /path" -> (METHOD or "", "/path"). Method optional."""
        tokens = target.strip().split(None, 1)
        if len(tokens) == 2 and tokens[0].upper() in _HTTP_METHODS:
            return tokens[0].upper(), tokens[1].strip()
        if len(tokens) == 1 and tokens[0].upper() in _HTTP_METHODS:
            return tokens[0].upper(), ""
        # No recognisable method -> treat entire string as the path (match any verb).
        return "", target.strip()

    def _segments(self, path: str) -> List[str]:
        """Split a URL path into segments, collapsing params to ``*`` wildcards.

        Query strings are discarded; ``{id}``, ``:id`` and bare numeric / UUID
        segments all normalise to ``*``.
        """
        path = path.split("?", 1)[0].split("#", 1)[0]
        raw = [seg for seg in path.split("/") if seg != ""]
        return [("*" if self._is_param(seg) else seg) for seg in raw]

    @staticmethod
    def _is_param(segment: str) -> bool:
        """True if a path segment is a parameter placeholder or concrete id value."""
        if not segment:
            return False
        if segment.startswith("{") and segment.endswith("}"):
            return True
        if segment.startswith(":"):
            return True
        if segment.isdigit():
            return True
        # UUID-ish (hex + dashes) -> treat as an id value.
        if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}", segment):
            return True
        return False

    @staticmethod
    def _as_str_list(value: Any) -> List[str]:
        """Coerce an arbitrary value into a list of stripped strings."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        text = str(value).strip()
        return [text] if text else []

    @staticmethod
    def _unique(items: Any) -> List[str]:
        """Order-preserving de-duplication, dropping empties."""
        seen: set = set()
        out: List[str] = []
        for item in items:
            if item and item not in seen:
                seen.add(item)
                out.append(item)
        return out


# ── Self-test (no real LLM required) ──────────────────────────────────────

if __name__ == "__main__":

    class _StubProvider:
        """Stand-in AIProvider that returns a fixed JSON array of scenarios.

        Two target REAL endpoints in the inline graph below; one targets a
        FAKE endpoint that the grounding filter must reject.
        """

        def is_enabled(self) -> bool:
            return True

        def _call_llm(self, prompt: str, system_prompt: str = "") -> Optional[str]:
            return json.dumps([
                {
                    "title": "Mass-assignment on order creation",
                    "hypothesis": "Client may set server-controlled fields (status, ownerId).",
                    "technique": "EXPLORATORY",
                    "category": "Exploratory / Edge-case",
                    "targetEndpoint": "POST /orders",
                    "steps": ["POST /orders with extra field ownerId=999", "Inspect created row"],
                    "assertions": ["ownerId is ignored / rejected", "status is server-defaulted"],
                },
                {
                    "title": "Type confusion on product id",
                    "hypothesis": "Passing an array or string where an int id is expected may 500.",
                    "technique": "EXPLORATORY",
                    "category": "Exploratory / Edge-case",
                    "targetEndpoint": "GET /products/42",   # concrete id vs {id} wildcard
                    "steps": ["GET /products/{id} with id='0x1'", "Observe status code"],
                    "assertions": ["Returns 400, not 500"],
                },
                {
                    "title": "Auth bypass on a hallucinated route",
                    "hypothesis": "This endpoint does not exist and must be filtered out.",
                    "technique": "EXPLORATORY",
                    "category": "Exploratory / Edge-case",
                    "targetEndpoint": "POST /totally-made-up",
                    "steps": ["POST /totally-made-up"],
                    "assertions": ["should never reach here"],
                },
            ])

    class _DisabledProvider:
        def is_enabled(self) -> bool:
            return False

        def _call_llm(self, prompt: str, system_prompt: str = "") -> Optional[str]:
            raise AssertionError("_call_llm must not be called when disabled")

    # Tiny inline graph_data with two real endpoints (one parameterised).
    inline_graph: Dict[str, Any] = {
        "apiEndpoints": [
            {"method": "POST", "path": "/orders", "auth": True},
            {"method": "GET", "path": "/products/{id}", "auth": False},
        ],
        "fields": [
            {"fieldName": "amount"},
            {"fieldName": "status"},
            {"fieldName": "amount"},  # dup, should collapse
        ],
        "dbTables": [
            {"name": "orders"},
            {"name": "products"},
        ],
    }

    tester = ExploratoryTester(_StubProvider(), inline_graph)
    scenarios = tester.propose_scenarios(max_scenarios=8)

    titles = [s["title"] for s in scenarios]

    # (a) the two real-endpoint scenarios survive, tagged grounded=true
    assert len(scenarios) == 2, f"expected 2 grounded scenarios, got {len(scenarios)}: {titles}"
    assert all(s.get("grounded") is True for s in scenarios), "survivors must be grounded=true"
    assert "Mass-assignment on order creation" in titles, "POST /orders scenario should survive"
    assert "Type confusion on product id" in titles, "GET /products/42 scenario should survive"

    # (b) the fake-endpoint scenario is filtered out by the grounding check
    assert "Auth bypass on a hallucinated route" not in titles, \
        "hallucinated /totally-made-up endpoint must be filtered out"

    # (c) a disabled provider returns [] without crashing (and without calling _call_llm)
    assert ExploratoryTester(_DisabledProvider(), inline_graph).propose_scenarios() == [], \
        "disabled provider must yield []"

    # Bonus: a provider that returns None also degrades to [].
    class _NoneProvider:
        def is_enabled(self) -> bool:
            return True

        def _call_llm(self, prompt: str, system_prompt: str = "") -> Optional[str]:
            return None

    assert ExploratoryTester(_NoneProvider(), inline_graph).propose_scenarios() == [], \
        "None response must yield []"

    print("Surviving scenarios:")
    for t in titles:
        print(f"  - {t}")
    print("SELF-TEST PASS")
