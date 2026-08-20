# Extreme Deep Run — Results & Gemini Model Rotation

A full-depth live campaign against the bundled `test-ecosudar` target (PHP API + MariaDB
+ React/Vite SPA), with Gemini powering the AI features. Every number here is from a live
run; nothing is simulated.

> **Key hygiene:** the Gemini API key is passed only through the `SYSTEMINTEL_AI_API_KEY`
> / `SYSTEMINTEL_VISION_API_KEY` environment variables at run time. It is never written to
> a file, commit, report, or log (the key travels in the `x-goog-api-key` request header,
> not the URL). Rotate any key after a heavy session.

## Gemini as a first-class AI provider, with model rotation

`backend/ai_provider.py` supports `provider="gemini"` (native `generateContent`). Because
each free-tier Gemini model has its **own** RPM / TPM / RPD budget, a `429` on one model
does not mean the key is spent — so `_call_gemini` **rotates across models** instead of
erroring:

- Model chain = `SYSTEMINTEL_AI_MODELS` (CSV) → live `ListModels` discovery of the key's
  `generateContent`-capable **text** models (tts / image / audio / embedding filtered out)
  → a curated fallback chain.
- On a quota `429` (or `404`/`400` unavailable) the current model is marked exhausted for
  the run and the next model is tried immediately. A transient (non-quota) `429` gets one
  short backoff on the same model first. Only when **every** model is exhausted does it
  return `None`.

Configure a run:

```
export SYSTEMINTEL_AI_PROVIDER=gemini
export SYSTEMINTEL_AI_MODEL=auto           # auto → discover + rotate
export SYSTEMINTEL_AI_API_KEY=<your key>   # env only; never committed
export SYSTEMINTEL_AI_ALLOW_EXTERNAL=1     # S5 consent for an external LLM
export SYSTEMINTEL_VISION_API_KEY=<your key>
```

## Live results

### AI page-docs (Gemini, rotating)
- **42 page dossiers** generated; **23 carry real Gemini-written plain-language use-cases**
  (grounded on the graph, not deterministic fallback).
- **~21 model switches** across 5+ distinct models
  (`gemini-3.1-flash-lite-preview`, `gemini-flash-lite-latest`, `gemini-3-flash-preview`,
  `gemini-flash-latest`, `gemini-2.5-flash-lite`, …); **quota-hits handled by rotating,
  zero "all models exhausted"**. Without rotation the first attempt stalled ~36 min
  erroring on `429`s.

### Flat depth suite (deterministic, live vs MySQL)
- **3,510 tests generated** — 186 contract black-box + 1,200 per-field black-box + 635
  pairwise combinatorial + cross-layer + base.
- **Field coverage: 604 / 808 = 75%** — the denominator grew because the page-docs corpus
  contributed **278 UI fields** (the page-docs → coverage integration working).
- **Executed 2,650 / 3,510 → 1,800 PASS / 850 FAIL / 860 SKIP (67.9% of executed)**. The
  850 failures are deeper negatives surfacing 2xx-on-bad-input — candidate missing-validation
  findings for human triage (some may be false positives; not automatic bugs).

### AI scenarios (Gemini, RAG-grounded)
- **166 scenarios** designed on the enriched page-docs + RAG → **6 PASS / 44 FAIL / 116 SKIP**.
- Low pass rate is an environment limitation, not an AI failure: this phase ran
  `--no-browser` (UI steps skip; the browser path is proven separately in the UI-breadth
  sweep), and the scanner reads some React **component names** as routes so a few
  navigate/POST steps miss. The AI scenario *design* itself worked (grounded output).

### Mutation
- Repo-wide discovery: **3,005 mutants across 54 controllers** (census). A scoped live score
  on a focused set is the practical path (`--mutate-scope auto` shrinks the per-mutant suite
  only when a **few** files are targeted — mutating all 54 unions back to the whole API).
  See `COVERAGE_UPGRADE.md` for the scoped live score (5 controllers, 17%).

## Reproduce

```
# 1) stand up the stack (DB + PHP API + Vite SPA)  — see scripts in the run notes
# 2) AI page-docs with rotation
python3 cli.py scan --path test-ecosudar --page-docs ./page_docs --page-docs-ai --enrich-contracts-ai
# 3) flat depth suite (no --scenarios; that path is separate)
python3 cli.py test --graph system_graph.json --base-url http://localhost:8080 \
   --db mysql --db-host 127.0.0.1 --db-name ecosudar_test --db-user ecosudar --db-password ecosudar \
   --auth-token "$TOKEN" --no-browser --field-blackbox --combinatorial --page-docs-dir ./page_docs
# 4) AI scenarios (separate invocation)
python3 cli.py test --graph system_graph.json --base-url http://localhost:8080 --auth-token "$TOKEN" \
   --scenarios --scenarios-ai --page-docs-dir ./page_docs
```

> Note: `--scenarios` short-circuits the flat suite (scenario mode returns early), so run the
> depth suite and scenario mode as **separate** invocations.
