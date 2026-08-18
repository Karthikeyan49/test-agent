# SystemIntel — Session Context & Handoff

A record of what this tool is, what was built, and how to run it. SystemIntel is a
terminal-native, **deterministic** code-analysis + testing engine: it reads a repo
once, turns it into a system graph, generates evidence-based tests across **API +
Database + Browser**, runs them against the live app, and judges every one with a
hard assertion — never an LLM opinion. AI is optional and only ever *proposes*
scenarios or *explains* failures; it never decides pass/fail.

## Repo layout
```
testing-agent/
├── cli.py                     # entry point: scan / test / query / agent
├── backend/                   # the engine (all deterministic core)
│   ├── engine.py              # repo + SQL parsing → analysis (PHP/React/Django/Flask/
│   │                          #   FastAPI/NestJS/Spring/Rails/Go; DEFAULT/AUTO_INCREMENT)
│   ├── graph_builder.py       # analysis → system graph + cross_layer_oracles()
│   ├── file_scanner.py        # repo walk (skips minified/build output)
│   ├── http_runner.py         # API assertions (status class: 4xx / !5xx)
│   ├── db_runner.py           # DB assertions (sqlite/mysql/postgres; injection-safe)
│   ├── playwright_runner.py   # browser: nav, form-fill, render, WCAG, auth-redirect→SKIP
│   ├── field_mapper.py        # DOM-introspection field→selector (+ Gemini vision hook)
│   ├── ai_provider.py         # Groq/OpenAI-compatible provider (optional)
│   ├── agent.py               # ReAct agent over the graph
│   ├── failure_analyzer.py    # deterministic root-cause (+ optional AI enrich)
│   │
│   │   # ── generators (each ships a self-test: `python3 backend/<mod>.py`) ──
│   ├── field_blackbox.py      # per-field battery: required/type/format/length/enum/
│   │                          #   boundary/injection (schema-driven)
│   ├── invariants.py          # data-correctness: non-neg money/qty, email, enum/bool,
│   │                          #   updated_at ≥ created_at
│   ├── metamorphic.py         # idempotency / round-trip / additive / sum-invariant
│   ├── mutation.py            # test-quality KPI (injects bugs, counts kills)
│   ├── fixtures.py            # FK-ordered seed rows (orphan-free, DEFAULT on)
│   ├── db_seeder.py           # self-contained SQLite from the schema
│   ├── spec_oracle.py         # OpenAPI/Swagger → contract tests
│   ├── explorer.py            # AI edge-case proposals (graph-grounded)
│   ├── auth.py                # token / login session manager
│   ├── reporters.py           # JUnit XML + exit codes
│   ├── ui_audits.py           # WCAG accessibility audit
│   ├── vision_gemini.py       # Gemini vision (form screenshot → field map)
│   ├── browser_field_validation.py  # per-field validation IN the browser (native/aria/msg)
│   │
│   │   # ── scenario layer (RAG + 3-way UI+API+DB) ──
│   ├── scenario_contracts.py  # shared shapes: Scenario / ScenarioResult / RepoMemory
│   ├── repo_memory.py         # RAG memory: pages/fields/use-cases/connections/cross-page
│   ├── scenarios.py           # CRUD-lifecycle + use-case-flow + cross-page + AI scenarios
│   ├── scenario_runner.py     # runs a scenario across UI+API+DB with ${id} binding
│   └── scenario_reports.py    # per-scenario .md + JSON + visual HTML + FAILURES.md
├── test-ecosudar/             # the test target (a real PHP+React ERP) + deploy/ stack
├── AUTONOMY_PLAN.md           # the roadmap + build status
├── SYSTEMINTEL_CONTEXT.md     # original design context
└── run_ecosudar.sh / run_groq.sh / check_groq.py   # runners (keys read from env)
```

## The phases (how to use it)
| Phase | Command / flag | Uses AI? |
|---|---|---|
| **0** Page docs (planned) | per-page `.md` + data-model audit → RAG memory | yes |
| **1** Build the map | `python3 cli.py scan --path test-ecosudar --output graph.json` | no |
| **1.5** Enrich contracts | reads each controller for its REAL request fields + validation rules (on by default; `--no-enrich-contracts`, `--enrich-contracts-ai`) | opt (fallback) |
| **2** Preview tests | `python3 cli.py test --graph graph.json --no-browser` | no |
| **3** Start target | `cd test-ecosudar/deploy && docker compose up -d` | no |
| **4** Run tests | `python3 cli.py test --graph graph.json --base-url http://localhost:8080 --db mysql --seed-db` | no |
| **5** Report | `--format junit|html|json` + exit codes | no |
| **6** Deep modes | `--field-blackbox` · `--scenarios [--scenarios-ai]` · `--mutate FILES` · `--explore` | some |

## Test-ecosudar stack (the live target)
- **Stack**: `test-ecosudar/deploy/docker-compose.yml` → MariaDB 11 (dump auto-imported) + PHP 8.2/Apache.
- **URLs**: API `http://localhost:8080`, DB `127.0.0.1:3307` (db/`ecosudar`/`ecosudar`), frontend `cd eco-sudar-control && npx vite preview --port 5173`.
- **Boot note**: the app requires `strlen(JWT_SECRET) ≥ 32`; set a 64-hex secret in `deploy/.env` (see `.env.example`).
- **Graph**: ~1,425 nodes, 354 endpoints, 81 tables, 109 FKs.

## What a live run proved (this session)
- **API+DB suite**: 1,491 tests, ~1,464 executed live in ~27s (401s on protected endpoints are honest, not bugs — supply a token).
- **Per-field black-box**: 4,311 tests across 131 endpoints; found candidate over-length/validation gaps.
- **Invariants**: 144, zero false positives on valid data, caught a planted negative value.
- **Mutation**: 3/8 killed on a live PHP controller (source restored byte-for-byte).
- **UI black-box**: forms drive real Chromium; caught a serious WCAG issue; auth-gated forms SKIP honestly.
- **Browser field-validation**: caught a real frontend gap (pincode accepts non-numeric).
- **Scenarios**: 166 generated (CRUD + use-case + cross-page); 3-way runner executed all across UI+API+DB and wrote all 4 reports.

## Honest limits (the remaining work, not missing architecture)
- ✅ **Static endpoint→request-contract mapping — addressed (Phase 1.5).** `backend/endpoint_contracts.py` reads each controller for the fields it actually reads (`$request->input`/`only`, `$_POST`) + its `Validator::make`/`validate([...])` rules, and annotates every write endpoint with a real `requestContract` (fields + type + required + `max`/`in` rules). On the target: **102 contracts parsed deterministically** — `POST /queries` now correctly resolves to `{name, email, message}` (email + max:100), not the queries-table columns; `PUT /orders/{id}/status` recovers `order_status` as an enum. Additive (never overrides parsed facts); AI is an optional, source-verified fallback only where parsing finds nothing. `scenarios.py` (CRUD + use-case flows) now builds request bodies + typed field values from these contracts. Remaining: **HAR request bodies** would still add real captured journeys + observed field→API links.
- Role-appropriate auth tokens needed for full-green live runs.
- shadcn custom components limit browser field coverage (~13–19 of 278 fields map).
- Business-logic oracle beyond metamorphic is the AI-hard frontier.

## SECURITY — before pushing
API keys were **removed** from `run_groq.sh`, `run_ecosudar.sh`, `check_groq.py` (now read from env).
All `.env` files, tokens, `node_modules/`, `dist/`, and DB volumes are **git-ignored**.
**Rotate the previously-used Groq and Gemini keys** — they appeared in earlier plaintext and should be considered exposed.
The DB dump under `test-ecosudar/database/` contains seed data (incl. hashed credentials) — review before making the repo public.
