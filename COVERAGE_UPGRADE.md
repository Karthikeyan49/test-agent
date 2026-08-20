# SystemIntel — Coverage-Depth Upgrade

*Closes the six test-depth gaps raised against the tool: per-field completeness,
cross-page/requirement checking, RAG→AI grounding, UI breadth, mutation scale, and
combinatorial coverage. Every item below is code + a deterministic self-test in the
pytest harness (29/29 green) and is pushed on `claude/new-session-bve7yu`.*

> **Prime directive still holds:** AI may *propose*; a deterministic check always
> *decides*. A SKIP is never a PASS. A missing evidence leg is a SKIP, not a green
> checkmark. Nothing here weakens that.

---

## The six gaps and what closed them

| # | Gap (as raised) | What was built | Status |
|---|---|---|---|
| 1 | Full field battery only opt-in, schema-only; in/out edges not compared | `field_edge_oracle.py` + `field_coverage_report()` | built · self-tested · wired · **ran live** |
| 2 | Cross-page "displays correctly **per requirements**" unverifiable | `requirement_oracle.py` | built · self-tested · module available (not auto-invoked in the default runner yet) |
| 3 | Page-docs RAG never actually reached the AI; no offline story | `graph_rag` page-docs ingest + `ai_provider.propose_scenarios_with_rag()` (offline-rag fallback) | built · self-tested · offline path exercised (no live LLM reachable here) |
| 4 | UI black-box not run on all pages | (no code gap) needs the React SPA served | **not run** — still gated on serving the SPA (`--no-browser` was used) |
| 5 | "Only 8 mutants" on a large repo | `mutation.py` repo-wide discovery + stratified budget | built · self-tested · **census ran live** |
| 6 | Too few tests; possibilities not computed | `combinatorial.py` pairwise generation | built · self-tested · wired · **ran live** |

Plus two real bugs fixed along the way (see *Bugs fixed* below).

---

## 1 · Per-field completeness + in/out edge comparison

**`backend/field_edge_oracle.py` (new).** For a field the graph knows, it compares the
value across the System Graph's in/out edges:

```
value SUBMITTED  →  value STORED (DB)  →  value READ BACK (read endpoint / cross-page)
 (SUBMITS_TO)        (WRITES_TO col)       (READS / cross-page)
```

- consistent across every present leg → **PASS**
- a provable corruption → **FAIL** with the concrete before/after, classified as
  `truncation` / `silent_drop` / `encoding_change` / `changed`
- a leg with no evidence → **SKIP** (never a PASS). Benign coercions
  (`"5"`≡`5`, `True`≡`1`) are treated as consistent.

**`field_coverage_report()` in `field_blackbox.py` (new).** The honest denominator:
enumerates the **union** of DB writable columns + request-contract fields + page-docs
UI fields, and marks each **covered / uncovered with a reason**. Answers "did you test
every field, and which weren't, and why?".
Live on the ecosudar graph: **451 / 622 fields exercised (72%)**, 171 uncovered surfaced.

## 2 · Requirement (intent) oracle

**`backend/requirement_oracle.py` (new).** Judges the *machine-checkable subset* of
requirements (page-docs use-cases and/or an OpenAPI response schema) against observed
evidence: `present` / `equals` / `min` / `max` / `in` / `count` / `status`.
- checkable + satisfied → **PASS**; checkable + violated → **FAIL** (expected vs actual)
- a vague NL requirement that cannot be grounded → **SKIP** (`"requirement not
  machine-checkable"`) — never a fabricated PASS.
Field matching is case/separator-insensitive (`orderId` ≡ `order_id`).

## 3 · Page-docs RAG → AI (with an honest offline path)

- **`graph_rag.py`** now ingests the page-docs corpus as first-class `PageDoc`
  documents (name / route / form fields / use-cases), so retrieval is grounded on the
  page-wise `.md` knowledge, not only the graph. `retrieve()` / `retrieve_context()`
  take `page_docs`.
- **`ai_provider.propose_scenarios_with_rag()`** sends the retrieved RAG context to a
  live model **when one is reachable and S5 egress is consented**; otherwise it returns
  a deterministic **offline-rag** result tagged `ai=False, source="offline-rag"` — so it
  is never mistaken for "the model said". S5 egress policy is untouched.

## 4 · UI black-box breadth — *now run live*

The React SPA (`test-ecosudar/eco-sudar-control`, Vite) was `npm install`ed and served on
`:5174`, pointed at the live PHP API. Using the tool's own `PlaywrightRunner` + `ui_audits`,
the browser **drove the real login form** (fill + submit → authenticated, left `/login`) and
then rendered + audited protected pages live: `/dashboard`, `/products`, `/admin/employees`,
`/admin/invoices`, `/orders` — each with field/button/link detection and a WCAG accessibility
audit. Two fixes made this work:
- **`playwright_runner`**: launch Chromium via `PLAYWRIGHT_CHROMIUM_PATH` / a conventional
  `/opt/pw-browsers/chromium` symlink when the pinned Playwright browser build isn't present
  (portability fix for pre-provisioned images).
- **CORS** (test-app config, not tool code): the API's `CORS_ORIGIN` (`.env`) was set to the
  Vite origin so the browser could complete the login round-trip.

Still bounded: data-heavy pages depend on the API returning rows, and coverage across *every*
page/field is a breadth exercise — but the browser path is proven end-to-end on real pages.

**Full breadth run (`scripts/ui_breadth.py`).** The whole SPA was then swept: all **65
concrete routes** (of 91 declared; param/glob routes excluded) driven after a single login.
Result: **65/65 rendered, 0 bounced to login, 0 errors**; **51 pages carried forms**;
**209 controls** detected and **404 per-field UI black-box cases** run live (oversize /
wrong-type → does the frontend signal validation?). **170 fields signalled validation, 92
did not** (the no-signal fields are mostly search/filter boxes — candidate findings for
triage, not automatic bugs). WCAG audit ran on every page. Reproducible:

```
python3 scripts/ui_breadth.py --ui-base-url http://127.0.0.1:5174 \
   --app-tsx test-ecosudar/eco-sudar-control/src/App.tsx \
   --email admin@demo.local --password 'Test1234!' --out ui_breadth_report.json
```

## 5 · Mutation at repo scale

**`backend/mutation.py`.** Added repo-wide **discovery** (`discover_mutants`,
`discovery_summary`, `plan_execution`) and a **stratified, seeded, bounded** executor
(`sample_catalog`, `execute_catalog`) that always reports **discovered vs executed** so
a sampled score is never read as full coverage. Per-file cap and a soft time budget
bound the wall-clock.
Live census: **5,965 mutants across 112 files** in `test-ecosudar/api` (3,005 in the
controllers alone) — the honest answer to "only 8 mutants" (that was a `--mutate-max`
cap, not the repo's real count).

## 6 · Combinatorial (pairwise) generation

**`backend/combinatorial.py` (new).** Beyond single-fault isolation: a deterministic
pairwise (t-wise) covering array so multiple fields can be wrong **together**, bounded
per endpoint (pairwise, not the full cross-product). Live: **500 combinatorial +
900 field-blackbox** tests added, growing the suite from ~1,672 to **3,072**.

---

## Bugs fixed (surfaced by this work)

- **Q2 auth-token gap** (`http_runner.py`): the auth-skip guard only recognised a token
  passed via the `authToken` key, but `--auth-token` / `--auth-cookie` arrive as an
  `Authorization` / `Cookie` **header**, so genuine 401/403 results were being wrongly
  **SKIPPED**. Now any credential source is credited. Confirmed live: `/orders` with a
  token → `200`.
- **S4 CRLF restore** (`mutation.py`): backup/restore used text-mode I/O, rewriting
  Windows **CRLF** source to **LF** on restore — leaving files "modified" in git with
  identical content. Fixed with byte-exact (`newline=''`) round-trip + a CRLF
  regression test.

---

## New CLI flags (`test`)

| Flag | Effect |
|---|---|
| `--combinatorial` / `--combinatorial-strength {1,2}` / `--combinatorial-max N` | pairwise multi-field generation |
| `--mutate-repo DIR` | repo-wide mutation: discover across a tree, execute a bounded stratified sample |
| `--mutate-discover` | **dry-run** static census (no app, no PHP): "how many mutants does my repo really have?" |
| `--mutate-budget N` / `--mutate-per-file-cap N` / `--mutate-time-budget S` | bound the executed sample |

The field-coverage line prints automatically whenever field-depth (`--field-blackbox`
or `--combinatorial`) runs.

---

## Live run summary (this session)

- **Generation:** 3,072 tests (183 contract + 900 field-blackbox + 500 combinatorial + base).
- **Execution:** 2,322 executed → 1,500 pass / 822 fail / 750 skip (64.6% of executed).
  The jump in failures (32 → 822) is the deeper negatives doing their job — every 2xx on
  a bad payload is a **candidate missing-validation finding** for human triage (some may
  be false positives; that is the wider surface, not a verdict).
- **Field coverage:** 451/622 = 72%.
- **Mutation:** 5,965 discovered (census). A **live kill count** was obtained with a
  scoped, fast oracle (4 product-only checks vs the 595-check full suite, which was too
  slow against timing-out endpoints): ProductController — 30 mutants discovered, 10
  executed, **2 killed / 8 survived = 20%**, survivors listed by line + operator, tree
  restored byte-for-byte. (20% reflects the deliberately thin oracle; a full-suite oracle
  scores higher — the point was a real *live* kill count.)
- **UI browser:** the SPA was served and the tool's browser path drove the real login +
  audited five protected pages live (see §4).

## Follow-up wiring done after the first pass

- **Edge + requirement oracles are now auto-invoked** by `scenario_runner` on every
  scenario run: it feeds the submitted body → DB row → read-back evidence it already
  collects into `field_edge_oracle` and `requirement_oracle`, attaching verdicts under
  `result["oracleFindings"]` (strictly additive — never changes the scenario's own
  PASS/FAIL). Covered by a new self-test (harness now 30/30).
- **Edge + requirement oracles are also auto-invoked on the flat `test` path.** After a
  successful CREATE (POST), the runner issues a real **read-back GET** for the created
  resource, optionally reads the **stored DB row** (new `DBRunner.fetch_row`, S9-safe +
  parameterized), and runs both oracles over submitted → stored → read_back; findings
  attach to `tc_result["oracleFindings"]` and print a one-line note on corruption /
  violation. Additive (never changes PASS/FAIL); on by default, `--no-edge-oracle` off.
- **Mutation is now scoped to the mutated file's own endpoints** (`--mutate-scope`,
  default `auto`): a mutant in `ProductController` is only catchable by `/products`
  checks, so the per-mutant suite drops from ~354 endpoints to ~21 (via the graph's
  controllerName→endpoint map, or a resource-name heuristic). This makes a **fast live
  mutation score** practical — the previous full-suite baseline (595 checks, many hanging
  to timeout) was the sole blocker. **Proven live:** a run over 5 controllers (Product,
  Order, Query, Quote, Statistics) executed **29 mutants → 5 killed / 24 survived = 17%**
  at **106 of 595 checks per run** in ~7 min, with the tree restored byte-for-byte. The
  17% is honest: most survivors are logic mutations (int defaults, boolean flags, status
  codes) that endpoint-status checks can't catch — killing those needs response-body
  assertions, a known sensitivity limit rather than a mutation-engine gap.

## Honest remaining gaps

All three items open after the first pass are now closed:

- ✅ **UI breadth** — all 65 concrete routes swept live (65/65 rendered, 51 forms, 404
  per-field cases) via `scripts/ui_breadth.py` (§4). What remains is only deeper
  data-state seeding so every list/detail page is fully populated — *volume of runs*, not
  a missing capability.
- ✅ **Oracles on the flat `test` path** — auto-invoked per write (read-back + DB row).
- ✅ **Fast live mutation score** — `--mutate-scope auto` removes the endpoint-hang
  blocker; 5 controllers scored live. A whole-repo score is now just more runtime.

## Verification

```
python3 -m pytest tests/test_selftests.py -q      # 29/29 green
python3 backend/combinatorial.py                  # pairwise covering-array self-test
python3 backend/field_edge_oracle.py              # in/out edge PASS/FAIL/SKIP
python3 backend/requirement_oracle.py             # requirement PASS/FAIL/SKIP
python3 cli.py test --mutate-discover --mutate-repo test-ecosudar/api   # repo-wide census
```
