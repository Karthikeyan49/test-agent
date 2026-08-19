#!/usr/bin/env python3
"""
SystemIntel CLI — Pure Command-Line Autonomous System Intelligence & Testing Engine
Zero UI. 100% terminal-native.

Commands:
  scan    Recursively walk a real ERP repo, parse all source files, build system graph
  test    Generate evidence-based tests, run real Playwright, HTTP, and DB assertions
  query   Natural language query over the system graph

Usage:
  python3 cli.py scan --path /path/to/your/erp --output graph.json
  python3 cli.py test --path /path/to/your/erp --base-url http://localhost:3000 --db sqlite --db-path ./erp.db --output report.json
  python3 cli.py query "Where is customer_id used?"
"""

import sys
import os
import argparse
import json
import time
import tempfile

# ── ensure backend/ is on path ───────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from engine          import PythonSystemIntelligenceEngine
from file_scanner    import scan_repository, find_sql_schema_file, print_scan_summary
from http_runner     import HTTPRunner
from db_runner       import DBRunner
from playwright_runner import PlaywrightRunner
from graph_builder   import SystemGraphBuilder
from ai_provider     import AIProvider
from agent           import SystemIntelAgent
from failure_analyzer import FailureAnalyzer

# Try importing the report generator, if available. (We can write a quick standalone HTML generator).
def generate_html_report(report_data: dict) -> str:
    # Extract summary first to avoid {{{}}} f-string set-literal TypeError
    s   = report_data.get('summary', {})
    total    = s.get('total',    0)
    passed   = s.get('passed',   0)
    failed   = s.get('failed',   0)
    passrate = s.get('passRate', '0%')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SystemIntel - Testing Report</title>
  <style>
    body {{ font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; }}
    h1, h2 {{ color: #38bdf8; }}
    .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }}
    .stat {{ background: #0f172a; padding: 16px; text-align: center; border-radius: 8px; border: 1px solid #334155; }}
    .stat-val {{ font-size: 28px; font-weight: bold; margin-top: 8px; }}
    .pass {{ color: #4ade80; }}
    .fail {{ color: #f87171; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
    th, td {{ border: 1px solid #334155; padding: 10px; text-align: left; }}
    th {{ background: #0f172a; color: #94a3b8; }}
    .badge {{ padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }}
    .badge-pass {{ background: #064e3b; color: #6ee7b7; }}
    .badge-fail {{ background: #7f1d1d; color: #fca5a5; }}
  </style>
</head>
<body>
  <h1>SystemIntel Enterprise Autonomous Testing Report</h1>
  <p style="color: #94a3b8">Run ID: {report_data.get('timestamp', '')} | Base URL: {report_data.get('baseUrl', '')}</p>

  <div class="card">
    <h2>Executive Summary</h2>
    <div class="grid">
      <div class="stat"><div>Total Tests</div><div class="stat-val">{total}</div></div>
      <div class="stat"><div>Passed</div><div class="stat-val pass">{passed}</div></div>
      <div class="stat"><div>Failed</div><div class="stat-val fail">{failed}</div></div>
      <div class="stat"><div>Pass Rate</div><div class="stat-val pass">{passrate}</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Test Execution Results</h2>
    <table>
      <thead>
        <tr><th>Test ID</th><th>Title</th><th>Category</th><th>Status</th><th>Duration</th></tr>
      </thead>
      <tbody>
"""
    for r in report_data.get("testResults", []):
        badge = "badge-pass" if r.get("overallStatus") == "PASS" else "badge-fail"
        html += f"""        <tr>
          <td><strong>{r.get('testId', '')}</strong></td>
          <td>{r.get('title', '')}</td>
          <td>{r.get('category', '')}</td>
          <td><span class="badge {badge}">{r.get('overallStatus', '')}</span></td>
          <td>{r.get('durationMs', 0)}ms</td>
        </tr>
"""
    html += """      </tbody>
    </table>
  </div>
</body>
</html>"""
    return html

RESET  = "\033[0m"
CYAN   = "\033[38;5;39m"
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BOLD   = "\033[1m"
DIM    = "\033[2m"


def print_banner():
    print(f"\n{CYAN}" + "=" * 72)
    print("   SYSTEMINTEL CLI  —  Autonomous System Intelligence & Testing Engine")
    print("=" * 72 + RESET)


def section(title: str):
    print(f"\n{BOLD}{CYAN}── {title} {'─' * max(0, 62 - len(title))}{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# COMMAND: scan
# ─────────────────────────────────────────────────────────────────────────────

def cmd_scan(args):
    print_banner()
    section("Repository Ingestion & System Graph Construction")

    repo_path = os.path.abspath(args.path)
    if not os.path.isdir(repo_path):
        print(f"{RED}[✗] Repository path not found: {repo_path}{RESET}")
        sys.exit(1)

    print(f"{CYAN}[+] Scanning repository: {repo_path}{RESET}")

    # Step 1: Real recursive file system scan
    scan_result = scan_repository(repo_path)

    # Optional external HAR trace (--trace) → enables observed field→API (SUBMITS_TO) links
    if getattr(args, 'trace', None) and os.path.isfile(args.trace):
        with open(args.trace, 'r', encoding='utf-8', errors='replace') as f:
            har_content = f.read()
        scan_result.setdefault("trace_files", []).append({
            "name": os.path.basename(args.trace), "path": args.trace,
            "abs_path": args.trace, "ext": ".har", "content": har_content,
        })
        print(f"{CYAN}[+] Loaded runtime trace: {args.trace}{RESET}")

    print_scan_summary(scan_result)

    # Step 2: Parse all discovered source files
    engine   = PythonSystemIntelligenceEngine()
    analysis = engine.analyze_repository(scan_result)

    # Step 3: If --sql provided, parse that too; else use auto-detected schema files
    extra_sql_path = args.sql or find_sql_schema_file(repo_path)
    if extra_sql_path and os.path.isfile(extra_sql_path):
        with open(extra_sql_path, 'r', encoding='utf-8') as f:
            extra_sql = f.read()
        extra_db = engine.parse_sql_schema(extra_sql)
        # Merge with schema files already captured
        analysis["dbResult"]["tables"]       += extra_db["tables"]
        analysis["dbResult"]["foreign_keys"] += extra_db["foreign_keys"]
        # Deduplicate by table id
        seen_t = set()
        deduped_t = []
        for t in analysis["dbResult"]["tables"]:
            if t["id"] not in seen_t:
                seen_t.add(t["id"])
                deduped_t.append(t)
        analysis["dbResult"]["tables"] = deduped_t
        
        # Deduplicate foreign keys
        seen_fk = set()
        deduped_fk = []
        for fk in analysis["dbResult"]["foreign_keys"]:
            k = f"{fk['sourceTable']}_{fk['sourceColumn']}_{fk['targetTable']}_{fk['targetColumn']}"
            if k not in seen_fk:
                seen_fk.add(k)
                deduped_fk.append(fk)
        analysis["dbResult"]["foreign_keys"] = deduped_fk

    # Step 4: Build deterministic System Graph
    gb = SystemGraphBuilder()
    gb.build_from_analysis(analysis)
    full_graph = gb.to_dict()

    section("System Graph Summary")

    db_result = analysis.get("dbResult", {})
    tables    = db_result.get("tables", [])
    fks       = db_result.get("foreign_keys", [])
    pages     = analysis.get("pages", [])
    fields    = analysis.get("fields", [])
    api_eps   = analysis.get("apiEndpoints", [])
    symbols   = analysis.get("symbols", [])
    queries   = analysis.get("dbQueries", [])

    total_cols = sum(len(t.get("columns", [])) for t in tables)

    print(f"  • {BOLD}Frontend Pages{RESET}  : {len(pages)}")
    print(f"  • {BOLD}Input Fields{RESET}    : {len(fields)}")
    print(f"  • {BOLD}API Calls{RESET}       : {len(analysis.get('apiCalls', []))}")
    print(f"  • {BOLD}API Endpoints{RESET}   : {len(api_eps)}")
    print(f"  • {BOLD}Controllers{RESET}     : {len([s for s in symbols if s['type']=='Controller'])}")
    print(f"  • {BOLD}Services{RESET}        : {len([s for s in symbols if s['type']=='Service'])}")
    print(f"  • {BOLD}Repositories{RESET}    : {len([s for s in symbols if s['type']=='Repository'])}")
    print(f"  • {BOLD}DB Tables{RESET}       : {len(tables)}")
    print(f"  • {BOLD}DB Columns{RESET}      : {total_cols}")
    print(f"  • {BOLD}Foreign Keys{RESET}    : {len(fks)}")
    print(f"  • {BOLD}SQL Queries{RESET}     : {len(queries)}")
    submits = len([e for e in full_graph["edges"] if e["relationship"] == "SUBMITS_TO"])
    print(f"  • {BOLD}Field→API (obs){RESET} : {submits}  {DIM}(SUBMITS_TO from runtime trace){RESET}")
    print(f"  • {BOLD}Graph Nodes{RESET}     : {full_graph['nodeCount']}")
    print(f"  • {BOLD}Graph Edges{RESET}     : {full_graph['edgeCount']}")
    print(f"  • {BOLD}Total Files{RESET}     : {analysis.get('filesAnalyzed', 0)}")
    print(f"  • {BOLD}Lines of Code{RESET}   : {analysis.get('linesOfCode', 0):,}")

    # Discovered entities detail
    if pages:
        print(f"\n  {DIM}Pages:{RESET}  " + "  |  ".join(f"{p['name']} ({p['routePath']})" for p in pages[:6]))
    if tables:
        print(f"  {DIM}Tables:{RESET} " + "  |  ".join(t['name'] for t in tables))
    if api_eps:
        print(f"  {DIM}APIs:{RESET}   " + "  |  ".join(f"{e['method']} {e['path']}" for e in api_eps[:6]))

    # Export
    output_path = args.output or "system_graph.json"
    export_data = {
        "repoPath":    repo_path,
        "scannedAt":   time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": {
            "pages": len(pages), "fields": len(fields),
            "apiEndpoints": len(api_eps), "dbTables": len(tables),
            "dbColumns": total_cols, "foreignKeys": len(fks),
            "nodeCount": full_graph['nodeCount'], "edgeCount": full_graph['edgeCount'],
            "filesAnalyzed": analysis.get("filesAnalyzed", 0),
            "linesOfCode":   analysis.get("linesOfCode", 0),
        },
        "nodes":        full_graph["nodes"],
        "edges":        full_graph["edges"],
        "pages":        pages,
        "fields":       fields,
        "apiEndpoints": api_eps,
        "symbols":      symbols,
        "dbTables":     tables,
        "foreignKeys":  fks,
        "dbQueries":    queries,
    }
    # Phase 1.5: endpoint request-contract enrichment (on by default, deterministic).
    # Reads each controller for the REAL request fields + validation rules it enforces,
    # fixing the static table-column guess (e.g. POST /queries wants name+email+message,
    # not the queries-table columns). Additive: annotates nodes, never overrides facts.
    if getattr(args, 'enrich_contracts', True):
        try:
            from endpoint_contracts import build_endpoint_contracts, enrich_graph
            provider = None
            if getattr(args, 'enrich_contracts_ai', False):
                provider = AIProvider()
                print(f"{GREEN}[✓] Contract-enrichment AI fallback "
                      f"{'enabled' if provider.is_enabled() else 'unavailable — parse-only'}{RESET}")
            contracts = build_endpoint_contracts(export_data, repo_path, provider=provider)
            stats = enrich_graph(export_data, contracts)
            export_data["requestContracts"] = list(contracts.values())
            export_data["summary"]["requestContracts"] = len(contracts)
            export_data["summary"]["edgeCount"] = len(export_data["edges"])
            n_parsed = sum(1 for c in contracts.values() if c["origin"] == "parsed")
            n_ai     = sum(1 for c in contracts.values() if c["origin"] == "ai")
            print(f"  • {BOLD}Request Contracts{RESET} : {len(contracts)}  "
                  f"{DIM}({n_parsed} parsed{', ' + str(n_ai) + ' AI-inferred' if n_ai else ''}; "
                  f"{stats['edges_added']} READS_FIELD edges){RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Contract enrichment failed (graph still valid): {e}{RESET}")

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, indent=2)

    print(f"\n{GREEN}[✓] System Graph exported to: {output_path}{RESET}\n")

    # Phase 0 (optional): per-page AI-enriched documentation + data-model audit,
    # written as Markdown — the RAG corpus later phases read for context.
    if getattr(args, 'page_docs', None):
        section("Per-Page Documentation (Phase 0 · RAG corpus)")
        try:
            from page_docs import build_page_docs
            provider = None
            if getattr(args, 'page_docs_ai', False):
                provider = AIProvider()
                print(f"{GREEN}[✓] AI enrichment {'enabled' if provider.is_enabled() else 'unavailable — facts only'}{RESET}")
            res = build_page_docs(export_data, args.page_docs, provider=provider,
                                  pages_limit=getattr(args, 'page_docs_limit', None) or None)
            a = res["audit"]
            print(f"{GREEN}[✓] {res['pages_written']} page dossier(s) → {res['out_dir']}{RESET}")
            print(f"    {DIM}Data-model audit: {len(a['missing_fk'])} candidate missing FK(s), "
                  f"{len(a['denormalization'])} normalization note(s) → {os.path.basename(res['audit_file'])}{RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Page-docs generation failed: {e}{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# COMMAND: test
# ─────────────────────────────────────────────────────────────────────────────

def _build_auth(args, base_url):
    """Construct an AuthManager from the --auth-* flags (token / login / none)."""
    from auth import AuthManager
    if getattr(args, 'auth_token', None):
        auth = AuthManager({"mode": "token", "static_token": args.auth_token})
    elif getattr(args, 'auth_login_url', None):
        auth = AuthManager({"mode": "login", "login_url": args.auth_login_url,
                            "username": args.auth_user, "password": args.auth_pass,
                            "token_json_path": args.auth_token_path or "token"})
        auth.login(base_url=base_url)
    else:
        auth = AuthManager({"mode": "none"})
    return auth


def run_mutation_mode(args, test_cases):
    """
    Mutation testing against a LIVE app: inject one small bug at a time into each
    target source file, re-run the API suite, and count how many mutants the suite
    "kills" (a mutant that makes a previously-passing suite fail). Mutation score =
    killed / injected — the honest measure of whether the tests catch real bugs.

    Works on interpreted back-ends whose source is what the server executes (e.g.
    a bind-mounted PHP app): after each mutation we reset the server's opcode cache
    (``--mutate-reset-url``, default ``{base_url}/clear-cache.php``) so the running
    process actually executes the mutated code before we measure. Originals are
    always restored by MutationTester, even on error.
    """
    import urllib.request
    from http_runner import HTTPRunner
    from mutation import MutationTester

    base_url = args.base_url or "http://localhost:3000"
    auth = _build_auth(args, base_url)
    auth_headers = {"Content-Type": "application/json", **auth.auth_headers()}
    if auth.is_active():
        print(f"{GREEN}[✓] Auth active — mutation suite carries {auth.header}{RESET}")

    # Resolve target files (comma-separated; relative to --path when given).
    files = []
    for raw in [p.strip() for p in args.mutate.split(",") if p.strip()]:
        cand = raw if os.path.isabs(raw) else (
            os.path.join(args.path, raw) if args.path else raw)
        if os.path.isfile(cand):
            files.append(os.path.abspath(cand))
        else:
            print(f"{YELLOW}[!] Mutation target not found: {raw}{RESET}")
    if not files:
        print(f"{RED}[✗] No valid --mutate target files.{RESET}")
        sys.exit(1)

    # Distinct API checks (dedupe by method+endpoint) so each suite run is fast.
    seen, api_units = set(), []
    for tc in test_cases:
        body = dict(tc.get("testData", {}))
        for a in tc.get("assertions", []):
            if a.get("type") != "API":
                continue
            key = (a.get("method", "GET"), a.get("endpoint", ""))
            if key in seen:
                continue
            seen.add(key)
            api_units.append({**a, "body": body, "headers": auth_headers})

    section("Mutation Testing — does the suite actually catch injected bugs?")
    print(f"{CYAN}[+] Target files: {len(files)}  |  distinct API checks per run: {len(api_units)}{RESET}")
    for f in files:
        print(f"    {DIM}• {os.path.relpath(f)}{RESET}")

    runner    = HTTPRunner(base_url=base_url, timeout=args.timeout)
    reset_url = getattr(args, 'mutate_reset_url', None) or (base_url.rstrip('/') + "/clear-cache.php")
    _reset_ok = [True]  # track whether the reset hook works (avoids repeated slow fallbacks)

    def _reset_server_cache():
        try:
            with urllib.request.urlopen(reset_url, timeout=5) as r:
                r.read()
            return True
        except Exception:
            return False

    def run_tests():
        # Make sure the server executes the source currently on disk.
        if not _reset_server_cache():
            _reset_ok[0] = False
            time.sleep(2.2)   # opcache revalidate_freq fallback (no reset endpoint)
        passed = failed = 0
        for a in api_units:
            hr = runner.run_assertion(a)
            if hr.get("skipped"):
                continue
            if "CONNECTION_REFUSED" in (hr.get("error") or ""):
                continue          # app down — don't miscount as a failure
            if hr.get("passed"):
                passed += 1
            else:
                failed += 1
        return passed, failed

    print(f"{DIM}Running baseline (clean source)…{RESET}")
    result = MutationTester().run(files, run_tests, max_mutants_per_file=args.mutate_max)

    if result.get("error"):
        print(f"{RED}[✗] {result['error']}{RESET}")
        print(f"    {DIM}baseline passed={result.get('baselinePassed')} "
              f"failed={result.get('baselineFailed')}{RESET}")
        print(f"    {DIM}The app must be live at {base_url} and the suite must have "
              f"passing checks that exercise the mutated files.{RESET}")
        sys.exit(1)

    score = result["mutationScore"]
    vc = GREEN if score >= 0.7 else (YELLOW if score >= 0.4 else RED)
    print(f"\n  {'─' * 60}")
    print(f"  Mutants injected : {result['mutantsTried']}")
    print(f"  {GREEN}Killed{RESET} (caught) : {result['killed']}")
    print(f"  {RED}Survived{RESET} (missed): {result['survived']}")
    print(f"  Mutation Score   : {vc}{BOLD}{score * 100:.0f}%{RESET}  "
          f"{DIM}(killed / injected — higher = suite catches more real bugs){RESET}")
    if not _reset_ok[0]:
        print(f"  {DIM}(opcache reset hook unreachable — used timed fallback){RESET}")
    print(f"  {'─' * 60}")
    for s in result.get("surviving", []):
        rel = os.path.relpath(s["file"]) if os.path.exists(s["file"]) else s["file"]
        print(f"    {YELLOW}• survived:{RESET} {rel}:{s['lineno']}  [{s['op']}]  "
              f"{DIM}— no check detected this change{RESET}")
    print(f"\n{GREEN}[✓] Mutation analysis complete.{RESET}\n")
    sys.exit(0)


def run_scenario_mode(args, graph_data):
    """
    Professional scenario mode: build a RAG repo-memory of the app, generate
    step-by-step use-case / CRUD / cross-page / AI-assisted scenarios grounded on
    it, run each with 3-WAY verification (browser UI + HTTP API + DB in one pass,
    with create→read→delete variable binding), then emit per-scenario .md + JSON +
    a visual HTML report + a FAILURES.md of everything that didn't match.
    """
    from repo_memory     import build_repo_memory, write_repo_memory_md
    from scenarios        import generate_scenarios
    from scenario_runner  import ScenarioRunner
    from scenario_reports import write_scenario_reports

    base_url = args.base_url or "http://localhost:3000"          # API host (HTTP steps)
    ui_base  = getattr(args, 'ui_base_url', None) or base_url    # frontend host (UI steps)
    out_dir  = getattr(args, 'scenarios_out', None) or "./scenario_report"
    os.makedirs(out_dir, exist_ok=True)

    section("Repo Memory (RAG) + Use-Case Scenario Generation")
    memory  = build_repo_memory(graph_data)
    md_path = write_repo_memory_md(memory, os.path.join(out_dir, "repo_memory.md"))
    print(f"{GREEN}[✓] Repo memory — {len(memory['pages'])} pages, {len(memory['use_cases'])} use-cases, "
          f"{len(memory['connections'])} connections, {len(memory['cross_page'])} cross-page flows{RESET}")
    print(f"    {DIM}→ {md_path}{RESET}")

    provider = None
    if getattr(args, 'scenarios_ai', False):
        provider = AIProvider()
        if provider.is_enabled():
            print(f"{GREEN}[✓] AI-assisted scenario design enabled (proposals are graph-grounded){RESET}")
        else:
            print(f"{YELLOW}[!] AI provider not reachable — AI scenarios skipped{RESET}")
            provider = None

    scenarios = generate_scenarios(graph_data, repo_memory=memory, provider=provider,
                                   max_ai=getattr(args, 'scenarios_ai_max', 8))
    by = {}
    for s in scenarios:
        by[s['category']] = by.get(s['category'], 0) + 1
    print(f"{GREEN}[✓] Generated {len(scenarios)} scenarios — {by}{RESET}")
    if not scenarios:
        print(f"{YELLOW}[!] No scenarios generated.{RESET}")
        sys.exit(0)

    # ── Runners (shared with the normal test path) ──────────────────────────
    auth = _build_auth(args, base_url)
    auth_headers = {"Content-Type": "application/json", **auth.auth_headers()}
    if auth.is_active():
        print(f"{GREEN}[✓] Auth active — API steps carry {auth.header}{RESET}")
    http_runner = HTTPRunner(base_url=base_url, timeout=args.timeout)

    db_runner = None
    if args.db:
        db_cfg = {"driver": args.db}
        if args.db == "sqlite":
            db_cfg["path"] = args.db_path or ":memory:"
        else:
            db_cfg.update({
                "host":     args.db_host     or "localhost",
                "port":     int(args.db_port or (5432 if args.db == "postgresql" else 3306)),
                "database": args.db_name     or "erp",
                "user":     args.db_user     or "postgres",
                "password": args.db_password or "",
            })
        db_runner = DBRunner(db_cfg)
        try:
            db_runner.connect()
            print(f"{GREEN}[✓] DB connected ({args.db}) — DB layer of each scenario is live{RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] DB connection failed: {e} — DB steps will skip{RESET}")
            db_runner = None

    ui_auth_ls = None
    if getattr(args, 'ui_auth_storage_file', None) and os.path.isfile(args.ui_auth_storage_file):
        try:
            with open(args.ui_auth_storage_file, 'r', encoding='utf-8') as f:
                ui_auth_ls = json.load(f)
        except Exception:
            ui_auth_ls = None
    playwright_runner = None
    if not args.no_browser:
        playwright_runner = PlaywrightRunner(base_url=ui_base, headless=not args.headed,
                                             screenshots_dir=args.screenshots_dir or "./screenshots",
                                             auth_local_storage=ui_auth_ls)
        if playwright_runner.is_available():
            try:
                playwright_runner.start()
                print(f"{GREEN}[✓] Browser launched — UI layer of each scenario is live{RESET}")
            except Exception as e:
                print(f"{YELLOW}[!] Playwright failed to start: {e}{RESET}")
                playwright_runner = None
        else:
            playwright_runner = None

    # ── Execute scenarios (3-way per scenario) ──────────────────────────────
    section("Executing scenarios — 3-way UI + API + DB verification")
    runner = ScenarioRunner(base_url=ui_base, http_runner=http_runner, db_runner=db_runner,
                            playwright_runner=playwright_runner, auth_headers=auth_headers)
    results = []
    for i, s in enumerate(scenarios, 1):
        r = runner.run(s)
        results.append(r)
        col = {"PASS": GREEN, "SKIPPED": YELLOW}.get(r["status"], RED)
        L = r.get("layers", {})
        print(f"  [{i}/{len(scenarios)}] {col}{r['status']:7s}{RESET} {s['name'][:56]:56s} "
              f"{DIM}ui={L.get('ui')} api={L.get('api')} db={L.get('db')}{RESET}")

    if playwright_runner:
        playwright_runner.stop()
    if db_runner:
        db_runner.disconnect()

    # ── Reports ─────────────────────────────────────────────────────────────
    paths = write_scenario_reports(results, out_dir, scenarios=scenarios)
    p  = sum(1 for r in results if r["status"] == "PASS")
    f  = sum(1 for r in results if r["status"] == "FAIL")
    sk = sum(1 for r in results if r["status"] == "SKIPPED")
    section("Scenario Summary")
    print(f"  Scenarios : {len(results)}   {GREEN}PASS {p}{RESET}   {RED}FAIL {f}{RESET}   {YELLOW}SKIP {sk}{RESET}")
    for k, v in paths.items():
        print(f"  {DIM}{k:16s}{RESET} {v}")
    print()
    sys.exit(1 if f else 0)


def cmd_test(args):
    print_banner()
    section("Evidence-Based Test Generation")

    repo_path = os.path.abspath(args.path) if args.path else None
    engine    = PythonSystemIntelligenceEngine()

    # Load existing graph JSON if provided, else re-scan
    if args.graph and os.path.isfile(args.graph):
        print(f"{CYAN}[+] Loading system graph from: {args.graph}{RESET}")
        with open(args.graph, 'r') as f:
            graph_data = json.load(f)
        # Build a minimal analysis dict from the graph JSON
        analysis = {
            "pages":        graph_data.get("pages", []),
            "fields":       graph_data.get("fields", []),
            "apiCalls":     [],
            "apiEndpoints": graph_data.get("apiEndpoints", []),
            "symbols":      graph_data.get("symbols", []),
            "dbQueries":    graph_data.get("dbQueries", []),
            "filesAnalyzed": graph_data.get("summary", {}).get("filesAnalyzed", 0),
            "linesOfCode":   graph_data.get("summary", {}).get("linesOfCode", 0),
            "dbResult": {
                "tables":       graph_data.get("dbTables", []),
                "foreign_keys": graph_data.get("foreignKeys", []),
            }
        }
    elif os.path.isdir(repo_path):
        print(f"{CYAN}[+] Scanning repository: {repo_path}{RESET}")
        scan_result = scan_repository(repo_path)
        print_scan_summary(scan_result)
        analysis = engine.analyze_repository(scan_result)
    else:
        print(f"{RED}[✗] Provide --path to repo directory or --graph to graph JSON.{RESET}")
        sys.exit(1)

    # Build the System Graph once (reused for cross-layer oracles + failure analysis)
    gb = SystemGraphBuilder()
    _loaded = locals().get('graph_data')
    if _loaded and "nodes" in _loaded:
        gb.nodes = {n["id"]: n for n in _loaded.get("nodes", [])}
        gb.edges = _loaded.get("edges", [])
    else:
        gb.build_from_analysis(analysis)

    # Scenario mode: RAG repo-memory → use-case/CRUD/AI scenarios → 3-way UI+API+DB
    # verification → per-scenario .md + JSON + visual HTML + FAILURES.md.
    if getattr(args, 'scenarios', False):
        if _loaded and _loaded.get("nodes"):
            scen_graph = _loaded
            scen_graph.setdefault("dbTables", _loaded.get("dbTables", []))
        else:
            gd = gb.to_dict()
            scen_graph = {
                "nodes":        gd.get("nodes", []),
                "edges":        gd.get("edges", []),
                "pages":        analysis.get("pages", []),
                "fields":       analysis.get("fields", []),
                "apiEndpoints": analysis.get("apiEndpoints", []),
                "dbTables":     analysis.get("dbResult", {}).get("tables", []),
            }
        run_scenario_mode(args, scen_graph)
        return

    # Generate test cases: black/white/UI matrix + cross-layer consistency oracles
    test_cases = engine.generate_test_cases(analysis)
    xl_tests = gb.cross_layer_oracles()
    if xl_tests:
        print(f"{GREEN}[✓] + {len(xl_tests)} cross-layer consistency oracle(s) — UI→API→DB value checks{RESET}")
    test_cases += xl_tests

    # Spec/contract oracle (Phase 6): derive tests from an OpenAPI/Swagger document
    if getattr(args, 'openapi', None):
        try:
            from spec_oracle import generate_spec_tests_from_file
            spec_tests = generate_spec_tests_from_file(args.openapi)
            if spec_tests:
                print(f"{GREEN}[✓] + {len(spec_tests)} spec-derived contract test(s) from {args.openapi}{RESET}")
            test_cases += spec_tests
        except Exception as e:
            print(f"{YELLOW}[!] Could not derive spec tests: {e}{RESET}")

    # Metamorphic relation tests — partial business-logic oracle (idempotency, round-trip, additive, sum-invariant)
    try:
        from metamorphic import generate_metamorphic_tests
        mr_graph = _loaded if (_loaded and _loaded.get("apiEndpoints")) else {"apiEndpoints": analysis.get("apiEndpoints", [])}
        mr_tests = generate_metamorphic_tests(mr_graph)
        if mr_tests:
            print(f"{GREEN}[✓] + {len(mr_tests)} metamorphic relation test(s){RESET}")
        test_cases += mr_tests
    except Exception as e:
        print(f"{YELLOW}[!] Metamorphic generation failed: {e}{RESET}")

    # Business-invariant data-correctness oracle — mines schema for rules the
    # stored data must always satisfy (non-negative money/qty, email format,
    # boolean/enum domains, updated_at ≥ created_at) and emits real DB checks.
    try:
        from invariants import generate_invariant_tests
        inv_graph = _loaded if (_loaded and _loaded.get("dbTables")) else {
            "dbTables": analysis.get("dbResult", {}).get("tables", [])}
        inv_tests = generate_invariant_tests(inv_graph)
        if inv_tests:
            print(f"{GREEN}[✓] + {len(inv_tests)} business-invariant data-correctness test(s){RESET}")
        test_cases += inv_tests
    except Exception as e:
        print(f"{YELLOW}[!] Invariant generation failed: {e}{RESET}")

    # Contract-driven black-box negatives (Phase 1.5): for each endpoint's REAL
    # request contract, one single-fault case per validation rule (missing-required,
    # bad-email, over-max, out-of-enum, wrong-type) asserting a 4xx, plus a valid
    # happy-path. Always-on and precise (no table-column guessing) — needs the
    # requestContracts the scan wrote into the graph.
    try:
        from field_blackbox import generate_contract_negative_tests
        cn_graph = _loaded if (_loaded and _loaded.get("requestContracts")) else {
            "requestContracts": (analysis.get("requestContracts", []) if isinstance(analysis, dict) else [])}
        cn_tests = generate_contract_negative_tests(cn_graph)
        if cn_tests:
            neg = sum(1 for t in cn_tests if (t.get("assertions") or [{}])[0].get("expectedStatusClass") == "4xx")
            print(f"{GREEN}[✓] + {len(cn_tests)} contract black-box test(s) — "
                  f"{neg} rule-violation negatives + {len(cn_tests)-neg} happy-path{RESET}")
        test_cases += cn_tests
    except Exception as e:
        print(f"{YELLOW}[!] Contract-negative generation failed: {e}{RESET}")

    # Per-field black-box DEPTH — every writable field × the full method battery
    # (required, type, format, length, enum, boundary/negative, fuzz-robustness). Opt-in
    # (--field-blackbox) because it multiplies the case count. Schema-driven,
    # deterministic, executable single-fault tests.
    if getattr(args, 'field_blackbox', False):
        try:
            from field_blackbox import generate_field_blackbox_tests
            fbb_graph = _loaded if (_loaded and _loaded.get("apiEndpoints")) else {
                "apiEndpoints": analysis.get("apiEndpoints", []),
                "dbTables":     analysis.get("dbResult", {}).get("tables", []),
                "nodes":        gb.to_dict().get("nodes", []),
                "edges":        gb.to_dict().get("edges", []),
            }
            fbb = generate_field_blackbox_tests(fbb_graph, max_cases=getattr(args, 'field_blackbox_max', 4000))
            if fbb:
                by = {}
                for t in fbb:
                    by[t.get("subtype")] = by.get(t.get("subtype"), 0) + 1
                print(f"{GREEN}[✓] + {len(fbb)} per-field black-box test(s) — {by}{RESET}")
            test_cases += fbb
        except Exception as e:
            print(f"{YELLOW}[!] Per-field black-box generation failed: {e}{RESET}")

    # Exploratory edge-case scenarios (experimental) — LLM proposes, grounded on the graph
    if getattr(args, 'explore', False):
        try:
            from explorer import ExploratoryTester
            exp_graph = _loaded if (_loaded and _loaded.get("apiEndpoints")) else {
                "apiEndpoints": analysis.get("apiEndpoints", []),
                "fields":       analysis.get("fields", []),
                "dbTables":     analysis.get("dbResult", {}).get("tables", []),
            }
            scenarios = ExploratoryTester(AIProvider(), exp_graph).propose_scenarios(max_scenarios=8)
            if scenarios:
                print(f"{GREEN}[✓] + {len(scenarios)} exploratory edge-case scenario(s) [experimental]{RESET}")
                for s in scenarios:
                    print(f"    {DIM}• {s.get('title','?')} → {s.get('targetEndpoint','')}{RESET}")
                test_cases += [s for s in scenarios if s.get("assertions")]
            else:
                print(f"{DIM}[i] Exploratory mode: no scenarios (AI disabled/unreachable){RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Exploratory mode failed: {e}{RESET}")

    if not test_cases:
        print(f"{YELLOW}[!] No test cases generated. Check that your repo has frontend pages, API endpoints, or DB tables.{RESET}")
        sys.exit(0)

    # Mutation-testing mode: instead of one normal run, inject bugs into the given
    # source files and measure how many the suite catches (the real test-quality KPI).
    if getattr(args, 'mutate', None):
        run_mutation_mode(args, test_cases)
        return

    print(f"{GREEN}[✓] Generated {len(test_cases)} evidence-based test scenarios{RESET}\n")
    for tc in test_cases:
        print(f"  • {BOLD}{tc['id']}{RESET}: {tc['title']}")
        print(f"    {DIM}Category: {tc['category']}  |  Confidence: {tc['confidence']*100:.0f}%{RESET}")

    section("Test Execution: Playwright Browser + HTTP API + Database Assertions")

    # ── Initialise runners ──────────────────────────────────────────────
    base_url = args.base_url or "http://localhost:3000"

    # Auth (optional) — obtain/carry a token so protected endpoints become testable
    from auth import AuthManager
    if getattr(args, 'auth_token', None):
        auth = AuthManager({"mode": "token", "static_token": args.auth_token})
    elif getattr(args, 'auth_login_url', None):
        auth = AuthManager({"mode": "login", "login_url": args.auth_login_url,
                            "username": args.auth_user, "password": args.auth_pass,
                            "token_json_path": args.auth_token_path or "token"})
        auth.login(base_url=base_url)
    else:
        auth = AuthManager({"mode": "none"})
    if auth.is_active():
        print(f"{GREEN}[✓] Auth active — protected requests carry {auth.header}{RESET}")

    # HTTP runner
    http_runner = HTTPRunner(base_url=base_url, timeout=args.timeout)

    # ── S3: production-write guardrail ──────────────────────────────────────
    # The suite fires real POST/PUT/PATCH/DELETE (and hostile payloads). Pointed
    # at a non-local host it can create/edit/DELETE real records. Refuse mutating
    # requests against a non-local target unless the operator explicitly opts in.
    from urllib.parse import urlparse as _urlparse
    _host = (_urlparse(base_url).hostname or "").lower()
    _is_local = _host in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or _host.endswith(".local")
    block_writes = (not _is_local) and (not getattr(args, "allow_nonlocal_writes", False))
    if block_writes:
        print(f"{YELLOW}{BOLD}[!] SAFETY: '{_host}' is not a local target. Mutating requests "
              f"(POST/PUT/PATCH/DELETE) will be SKIPPED to avoid changing real data.{RESET}")
        print(f"{YELLOW}    Re-run with --allow-nonlocal-writes ONLY against a disposable "
              f"staging target you fully control (never production).{RESET}")

    # Seeded SQLite test DB (Phase 4): build a self-contained DB from the discovered
    # schema so DB/schema assertions execute offline (no production creds needed).
    if getattr(args, 'seed_db', False):
        try:
            from db_seeder import create_sqlite_schema
            seed_path = args.db_path or os.path.join(tempfile.gettempdir(), "systemintel_testdb.sqlite")
            if os.path.exists(seed_path):
                os.remove(seed_path)
            db_tables = analysis.get("dbResult", {}).get("tables", [])
            db_fks    = analysis.get("dbResult", {}).get("foreign_keys", [])
            conn = create_sqlite_schema(db_tables, seed_path)
            seeded_rows = 0
            # Fixtures are ON by default: FK-ordered rows give cross-layer/functional
            # tests valid preconditions. The seeder never fabricates an FK value
            # (real parent value or NULL only), so it is orphan-free even on the
            # 81-table / 109-FK ecosudar schema — verified in fixtures.py. Opt out
            # with --no-fixtures to test against an empty schema.
            if not getattr(args, 'no_fixtures', False):
                try:
                    from fixtures import seed_fixtures
                    inserted = seed_fixtures(conn, db_tables, db_fks, rows_per_table=1)
                    seeded_rows = sum(len(v) for v in (inserted or {}).values())
                    conn.commit()
                except Exception as e:
                    print(f"{YELLOW}[!] Fixture seeding skipped: {e}{RESET}")
            conn.close()
            args.db, args.db_path = "sqlite", seed_path
            extra = f" + {seeded_rows} fixture rows (FK-ordered)" if seeded_rows else ""
            print(f"{GREEN}[✓] Seeded SQLite test DB from schema{extra} → {seed_path}{RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Could not seed test DB: {e}{RESET}")

    # DB runner
    db_runner = None
    if args.db:
        db_cfg = {"driver": args.db}
        if args.db == "sqlite":
            db_cfg["path"] = args.db_path or ":memory:"
        else:
            db_cfg.update({
                "host":     args.db_host     or "localhost",
                "port":     int(args.db_port or (5432 if args.db == "postgresql" else 3306)),
                "database": args.db_name     or "erp",
                "user":     args.db_user     or "postgres",
                "password": args.db_password or "",
            })
        db_runner = DBRunner(db_cfg)
        try:
            db_runner.connect()
            print(f"{GREEN}[✓] Database connection established ({args.db}){RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] DB connection failed: {e}{RESET}")
            print(f"    {DIM}DB assertions will be skipped.{RESET}")
            db_runner = None

    # Optional authenticated UI session: a JSON file of {localStorage_key: value}
    # injected before app JS runs, so client-side auth gates render protected
    # pages instead of redirecting UI tests to /login.
    ui_auth_ls = None
    if getattr(args, 'ui_auth_storage_file', None) and os.path.isfile(args.ui_auth_storage_file):
        try:
            with open(args.ui_auth_storage_file, 'r', encoding='utf-8') as f:
                ui_auth_ls = json.load(f)
            print(f"{GREEN}[✓] UI auth session loaded ({len(ui_auth_ls)} localStorage key(s)) — protected pages will render{RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Could not load --ui-auth-storage-file: {e}{RESET}")

    # Playwright runner
    playwright_runner = None
    if not args.no_browser:
        playwright_runner = PlaywrightRunner(
            base_url=base_url,
            headless=not args.headed,
            screenshots_dir=args.screenshots_dir or "./screenshots",
            auth_local_storage=ui_auth_ls,
        )
        if playwright_runner.is_available():
            try:
                playwright_runner.start()
                print(f"{GREEN}[✓] Playwright Chromium browser launched (headless={'no' if args.headed else 'yes'}){RESET}")
            except Exception as e:
                print(f"{YELLOW}[!] Playwright failed to start: {e}{RESET}")
                print(f"    {DIM}Run: pip install playwright && python -m playwright install chromium{RESET}")
                playwright_runner = None
        else:
            print(f"{YELLOW}[!] Playwright not installed — browser assertions skipped.{RESET}")
            print(f"    {DIM}Install: pip install playwright && python -m playwright install chromium{RESET}")
            playwright_runner = None

    # ── Execute each test case ──────────────────────────────────────────
    print()
    run_results = []
    total = len(test_cases)
    passed_count = 0
    failed_count = 0
    skipped_count = 0
    start_total  = time.time()

    for i, tc in enumerate(test_cases, start=1):
        print(f"\n{BOLD}[{i}/{total}] {tc['id']}: {tc['title']}{RESET}")

        tc_result = {
            "testId":          tc["id"],
            "title":           tc["title"],
            "category":        tc["category"],
            "playwrightResult": None,
            "httpResults":     [],
            "dbResults":       [],
            "overallStatus":   "PASS",
            "failureReasons":  [],
        }
        start_tc = time.time()

        # 0. Metamorphic relation tests are routed through the metamorphic
        #    EXECUTOR (Q1) — it performs the paired requests and evaluates the
        #    relation (count +1, field echo, sum, idempotency). Previously these
        #    fell through to the plain assertion loop and degraded to GET→200.
        #    Honestly SKIPs (never PASS) when it lacks a body / bound id.
        if tc.get("technique") == "METAMORPHIC" and http_runner:
            from metamorphic import execute_metamorphic_test

            def _mr_run(a):
                return http_runner.run_assertion(
                    {**a, "headers": {"Content-Type": "application/json", **auth.auth_headers()}})

            mbody = dict(tc.get("testData") or {}) or None
            verdict = execute_metamorphic_test(tc, _mr_run, body=mbody)
            tc_result["metamorphicResult"] = verdict
            tag = f"{verdict.get('relation')}: {verdict.get('reason')}"
            if verdict.get("skipped"):
                tc_result["overallStatus"] = "SKIPPED"
                skipped_count += 1
                print(f"  {YELLOW}→ SKIPPED  ({tag}){RESET}")
            elif verdict.get("passed"):
                tc_result["overallStatus"] = "PASS"
                passed_count += 1
                print(f"  {GREEN}→ PASS  ({tag}){RESET}")
            else:
                tc_result["overallStatus"] = "FAIL"
                failed_count += 1
                tc_result["failureReasons"].append(tag)
                print(f"  {RED}→ FAIL  ({tag}){RESET}")
            tc_result["durationMs"] = round((time.time() - start_tc) * 1000, 2)
            run_results.append(tc_result)
            continue

        # 1. Playwright browser execution (only for UI tests that carry steps)
        if playwright_runner and tc.get("steps"):
            pw_result = playwright_runner.run_test_case(tc)
            tc_result["playwrightResult"] = pw_result
            playwright_runner.print_result(pw_result)
            if pw_result.get("skipped"):
                print(f"  {YELLOW}  ⚠ Frontend not reachable at {base_url} — UI test skipped{RESET}")
            elif not pw_result.get("passed"):
                tc_result["overallStatus"] = "FAIL"
                if pw_result.get("error"):
                    tc_result["failureReasons"].append(f"Browser: {pw_result['error']}")

        # 2. HTTP API assertions
        http_assertions = [a for a in tc.get("assertions", []) if a.get("type") == "API"]
        for a in http_assertions:
            # S3: block mutating verbs against a non-local target unless opted in.
            _verb = (a.get("endpoint", "GET").split(" ", 1)[0] or "GET").upper()
            if block_writes and _verb in ("POST", "PUT", "PATCH", "DELETE"):
                tc_result["httpResults"].append({
                    "type": "API", "endpoint": a.get("endpoint"), "method": _verb,
                    "skipped": True,
                    "skipReason": "write blocked: non-local target without --allow-nonlocal-writes"})
                print(f"  {YELLOW}  ⚠ {a.get('endpoint')} — write blocked (non-local target){RESET}")
                continue
            body = dict(tc.get("testData", {}))
            a_with_body = {**a, "body": body,
                           "headers": {"Content-Type": "application/json", **auth.auth_headers()}}
            hr = http_runner.run_assertion(a_with_body)
            tc_result["httpResults"].append(hr)
            http_runner.print_result(hr)
            if hr.get("skipped"):
                # Precondition unmet (auth wall, or backend unreachable) — not a
                # failure and not a pass; excluded from the executed count below.
                reason = hr.get("skipReason") or "assertion skipped"
                print(f"  {YELLOW}  ⚠ {a.get('endpoint')} — skipped: {reason}{RESET}")
            elif not hr.get("passed"):
                err = hr.get("error")
                if err and "CONNECTION_REFUSED" in err:
                    # Backend not running — mark as warning not failure
                    print(f"  {YELLOW}  ⚠ Backend not reachable at {base_url} — HTTP assertion skipped{RESET}")
                    tc_result["httpResults"][-1]["skipped"] = True
                else:
                    tc_result["overallStatus"] = "FAIL"
                    tc_result["failureReasons"].append(
                        f"API {a.get('endpoint')}: expected {a.get('expectedStatusCode')} got {hr.get('actualStatus','ERR')}"
                    )

        # 3. Database assertions
        if db_runner:
            api_succeeded = any(hr.get("passed") for hr in tc_result["httpResults"])
            db_assertions = [a for a in tc.get("assertions", []) if a.get("type") == "DB"]
            for a in db_assertions:
                # cross-layer persistence is only meaningful if the API write ran
                if a.get("checkType") == "cross_layer" and not api_succeeded:
                    tc_result["dbResults"].append({
                        "type": "DB", "table": a.get("table"), "skipped": True,
                        "reason": "API write not executed — cannot verify persistence",
                    })
                    continue
                dr = db_runner.run_assertion(a)
                tc_result["dbResults"].append(dr)
                db_runner.print_result(dr)
                if not dr.get("passed") and not dr.get("skipped"):
                    tc_result["overallStatus"] = "FAIL"
                    tc_result["failureReasons"].append(
                        f"DB {a.get('table')}.{a.get('column')}: "
                        f"expected={a.get('value', a.get('expectedRowsCount'))} "
                        f"actual={dr.get('actualValue', dr.get('actualRowsCount', '?'))}"
                    )

        tc_result["durationMs"] = round((time.time() - start_tc) * 1000, 2)

        # A test that verified NOTHING live (every assertion skipped) is SKIPPED,
        # never PASS — skips must not inflate the pass rate.
        http_exec = sum(1 for hr in tc_result["httpResults"] if not hr.get("skipped"))
        db_exec   = sum(1 for dr in tc_result["dbResults"]   if not dr.get("skipped"))
        pw_exec   = 1 if (tc_result["playwrightResult"] and not tc_result["playwrightResult"].get("skipped")) else 0
        tc_result["assertionsExecuted"] = http_exec + db_exec + pw_exec
        if tc_result["overallStatus"] != "FAIL" and tc_result["assertionsExecuted"] == 0:
            tc_result["overallStatus"] = "SKIPPED"

        status_color = {"PASS": GREEN, "SKIPPED": YELLOW}.get(tc_result["overallStatus"], RED)
        print(f"  {status_color}{BOLD}→ {tc_result['overallStatus']}{RESET}  ({tc_result['durationMs']:.0f}ms)")

        if tc_result["overallStatus"] == "PASS":
            passed_count += 1
        elif tc_result["overallStatus"] == "SKIPPED":
            skipped_count += 1
        else:
            failed_count += 1
            for reason in tc_result["failureReasons"]:
                print(f"    {RED}✗ {reason}{RESET}")

        run_results.append(tc_result)

    total_duration = round((time.time() - start_total) * 1000, 2)

    # ── Cleanup runners ─────────────────────────────────────────────────
    if playwright_runner:
        playwright_runner.stop()
    if db_runner:
        db_runner.disconnect()

    # ── Summary ─────────────────────────────────────────────────────────
    section("Test Execution Summary")
    executed  = passed_count + failed_count
    pass_rate = (passed_count / executed * 100) if executed else 0.0

    # Technique / category coverage breakdown
    by_tech = {}
    for tc in test_cases:
        by_tech[tc.get("technique", "BLACK_BOX")] = by_tech.get(tc.get("technique", "BLACK_BOX"), 0) + 1

    print(f"  {'─' * 60}")
    print(f"  Total Test Cases  : {total}   ({BOLD}{by_tech.get('BLACK_BOX',0)}{RESET} black-box, {BOLD}{by_tech.get('WHITE_BOX',0)}{RESET} white-box)")
    print(f"  {GREEN}Passed{RESET}            : {passed_count}")
    print(f"  {RED}Failed{RESET}            : {failed_count}")
    print(f"  {YELLOW}Skipped{RESET}           : {skipped_count}  {DIM}(not executed — app/DB unreachable){RESET}")
    print(f"  Executed          : {executed} / {total}")
    print(f"  Pass Rate         : {BOLD}{pass_rate:.1f}%{RESET}  {DIM}(of executed only){RESET}")
    print(f"  Total Duration    : {total_duration:.0f}ms")
    print(f"  {'─' * 60}")
    if executed == 0:
        print(f"  {YELLOW}⚠ Nothing was verified live — start the app + DB to execute real assertions.{RESET}")

    # Reuse the graph already built during test generation
    provider = AIProvider()
    fail_analyzer = FailureAnalyzer(gb, provider)

    # ── Failure intelligence ─────────────────────────────────────────────
    failed_tests = [r for r in run_results if r["overallStatus"] == "FAIL"]
    if failed_tests:
        section("Failure Intelligence & Root Cause Analysis")
        for fr in failed_tests:
            print(f"\n  {RED}{BOLD}[FAIL] {fr['testId']}: {fr['title']}{RESET}")
            analysis_result = fail_analyzer.analyze(fr)
            for hyp in analysis_result.get("hypotheses", []):
                print(f"    {YELLOW}➜ [{hyp['type']}] {hyp['diagnosis']}{RESET}")
                if hyp.get('affectedFiles'):
                    print(f"      {DIM}Affected Files: {', '.join(hyp['affectedFiles'])}{RESET}")
                if hyp.get('suggestion'):
                    print(f"      {DIM}Suggested Fix: {hyp['suggestion']}{RESET}")

    # ── Export report ────────────────────────────────────────────────────
    output_path = args.output or "SystemIntel_Report.json"
    report = {
        "timestamp":   time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "repoPath":    repo_path if (repo_path and os.path.isdir(repo_path)) else args.graph,
        "baseUrl":     base_url,
        "summary": {
            "total":    total,
            "passed":   passed_count,
            "failed":   failed_count,
            "skipped":  skipped_count,
            "executed": executed,
            "passRate": f"{pass_rate:.1f}%",
            "passRateBasis": "executed",
            "durationMs": total_duration,
        },
        "testResults": run_results,
    }

    # ── S10: redact live response bodies from the persisted report by default ──
    # A live responseBody can contain PII or tokens the app returned. Reports are
    # shared by hand, so strip them unless the operator opts in.
    if not getattr(args, "include_response_bodies", False):
        _redacted = 0
        for r in report["testResults"]:
            for hr in r.get("httpResults", []):
                if "responseBody" in hr and hr["responseBody"] not in (None, ""):
                    hr["responseBody"] = "<redacted: run --include-response-bodies to keep>"
                    _redacted += 1
        if _redacted:
            print(f"{DIM}[i] Redacted {_redacted} response body/bodies from the report "
                  f"(use --include-response-bodies to keep them).{RESET}")

    if args.format == "html":
        output_path = args.output if args.output.endswith(".html") else args.output.replace(".json", ".html")
        html_content = generate_html_report(report)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
    elif args.format == "junit":
        from reporters import write_junit
        output_path = args.output if args.output.endswith(".xml") else args.output.replace(".json", ".xml")
        write_junit(report, output_path)
    else:
        output_path = args.output
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, default=str)

    print(f"\n{GREEN}[✓] Full report saved to: {output_path}{RESET}\n")

    # CI exit code: non-zero only on genuine failures (skips never fail the pipeline)
    try:
        from reporters import exit_code
        sys.exit(exit_code(report))
    except SystemExit:
        raise
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# COMMAND: query
# ─────────────────────────────────────────────────────────────────────────────

def cmd_query(args):
    print_banner()
    section("Natural Language System Graph Query")
    print(f"{CYAN}[+] Query: \"{args.question}\"{RESET}\n")

    # Load graph JSON if provided
    graph_data = {}
    if args.graph and os.path.isfile(args.graph):
        with open(args.graph, 'r') as f:
            graph_data = json.load(f)

    lower = args.question.lower()

    pages    = graph_data.get("pages", [])
    fields   = graph_data.get("fields", [])
    api_eps  = graph_data.get("apiEndpoints", [])
    tables   = graph_data.get("dbTables", [])
    fks      = graph_data.get("foreignKeys", [])
    nodes    = graph_data.get("nodes", [])
    edges    = graph_data.get("edges", [])

    # Targeted Connection Query: "connection of [entity]"
    import re
    conn_match = re.search(r'connection\s+of\s+([a-zA-Z0-9_\-\s]+)', lower)
    if conn_match and nodes and edges:
        target_name = conn_match.group(1).strip()
        print(f"{BOLD}[Targeted Graph Connectivity for '{target_name}']:{RESET}")
        
        # Find matching node
        target_node = next((n for n in nodes if target_name in n["name"].lower()), None)
        if not target_node:
            print(f"  {YELLOW}⚠ Could not find a Page, Field, or Module matching '{target_name}'.{RESET}")
            return
            
        print(f"  {CYAN}Target Entity: {target_node['name']} ({target_node['type']}){RESET}")
        
        # Incoming connections (Upstream)
        incoming_edges = [e for e in edges if e["target"] == target_node["id"]]
        print(f"\n  {BOLD}▼ Incoming Connections (Upstream):{RESET}")
        if not incoming_edges:
            print("    (None)")
        for e in incoming_edges:
            src_node = next((n for n in nodes if n["id"] == e["source"]), {})
            print(f"    - {src_node.get('type', '?')}: {src_node.get('name', '?')}  --[{e['relationship']}]-->")
            
        # Outgoing connections (Downstream)
        outgoing_edges = [e for e in edges if e["source"] == target_node["id"]]
        print(f"\n  {BOLD}▼ Outgoing Connections (Downstream):{RESET}")
        if not outgoing_edges:
            print("    (None)")
        for e in outgoing_edges:
            tgt_node = next((n for n in nodes if n["id"] == e["target"]), {})
            print(f"    --[{e['relationship']}]-->  {tgt_node.get('type', '?')}: {tgt_node.get('name', '?')}")
        
        print()
        return

    # Answer from graph data when available
    if any(kw in lower for kw in ["customer_id", "credit_limit", "credit"]):
        matching_fields = [f for f in fields if "credit" in f.get("fieldName", "").lower()]
        matching_cols   = [
            f"{t['name']}.{c['name']}"
            for t in tables for c in t.get("columns", [])
            if "credit" in c["name"].lower()
        ]
        print(f"{BOLD}[System Graph Result]:{RESET}")
        if matching_fields:
            for mf in matching_fields:
                print(f"  • Frontend Field  : {mf['fieldName']} ({mf['filePath']}:{mf['lineStart']})")
        if matching_cols:
            for mc in matching_cols:
                print(f"  • DB Column       : {mc}")
        # FK downstream
        downstream_fks = [
            fk for fk in fks
            if "credit" in fk.get("sourceColumn", "") or "customer" in fk.get("sourceTable", "")
        ]
        for fk in downstream_fks:
            print(f"  • FK Dependency   : {fk['sourceTable']}.{fk['sourceColumn']} → {fk['targetTable']}.{fk['targetColumn']}")
        # APIs
        for ep in api_eps:
            if "customer" in ep.get("path", "").lower():
                print(f"  • API Endpoint    : {ep['method']} {ep['path']} ({ep['filePath']}:{ep['lineStart']})")

    elif any(kw in lower for kw in ["table", "database", "schema", "column"]):
        print(f"{BOLD}[Database Schema Entities]:{RESET}")
        for t in tables:
            cols = ", ".join(c["name"] for c in t.get("columns", []))
            print(f"  • Table `{t['name']}`: {cols or '(no columns)'}")
        for fk in fks:
            print(f"  • FK: {fk['sourceTable']}.{fk['sourceColumn']} → {fk['targetTable']}.{fk['targetColumn']}")

    elif any(kw in lower for kw in ["api", "endpoint", "route", "post", "get"]):
        print(f"{BOLD}[API Endpoints Discovered]:{RESET}")
        for ep in api_eps:
            print(f"  • {ep['method']:6s} {ep['path']}  (controller: {ep.get('controllerName','?')}, {ep['filePath']}:{ep['lineStart']})")

    elif any(kw in lower for kw in ["page", "frontend", "ui", "field"]):
        print(f"{BOLD}[Frontend Pages & Fields]:{RESET}")
        for p in pages:
            print(f"  • Page `{p['name']}` at route `{p['routePath']}` ({p['filePath']})")
        for f in fields[:20]:
            print(f"    - Field: {f['fieldName']} (type={f.get('fieldType','text')}, required={f.get('required',False)})")

    else:
        print(f"{BOLD}[Graph Summary for: \"{args.question}\"]{RESET}")
        print(f"  • Pages: {len(pages)} | Fields: {len(fields)} | APIs: {len(api_eps)} | Tables: {len(tables)} | FKs: {len(fks)}")

    print()


# ─────────────────────────────────────────────────────────────────────────────
# COMMAND: agent
# ─────────────────────────────────────────────────────────────────────────────

def cmd_agent(args):
    print_banner()
    section("Autonomous SystemIntel Agent (ReAct)")
    print(f"{CYAN}[+] Task: \"{args.task}\"{RESET}\n")

    if not args.graph or not os.path.isfile(args.graph):
        print(f"{RED}[✗] You must provide a valid --graph JSON file for the agent to use.{RESET}")
        sys.exit(1)

    with open(args.graph, 'r') as f:
        graph_data = json.load(f)

    # Initialize AI Provider & Agent
    provider = AIProvider()
    if not provider.is_enabled():
        print(f"{YELLOW}[⚠] AI Provider is disabled or unreachable. Some agent functions may fail.{RESET}")

    agent = SystemIntelAgent(provider, graph_data)
    
    # Run the agentic loop
    try:
        final_answer = agent.run(args.task)
        print(f"\n{GREEN}{BOLD}[AGENT FINAL ANSWER]{RESET}\n{final_answer}\n")
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Agent interrupted by user.{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# ARGUMENT PARSER
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="SystemIntel CLI — Autonomous System Intelligence & Testing Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan an ERP repo and export system graph
  python3 cli.py scan --path ./my_erp_project --output graph.json

  # Run full tests against a live ERP app (Playwright + HTTP + DB)
  python3 cli.py test --path ./my_erp_project --base-url http://localhost:3000 --db sqlite --db-path ./erp.db

  # Load existing graph and run tests without re-scanning
  python3 cli.py test --graph graph.json --base-url http://localhost:3000 --db postgresql --db-name erp

  # Query the system graph in natural language
  python3 cli.py query "Where is customer_id used?" --graph graph.json
        """
    )

    sub = parser.add_subparsers(dest="command")

    # ── scan ──────────────────────────────────────────────────────────────────
    sp = sub.add_parser("scan", help="Scan ERP repository and build system graph")
    sp.add_argument("--path",   required=True, help="Path to ERP repository root directory")
    sp.add_argument("--sql",    help="Optional: explicit path to SQL schema file")
    sp.add_argument("--trace",  help="Optional: path to a HAR recording of real usage (enables observed field→API SUBMITS_TO links)")
    sp.add_argument("--output", default="system_graph.json", help="Output JSON file path (default: system_graph.json)")
    sp.add_argument("--page-docs",  nargs="?", const="./page_docs", help="Phase 0: write a per-page Markdown dossier (fields, APIs, DB, connectivity, use-cases, FKs) + a data-model audit into this dir (default ./page_docs) — the RAG corpus for test generation")
    sp.add_argument("--page-docs-ai", action="store_true", help="With --page-docs, use AI (multi-loop) to infer missing fields, write use-cases, and flag missing FKs / normalization")
    sp.add_argument("--page-docs-limit", type=int, help="Limit page-docs to the N pages with the most fields (for a quick/cheap pass)")
    sp.add_argument("--no-enrich-contracts", dest="enrich_contracts", action="store_false", help="Phase 1.5: skip endpoint request-contract enrichment (on by default — reads each controller for its real request fields + validation rules)")
    sp.set_defaults(enrich_contracts=True)
    sp.add_argument("--enrich-contracts-ai", action="store_true", help="With contract enrichment, let AI infer request fields for controllers that parsing couldn't read (grounded + verified against source; parsed facts are never overridden)")

    # ── test ──────────────────────────────────────────────────────────────────
    tp = sub.add_parser("test", help="Generate & execute tests against a live ERP system")
    tp.add_argument("--path",         help="Path to ERP repository (for re-scan)")
    tp.add_argument("--graph",        help="Path to existing system_graph.json (skips re-scan)")
    tp.add_argument("--base-url",     default="http://localhost:3000", help="ERP app base URL (default: http://localhost:3000)")
    tp.add_argument("--timeout",      type=float, default=10.0,        help="HTTP request timeout in seconds (default: 10)")
    tp.add_argument("--no-browser",   action="store_true",             help="Skip Playwright browser tests")
    tp.add_argument("--headed",       action="store_true",             help="Run browser in headed (visible) mode")
    tp.add_argument("--screenshots-dir", default="./screenshots",      help="Directory to save screenshots (default: ./screenshots)")
    tp.add_argument("--ui-auth-storage-file", help="JSON file of {localStorage_key: value} to inject as a pre-authenticated UI session, so browser tests reach protected pages instead of the login redirect")
    tp.add_argument("--db",           choices=["sqlite","postgresql","mysql"], help="Database driver for DB assertions")
    tp.add_argument("--db-path",      help="(SQLite) path to .db file")
    tp.add_argument("--seed-db",      action="store_true", help="Build a self-contained SQLite test DB from the discovered schema and run DB/schema assertions against it (offline)")
    tp.add_argument("--seed-fixtures", action="store_true", help="(default; kept for back-compat) insert FK-ordered fixture rows with --seed-db")
    tp.add_argument("--no-fixtures",  action="store_true", help="With --seed-db, leave tables empty (skip fixture rows)")
    tp.add_argument("--mutate",       help="Mutation testing: comma-separated source files to mutate; re-runs the API suite against --base-url and reports the mutation score (how many injected bugs the suite catches)")
    tp.add_argument("--mutate-max",   type=int, default=8, help="Max mutants per file for --mutate (default: 8)")
    tp.add_argument("--mutate-reset-url", help="URL to hit between mutants to reset a server-side code cache (default: {base_url}/clear-cache.php; falls back to a timed wait)")
    tp.add_argument("--openapi",      help="Path to an OpenAPI/Swagger spec — derive contract tests (happy path, required-field negatives, documented errors)")
    tp.add_argument("--explore",      action="store_true", help="[experimental] AI proposes edge-case scenarios (grounded on the graph) that templates miss")
    tp.add_argument("--scenarios",    action="store_true", help="SCENARIO mode: RAG repo-memory + use-case/CRUD/cross-page scenarios, run with 3-way UI+API+DB verification, emit per-scenario .md + JSON + visual HTML + FAILURES.md")
    tp.add_argument("--scenarios-out", default="./scenario_report", help="Output directory for scenario reports (default: ./scenario_report)")
    tp.add_argument("--scenarios-ai",  action="store_true", help="With --scenarios, let the AI provider design extra use-case scenarios (graph-grounded; deterministic checks still decide pass/fail)")
    tp.add_argument("--scenarios-ai-max", type=int, default=8, help="Max AI-designed scenarios (default: 8)")
    tp.add_argument("--ui-base-url",   help="Frontend base URL for UI steps (default: same as --base-url); use when the SPA and API are on different hosts")
    tp.add_argument("--field-blackbox", action="store_true", help="DEPTH: generate the full per-field black-box battery (required/type/format/length/enum/boundary/fuzz-robustness) for every writable field. NOTE: the fuzz-robustness case only asserts the server does not 5xx on a hostile-looking string — it is NOT a vulnerability/injection check.")
    tp.add_argument("--field-blackbox-max", type=int, default=4000, help="Cap on per-field black-box cases (default: 4000)")
    tp.add_argument("--auth-token",     help="Static bearer token sent on every request (test protected endpoints)")
    tp.add_argument("--auth-login-url", help="Login URL/path to obtain a token before testing")
    tp.add_argument("--auth-user",      help="Username for --auth-login-url")
    tp.add_argument("--auth-pass",      help="Password for --auth-login-url")
    tp.add_argument("--auth-token-path", help="Dot path to the token in the login response JSON (default: token)")
    tp.add_argument("--db-host",      default="localhost", help="(PostgreSQL/MySQL) database host")
    tp.add_argument("--db-port",      help="(PostgreSQL/MySQL) database port")
    tp.add_argument("--db-name",      help="(PostgreSQL/MySQL) database name")
    tp.add_argument("--db-user",      help="(PostgreSQL/MySQL) database user")
    tp.add_argument("--db-password",  help="(PostgreSQL/MySQL) database password")
    tp.add_argument("--format",       choices=["json", "html", "junit"], default="json", help="Report format (default: json)")
    tp.add_argument("--output",       default="SystemIntel_Report.json", help="Report output path (default: SystemIntel_Report.json)")
    tp.add_argument("--allow-nonlocal-writes", action="store_true", help="SAFETY: permit mutating requests (POST/PUT/PATCH/DELETE) against a NON-local --base-url. Off by default — use ONLY on a disposable staging target you control, NEVER production.")
    tp.add_argument("--include-response-bodies", action="store_true", help="Keep live HTTP response bodies in the saved report (redacted by default, since they can contain PII/tokens).")

    # ── query ─────────────────────────────────────────────────────────────────
    qp = sub.add_parser("query", help="Natural language query over system graph")
    qp.add_argument("question", help="Question to ask about the system graph")
    qp.add_argument("--graph",  help="Path to system_graph.json for graph-grounded answers")

    # ── agent ─────────────────────────────────────────────────────────────────
    ap = sub.add_parser("agent", help="Run an autonomous AI agent to solve a high-level task")
    ap.add_argument("task", help="The task for the agent to solve (e.g., 'Find the bug in the customer controller')")
    ap.add_argument("--graph", required=True, help="Path to system_graph.json")

    args = parser.parse_args()

    if args.command == "scan":
        cmd_scan(args)
    elif args.command == "test":
        if not args.path and not args.graph:
            tp.print_help()
            print(f"\n{RED}[✗] Provide --path (repo directory) or --graph (existing graph JSON){RESET}")
            sys.exit(1)
        cmd_test(args)
    elif args.command == "query":
        cmd_query(args)
    elif args.command == "agent":
        cmd_agent(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
