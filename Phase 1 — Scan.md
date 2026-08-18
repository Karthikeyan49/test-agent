Phase 1 — Scan

Walk the repo, skip junk (node_modules, builds, minified bundles), sort files into frontend / backend / SQL.

Phase 2 — Parse (read the code)

Frontend → pages, routes, form fields
Backend → controllers, models, API routes, SQL queries
Database → tables, columns, foreign keys

Phase 3 — Build the graph

Connect everything into one map:
Page → Field → API → Controller → Model → Table → Column, plus page↔page and table↔table (FK) links.

Phase 4 — Use the graph (pick one)

Query → ask about any node's connections
Test → auto-generate + run tests (browser, API, DB)
Agent → AI solves a task by exploring the graph

Phase 5 — Report

Output the graph as JSON, an HTML report, or root-cause hints when a test fails.




1. RAG for large repos — yes, but the right kind
You already saw the problem live: the agent stuffs graph/file text into the prompt, hits the 12k-char truncation and 429 rate limits. That's the "send everything as context" anti-pattern, and it gets worse as the repo grows.

The fix isn't generic RAG — it's GraphRAG, and this tool is unusually well-positioned for it because the System Graph is already the perfect retrieval index:

Generic RAG	GraphRAG (right for this tool)
Chunk all files, embed, semantic search	Embed nodes + edges + code slices; retrieve the relevant subgraph neighborhood per query
Can retrieve irrelevant/wrong chunks	Retrieval walks real edges → grounded, no hallucinated links
Flat	Structured — "give me orders + its FK neighbors + the controllers that write it"
So instead of "here's 12k chars," a query for orders retrieves only the orders subgraph + the 3–4 relevant files. That removes the context ceiling, kills the 429s, and preserves determinism (you retrieve facts, you don't ask the model to recall them). This is the single highest-leverage add for scale, and it's genuinely buildable.

2. Each structural gap → the AI technique that fills it
Gap	Technique to fill it	Feasibility
Code, not intent	Spec ingestion — RAG over PRDs / Jira / OpenAPI / acceptance criteria → an intent model to test against	Engineerable if the specs exist
Oracle problem	Metamorphic testing (relations that must hold w/o knowing the exact value: total == Σ line items, sort-invariance) + differential testing (vs. a prior version / reference impl) + LLM-as-oracle grounded on the spec	Metamorphic = pragmatic + buildable; full oracle stays hard
Shallow negatives	Property-based testing (Hypothesis) + fuzzing + input synthesis from the guard conditions to actually trigger each 4xx branch	Engineerable
Exploratory testing	Agentic exploratory tester — an LLM agent that drives the live app, forms hypotheses, tries weird flows	Emerging; partially buildable
Verifies nothing offline	Ephemeral environments — docker-compose spin-up + seeded test DB + contract testing/mocks (Pact) so it runs without prod	Engineerable (DevOps)
Frontend↔backend (SUBMITS_TO) + fills	Runtime tracing — capture a HAR of real submissions and link field→API deterministically by observation (the engine already has a parse_trace_file HAR stub!) + computer-use / vision models to fill forms like a human	Engineerable — and on-brand (deterministic)
No UX/visual/a11y	Vision-language models — screenshot/visual-regression diffing + accessibility-tree analysis (axe-core)	Engineerable
The important pattern: most of these are grounded techniques, not "ask GPT to test." Metamorphic relations, runtime traces, property generators, and axe-core are all deterministic or semi-deterministic — they extend the fact base rather than gambling on the model. That's how you add capability without quality degradation.

3. What the "tester-replacement" system would look like

Deterministic System Graph  (facts — the ground truth)
        │
   GraphRAG retrieval        (scales to any repo, kills 429s)
        │
   Spec/intent layer  ─────► Oracle: metamorphic + differential + spec-grounded LLM
        │
   Generators: property-based · fuzz · branch-triggering input synthesis
        │
   Drivers: agentic exploratory + computer-use (UI) · runtime-trace linker (SUBMITS_TO)
        │
   Execution: ephemeral env + seeded DB + contract mocks
        │
   Judges: vision (visual/a11y) + honest quality gate (already built)
4. Honest verdict on "replace the tester"
With all of this, it plausibly reaches ~70–80% of a tester's job (up from ~35% today). The last ~20% — resolving ambiguous requirements, deciding what risk is acceptable, novel judgment — stays human, because it depends on intent that isn't written down anywhere for the tool to retrieve. The two truly hard parts are the oracle (needs real specs + is AI-limited) and exploratory judgment; everything else on that list is engineering, not magic.

What I'd build first (highest leverage, all grounded)
GraphRAG retrieval — fixes large-repo context + the 429s you hit. (1 subsystem)
Runtime-trace SUBMITS_TO — feed a HAR of real submissions → deterministically join frontend↔backend + reliable field selectors. The HAR parser stub is already there. (closes the last graph bridge, honestly)
Metamorphic + property-based oracle — turns smoke tests into correctness tests without needing exact expected values.
These three move the needle most and each keeps the determinism guarantee intact. Want me to start with GraphRAG (scale) or the runtime-trace SUBMITS_TO (correctness of the graph)? I can build one properly rather than half-doing all seven.