# SystemIntel — Full Workflow (start → end)

The one authoritative map: every phase, every backend module, and the decision
branches at each step. Read top to bottom.

> **Prime directive (holds everywhere below):** the graph and every PASS/FAIL are
> built from facts (source, schema, traces) with deterministic checks. **AI may
> *propose*; a deterministic check always *decides*.** Anything that cannot be
> verified becomes **SKIP** or **UNKNOWN** — never a green checkmark. What the tool
> writes: its own artifacts (graph JSON, reports, page-docs). It does **not** edit
> your source (the one exception, `--mutate`, restores byte-for-byte).

## Commands

| Command | Purpose |
|---|---|
| `scan`  | ingest a repo → build & save the System Graph (+ optional page-docs, HAR) |
| `test`  | generate tests from the graph, run them (API/DB/browser), judge, report |
| `query` | ask about the architecture (graph-grounded, read-only) |
| `agent` | autonomous ReAct agent over the graph (read-only tools) |

---

## PHASE 0 · Page docs → RAG corpus  (`scan --page-docs`, `page_docs.py`)
*Optional but foundational: gives every later phase full per-page context via RAG.*
```
FOR EACH page → write one <page>.md dossier gathering:
   fields (name/type/required) · APIs it calls · DB tables+columns behind it ·
   foreign keys · page↔page & module↔module connectivity · use-cases
Build each dossier in loops (facts first — AI can never overwrite a fact):
   Loop 0 FACTS  → from the graph (exact ground truth)
   IF --page-docs-ai AND external-AI consent:
     Loop 1 ENRICH → AI infers missing fields + writes plain-language use-cases
     Loop 2 AUDIT  → AI flags missing FKs / normalization (schema-grounded)
   ELSE → deterministic heuristics still produce the audit
WRITE per-page .md (for humans) + page_docs.json (machine-readable corpus)
 └─ WHEN --scenarios runs: repo_memory INGESTS page_docs.json (auto-detected in
      ./page_docs, or --page-docs-dir) and MERGES any fields / use-cases the
      page-docs pass surfaced (incl. AI-enriched ones) that the graph-only pass
      missed → scenario generation is genuinely grounded on the page-docs corpus.
    IF no page_docs.json present → repo_memory is graph-derived (same as before).
```

## PHASE 1 · Scan → Parse → Graph  (`file_scanner`, `engine`, `graph_builder`)
```
scan --path <repo>:
 └─ WALK files (file_scanner):
      IF symlink → SKIP (S8 — never read outside the repo)
      IF empty / too big / binary → SKIP (recorded in skipped_files)
      ELSE read
 └─ PARSE each file (engine — regex/pattern based, not full AST):
      IF frontend (.jsx/.tsx/.vue) → pages, fields, fetch/axios calls
      IF backend (.php/.py/.ts/.java/.go…) → routes, controllers, inline SQL
      IF .sql → tables, columns, foreign keys
      IF .har (or --trace) → observed request field-keys + URLs   ← Phase 2 input
      IF a file fails to parse → RECORD parse error (A2) → warn "graph may be INCOMPLETE"
 └─ BUILD graph (graph_builder): Page→API→Controller→Service→Repository→Table→Column
      field→API (SUBMITS_TO):
        IF normalized paths match exactly (base-path aware, Q4b) → link statically
        ELSE IF a HAR trace observed the field→endpoint → link from the trace (Phase 2)
      controller→service→repo→table: CALLS / READS_FROM / WRITES_TO from code
      column→column: REFERENCES (foreign keys)
 └─ WORKFLOW DISCOVERY: BFS finds full Page→API→Table paths = business workflows
 └─ WRITE graph.json   ← artifact (your source is untouched)
```

## PHASE 1.5 · Contract enrichment  (`endpoint_contracts.py`, on by default)
```
FOR EACH write endpoint:
   IF the controller is readable → parse the fields it ACTUALLY reads
      ($request->input/only, $_POST) + its Validator/validate rules
      → attach a real requestContract (fields + type + required + max/in rules)
   ELSE IF --enrich-contracts-ai AND consent → AI proposes fields (verified vs source)
   ELSE → endpoint left without a contract
(Additive: parsed facts are never overridden by AI.)
```

## PHASE 2 · Runtime traces  (`--trace <file.har>`)
```
IF a HAR recording is supplied:
   match POST-body keys → detected fields, URL → endpoint
   → deterministic field→API→column lineage from OBSERVED traffic (not guesses)
   (also harvests real DOM selectors so browser fills stop being best-effort)
```

---

## TEST GENERATION  (from the graph — `test`)
Deterministic generators (each emits evidence + provenance):
```
happy-path            expect 2xx on a valid request
auth boundary         protected route, no token → expect 401   (authSensitive=False)
field black-box       per writable field: required/type/format/length/enum/boundary
contract negatives    one single-fault per validation rule → expect 4xx (+ happy path)
fuzz-robustness       SQLi-shaped payload → must not 5xx  (robustness, NOT a vuln check)
metamorphic           round-trip / additive(+1) / sum-invariant / idempotent
invariants            non-neg money/qty, email, enum/bool, updated_at ≥ created_at
cross-layer           value sent → API → must persist to its DB column (unique per-run value)
IF --openapi   → spec_oracle: contract tests (happy + required-field negatives + documented errors)
IF --field-blackbox → the FULL per-field battery for every writable field
IF --scenarios → the scenario layer (below)
IF --explore   → explorer: AI proposes edge cases; grounding filter rejects invented endpoints
```

## EXECUTION  (`test --base-url <url>` [`--db …`] [`--no-browser`])
```
Set up auth:
   IF --auth-cookie → cookie mode   ELSE IF --auth-token → bearer
   ELSE IF --auth-login-url → POST creds, grab token   ELSE → no auth
Write-guard (S3):
   IF base-url NOT local AND no --allow-nonlocal-writes → block_writes = ON
Offline DB (optional):
   IF --seed-db → db_seeder builds a self-contained SQLite from the schema;
                  fixtures inserts FK-ordered, orphan-free rows (or --no-fixtures)

FOR EACH test:
 ├─ IF METAMORPHIC:
 │     run the paired requests; evaluate the relation (count +1 / field echo /
 │     Σ items / idempotent)
 │       IF a needed write is blocked, or no body / no id → SKIP
 │       IF round-trip read is non-2xx or a sent field is missing → FAIL (data drop)
 │       IF sum has tax/discount present → SKIP (can't verify the formula)
 │       ELSE → PASS/FAIL
 ├─ IF it has BROWSER steps (playwright_runner):
 │     locate fields (field_mapper DOM introspection; vision_gemini fallback if consented),
 │     fill, click submit; browser_field_validation checks per-field validity in the DOM;
 │     ui_audits runs a WCAG audit (separate dimension, never pass/fail)
 │       IF frontend unreachable → SKIP
 │       IF workflow didn't run (0 fields filled or submit never fired) → SKIP (Q6)
 │       ELSE → PASS/FAIL on the functional assertion
 ├─ HTTP assertion (http_runner):
 │       IF verb is a write AND block_writes → SKIP (S3)
 │       IF an absolute URL is off the base-url origin → REFUSE (S7)
 │       IF 401/403, the test is NOT an auth test, and no token was sent → SKIP (Q2)
 │       ELSE → check status class (and record if the 4xx names the injected field — Q5)
 └─ DB assertion (db_runner, if --db):
         IF the API write didn't run → SKIP the cross-layer check
         IF the table/column is unknown in this DB → UNKNOWN (Q8)
         ELSE → check the exact value / row / FK integrity persisted
```

## SCENARIO LAYER  (`--scenarios` — RAG + 3-way verification)
```
repo_memory   → RAG memory from the graph, ENRICHED by the page_docs.json corpus
                when present (pages/fields/use-cases/connections/cross-page)
scenarios     → generate CRUD-lifecycle · use-case-flow · cross-page scenarios
                (deterministic; + AI ones grounded on RAG + contracts if --scenarios-ai)
scenario_runner → run each across UI + API + DB with ${id} binding
                  (create in one step, reuse the id downstream)
   IF non-local host AND no --allow-nonlocal-writes → REFUSE (S3, CRUD is write-heavy)
scenario_reports → per-scenario .md + JSON + visual HTML + FAILURES.md
                   (live response bodies REDACTED by default — S10)
```

## JUDGE → ANALYZE → REPORT
```
Tally PASS / FAIL / SKIPPED / UNKNOWN   (skips & unknowns never count as pass;
                                         pass-rate is over EXECUTED only)
IF any FAIL → failure_analyzer:
   deterministic root cause (500→controller/service, missing row→repository, file:line)
   + optional AI hypothesis (if AI enabled)
WRITE report:  --format json | html | junit   (response bodies redacted unless --include-response-bodies)
APPEND run to history (.systemintel_runs.jsonl) + show Δ vs the previous run (P9)
EXIT non-zero ONLY on real failures (skips/unknowns never fail CI)
```

## DEEP MODE · Mutation  (`--mutate <files>`)
*Measures test QUALITY: how many injected bugs the suite catches.*
```
Recover any leftover backup from a crashed run (S4)
FOR EACH mutant: back up file (atomic) → inject a bug → re-run the suite
   IF the suite now FAILS → mutant KILLED  (good — the tests caught it)
   ELSE → mutant SURVIVED  (a gap in the tests)
   ALWAYS restore the file (on-disk backup + SIGINT/SIGTERM safe)
Report mutation score = killed / total
```

## GRAPH-NATIVE QUERIES  (read-only)
```
query "<question>":
   IF a node name is referenced (e.g. "connection of SalesOrderPage") →
       return exact upstream/downstream EDGES (deterministic)
   ELSE IF graph loaded → GraphRAG retrieves the relevant subgraph → AI answers grounded
   ELSE → keyword fallback
Impact / lineage:  get_upstream / get_downstream
   "what UI fields write to credit_limit?" · "if I change CustomerController, what breaks?"

agent "<task>":
   loop  Thought → Action (QUERY_GRAPH | GET_NODE_LINKS | READ_FILE) → Observation
   repeat until enough context → FINAL_ANSWER
   (read-only tools only — never edits or writes code)
```

---

## Safety guardrails (always on)
- **S3** writes blocked against non-local targets (incl. metamorphic + scenario paths) unless `--allow-nonlocal-writes`
- **S5** repo content / screenshots not sent to an external LLM without `SYSTEMINTEL_AI_ALLOW_EXTERNAL=1` (default provider is local)
- **S7** off-origin absolute URLs refused; redirects not followed
- **S8** symlinked files not read; scan API path-checked (realpath+commonpath), binds localhost
- **S9** SQL identifiers sanitized · **S10** response bodies redacted from reports by default
- **`--mutate`** edits source only temporarily, with crash-safe on-disk backup + restore

## Module index (backend/)
| Module | Role |
|---|---|
| `file_scanner` | repo walk + noise/symlink filtering |
| `engine` | parse code/SQL/HAR → analysis (regex-based); records parse errors |
| `graph_builder` | analysis → System Graph, workflow BFS, lineage, cross-layer oracle |
| `graph_rag` | GraphRAG retrieval (semantic if sentence-transformers installed, else lexical) |
| `page_docs` / `repo_memory` | Phase 0 page dossiers → RAG memory/index |
| `endpoint_contracts` | Phase 1.5 request-contract enrichment |
| `field_blackbox` | per-field black-box battery + contract negatives + fuzz-robustness |
| `metamorphic` | metamorphic relation generator **+ executor** |
| `injection_oracle` | differential SQLi + reflected-XSS oracle |
| `authz_oracle` | IDOR / privilege role-differential oracle |
| `invariants` | data-correctness invariants (schema + guards) |
| `spec_oracle` | OpenAPI/Swagger → contract tests |
| `explorer` | AI edge-case proposals (grounding-filtered) |
| `http_runner` | API assertions (status class, off-origin guard, auth-skip, attribution) |
| `db_runner` | DB assertions (sqlite/pg/mysql; injection-safe; invariant/cross-layer/FK) |
| `db_seeder` / `fixtures` | self-contained SQLite from schema + FK-ordered orphan-free rows |
| `playwright_runner` | browser nav/fill/submit, workflow post-condition, a11y |
| `field_mapper` / `vision_gemini` | DOM field→selector map + vision fallback |
| `browser_field_validation` | per-field validation checks in the browser |
| `ui_audits` | WCAG accessibility audit |
| `auth` | token / login / cookie session manager |
| `mutation` | inject bugs, score the suite (crash-safe) |
| `scenario_contracts` / `scenarios` / `scenario_runner` / `scenario_reports` | RAG scenarios + 3-way UI+API+DB run + reports |
| `failure_analyzer` | deterministic root cause (+ optional AI hypothesis) |
| `ai_provider` | optional LLM gateway (local default; external needs consent) |
| `agent` | grounded ReAct agent over the graph (read-only) |
| `reporters` | JUnit XML + CI exit codes |
| `main` | optional FastAPI wrapper (scan/graph) |
