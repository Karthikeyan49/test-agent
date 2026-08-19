# SystemIntel — Gap Analysis, Resolution Plan & Status

A single register of every gap found in a four-perspective audit (QA, Architecture,
Security, Product) of the tool's **own code and docs**, the plan to resolve each,
where **AI genuinely helps**, and where **a human must intervene**.

> **Provenance:** these gaps were found by a code review of SystemIntel itself —
> the tool did **not** find them, and they are **not** the author's roadmap. They
> are the gap between what the docs claim and what the code does. None are defects
> in the ecosudar *application*; ecosudar is only the bundled demo target.

**Legend — Status:** ✅ resolved & self-tested · 🟡 partially resolved · ⏳ open ·
👤 needs human · 🤖 AI assists (deterministic check still decides)

---

## 0 · Executive status

| Bucket | Total | ✅ Resolved | 🟡 Partial | ⏳ Open (planned) |
|---|---|---|---|---|
| Security | 10 | 6 | 1 | 3 |
| QA / Oracle | 10 | 4 | 1 | 5 |
| Architecture | 9 | 5 | 1 | 3 |
| Product | 9 | 4 | 2 | 3 |
| **Total** | **38** | **19** | **5** | **14** |

The headline change this session: the tool now has **real oracles** for the bug
classes it previously could not catch — metamorphic execution (business-logic
math), an auth-precondition skip (no more false-green behind login), and a
differential SQLi/XSS oracle (real vulnerability detection, not "did not crash").

---

## 1 · Security

| ID | Gap | Status | Resolution | AI / Human |
|---|---|---|---|---|
| S1 | Real production admin credential committed in the seed dump | 🟡 | Sanitized in working tree (placeholder). **History purge + password rotation remain.** | 👤 force-push decision + rotate on server |
| S2 | "Injection tests" only checked `!5xx` (security theater) | ✅ | New `injection_oracle.py`: boolean-differential SQLi (`OR 1=1` vs `AND 1=2`) + reflected-XSS check. Self-tested: detects a vuln, passes a safe endpoint, skips behind auth. | 🤖 AI can *propose* extra payloads; the differential check decides |
| S3 | No guardrail against being pointed at production | ✅ | `--allow-nonlocal-writes` gate; mutating verbs skipped against a non-local `--base-url` by default. | — |
| S4 | Mutation mode could leave corrupted source served live | ✅ | On-disk `.si-orig` backup + restore-on-startup + SIGINT/SIGTERM handler. | — |
| S5 | Source/schema exfiltrated to third-party LLMs by default | ⏳ | Plan: default provider → local (ollama); explicit consent flag + logged manifest of what leaves. (README privacy note added.) | 👤 choose provider policy |
| S6 | Gemini API key in URL query string, logged on error | ✅ | Key moved to `x-goog-api-key` header; errors log status only. | — |
| S7 | SSRF / auth-token leak via off-origin absolute URLs | ✅ | `http_runner` refuses absolute URLs off the `--base-url` origin. Self-tested. | — |
| S8 | Path-traversal guard bypassable; API bound to `0.0.0.0` | ✅ | `realpath` + `commonpath` check; binds `127.0.0.1` by default. | — |
| S9 | Raw SQL identifier interpolation despite "injection-safe" claim | ✅ | `_safe_ident` now applied on `schema_exists` + `fk_integrity` identifier paths. | — |
| S10 | Live response bodies (PII/tokens) written into reports | ✅ | Redacted by default; `--include-response-bodies` to opt in. | — |

## 2 · QA / Oracle soundness

| ID | Gap | Status | Resolution | AI / Human |
|---|---|---|---|---|
| Q1 | Metamorphic oracle decorative — relations never executed | ✅ | `execute_metamorphic_test()` performs the paired requests and evaluates count-delta / field-echo / sum / idempotency. Wired into `cli.py`. Self-tested to FAIL buggy apps, SKIP when it can't run. | 🤖 AI proposes the relation; the executor decides |
| Q2 | 401/403 scored as passing "4xx" (false-green behind auth) | ✅ | `http_runner` marks a 401/403 on a non-auth test with no token as **SKIPPED** (never PASS/FAIL). Real auth tests (expect 401) still pass. Self-tested (4 cases). | 👤 supply role tokens to actually test |
| Q3 | Injection = crash check only | ✅ | Same as S2 (relabeled `fuzz_robustness` + real oracle added). | 🤖 |
| Q4 | No response-body correctness (wrong data returned invisible) | ✅ | The metamorphic `round_trip` executor compares written vs read-back fields keyed on the created id. | — |
| Q4b | Cross-layer oracle ≈2% coverage, `≥1 row` on constant values | ⏳ | Plan: derive `SUBMITS_TO` statically (base-path normalization) + unique per-run token matched to the created id. | — |
| Q5 | Negatives can't attribute the 4xx to the injected fault | ⏳ | Plan: assert on the response's error field/code, not just status class. | 🤖 AI can map error text → field |
| Q6 | UI oracle asserts "rendered", not workflow success | ⏳ | Plan: require submit to fire + a DB/API post-condition before a UI PASS. | — |
| Q7 | Mutation score 38% (weak logic-bug detection) | 🟡 | Improves automatically as Q1/Q4/S2 add behavioral oracles; raise `--mutate-max`. | — |
| Q8 | Invariants partly tautological; unknown columns skip-as-pass | ⏳ | Plan: report skipped invariants as "unknown"; run against production-like data. | — |
| Q9 | Generalizability name-convention-bound (`Controller`→`Service`) | ⏳ | Plan: resolve `CALLS`/`WRITES_TO` from real call/import edges; validate on a non-PHP repo. | 👤 provide a 2nd-stack target |

## 3 · Architecture / Maintainability

| ID | Gap | Status | Resolution | AI / Human |
|---|---|---|---|---|
| A1 | "AST parser" is 100% regex | ⏳ | Plan: adopt `tree-sitter`/`ast`, or strike the "AST/guaranteed accurate" wording. Large. | 👤 approve parser rewrite |
| A2 | Parse errors swallowed → partial graph shown as complete | ⏳ | Plan: collect per-file `parse_errors[]`, surface coverage ("N of M parsed"), no `except: pass` in graph paths. | — |
| A3 | No tests for the tool itself, no CI | ✅ | `tests/test_selftests.py` aggregates 22 module self-tests; `.github/workflows/ci.yml` runs compile + pytest on 3.10/3.12. | — |
| A4 | 1,277 LOC dead/diverged JS engine + orphaned web UI | 👤 | **Keep vs delete is a product call** — flagged, not deleted unilaterally. README marks `src/` as non-canonical. | 👤 decide keep/delete |
| A5 | `cli.py` god-module (496-line `cmd_test`), reporter duplicated | ⏳ | Plan: extract an importable `systemintel` API package; de-dup the HTML reporter. | — |
| A6 | Not a package; unpinned deps; committed bytecode | ✅ | `pyproject.toml` + console entry point; deps pinned with upper caps; 31 `.pyc` untracked. | — |
| A7 | `.pyc` committed | ✅ | Untracked (prior commit). | — |
| A8 | Hardcoded personal paths + single baked-in target in self-tests | ✅ | All self-tests now use `SYSTEMINTEL_GRAPH` env + synthetic fallback / clean skip; run on any machine. | — |
| A9 | GraphRAG semantic path inert (sentence-transformers absent) | 🟡 | Documented in the build-status caveat; add the dep or state lexical-only in docs. | — |

## 4 · Product / Requirements

| ID | Gap | Status | Resolution | AI / Human |
|---|---|---|---|---|
| P1 | No onboarding; broken CLI examples | ✅ | Root `README.md` + corrected `README_CLI.md`. | — |
| P2 | Wired to one machine/target | 🟡 | Personal paths removed (A8); a "run against your own repo" tutorial still to write. | — |
| P3 | Docs contradict code about the UI | 🟡 | README marks `src/` non-canonical; full reconcile pending the A4 keep/delete call. | 👤 |
| P4 | "✅ shipped" overstates maturity | ✅ | Scope caveat added to the build-status table. | — |
| P5 | Undisclosed limits; false "Google Deepmind" authorship | ✅ | Authorship corrected; this document is the full disclosed-limits register. | — |
| P6 | Narrow integration (bearer-only auth, relational-only, REST-only) | ⏳ | Plan: document the support matrix; add session-cookie + OAuth client-credentials. | 👤 provide target auth details |
| P7 | 36-flag `test` command, no config/presets | ⏳ | Plan: `systemintel.yaml` + `smoke`/`deep` presets. | — |
| P8 | CI-readiness unproven | ✅ | Example GitHub Actions workflow shipped (A3). | — |
| P9 | No run-history / baseline-diff / incremental re-scan | ⏳ | Plan: persist a run store to enable the differential oracle + trends. | — |

---

## 5 · Where AI helps vs. where a human is required

**AI genuinely raises the ceiling (always behind a deterministic check — R2 "propose, don't decide"):**
- Propose metamorphic relations & business invariants from code/spec (Q1, Q8).
- Generate smarter inputs / extra injection payloads (S2, Q5).
- Map error-response text → the field that failed (Q5).
- Prioritize risky endpoints for authz review (Q9).
- Explain failures / root-cause hypotheses (already present).

**A human is required — AI cannot substitute:**
- 👤 **S1:** decide on git-history rewrite (force-push) and rotate the real password on the server.
- 👤 **Q2/Q9:** supply real credentials for ≥2 roles (IDOR/authz) and a 2nd-stack target repo.
- 👤 **Q-business-logic:** the "correct" answer for novel, unspecified rules (the irreducible ~20%).
- 👤 **A4:** keep-or-delete the legacy JS/UI (product decision).
- 👤 **S5:** choose the data-egress policy for third-party LLMs.

---

## 6 · Recommended sequence for the remaining work

1. **S1 finish** (human): purge history + rotate password.
2. **Q4b + Q5** — static `SUBMITS_TO` + error-field attribution (turns more shallow checks into real oracles).
3. **A2** — surface parse errors + coverage (protects the determinism claim cheaply).
4. **P6/P7** — auth matrix + config presets (adoptability).
5. **A1 / A5** — parser rewrite + `cli.py` decomposition (the big engineering lifts).
6. **A4 decision**, then reconcile P3 docs.
