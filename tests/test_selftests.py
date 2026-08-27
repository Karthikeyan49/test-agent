"""
Aggregated self-test suite for SystemIntel's own engine (closes A3).

Each backend module ships a deterministic `__main__` self-test. Historically
these could only be run one at a time by hand (`python3 backend/<mod>.py`) and
nothing gated them. This collects them into a single pytest run so CI can fail
the build if any regress.

Only modules whose self-tests are deterministic and run fully OFFLINE (no live
app, DB server, browser, or LLM) are included here. Modules that need an
external service (playwright_runner, vision_gemini, ai_provider, agent, …) are
intentionally excluded and covered by integration tests instead.
"""
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent / "backend"

OFFLINE_SELFTEST_MODULES = [
    "metamorphic",          # generator + executor (Q1)
    "injection_oracle",     # differential SQLi / XSS (S2)
    "authz_oracle",         # IDOR / privilege differential
    "combinatorial",        # pairwise / t-wise covering-array generation
    "field_edge_oracle",    # per-field in/out edge round-trip oracle
    "requirement_oracle",   # requirement (intent) oracle — PASS/FAIL/SKIP
    "auth",                 # token/login/cookie (P6)
    "ai_provider",          # external-egress policy (S5)
    "http_runner",          # auth-skip (Q2) + off-origin guard (S7) + attribution (Q5)
    "db_runner",
    "mutation",
    "field_blackbox",
    "field_battery",        # rich multi-case-per-method per-field battery
    "valid_data",           # constraint+name-aware realistic value + FK grounding + guarded AI
    "screenshots",
    "browser_required_oracle",
    "browser_combinatorial",
    "browser_field_validation",
    "ai_assist",
    "vision_gemini",        # Gemini vision field-mapper — offline JSON+chain+429-rotation tests
    "db_seeder",
    "graph_rag",
    "page_docs",            # skips cleanly without a real graph
    "invariants",
    "fixtures",
    "spec_oracle",
    "endpoint_contracts",
    "scenario_contracts",
    "scenarios",            # multi-page use-case flow generator; AI-summary checks skip-gate offline
    "scenario_runner",      # 3-way runner + additive edge/requirement oracle findings
    "test_recorder",        # live per-test JSONL ledger + HTML render
    "scenario_reports",
    "reporters",
    "repo_memory",
    "ui_audits",
    "explorer",
    "graph_builder",
    "engine",
    "file_scanner",
    "graph_builder",        # Q4b base-path SUBMITS_TO
]


@pytest.mark.parametrize("module", OFFLINE_SELFTEST_MODULES)
def test_module_selftest(module):
    """Run `python3 backend/<module>.py` and require a clean (exit 0) self-test."""
    script = BACKEND / f"{module}.py"
    assert script.exists(), f"missing module {script}"
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(BACKEND), capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        f"{module} self-test failed (exit {proc.returncode})\n"
        f"--- stdout ---\n{proc.stdout[-2000:]}\n"
        f"--- stderr ---\n{proc.stderr[-2000:]}"
    )
