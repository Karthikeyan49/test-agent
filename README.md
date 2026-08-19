# SystemIntel

A terminal-native, **deterministic** code-analysis and testing engine. It scans a
repository once, turns it into a **System Graph** (Page → API → Controller → Service
→ Repository → Table → Column), then generates and executes evidence-based tests
across **API + Database + Browser** and judges every one with a hard assertion.

**Core principle:** AI never decides pass/fail. Deterministic checks (status codes,
row counts, DOM state, schema constraints) are always the judge. AI is optional and
only ever *proposes* scenarios or *explains* failures.

> **Project status — honest read:** this is a capable **prototype**, verified
> end-to-end on one bundled PHP target (`test-ecosudar`). It is not yet a
> hardened, general-purpose product. Before adopting it, read
> [`SESSION_CONTEXT.md`](SESSION_CONTEXT.md) ("Honest limits") and the scope
> caveat in [`AUTONOMY_PLAN.md`](AUTONOMY_PLAN.md). Notable current limits:
> regex-based parsing (not full AST), oracle depth varies by test class, and
> breadth is validated mainly on PHP.

---

## Install

Requires **Python 3.10+**.

```bash
# 1) Python dependencies
pip install -r backend/requirements.txt

# 2) Browser engine (only needed for UI/browser tests)
python3 -m playwright install chromium

# 3) (optional) database drivers are already in requirements.txt
#    (psycopg2-binary for PostgreSQL, mysql-connector-python for MySQL)
```

Optional AI features (failure explanation, scenario proposals, contract inference)
need an LLM provider. Copy `.env.example` to `.env` and set the keys. **AI is fully
optional** — the deterministic engine runs without it.

> **Privacy note:** with an external AI provider configured (e.g. Groq/OpenAI),
> some features send source snippets and schema to that provider. Default to a
> local provider (Ollama) for private code — see `.env.example`.

## Quickstart — run it against your own repo

```bash
# Scan any repo → deterministic system graph
python3 cli.py scan --path /path/to/your/repo --output graph.json

# Preview the generated tests offline (no live app required)
python3 cli.py test --graph graph.json --no-browser --output report.json

# Ask questions about the discovered architecture
python3 cli.py query "Where is customer_id used?" --graph graph.json
```

To run tests against a **live** app, point `--base-url` at it and supply a DB:

```bash
python3 cli.py test --graph graph.json \
    --base-url http://localhost:8080 \
    --db mysql --db-host 127.0.0.1 --db-port 3307 \
    --db-name mydb --db-user user --db-password pass \
    --format junit --output report.xml
```

> ⚠️ **Never point `--base-url` at production.** `test` fires real
> POST/PUT/PATCH/DELETE requests and hostile-looking payloads. Use a disposable
> local or staging target you fully control.

## Try the bundled demo target

A real PHP + React ERP (`test-ecosudar/`) with a Docker stack is included:

```bash
cd test-ecosudar/deploy
cp .env.example .env         # set a JWT_SECRET of >= 32 chars
docker compose up -d         # MariaDB (auto-seeded) + PHP/Apache on :8080
```

Then scan and test it (see [`SESSION_CONTEXT.md`](SESSION_CONTEXT.md) for the full
phase-by-phase walkthrough).

## Commands

| Command | Purpose |
|---|---|
| `scan`  | Parse a repo → build & save the system graph JSON |
| `test`  | Generate tests from the graph and run them (API/DB/browser); depth modes: `--field-blackbox`, `--scenarios`, `--mutate`, `--explore` |
| `query` | Natural-language question over the graph (graph-grounded) |
| `agent` | Autonomous ReAct agent over the graph |

Run `python3 cli.py <command> --help` for all flags. Reports export as
`json`, `html`, or `junit` (CI-consumable) via `--format`.

## Documentation

- [`SYSTEMINTEL_CONTEXT.md`](SYSTEMINTEL_CONTEXT.md) — architecture & design
- [`AUTONOMY_PLAN.md`](AUTONOMY_PLAN.md) — roadmap and build status (with scope caveat)
- [`SESSION_CONTEXT.md`](SESSION_CONTEXT.md) — how to run it + honest limits
- [`README_CLI.md`](README_CLI.md) — CLI reference

## Layout

```
cli.py          # entry point (scan / test / query / agent)
backend/        # the deterministic engine (canonical implementation)
test-ecosudar/  # bundled demo target (PHP+React ERP) + docker stack
src/            # legacy browser bundle — NOT the supported surface
```

## License

MIT — see `package.json`.
