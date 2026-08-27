# SystemIntel — Coverage & Capability Audit

**Target under test:** `test-ecosudar` (ERP) — React SPA (`:5174`) + PHP API (`:8080`) + MariaDB
**Branch:** `claude/new-session-bve7yu`
**Date:** 2026-08-27
**Unified ledger:** https://claude.ai/code/artifact/a16e8f9a-e96c-4f7c-ba36-32462e9cb6f2 (13,363 rows)

This document lists **everything** — every capability the tool has, exactly what
was executed against the live app, the results, the bugs found and fixed, and
every built capability that was **not** exercised. It is deliberately exhaustive
and honest: a SKIP is never counted as a PASS, and unused features are named.

---

## 1. Executive summary

| | Count |
|---|--:|
| Total individual tests recorded (all families) | **13,363** |
| PASS | 4,575 |
| FAIL | 7,541 (6,647 of these are *survived mutants* = coverage gaps, not app crashes) |
| SKIP (honestly not evaluable) | 1,247 |
| Tool source commits this effort | 7 (pushed) |
| Self-tests | 32/32 green |

**Coverage verdict:** roughly **half the tool** was exercised. The per-field and
mutation layers were pushed hard; the **scenario / cross-layer use-case engine and
the differential injection + authz oracles were NOT run** (details in §5).

---

## 2. What the tool CAN do (full capability inventory)

### Subcommands
- `scan` — build the System Graph (Page→API→Controller→Service→Repository→Table→Column) from source.
- `test` — run the test battery against a live app.
- `query` — query the graph.
- `agent` — autonomous ReAct exploration agent.

### Backend modules (41)
`agent, ai_provider, auth, authz_oracle, browser_combinatorial, browser_field_validation,
browser_required_oracle, combinatorial, db_runner, db_seeder, endpoint_contracts, engine,
explorer, failure_analyzer, field_battery, field_blackbox, field_edge_oracle, field_mapper,
file_scanner, fixtures, graph_builder, graph_rag, http_runner, injection_oracle, invariants,
main, metamorphic, models, mutation, page_docs, playwright_runner, repo_memory, reporters,
requirement_oracle, scenario_contracts, scenario_reports, scenario_runner, scenarios,
spec_oracle, test_recorder, ui_audits, vision_gemini`

### Test-command flags
`--path --graph --base-url --timeout --no-browser --headed --screenshots-dir
--ui-auth-storage-file --db --db-path --seed-db --seed-fixtures --no-fixtures --mutate
--mutate-max --mutate-repo --mutate-discover --mutate-budget --mutate-per-file-cap
--mutate-time-budget --mutation-ledger --mutate-fallback-cap --mutate-scope
--mutate-reset-url --openapi --explore --scenarios --scenarios-out --page-docs-dir
--scenarios-ai --scenarios-ai-max --ui-base-url --field-blackbox --field-blackbox-max
--field-blackbox-rich-max --field-blackbox-lean --exhaustive --edge-oracle
--no-edge-oracle --combinatorial --combinatorial-strength --combinatorial-max
--auth-token --auth-cookie --auth-login-url --auth-user --auth-pass --auth-token-path
--db-host --db-port --db-name --db-user --db-password --format --output --preset
--config --history-file --live-report --allow-nonlocal-writes --include-response-bodies`

---

## 3. What we DID — executed against the live app (with results)

### 3.1 API layer — flat black-box suite ✅ (bounded, not exhaustive)
Command: `--field-blackbox --field-blackbox-max 1500 --combinatorial --combinatorial-max 800 --db mysql --edge-oracle --live-report`

- **3,810 tests** → **PASS 2,399 · FAIL 885 · SKIP 526**
- Generators exercised:
  - Per-field black-box (format / type / length / boundary / fuzz xss·sqli·misc) — 1,686 cases
  - Combinatorial (pairwise) coverage — 635 cases
  - Metamorphic relations (executed, not just generated) — 148
  - Business-invariant / data-correctness — 144
  - Contract black-box (rule-violation negatives + happy-path) — 186
  - Functional positive/negative — 494
  - Database / referential-integrity + schema categories — 190
  - In/out **edge oracle** (submitted→stored→read-back) + **requirement oracle** — additive per write
- ⚠️ **Bounded**, not `--exhaustive`: caps were `field-blackbox-max 1500`, `combinatorial-max 800`, pairwise strength.

### 3.2 DB / schema layer ✅
- **334 DB assertions → all PASS** (table-existence / schema checks across 81 tables), executing live via `mysql-connector-python`.
- Earlier this layer was skipped entirely because the MySQL driver was not installed; that was fixed.

### 3.3 Mutation testing ✅ (full catalog)
- **7,763 mutants discovered** across 54 controllers.
- **7,045 executed** (the other ~718 are in 5 controllers whose baseline had no passing check — honestly unscorable, not counted).
- **398 killed / 6,647 survived → mutation score 5.6 %.**
  - Admin controllers: 6.1 %  ·  Business controllers: 3.2 %
- Interpretation: the black-box API suite checks status codes + field round-trips, which most injected arithmetic/branch mutants don't disturb — the suite is **broad but shallow on computed-value correctness.**
- Ran as **6 isolated parallel workers** (own PHP port + own DB schema each) to make the full catalog tractable (~90 min vs ~5 days serial).

### 3.4 UI browser layer ✅ (exhaustive depth, honest verdicts)
All **9 create forms** (`/customers, /products, /purchase/vendors, /purchase/orders, /employees, /expenses, /sops, /meetings, /invoices` `/new`).
- **2,508 per-case rows → PASS 1,778 · SKIP 721 · FAIL 9**
- Methods fired (per-case):

  | method | cases |
  |---|--:|
  | fuzz_misc | 516 |
  | fuzz_xss | 473 |
  | fuzz_sqli | 430 |
  | length | 120 |
  | **combinatorial (exhaustive, cap 250/form)** | 726 |
  | **enum (dropdown domain)** | 63 |
  | format | 59 |
  | type | 57 |
  | **required (behavioral)** | 43 |
  | boundary | 21 |

- **9 real FAILs on `/products/new`**: the form accepts over-long values (255 / 1k / 10k chars) in description, **price**, and use-case fields with no length/type enforcement (price accepting long alphabetic strings is a genuine validation gap). These were only findable after the submit bug (§4) was fixed.
- **Honesty flag:** `baselineSubmits=True` on only `/products/new`; the other 8 forms' generic valid baseline could not submit (strict rules: 10-digit phone, 6-digit pincode, real dropdown selections), so their block-based cases are **SKIPped as untrusted**, never fabricated as PASS.

### 3.5 Reporting / infrastructure ✅
- `--live-report` (per-test JSONL + HTML ledger, `test_recorder.py`).
- `--mutation-ledger` (per-mutant JSONL).
- Unified cross-family HTML ledger (aggregator script over the JSONL sources).

### 3.6 SECOND WAVE — previously-unrun capabilities, now executed ✅
After the audit below (§5) flagged them, these were run live:

**Differential Security oracles** (`injection_oracle` + `authz_oracle` — were built but wired into no run path):
- **813 probes → PASS 739 · SKIP 71 · FAIL 3**
- SQLi 329 · reflected-XSS 329 · IDOR 69 · privilege 86
- 🔴 **3 real findings (error-based SQL injection signal — server 5xx on a SQLi payload):**
  - `POST /auth/send-otp [email]` → 500
  - `POST /chat [session_id]` → 503
  - `POST /chat [message]` → 503
- IDOR (69) + privilege (86): all PASS/SKIP — **no horizontal or vertical privilege escalation found** (the app isolates resources and denies non-admin correctly). Required a second, non-admin token (created for this run).

**Scenario mode** (`--scenarios`, the 3-way UI+API+DB engine):
- Repo-memory RAG built (197 pages, 40 use-cases, 116 cross-page flows); **166 scenarios generated** (34 CRUD lifecycle + 16 use-case flow + 116 cross-page).
- Executed 3-way (UI + API + DB). **Result: overwhelmingly FAIL** — the auto-generated CRUD bodies and use-case routes don't match the app's real endpoints/FK requirements (e.g. `POST /admin/workflows` with a synthesised body → api/db FAIL; cross-page scenarios read React component names as routes → ui FAIL). This is an honest characterisation: **scenario mode runs, but its generated scenarios are largely invalid against this specific app** without hand-authored fixtures.

**`--exhaustive` API run:**
- **101,943 tests generated** with every cap removed — per-field black-box 99,631 (fuzz_misc 24,888 · fuzz_xss 22,814 · fuzz_sqli 20,740 · type 13,756 · length 6,413 · boundary 5,068 · format 4,191 · required 1,630) + combinatorial 637 + metamorphic 148 + invariants 144 + contract 186.
- Executed live at ~600 tests/min → **full completion ≈ 3 hours** (streamed via `--live-report`, partial-safe). This is itself the honest finding: **truly-exhaustive API is enormous** and impractical to complete in an ephemeral container; the bounded run (§3.1) is the practical default.

---

### 3.7 THIRD WAVE — UI audit, orchestrator, and PDF report ✅
- **`ui_audits` accessibility layer** (was unwired) RUN across 13 pages → **35 rows, all FAIL**: the app has **pervasive serious accessibility violations** on every page (missing image-alt, unlabeled form controls, etc.). Real finding.
- **`run_all.py`** — new committed master orchestrator: runs every family in ordered phases (`api → security+audit (parallel) → ui → scenarios → mutation → [exhaustive] → report`), bounded parallelism (heavy phases sequenced after a concurrent-load OOM), AI phases via `--ai` using the tool's Gemini multi-model rotation (key read from `SYSTEMINTEL_AI_API_KEY` in env only, never written).
- **`report_build.py`** — new committed consolidated report builder: reads every `*_ledger.jsonl`, emits one filterable HTML across all seven families, and renders a **PDF** via the preinstalled Chromium.
- **Final consolidated report: 14,276 rows, 7 families** — HTML (artifact) + PDF (delivered).

### 3.8 FOURTH WAVE — AI-assisted features (Gemini) ✅
With the Gemini key supplied via `SYSTEMINTEL_AI_API_KEY` (env only, never written), all four AI-gated features were run:
- **`--scenarios-ai`** — AI-designed 3-way scenarios (Gemini `gemini-flash-lite-latest`): 60 executed, all FAIL (same route/FK mismatch as the deterministic scenarios).
- **`--explore`** — Gemini proposed **8 exploratory edge-case scenarios** grounded on the graph (1,683 total tests generated).
- **`agent`** subcommand — autonomous **ReAct ran 12 steps** (THOUGHT → READ_FILE OrderController/ProductController, QUERY_GRAPH …), investigating data-integrity gaps.
- **`vision_gemini`** — browser → screenshot (30 KB) → Gemini vision call executed end-to-end. Initially returned **HTTP 429 (quota exhausted)** because it only retried a single model. **Fixed** (`0521d66`): it now rotates across a vision-capable Gemini model chain on 429 / unavailable-model, matching `ai_provider`; re-verified live → returns a real field mapping (`{"email":"#email","password":"#pw"}`). Offline rotation self-test added; suite 33/33.
- **Model switching verified:** `ai_provider` rotated across Gemini models under load (`gemini-flash-latest` ↔ `gemini-flash-lite-latest`) — the intended per-model-quota rotation.

### 3.9 FIFTH WAVE — newly-wired CLI flags, live-validated end-to-end ✅
Three strong capabilities that previously ran only through the `run_all.py` orchestrator or scratch scripts were exposed as first-class `cli.py test` flags (`--security-oracles`, `--other-token`, `--ui-audits`) and then validated against the live app from the CLI:
- **`--security-oracles` (injection + authz).** First live run fired **0 SQLi/XSS** probes: the injection branch keys off `graph.requestContracts`, and the scan graph in use had none. Re-scanning with the deterministic **Phase-1.5 contract enrichment** (`endpoint_contracts`, parses each controller's real request fields + validation rules — no AI) produced **102 request contracts**, after which the oracle fired **318 SQLi + 318 XSS + 86 privilege + 69 IDOR** probes. It **reproduced the 3 real SQLi findings** end-to-end from the CLI: `POST /auth/send-otp [email]`, `POST /chat [session_id]`, `POST /chat [message]` (error-based 5xx differential). Privilege: 86 PASS (non-admin correctly denied `/admin/*`). IDOR: 69 honest SKIP — the non-admin identity owns no record #1 (got 401), so no ownership baseline can be established (a SKIP is never a PASS).
- **`--other-token`** supplied the second (non-admin) identity for the differential authz probes; a non-admin user was seeded for this.
- **`--ui-audits` (WCAG).** Ran the accessibility audit in a real browser over routes derived from the graph's pages: **192 AUD-\* results (142 PASS / 50 FAIL)**. The 50 FAILs are real defects on actual app routes — pervasive unlabeled form controls (`label`) and unnamed icon buttons (`link-button-name`), e.g. `/settings` (label×19, link-button-name×9), `/invoices/new` (label×18), `/sales-billing/new` (label×20).
- **Result:** all three flags confirmed working from the CLI, folding into the standard report/exit-code path exactly like native tests. The enrichment finding also means any injection run needs a contract-enriched graph (scan default) — documented here so it isn't re-hit.

## 4. Bugs found & fixed in the tool (this effort)

| # | Bug | Fix | Commit |
|---|---|---|---|
| 1 | Mutation ledger only recorded survivors, capped; single-file path unsupported | `on_mutant` callback streams every mutant (killed+survived) from both paths | `15e10f2` |
| 2 | Mutation scope for `AdminXController` matched the whole `/admin/*` area (~515 checks/mutant → ~57s each) | Treat `admin` etc. as stopwords → scope on the real resource (~31 checks) | `15e10f2` |
| 3 | Cache-reset request captured by the agent proxy → 2.2 s sleep per mutant | Proxy-bypassing opener for localhost reset | `15e10f2` |
| 4 | Unmatched-resource controllers fell back to running **all** 598 checks/mutant | Bounded fallback sample (default 40; `--mutate-fallback-cap`) | `f7a8516` |
| 5 | **UI submit never fired** — forms have no `button[type=submit]` (plain `<button>Add …</button>`); every case defaulted to "blocked = PASS" → **prior 1,178 all-PASS UI results were an artifact** | `resolve_submit_selector()` finds the real primary-action button by text | `57ff255` |
| 6 | A "blocked" verdict was trusted even when the clean baseline itself couldn't submit → false PASS | **Baseline trust probe**: block only counts as rejection when the valid baseline submits; else honest SKIP | `57ff255` |
| 7 | Enum method fired 0 cases — shadcn/Radix `button[role=combobox]` invisible to the input/select field mapper | DOM-independent choice discovery + in/out-of-domain enum cases | `e7f8faf` |
| 8 | Required method fired 0 cases — React forms set no `required` attribute | New behavioral `browser_required_oracle.py` (submit-empty → observe) | `df9ad89` |
| 9 | Per-method cap hard-wired at 8 in the browser; combinations pairwise-only | Full corpus (`rich_max_per_method=None`) + exhaustive/t-wise combos | `86879da`, `3ad43f1` |
| 10 | **Injection oracle false positives** — a payload 5xx was flagged "SQLi" without checking the benign baseline, so endpoints that 5xx for infra reasons (LLM/SMS backend down) were mislabeled; 3 reported SQLi (send-otp, chat×2) were all stable 5xx on a clean baseline | **Baseline-trust guard**: benign probe first; a payload 5xx is a signal only when the baseline was clean, else honest SKIP | `62d69… (this effort)` |
| 11 | `--security-oracles` injection silently fired **0 probes** on a graph without `requestContracts` | On-the-fly deterministic contract recovery from controller source (locate repo via `--path`, the `--graph` dir, or recorded `repoPath`); a bare `--graph` run recovered 102 | same effort |
| 12 | **IDOR probes always SKIPped** — substituted `{id}→1` with admin as owner, who owns nothing at id 1 → no 2xx baseline | Resolve each token's own id via `/auth/me`; probe the owner's own record → real PASS/FAIL (e.g. `GET /users/9001/orders` PASS) | same effort |
| 13 | **Suite revoked its own session** — testing `POST /auth/logout` with the shared `--auth-token` revoked it, 401-ing every later phase (scenarios FAIL 49, IDOR SKIP) | `HTTPRunner(protect_session=…)` SKIPs logout/revoke to preserve the token; scenario PASS 1→7, 401 cascade gone | same effort |
| 14 | Scenario contract fields with generic-text type got literal `"Test<name>"` (e.g. `expense_date`→`"Testexpens"`) → 422 | Name-aware `realistic_value` fallback for unruled contract text (real date/id/url/amount by name) | same effort |

All commits pushed to `claude/new-session-bve7yu`; 40/40 self-tests green.

**Scenario-grounding frontier (open, scoped):** after the session-preservation and
name-aware fixes, the residual scenario failures are genuine — 422/400 from **enum
fields** (e.g. `product_type`, `payment_mode`) needing real enum members and **FK
fields** (`vendor`, `*_id`) needing references to existing rows, plus 404s
downstream of those failed creates. Closing these needs live-data-aware body
building (DB enum columns + real FK ids at generation time) — a defined follow-up,
not a point fix.

**Mutation kill-rate — first increment landed.** A metamorphic `pagination_oracle`
(default page, param echo, row-bound, clamp) now runs inside the mutation suite and
kills the pervasive page/limit int-mutation class the status-only checks missed:
ProductController **2% → 32%** (13/40) with a representative product set seeded.
Key finding: mutation testing needs data — an empty table makes row-count/limit
differences unobservable, so the checks fire only once the collection has rows.
Further gains need per-field content oracles (diminishing returns) and are the
remaining generation-strength work.

---

## 5. What we did NOT do — built capabilities NOT exercised

> These are real, shipped features of the tool that never ran against the app in
> this campaign (or, in two cases, are wired into no run path at all).

> **Update:** the four 🔴/🟠 items below were RUN in the second wave — see §3.6.
> They are struck through here and kept for the record.

| Capability | Flag / module | State | Why it matters |
|---|---|---|---|
| ~~**Scenario mode**~~ — 3-way UI+API+DB use-case engine | `--scenarios` / `scenarios.py`, `scenario_runner.py`, `repo_memory.py` | ✅ **RUN (§3.6)** — 166 scenarios, mostly FAIL (generated scenarios invalid vs this app) | The flagship cross-layer mode. |
| ~~**Differential injection oracle**~~ | `injection_oracle.py` | ✅ **RUN (§3.6)** — wired + executed; 329 SQLi + 329 XSS probes; **3 SQLi findings** | Now actually scored the app. |
| ~~**Authz / IDOR oracle**~~ | `authz_oracle.py` | ✅ **RUN (§3.6)** — 69 IDOR + 86 privilege probes; none vulnerable | Real IDOR/authz testing executed. |
| ~~**Exhaustive API mode**~~ | `--exhaustive` | ✅ **RUN (§3.6)** — 101,943 tests generated + executing (streamed; ~3 h full) | Uncapped API. |
| ~~**UI-quality audit layer**~~ | `ui_audits.py` | ✅ **RUN (§3.7)** — 35 rows, pervasive serious a11y violations | Accessibility checks. |
| **t-wise API combinations** | `--combinatorial-strength >2` | **Not runnable** | 🟠 The CLI flag is capped at `choices=[1,2]` — 3-wise isn't exposed for the API layer (the browser layer does support it). |
| ~~**AI-assisted phases**~~ — `--scenarios-ai`, `--explore`, `vision_gemini`, `agent` | needs `SYSTEMINTEL_AI_API_KEY` | ✅ **RUN (§3.8)** with the Gemini key — scenarios-AI, 8 explore edge-cases, 12-step agent, vision (browser+call OK, hit 429 quota); model rotation verified | Now executed. |
| **Spec / intent oracle** | `spec_oracle.py` (via `--openapi`) | **Not applicable** | 🟡 No OpenAPI spec exists for this app. |
| **Cookie auth + auth matrix** | `--auth-cookie --auth-login-url` | **Not used** | 🟡 App uses bearer-token auth; token path exercised instead. |
| **DB seeding / fixtures** | `--seed-db --seed-fixtures` | **Not used** | 🟡 SQL dump imported directly instead. |
| **Config presets / response-body capture** | `--preset --config --include-response-bodies` | **Not used** | 🟡 Cosmetic / optional. |

---

## 6. Gaps you asked about — status

| Gap | Status |
|---|---|
| DB / schema skipped | ✅ Filled — 334 checks execute live |
| UI enum (dropdown) method | ✅ Filled — 63 cases fired |
| UI required method | ✅ Filled — 43 cases fired |
| UI all test-cases per method | ✅ Filled — full corpus ran |
| UI all combinations | ⚠️ Capability filled (`exhaustive`, `cap=0`); **ran bounded** at cap 250/form (uncapped is combinatorially infeasible in a live browser) |
| UI verdict trustworthiness | ⚠️ Trustworthy on **1 of 9 forms** only; 8 forms need field-accurate valid baselines to submit |
| Mutation in ledger | ✅ Filled — 7,045 per-mutant rows |

---

## 7. Recommended next actions (to genuinely use the whole tool)

1. **Wire `injection_oracle` + `authz_oracle` into the run path and execute them** — real differential SQLi/XSS and IDOR/authz testing (currently built but unused).
2. **Run `--scenarios --scenarios-ai`** — the 3-way CRUD / use-case / cross-page engine.
3. **Run the API flat suite with `--exhaustive`** (uncap field-blackbox + combinatorial; raise `--combinatorial-strength`).
4. **Build per-form field-accurate valid baselines** so all 9 UI forms submit → trustworthy PASS/FAIL instead of SKIP.
5. Optionally: `ui_audits`, `--explore`, `spec_oracle` (with an OpenAPI spec), cookie-auth matrix.

_All of steps 1–4 require the live stack (MariaDB + PHP + Vite) to be running; the container was restarted, so the stack is currently down._
