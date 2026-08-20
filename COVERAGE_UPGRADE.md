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

## 4 · UI black-box breadth — *not closed this run*

No code gap, but honestly **not executed**: it needs the React SPA built and served.
Every live run here used `--no-browser`. Getting the SPA up is the remaining work to
actually exercise the in-browser field-validation / WCAG / form-fill on all pages.

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
- **Mutation:** 5,965 discovered (census); live kill/survive execution was **stopped
  early** (baseline suite too slow against timing-out endpoints), so no live kill count
  this run — kill mechanics are proven by the offline self-test only.

## Honest remaining gaps

1. **UI browser on all pages** — not run; needs the SPA served.
2. **A completed live mutation kill count** — needs a faster endpoint set or a longer window.
3. **Wiring depth for #2 and #3** — the requirement + RAG-offline oracles are built and
   self-tested but not yet auto-invoked in every per-assertion pass of the default runner.

## Verification

```
python3 -m pytest tests/test_selftests.py -q      # 29/29 green
python3 backend/combinatorial.py                  # pairwise covering-array self-test
python3 backend/field_edge_oracle.py              # in/out edge PASS/FAIL/SKIP
python3 backend/requirement_oracle.py             # requirement PASS/FAIL/SKIP
python3 cli.py test --mutate-discover --mutate-repo test-ecosudar/api   # repo-wide census
```
