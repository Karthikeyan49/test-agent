# SystemIntel Platform — CLI Reference

SystemIntel runs entirely via the command line (`cli.py`). An optional REST API
(`backend/main.py`) exposes the same scan/graph engine over HTTP, but the CLI does
**not** use it and does not require its web dependencies. The optional server needs
`pip install fastapi pydantic uvicorn` and is launched with `python3 backend/main.py`
(binds to `127.0.0.1:8000`). See the root `README.md` for install and quickstart.
There is no web UI — the CLI is the canonical surface.

## Commands (verified against `cli.py`)

```bash
# 1) Scan a repo → build the deterministic system graph
#    (--sql is optional; the scanner also auto-detects schema files)
python3 cli.py scan --path ./src/sample_erp --sql ./src/sample_erp/schema.sql --output graph.json

# 2) Preview generated tests offline (no live app needed)
python3 cli.py test --graph graph.json --no-browser --output report.json

# 3) Run tests against a live app + database
python3 cli.py test --graph graph.json --base-url http://localhost:8080 \
    --db mysql --seed-db --format junit --output report.xml

# 4) Ask a question about the discovered architecture
python3 cli.py query "Where is customer_id used?" --graph graph.json
```

Run `python3 cli.py <command> --help` for the full flag list.

Common flags: `scan` uses `--path`, `--sql`, `--output`, `--trace`, `--page-docs`.
`test` uses `--graph` (or `--path` to re-scan), `--base-url`, `--db`, `--format`
(`json|html|junit`), and depth modes `--field-blackbox`, `--scenarios`, `--mutate`,
`--explore`. There is no `--json` flag on `scan` and no `--sql` flag on `test`.
