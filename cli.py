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

    # A2: surface any swallowed parse errors so a partial graph is never mistaken
    # for a complete one — a missing edge could be a dropped file, not "no link".
    try:
        from engine import get_parse_errors
        _perrs = get_parse_errors()
    except Exception:
        _perrs = []
    if _perrs:
        print(f"\n  {YELLOW}⚠ {len(_perrs)} file(s) failed to parse and were skipped "
              f"— the graph may be INCOMPLETE:{RESET}")
        for pe in _perrs[:8]:
            print(f"    {DIM}- [{pe['where']}] {pe['file']}: {pe['error']}{RESET}")

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
    if getattr(args, 'auth_cookie', None):
        auth = AuthManager({"mode": "cookie", "cookie": args.auth_cookie})
    elif getattr(args, 'auth_token', None):
        auth = AuthManager({"mode": "token", "static_token": args.auth_token})
    elif getattr(args, 'auth_login_url', None):
        auth = AuthManager({"mode": "login", "login_url": args.auth_login_url,
                            "username": args.auth_user, "password": args.auth_pass,
                            "token_json_path": args.auth_token_path or "token"})
        auth.login(base_url=base_url)
    else:
        auth = AuthManager({"mode": "none"})
    return auth


def _controller_tokens(file_path):
    """Resource tokens implied by a controller file name, e.g.
    ProductController.php -> {'product', 'products'} (+ camelCase split).

    Generic area/prefix words (e.g. 'admin') are treated as stopwords: an
    AdminInvoiceController serves the *invoice* resource, not every /admin/*
    endpoint, so scoping on 'admin' would wrongly pull in the whole admin area
    (hundreds of endpoints) and make each mutant re-run the near-full suite. We
    scope on the specific resource instead, falling back to the generic words
    only if nothing specific remains."""
    import re as _re
    _STOP = {"admin", "api", "base", "abstract"}
    base = os.path.basename(file_path)
    base = _re.sub(r'\.php$', '', base, flags=_re.IGNORECASE)
    base = _re.sub(r'Controller$', '', base)
    words = [w.lower() for w in _re.findall(r'[A-Z]?[a-z0-9]+', base) if w]

    def _build(ws):
        t = set()
        for w in ws:
            if len(w) < 3:
                continue
            t.add(w); t.add(w + 's'); t.add(w.rstrip('s'))
        return t

    specific = _build([w for w in words if w not in _STOP])
    toks = specific if specific else _build(words)   # keep generic only if nothing else
    return toks, base


def _scope_api_units_to_files(api_units, files, args):
    """Restrict the mutation suite to only the endpoints the MUTATED files serve, so
    each suite re-run is small and fast instead of hammering all ~595 checks (many of
    which hang to timeout and are irrelevant to the mutated code). Resolution order:
      1. the graph's controllerName -> endpoints mapping (exact), when a graph is loaded;
      2. otherwise a resource-token heuristic from the controller file name.
    Returns (scoped_units, description). Falls back to the full set if nothing matches."""
    scope = getattr(args, 'mutate_scope', 'auto')
    if scope == 'all':
        return api_units, "all endpoints (--mutate-scope all)"

    in_scope_endpoints = set()   # {"POST /products", ...}
    used_graph = False
    gpath = getattr(args, 'graph', None)
    if gpath and os.path.isfile(gpath):
        try:
            with open(gpath) as fh:
                g = json.load(fh)
            want_controllers = set()
            for f in files:
                _t, base = _controller_tokens(f)
                want_controllers.add(base.lower())
            for ep in (g.get("apiEndpoints", []) or []):
                cn = str(ep.get("controllerName") or ep.get("controller") or "")
                cn = re.sub(r'Controller$', '', cn).lower()
                if cn and cn in want_controllers:
                    in_scope_endpoints.add(f"{(ep.get('method') or 'GET').upper()} {ep.get('path','')}")
            if in_scope_endpoints:
                used_graph = True
        except Exception:
            in_scope_endpoints = set()

    def _unit_in_scope(u):
        ep = u.get("endpoint", "")
        if used_graph:
            return ep in in_scope_endpoints
        # heuristic: the endpoint path contains a resource token of a mutated file
        path = ep.split(" ", 1)[1].lower() if " " in ep else ep.lower()
        for f in files:
            toks, _b = _controller_tokens(f)
            if any(t in path for t in toks):
                return True
        return False

    scoped = [u for u in api_units if _unit_in_scope(u)]
    if not scoped:
        # No endpoint's path carries the controller's resource token. Such a
        # controller is almost certainly not exercised by any check, so its
        # mutants will survive regardless — running ALL ~598 checks per mutant
        # (each a full suite re-run) is enormous wasted time for the same verdict.
        # Fall back to a bounded, deterministic safety-net sample instead: enough
        # to still catch a kill if the heuristic missed the real endpoint, without
        # the pathological cost. Override with --mutate-scope all for the full set.
        cap = int(getattr(args, 'mutate_fallback_cap', 40) or 40)
        sample = sorted(api_units, key=lambda u: u.get("endpoint", ""))[:cap]
        return sample, (f"{len(sample)} endpoint(s) — bounded fallback sample "
                        f"(no resource-token match; use --mutate-scope all for every endpoint)")
    how = "graph controllerName" if used_graph else "resource-name heuristic"
    return scoped, f"{len(scoped)} endpoint(s) served by the mutated file(s) [{how}]"


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
    from mutation import (MutationTester, discover_mutants, discovery_summary,
                          plan_execution)

    # ── Repo-wide DISCOVERY (dry-run) — the honest "how many mutants?" answer ──
    # Needs no app and no PHP: it enumerates every candidate mutant across the tree.
    _repo_root = getattr(args, 'mutate_repo', None) or (
        getattr(args, 'mutate_discover', False) and (args.path or "."))
    if getattr(args, 'mutate_discover', False):
        root = _repo_root or (args.path or ".")
        section("Mutation Discovery (dry-run — repo-wide mutant census)")
        catalog = discover_mutants(root)
        summ = discovery_summary(catalog)
        budget = getattr(args, 'mutate_budget', 50)
        plan = plan_execution(catalog, budget, getattr(args, 'mutate_per_file_cap', 0))
        print(f"{CYAN}[+] Root: {root}{RESET}")
        print(f"  {BOLD}Discovered mutants : {summ['discovered']}{RESET} "
              f"across {summ['files']} file(s)")
        print(f"  Would execute      : {plan['sampled']} at budget={budget} "
              f"{DIM}(~{plan['estimatedSeconds']/60:.1f} min; each = one full suite re-run){RESET}")
        print(f"  {DIM}by operator: {summ['byOperator']}{RESET}")
        top = sorted(summ['byFile'].items(), key=lambda kv: -kv[1])[:8]
        for f, n in top:
            print(f"    {DIM}• {os.path.relpath(f)}: {n}{RESET}")
        print(f"\n  {DIM}This is the true denominator — a prior run showing only a "
              f"handful of mutants was a budget cap, not the repo's real count.{RESET}")
        return

    base_url = args.base_url or "http://localhost:3000"
    auth = _build_auth(args, base_url)
    auth_headers = {"Content-Type": "application/json", **auth.auth_headers()}
    if auth.is_active():
        print(f"{GREEN}[✓] Auth active — mutation suite carries {'Cookie' if auth.mode=='cookie' else auth.header}{RESET}")

    repo_mode = bool(getattr(args, 'mutate_repo', None))
    files = []
    if repo_mode:
        # Repo-wide: discover the catalog across the tree (files derived from it).
        _catalog = discover_mutants(args.mutate_repo)
        if not _catalog:
            print(f"{RED}[✗] No mutants discovered under {args.mutate_repo}.{RESET}")
            sys.exit(1)
        files = list(dict.fromkeys(m["file"] for m in _catalog))
    else:
        # Resolve target files (comma-separated; relative to --path when given).
        for raw in [p.strip() for p in (args.mutate or "").split(",") if p.strip()]:
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

    # Scope the suite to the mutated file's own endpoints — a mutant in
    # ProductController can only be caught by /products checks, so running the
    # other ~590 checks (many of which hang to timeout) is pure wasted time.
    _full = len(api_units)
    api_units, _scope_desc = _scope_api_units_to_files(api_units, files, args)

    section("Mutation Testing — does the suite actually catch injected bugs?")
    print(f"{CYAN}[+] Target files: {len(files)}  |  API checks per run: {len(api_units)} "
          f"of {_full}  |  scope: {_scope_desc}{RESET}")
    for f in files:
        print(f"    {DIM}• {os.path.relpath(f)}{RESET}")

    runner    = HTTPRunner(base_url=base_url, timeout=args.timeout)
    reset_url = getattr(args, 'mutate_reset_url', None) or (base_url.rstrip('/') + "/clear-cache.php")
    _reset_ok = [True]  # track whether the reset hook works (avoids repeated slow fallbacks)

    # Build a proxy-bypassing opener: the reset target is always the local app, and
    # in sandboxed environments a configured HTTP(S)_PROXY would otherwise capture
    # the localhost request and fail it — forcing the slow timed fallback every run.
    _noproxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _reset_server_cache():
        try:
            with _noproxy_opener.open(reset_url, timeout=5) as r:
                r.read()
            return True
        except Exception:
            return False

    # Metamorphic pagination checks strengthen the mutation oracle: the flat
    # suite asserts mostly on status, so int mutations to a controller's page/limit
    # defaults and clamps keep returning 200 and survive. A pagination content
    # check (default page, param echo, row bound, clamp) flips when that logic
    # breaks → the mutant is killed. Discover the paginated GET collection
    # endpoints in scope ONCE, then re-check them every run.
    try:
        from pagination_oracle import check_pagination as _check_pag
    except ImportError:                                                       # pragma: no cover
        from backend.pagination_oracle import check_pagination as _check_pag  # type: ignore
    _pag_run = lambda a: runner.run_assertion({**a, "headers": auth_headers})
    _pag_candidates = []
    _seen_pg = set()
    for a in api_units:
        ep = a.get("endpoint", "")
        m = ep.split(" ", 1)[0].upper() if " " in ep else "GET"
        path = ep.split(" ", 1)[1] if " " in ep else ep
        if m == "GET" and "{" not in path and "?" not in path and ep not in _seen_pg:
            _seen_pg.add(ep)
            _pag_candidates.append(ep)
    _pag_eps = []
    for ep in _pag_candidates:
        try:
            v = _check_pag(ep, _pag_run)
            if not v.get("skipped"):        # a real paginated endpoint we can assert on
                _pag_eps.append(ep)
        except Exception:
            pass
    if _pag_eps:
        print(f"{CYAN}[+] Pagination oracle armed on {len(_pag_eps)} list endpoint(s): "
              f"{', '.join(_pag_eps[:5])}{'…' if len(_pag_eps) > 5 else ''}{RESET}")

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
        # Metamorphic pagination content checks (kill page/limit value mutations
        # that keep a 200 and so escape the status-only assertions above).
        for ep in _pag_eps:
            try:
                v = _check_pag(ep, _pag_run)
            except Exception:
                continue
            if v.get("skipped"):
                continue
            if v.get("passed"):
                passed += 1
            else:
                failed += 1
        return passed, failed

    # Honest discovery census before executing anything — the true denominator.
    catalog = (discover_mutants(args.mutate_repo) if repo_mode
               else [m for f in files for m in discover_mutants(f)])
    _census = discovery_summary(catalog)
    print(f"{BOLD}[i] Discovered {_census['discovered']} mutant(s) across "
          f"{_census['files']} file(s){RESET} {DIM}by operator {_census['byOperator']}{RESET}")

    # Optional per-mutant JSONL ledger: one flushed row per mutant (killed AND
    # survived) the moment it runs, for a live/unified test ledger. Works for BOTH
    # the repo-wide (execute_catalog) and single-file (run) paths.
    _mut_led = None
    _on_mutant = None
    if getattr(args, 'mutation_ledger', None):
        os.makedirs(os.path.dirname(os.path.abspath(args.mutation_ledger)) or ".", exist_ok=True)
        _mut_led = open(args.mutation_ledger, "a", encoding="utf-8")
        _mut_n = [0]
        def _on_mutant(rec, _f=_mut_led, _n=_mut_n):
            _n[0] += 1
            rel = os.path.relpath(rec["file"]) if os.path.exists(rec["file"]) else rec["file"]
            _f.write(json.dumps({
                "ts": time.time(), "id": f"MUT-{_n[0]:05d}", "cat": "Mutation",
                "layer": "MUT", "m": rec["op"], "ep": f"{rel}:{rec['lineno']}",
                "exp": "killed", "act": rec["verdict"],
                "v": "PASS" if rec["verdict"] == "killed" else "FAIL",
                "r": f"{rec.get('original','')} -> {rec.get('mutant','')}", "ms": rec.get("ms", 0),
            }, ensure_ascii=False) + "\n")
            _f.flush()
            try: os.fsync(_f.fileno())
            except Exception: pass

    print(f"{DIM}Running baseline (clean source)…{RESET}")
    if repo_mode:
        print(f"{CYAN}[+] Executing a bounded sample: budget={args.mutate_budget} "
              f"per_file_cap={args.mutate_per_file_cap or '∞'}{RESET}")
        result = MutationTester().execute_catalog(
            catalog, run_tests, budget=args.mutate_budget,
            per_file_cap=getattr(args, 'mutate_per_file_cap', 0),
            time_budget_seconds=getattr(args, 'mutate_time_budget', 0),
            on_mutant=_on_mutant)
        # normalize execute_catalog's shape to the printer below
        result.setdefault("mutantsTried", result.get("executed", 0))
    else:
        result = MutationTester().run(files, run_tests,
                                      max_mutants_per_file=args.mutate_max,
                                      on_mutant=_on_mutant)
    if _mut_led is not None:
        _mut_led.close()

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

    # S3: scenario mode runs CRUD (POST/PUT/DELETE) lifecycle flows. Refuse to run
    # it against a non-local target unless the operator explicitly opts in — the
    # main-path write guard is not reached on this code path.
    from urllib.parse import urlparse as _urlparse
    _shost = (_urlparse(base_url).hostname or "").lower()
    _s_local = _shost in ("localhost", "127.0.0.1", "::1", "0.0.0.0")
    if not _s_local and not getattr(args, "allow_nonlocal_writes", False):
        print(f"{RED}{BOLD}[!] SAFETY: scenario mode drives CRUD (create/update/delete) flows and "
              f"'{_shost}' is not a local target.{RESET}")
        print(f"{YELLOW}    Refusing to run scenarios against a non-local host without "
              f"--allow-nonlocal-writes (use ONLY on a disposable staging target).{RESET}")
        return

    section("Repo Memory (RAG) + Use-Case Scenario Generation")
    # If a page-docs corpus exists (from `scan --page-docs`), ingest it so
    # scenario generation is genuinely grounded on it. Look at --page-docs-dir,
    # else the default ./page_docs.
    from page_docs import load_page_docs
    _pd_dir = getattr(args, "page_docs_dir", None) or "./page_docs"
    _page_docs = load_page_docs(_pd_dir)
    if _page_docs:
        print(f"{GREEN}[✓] Grounding on page-docs corpus: {len(_page_docs)} page(s) from {_pd_dir}{RESET}")
    memory  = build_repo_memory(graph_data, page_docs=_page_docs)
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
        print(f"{GREEN}[✓] Auth active — API steps carry {'Cookie' if auth.mode=='cookie' else auth.header}{RESET}")
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
    paths = write_scenario_reports(results, out_dir, scenarios=scenarios,
                                   redact=not getattr(args, "include_response_bodies", False))
    p  = sum(1 for r in results if r["status"] == "PASS")
    f  = sum(1 for r in results if r["status"] == "FAIL")
    sk = sum(1 for r in results if r["status"] == "SKIPPED")
    section("Scenario Summary")
    print(f"  Scenarios : {len(results)}   {GREEN}PASS {p}{RESET}   {RED}FAIL {f}{RESET}   {YELLOW}SKIP {sk}{RESET}")
    for k, v in paths.items():
        print(f"  {DIM}{k:16s}{RESET} {v}")
    print()
    sys.exit(1 if f else 0)


def _record_run_history(report, history_file=None):
    """P9: append a compact run summary to a JSONL history file and print the
    delta vs. the previous run — the baseline for differential/regression checks."""
    path = history_file or ".systemintel_runs.jsonl"
    s = report.get("summary", {})
    entry = {
        "timestamp": report.get("timestamp"),
        "baseUrl":   report.get("baseUrl"),
        "total":     s.get("total"), "passed": s.get("passed"),
        "failed":    s.get("failed"), "skipped": s.get("skipped"),
        "executed":  s.get("executed"), "passRate": s.get("passRate"),
    }
    prev = None
    if os.path.exists(path):
        try:
            with open(path) as f:
                lines = [ln for ln in f if ln.strip()]
            if lines:
                prev = json.loads(lines[-1])
        except Exception:
            prev = None
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")

    if prev:
        def _d(k):
            a, b = prev.get(k) or 0, entry.get(k) or 0
            delta = b - a
            return f"{b} ({'+' if delta >= 0 else ''}{delta} vs last)"
        newly_failed = (entry.get("failed") or 0) - (prev.get("failed") or 0)
        col = RED if newly_failed > 0 else GREEN
        print(f"{col}[Δ] vs previous run — passed {_d('passed')}, failed {_d('failed')}, "
              f"skipped {_d('skipped')}{RESET}")
        if newly_failed > 0:
            print(f"{RED}    ⚠ regression: {newly_failed} more failing than last run{RESET}")
    else:
        print(f"{DIM}[i] run-history baseline recorded at {path}{RESET}")


def _apply_config_and_preset(args):
    """P7: apply a YAML config file and/or a named preset as DEFAULTS. An explicit
    CLI flag always wins (we only fill values the user left at their default)."""
    # (1) YAML config file — keys map to arg names (dashes or underscores).
    if getattr(args, "config", None):
        try:
            import yaml
            with open(args.config) as f:
                cfg = yaml.safe_load(f) or {}
            for k, v in cfg.items():
                attr = k.replace("-", "_")
                # Identity check (not `in (None, False)`) so an int arg legitimately
                # set to 0 (e.g. --timeout 0) isn't treated as unset and overwritten.
                cur = getattr(args, attr, "__missing__")
                if cur is None or cur is False:
                    setattr(args, attr, v)
            print(f"{GREEN}[✓] Loaded config defaults from {args.config}{RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Could not load --config {args.config}: {e}{RESET}")

    # (2) Named presets fill common flags (only where still unset).
    preset = getattr(args, "preset", None)
    if preset == "smoke":
        if not getattr(args, "no_browser", False): args.no_browser = True
    elif preset == "deep":
        if not getattr(args, "field_blackbox", False): args.field_blackbox = True
        if not getattr(args, "scenarios", False):      args.scenarios = True
    if preset:
        print(f"{GREEN}[✓] Applied '{preset}' preset{RESET}")

    # (3) EXHAUSTIVE mode — remove every generation cap / sample so the run computes
    #     ALL possible cases, combinations and mutants (no "one representative", no
    #     stratified sampling). Slow by design; the point is completeness, not speed.
    if getattr(args, "exhaustive", False):
        args.field_blackbox = True
        args.combinatorial = True
        args.field_blackbox_max = max(getattr(args, "field_blackbox_max", 0) or 0, 1_000_000)
        args.field_blackbox_rich_max = max(getattr(args, "field_blackbox_rich_max", 0) or 0, 999)
        args.combinatorial_max = max(getattr(args, "combinatorial_max", 0) or 0, 1_000_000)
        args.combinatorial_strength = max(getattr(args, "combinatorial_strength", 2) or 2, 2)
        args.scenarios_ai_max = max(getattr(args, "scenarios_ai_max", 0) or 0, 100)
        # mutation: run EVERY discovered mutant (no budget/per-file/time sampling)
        args.mutate_budget = 0            # 0 → execute the whole catalog
        args.mutate_per_file_cap = 0
        args.mutate_time_budget = 0
        args.mutate_max = max(getattr(args, "mutate_max", 0) or 0, 100000)  # file-mode: all per file
        args.mutate_scope = getattr(args, "mutate_scope", "auto") or "auto"
        print(f"{BOLD}[✓] EXHAUSTIVE mode: all caps removed — every field case, "
              f"combination and mutant will be generated/run (this is slow).{RESET}")


def _flat_edge_requirement_findings(tc, tc_result, http_runner, auth_headers,
                                    db_runner=None, block_writes=False):
    """Auto-invoke the in/out edge + requirement oracles on the flat `test` path.

    For a test case that performed a CREATE (POST) which returned 2xx, this issues a
    real READ-BACK GET for the created resource (and, when a DB runner is configured,
    fetches the stored row), then compares submitted -> stored -> read_back with
    field_edge_oracle and checks any machine-checkable requirements the case carries
    with requirement_oracle. Strictly ADDITIVE: attaches tc_result["oracleFindings"]
    and NEVER changes the case's own PASS/FAIL. Returns the findings dict (or None)."""
    try:
        from field_edge_oracle import check_field_edge
        from requirement_oracle import evaluate_requirements
    except ImportError:
        from backend.field_edge_oracle import check_field_edge          # type: ignore
        from backend.requirement_oracle import evaluate_requirements     # type: ignore

    # Find a successful write assertion (POST create) with a submitted body.
    submitted = dict(tc.get("testData", {}) or {})
    if not submitted:
        return None
    write_hr = None
    for hr in tc_result.get("httpResults", []):
        if hr.get("skipped") or not hr.get("passed"):
            continue
        if (hr.get("method") or "").upper() == "POST":
            write_hr = hr
            break
    if write_hr is None:
        return None

    # Resolve the created resource id and build a read-back GET.
    resp = write_hr.get("responseBody")
    created = resp.get("data") if isinstance(resp, dict) and isinstance(resp.get("data"), dict) else resp
    rid = None
    if isinstance(created, dict):
        for k in ("id", "ID", "uuid", "code"):
            if created.get(k) not in (None, ""):
                rid = created[k]; break
    endpoint = write_hr.get("endpoint", "")            # e.g. "POST /products"
    path = endpoint.split(" ", 1)[1] if " " in endpoint else endpoint
    read_back = {}
    if rid is not None and not block_writes:
        get_ep = f"GET {path.rstrip('/')}/{rid}"
        rb = http_runner.run_assertion({"type": "API", "endpoint": get_ep,
                                        "headers": auth_headers, "expectedStatusClass": "!5xx"})
        rb_body = rb.get("responseBody")
        if isinstance(rb_body, dict):
            read_back = rb_body.get("data") if isinstance(rb_body.get("data"), dict) else rb_body
        tc_result.setdefault("httpResults", []).append(rb)   # record the read-back call

    # Stored row via the DB runner, if a cross_layer table is known.
    stored = {}
    if db_runner is not None and rid is not None:
        tbl = None
        for a in tc.get("assertions", []):
            if a.get("type") == "DB" and a.get("table"):
                tbl = a.get("table"); break
        if tbl:
            try:
                row = db_runner.fetch_row(tbl, {"id": rid}) if hasattr(db_runner, "fetch_row") else None
                if isinstance(row, dict):
                    stored = row
            except Exception:
                stored = {}

    findings = {}
    if stored or read_back:
        edge = []
        for fld, val in submitted.items():
            if fld not in stored and fld not in read_back:
                continue
            kwargs = {"submitted": val}
            if fld in stored:
                kwargs["stored"] = stored[fld]
            if fld in read_back:
                kwargs["read_back"] = read_back[fld]
            edge.append(check_field_edge(fld, **kwargs))
        if edge:
            findings["fieldEdge"] = edge

    req_source = tc.get("requirements") or tc.get("use_cases") or tc.get("useCases")
    if req_source and read_back:
        findings["requirement"] = evaluate_requirements(req_source, read_back)

    if findings:
        tc_result["oracleFindings"] = findings
        return findings
    return None


def cmd_test(args):
    print_banner()
    section("Evidence-Based Test Generation")

    _apply_config_and_preset(args)

    repo_path = os.path.abspath(args.path) if args.path else None
    engine    = PythonSystemIntelligenceEngine()

    # Repo-wide mutation DISCOVERY is a pure static census — no graph, no app, no
    # test generation needed. Short-circuit here so `--mutate-discover` works on any
    # source tree directly (answers "how many mutants does my repo really have?").
    if getattr(args, 'mutate_discover', False):
        run_mutation_mode(args, [])
        return

    # Optional page-docs corpus (page-wise .md knowledge) — grounds the honest
    # field-coverage denominator with UI fields the schema/contracts don't name.
    _page_docs_corpus = None
    try:
        from page_docs import load_page_docs
        _pd_dir = getattr(args, "page_docs_dir", None) or "./page_docs"
        _page_docs_corpus = load_page_docs(_pd_dir) or None
    except Exception:
        _page_docs_corpus = None

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
        # A2: surface parse errors on the rescan path too (not only in `scan`) so a
        # test run against a repo with unparseable files warns of an incomplete graph.
        try:
            from engine import get_parse_errors
            _perrs = get_parse_errors()
            if _perrs:
                print(f"{YELLOW}⚠ {len(_perrs)} file(s) failed to parse — the graph "
                      f"(and generated tests) may be INCOMPLETE.{RESET}")
        except Exception:
            pass
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
            fbb = generate_field_blackbox_tests(
                fbb_graph, max_cases=getattr(args, 'field_blackbox_max', 4000),
                rich=not getattr(args, 'field_blackbox_lean', False),
                rich_max_per_method=getattr(args, 'field_blackbox_rich_max', 12))
            if fbb:
                by = {}
                for t in fbb:
                    by[t.get("subtype")] = by.get(t.get("subtype"), 0) + 1
                print(f"{GREEN}[✓] + {len(fbb)} per-field black-box test(s) — {by}{RESET}")
            test_cases += fbb
        except Exception as e:
            print(f"{YELLOW}[!] Per-field black-box generation failed: {e}{RESET}")

    # Combinatorial (pairwise) DEPTH — beyond single-fault isolation, exercise
    # multiple fields being wrong TOGETHER. A seeded covering array keeps the count
    # bounded (pairwise, not full cross-product). Opt-in (--combinatorial).
    if getattr(args, 'combinatorial', False):
        try:
            from combinatorial import generate_combinatorial_tests
            comb_graph = _loaded if (_loaded and (_loaded.get("requestContracts") or _loaded.get("apiEndpoints"))) else {
                "requestContracts": analysis.get("requestContracts", []) if isinstance(analysis, dict) else [],
                "apiEndpoints":     analysis.get("apiEndpoints", []),
                "dbTables":         analysis.get("dbResult", {}).get("tables", []),
            }
            _exh = getattr(args, 'exhaustive', False)
            comb = generate_combinatorial_tests(
                comb_graph,
                strength=getattr(args, 'combinatorial_strength', 2),
                cap_per_endpoint=(100000 if _exh else 64),
                max_cases=getattr(args, 'combinatorial_max', 2000),
                max_classes_per_field=(12 if _exh else 4))
            if comb:
                print(f"{GREEN}[✓] + {len(comb)} combinatorial (pairwise) test(s) — "
                      f"multi-field interaction coverage{RESET}")
            test_cases += comb
        except Exception as e:
            print(f"{YELLOW}[!] Combinatorial generation failed: {e}{RESET}")

    # Honest field-coverage accounting — the true denominator across DB columns,
    # contract fields AND page-docs UI fields, so the report states which fields were
    # exercised and which were not (and why). Printed whenever field-depth is on.
    if getattr(args, 'field_blackbox', False) or getattr(args, 'combinatorial', False):
        try:
            from field_blackbox import field_coverage_report
            cov_graph = _loaded if (_loaded and _loaded.get("apiEndpoints")) else {
                "apiEndpoints": analysis.get("apiEndpoints", []),
                "dbTables":     analysis.get("dbResult", {}).get("tables", []),
                "requestContracts": analysis.get("requestContracts", []) if isinstance(analysis, dict) else [],
                "nodes":        gb.to_dict().get("nodes", []),
                "edges":        gb.to_dict().get("edges", []),
            }
            cov = field_coverage_report(cov_graph, page_docs=_page_docs_corpus)
            print(f"{BOLD}[i] Field coverage: {cov['covered']}/{cov['total']} "
                  f"fields exercised ({cov['coverage']*100:.0f}%), {cov['uncovered']} "
                  f"uncovered {DIM}[db={cov['bySource']['db']} "
                  f"contract={cov['bySource']['contract']} page_docs={cov['bySource']['page_docs']}]{RESET}")
            _field_coverage = cov
        except Exception as e:
            print(f"{YELLOW}[!] Field-coverage report failed: {e}{RESET}")

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
    if getattr(args, 'mutate', None) or getattr(args, 'mutate_repo', None) or getattr(args, 'mutate_discover', False):
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
    if getattr(args, 'auth_cookie', None):
        auth = AuthManager({"mode": "cookie", "cookie": args.auth_cookie})
    elif getattr(args, 'auth_token', None):
        auth = AuthManager({"mode": "token", "static_token": args.auth_token})
    elif getattr(args, 'auth_login_url', None):
        auth = AuthManager({"mode": "login", "login_url": args.auth_login_url,
                            "username": args.auth_user, "password": args.auth_pass,
                            "token_json_path": args.auth_token_path or "token"})
        auth.login(base_url=base_url)
    else:
        auth = AuthManager({"mode": "none"})
    if auth.is_active():
        print(f"{GREEN}[✓] Auth active — protected requests carry {'Cookie' if auth.mode=='cookie' else auth.header}{RESET}")

    # HTTP runner. Protect the shared session whenever auth is active, so the
    # suite's own logout/revoke test does not silently invalidate the token that
    # scenarios, authz/IDOR, and later API tests all depend on.
    http_runner = HTTPRunner(base_url=base_url, timeout=args.timeout,
                             protect_session=auth.is_active())

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

    # Live recorder: writes every test to an append-only JSONL ledger + HTML the moment
    # it finishes, in parallel with execution (--live-report DIR). Also periodically
    # re-renders the HTML so a run in progress can be watched live.
    _recorder = None
    if getattr(args, "live_report", None):
        try:
            from test_recorder import TestRecorder, render_ledger
            _recorder = TestRecorder(args.live_report)
            print(f"{GREEN}[✓] Live ledger: {_recorder.jsonl} (+ ledger.html, refreshed as tests run){RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Live recorder unavailable: {e}{RESET}")
            _recorder = None

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
                # S3: honor the production-write guardrail here too — the executor
                # issues real POST/PUT/DELETE, which must be blocked against a
                # non-local target just like the plain assertion loop. Returning a
                # skipped result makes the executor SKIP the whole relation.
                verb = (a.get("endpoint", "GET").strip().split(" ", 1)[0] or "GET").upper()
                if block_writes and verb in ("POST", "PUT", "PATCH", "DELETE"):
                    return {"skipped": True,
                            "skipReason": "write blocked: non-local target without --allow-nonlocal-writes"}
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
            if _recorder:
                _recorder.record(tc_result)
                if _recorder.n % 50 == 0: render_ledger(_recorder.jsonl, _recorder.html)
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
            _verb = (a.get("endpoint", "GET").strip().split(" ", 1)[0] or "GET").upper()
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

        # 4. In/out edge + requirement oracles (read-back per write) — ADDITIVE.
        if getattr(args, "edge_oracle", True):
            try:
                of = _flat_edge_requirement_findings(
                    tc, tc_result, http_runner,
                    {"Content-Type": "application/json", **auth.auth_headers()},
                    db_runner=db_runner, block_writes=block_writes)
                if of:
                    fe = of.get("fieldEdge", [])
                    corrupt = [f for f in fe if f.get("passed") is False]
                    if corrupt:
                        for f in corrupt:
                            print(f"  {YELLOW}  ⧉ edge oracle: {f['field']} — {f['reason']}{RESET}")
                    rq = of.get("requirement")
                    if rq and rq.get("verdict") == "FAIL":
                        print(f"  {YELLOW}  ⧉ requirement oracle: {rq['failed']} requirement(s) violated{RESET}")
            except Exception as e:
                tc_result["oracleFindings"] = {"error": f"{type(e).__name__}: {e}"}

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
        if _recorder:
            _recorder.record(tc_result)
            if _recorder.n % 50 == 0: render_ledger(_recorder.jsonl, _recorder.html)

    # ── Opt-in EXTRA oracle passes (first-class --security-oracles / --ui-audits) ─
    # These wire the previously-unreachable injection_oracle / authz_oracle /
    # ui_audits modules into `cli.py test`. Each probe is recorded as a synthetic
    # tc_result folded into run_results / the summary / the --live-report ledger,
    # exactly like a normal test (verdict: a found vuln or serious a11y issue = FAIL,
    # safe = PASS, can't-evaluate = SKIP). All heavy imports are guarded INSIDE the
    # branches, so a normal run (neither flag set) is completely unaffected.
    _extra_seq = {}

    def _record_extra(category, title, verdict, reason, finding_key, finding,
                      duration_ms=0, id_prefix="EXTRA"):
        """Fold one extra-oracle probe into run_results + the counters + the ledger."""
        nonlocal passed_count, failed_count, skipped_count, total
        _extra_seq[id_prefix] = _extra_seq.get(id_prefix, 0) + 1
        tcr = {
            "testId":           f"{id_prefix}-{_extra_seq[id_prefix]:05d}",
            "title":            title,
            "category":         category,
            "playwrightResult": None,
            "httpResults":      [],
            "dbResults":        [],
            "overallStatus":    verdict,
            "failureReasons":   ([reason] if verdict == "FAIL" else []),
            "durationMs":       duration_ms,
            # A can't-evaluate SKIP verified nothing live — it is never counted as executed.
            "assertionsExecuted": 0 if verdict == "SKIPPED" else 1,
        }
        if finding is not None:
            tcr[finding_key] = finding
        if verdict == "PASS":
            passed_count += 1
        elif verdict == "FAIL":
            failed_count += 1
        else:
            skipped_count += 1
        total += 1
        run_results.append(tcr)
        if _recorder:
            _recorder.record(tcr)
            if _recorder.n % 50 == 0: render_ledger(_recorder.jsonl, _recorder.html)
        col = {"PASS": GREEN, "FAIL": RED}.get(verdict, YELLOW)
        print(f"  {col}{verdict:7s}{RESET} {title[:58]:58s} {DIM}{str(reason)[:58]}{RESET}")
        return tcr

    # ── 5. Security oracles — differential SQLi/XSS + IDOR/privilege ─────────────
    if getattr(args, "security_oracles", False):
        section("Security Oracles — injection (SQLi/XSS) + authz (IDOR/privilege)")
        try:
            try:
                from injection_oracle import check_sql_injection, check_reflected_xss
                from authz_oracle     import check_idor, check_privilege
            except ImportError:                                                   # pragma: no cover
                from backend.injection_oracle import check_sql_injection, check_reflected_xss  # type: ignore
                from backend.authz_oracle     import check_idor, check_privilege               # type: ignore
            import re as _re_sec

            # Endpoints/contracts come from the loaded graph (preferred) or the analysis.
            _sec_graph = _loaded if (_loaded and (_loaded.get("requestContracts") or _loaded.get("apiEndpoints"))) else {
                "requestContracts": (analysis.get("requestContracts", []) if isinstance(analysis, dict) else []),
                "apiEndpoints":     analysis.get("apiEndpoints", []),
            }
            admin_token = getattr(args, "auth_token", None) or ""     # owner/admin identity
            other_token = getattr(args, "other_token", None) or ""    # attacker/non-admin identity

            # The oracle `run` callable wraps HTTPRunner.run_assertion, defaulting to the
            # admin token for injection probes (which carry none) and honoring the
            # per-assertion authToken the authz probes set. The non-local write guard is
            # honored here too — mutating verbs against a non-local target SKIP.
            def _sec_run(a):
                verb = (a.get("endpoint", "GET").strip().split(" ", 1)[0] or "GET").upper()
                if block_writes and verb in ("POST", "PUT", "PATCH", "DELETE"):
                    return {"skipped": True,
                            "skipReason": "write blocked: non-local target without --allow-nonlocal-writes"}
                tok = a.get("authToken") or admin_token
                return http_runner.run_assertion({**a, "authToken": tok,
                                                  "headers": {"Content-Type": "application/json"}})

            def _sec_value(field):
                f = str(field).lower()
                if "email" in f: return "probe@demo.local"
                if "phone" in f or "mobile" in f: return "9990001112"
                if "password" in f: return "Test1234!"
                if "pin" in f: return "560001"
                if f.endswith("_id") or f == "id": return 1
                if any(k in f for k in ("qty", "quantity", "amount", "price", "count", "total", "stock")): return 5
                if "date" in f: return "2026-01-01"
                if "status" in f: return "active"
                return "probe"

            def _sec_verdict(res):
                # oracle: passed True -> safe (PASS); passed False -> vulnerable (FAIL); else SKIP
                if res.get("passed") is True:  return "PASS"
                if res.get("passed") is False: return "FAIL"
                return "SKIPPED"

            if not admin_token:
                print(f"{YELLOW}[!] No --auth-token — injection probes run unauthenticated and IDOR baselines will SKIP.{RESET}")
            if not other_token:
                print(f"{YELLOW}[!] No --other-token — IDOR/privilege probes will SKIP (they need a non-admin token).{RESET}")

            # (a) Injection: every writable request-contract field × {SQLi, XSS}.
            # Fallback: if the graph carries no request contracts (a scan run
            # without Phase-1.5 enrichment, or an externally-supplied --graph),
            # recover them on the fly straight from the controller source —
            # deterministic, no AI — so injection never silently fires 0 probes.
            # Source root for on-the-fly contract recovery, first that exists:
            # the scanned --path; the directory that holds the --graph file (the
            # graph is usually written inside the repo); the repoPath the graph
            # recorded at scan time. Lets even a bare --graph run read controllers.
            _sec_src = None
            for _cand in (repo_path,
                          (os.path.dirname(os.path.abspath(args.graph)) if getattr(args, "graph", None) else None),
                          (_sec_graph.get("repoPath") if isinstance(_sec_graph, dict) else None)):
                if _cand and os.path.isdir(_cand):
                    _sec_src = _cand
                    break
            if not _sec_graph.get("requestContracts") and _sec_src and os.path.isdir(_sec_src):
                try:
                    try:
                        from endpoint_contracts import build_endpoint_contracts as _bec
                    except ImportError:                                           # pragma: no cover
                        from backend.endpoint_contracts import build_endpoint_contracts as _bec  # type: ignore
                    _built = _bec(_sec_graph, _sec_src, provider=None)
                    _sec_graph["requestContracts"] = list(_built.values())
                    print(f"{CYAN}[+] Injection: graph had no contracts — recovered "
                          f"{len(_built)} from controller source (deterministic).{RESET}")
                except Exception as _e:
                    print(f"{YELLOW}[!] Injection: no request contracts and on-the-fly "
                          f"recovery failed ({type(_e).__name__}); SQLi/XSS will be skipped.{RESET}")
            contracts = [c for c in _sec_graph.get("requestContracts", [])
                         if c.get("method") in ("POST", "PUT", "PATCH") and c.get("fields")]
            print(f"{CYAN}[+] Injection: {len(contracts)} write-endpoint contract(s) with fields{RESET}")
            for c in contracts:
                ep = f'{c["method"]} {c["path"]}'
                fields = c["fields"]
                names = (list(fields.keys()) if isinstance(fields, dict)
                         else [(x.get("name") if isinstance(x, dict) else x) for x in fields])
                names = [n for n in names if n][:8]
                baseline = {n: _sec_value(n) for n in names}
                for fld in names:
                    for kind, fn in (("SQLi", check_sql_injection), ("XSS", check_reflected_xss)):
                        t0 = time.time()
                        try:
                            res = fn(ep, fld, baseline, _sec_run)
                        except Exception as _e:
                            _record_extra(f"Security · Injection · {kind}", f"{kind}: {ep} [{fld}]",
                                          "SKIPPED", f"err:{type(_e).__name__}", "securityFinding",
                                          None, round((time.time() - t0) * 1000), "SEC")
                            continue
                        _record_extra(f"Security · Injection · {kind}", f"{kind}: {ep} [{fld}]",
                                      _sec_verdict(res), res.get("reason", ""), "securityFinding",
                                      {k: res.get(k) for k in ("technique", "kind", "field", "vulnerable", "reason", "skipped")},
                                      round((time.time() - t0) * 1000), "SEC")

            # (b) IDOR (horizontal): GET endpoints with a {param}.
            # To get a real ownership baseline (not a SKIP), resolve each token's
            # OWN identity id via /auth/me and, for user-scoped resources, probe
            # that owner's own record — the owner then gets a genuine 2xx and the
            # oracle can decide PASS/FAIL. Endpoints we can't ground fall back to
            # id=1 (owner=admin) and SKIP honestly if admin doesn't own it.
            def _whoami(tok):
                if not tok:
                    return None
                try:
                    r = _sec_run({"type": "API", "endpoint": "GET /auth/me",
                                  "authToken": tok, "authSensitive": False})
                    b = r.get("responseBody")
                    d = b.get("data") if isinstance(b, dict) else None
                    d = d if isinstance(d, dict) else (b if isinstance(b, dict) else {})
                    for k in ("user_id", "id", "userId"):
                        if d.get(k):
                            return d.get(k)
                except Exception:
                    pass
                return None
            admin_id, other_id = _whoami(admin_token), _whoami(other_token)
            if admin_id or other_id:
                print(f"{CYAN}[+] IDOR: resolved owner ids (admin={admin_id}, other={other_id}) "
                      f"for grounded ownership baselines{RESET}")

            id_eps = [e for e in _sec_graph.get("apiEndpoints", [])
                      if e.get("method") == "GET" and "{" in (e.get("path", "") or "")]
            print(f"{CYAN}[+] IDOR: {len(id_eps)} resource-id GET endpoint(s){RESET}")
            for e in id_eps:
                path = e.get("path", "") or ""
                user_scoped = bool(_re_sec.search(r"/users?/\{", path)) or "userid" in path.lower()
                # (substituted-path, owner_token, attacker_token, tag)
                probes = []
                if user_scoped:
                    for _own_tok, _own_id, _atk_tok in ((other_token, other_id, admin_token),
                                                        (admin_token, admin_id, other_token)):
                        if _own_id and _own_tok and _atk_tok:
                            probes.append((_re_sec.sub(r"{[^}]+}", str(_own_id), path),
                                           _own_tok, _atk_tok, f"owner#{_own_id}"))
                if not probes:
                    probes.append((_re_sec.sub(r"{[^}]+}", "1", path), admin_token, other_token, "id=1"))
                for _spath, _own_tok, _atk_tok, _tag in probes:
                    ep = f"GET {_spath}"
                    t0 = time.time()
                    try:
                        res = check_idor(ep, _sec_run, _own_tok, _atk_tok)
                    except Exception as _ex:
                        _record_extra("Security · Authz · IDOR", f"IDOR: {ep} [{_tag}]", "SKIPPED",
                                      f"err:{type(_ex).__name__}", "securityFinding", None,
                                      round((time.time() - t0) * 1000), "SEC")
                        continue
                    _record_extra("Security · Authz · IDOR", f"IDOR: {ep} [{_tag}]", _sec_verdict(res),
                                  res.get("reason", ""), "securityFinding",
                                  {k: res.get(k) for k in ("technique", "kind", "endpoint", "vulnerable", "reason", "skipped")},
                                  round((time.time() - t0) * 1000), "SEC")

            # (c) Privilege (vertical): /admin/* GET endpoints without a path param.
            adm_eps = [e for e in _sec_graph.get("apiEndpoints", [])
                       if "/admin/" in (e.get("path", "") or "") and e.get("method") == "GET"
                       and "{" not in (e.get("path", "") or "")][:150]
            print(f"{CYAN}[+] Privilege: {len(adm_eps)} admin GET endpoint(s) (cap 150){RESET}")
            for e in adm_eps:
                ep = f'GET {e["path"]}'
                t0 = time.time()
                try:
                    res = check_privilege(ep, _sec_run, other_token)
                except Exception as _ex:
                    _record_extra("Security · Authz · Privilege", f"PRIV: {ep}", "SKIPPED",
                                  f"err:{type(_ex).__name__}", "securityFinding", None,
                                  round((time.time() - t0) * 1000), "SEC")
                    continue
                _record_extra("Security · Authz · Privilege", f"PRIV: {ep}", _sec_verdict(res),
                              res.get("reason", ""), "securityFinding",
                              {k: res.get(k) for k in ("technique", "kind", "endpoint", "vulnerable", "reason", "skipped")},
                              round((time.time() - t0) * 1000), "SEC")
        except Exception as _e:
            print(f"{YELLOW}[!] Security oracles failed (run otherwise unaffected): {type(_e).__name__}: {_e}{RESET}")

    # ── 6. UI audits — WCAG accessibility over the app's pages (needs the browser) ─
    if getattr(args, "ui_audits", False):
        section("UI Audits — WCAG accessibility over the app's pages")
        if not playwright_runner:
            print(f"{YELLOW}[!] UI audits need the browser, but none is available "
                  f"(--no-browser or Playwright not installed) — skipping.{RESET}")
            _record_extra("UI audit · a11y", "Accessibility audit", "SKIPPED",
                          "no browser available", "auditFinding", None, 0, "AUD")
        else:
            try:
                from ui_audits import audit_accessibility
                ui_base = (getattr(args, "ui_base_url", None) or base_url).rstrip("/")
                page = playwright_runner.page

                # Best-effort login so protected pages render instead of redirecting.
                ui_user = getattr(args, "auth_user", None) or "admin@demo.local"
                ui_pass = getattr(args, "auth_pass", None) or ""
                try:
                    page.goto(f"{ui_base}/login", wait_until="networkidle", timeout=25000)
                    page.fill('input[type="email"], input[name="email"]', ui_user, timeout=6000)
                    if page.locator('input[type="password"]').count():
                        page.fill('input[type="password"]', ui_pass, timeout=6000)
                    page.click('button[type="submit"]', timeout=6000)
                    page.wait_for_timeout(2000)
                except Exception as _le:
                    print(f"{DIM}  login note: {str(_le)[:70]}{RESET}")

                # Audit routes from the graph's pages (fall back to the site root).
                _pages = ((_loaded.get("pages") if _loaded else None)
                          or analysis.get("pages", []) or [])
                routes = []
                for p in _pages:
                    rp = p.get("routePath") or p.get("route") or ""
                    if isinstance(rp, str) and rp.startswith("/") and rp not in routes:
                        routes.append(rp)
                if not routes:
                    routes = ["/"]
                print(f"{CYAN}[+] Auditing {len(routes)} page route(s) for accessibility{RESET}")

                for route in routes:
                    t0 = time.time()
                    try:
                        page.goto(f"{ui_base}{route}", wait_until="networkidle", timeout=25000)
                        page.wait_for_timeout(500)
                        if "/login" in (page.url or ""):
                            _record_extra("UI audit · a11y", f"Accessibility: {route}", "SKIPPED",
                                          "auth redirect to /login", "auditFinding",
                                          {"route": route}, round((time.time() - t0) * 1000), "AUD")
                            continue
                        issues = audit_accessibility(page)
                        serious = [i for i in issues if i.get("severity") == "serious"]
                        if not issues:
                            _record_extra("UI audit · a11y", f"Accessibility: {route}", "PASS",
                                          "no accessibility issues", "auditFinding",
                                          {"route": route, "issues": []},
                                          round((time.time() - t0) * 1000), "AUD")
                        else:
                            verdict = "FAIL" if serious else "SKIPPED"
                            reason = ", ".join(f'{i.get("rule")}×{i.get("count")}' for i in issues[:5])
                            _record_extra("UI audit · a11y", f"Accessibility: {route}", verdict,
                                          reason, "auditFinding",
                                          {"route": route, "issues": issues,
                                           "seriousCount": sum(i.get("count", 0) for i in serious)},
                                          round((time.time() - t0) * 1000), "AUD")
                    except Exception as _pe:
                        _record_extra("UI audit · a11y", f"Accessibility: {route}", "SKIPPED",
                                      f"err:{type(_pe).__name__}", "auditFinding",
                                      {"route": route}, round((time.time() - t0) * 1000), "AUD")
            except Exception as _e:
                print(f"{YELLOW}[!] UI audits failed (run otherwise unaffected): {type(_e).__name__}: {_e}{RESET}")

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

    if _recorder:
        try:
            html_path = _recorder.finalize({
                "total": total, "passed": passed_count, "failed": failed_count,
                "skipped": skipped_count, "executed": executed,
                "passRate": round(pass_rate, 1)})
            print(f"{GREEN}[✓] Live ledger finalized: {html_path} ({_recorder.n} tests recorded){RESET}")
        except Exception as e:
            print(f"{YELLOW}[!] Ledger finalize failed: {e}{RESET}")

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

    # ── P9: run-history + baseline diff ─────────────────────────────────────
    # Append this run's summary to a history file and show the delta vs the
    # previous run (the "regression / differential" baseline the roadmap needs).
    try:
        _record_run_history(report, getattr(args, "history_file", None))
    except Exception as e:
        print(f"{DIM}[i] run-history not updated: {e}{RESET}")

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
    tp.add_argument("--mutate-max",   type=int, default=8, help="Max mutants per file for the fixed-file --mutate path (default: 8)")
    tp.add_argument("--mutate-repo",  help="Repo-wide mutation: a DIRECTORY to discover mutants across (all matching source files), then execute a bounded, stratified, seeded sample. Reports discovered-vs-executed honestly.")
    tp.add_argument("--mutate-discover", action="store_true", help="DRY-RUN: discover and report the true repo-wide mutant count (per file / per operator) WITHOUT executing anything — no app, no PHP needed. Answers 'how many mutants does my repo actually have?'.")
    tp.add_argument("--mutate-budget", type=int, default=50, help="Repo-wide mutation: max mutants to actually execute from the discovered catalog (default: 50). Each executed mutant re-runs the whole suite, so this bounds wall-clock time.")
    tp.add_argument("--mutate-per-file-cap", type=int, default=0, help="Repo-wide mutation: cap mutants executed per file so one huge file can't dominate the sample (0 = no cap).")
    tp.add_argument("--mutate-time-budget", type=float, default=0, help="Repo-wide mutation: soft wall-clock cap in seconds (0 = none).")
    tp.add_argument("--mutation-ledger", help="Repo-wide mutation: append a per-mutant JSONL row (killed AND survived) to this file as each mutant runs — for a live/unified test ledger.")
    tp.add_argument("--mutate-fallback-cap", type=int, default=40, help="Mutation scoping: when a mutated file's resource token matches no endpoint, cap the safety-net fallback suite to this many endpoints instead of all of them (0/none disables the cap). Default 40.")
    tp.add_argument("--mutate-scope", default="auto", help="Which endpoints the mutation suite re-runs per mutant: 'auto' (default) = only the endpoints the mutated file serves (fast, via the graph's controller→endpoint map or a resource-name heuristic); 'all' = every endpoint (slow). A mutant is only catchable by checks that exercise its code, so 'auto' gives the same kills far faster.")
    tp.add_argument("--mutate-reset-url", help="URL to hit between mutants to reset a server-side code cache (default: {base_url}/clear-cache.php; falls back to a timed wait)")
    tp.add_argument("--openapi",      help="Path to an OpenAPI/Swagger spec — derive contract tests (happy path, required-field negatives, documented errors)")
    tp.add_argument("--explore",      action="store_true", help="[experimental] AI proposes edge-case scenarios (grounded on the graph) that templates miss")
    tp.add_argument("--scenarios",    action="store_true", help="SCENARIO mode: RAG repo-memory + use-case/CRUD/cross-page scenarios, run with 3-way UI+API+DB verification, emit per-scenario .md + JSON + visual HTML + FAILURES.md")
    tp.add_argument("--scenarios-out", default="./scenario_report", help="Output directory for scenario reports (default: ./scenario_report)")
    tp.add_argument("--page-docs-dir", help="Directory holding a page-docs corpus (page_docs.json from `scan --page-docs`). When present, scenario generation is grounded on it (default: ./page_docs).")
    tp.add_argument("--scenarios-ai",  action="store_true", help="With --scenarios, let the AI provider design extra use-case scenarios (graph-grounded; deterministic checks still decide pass/fail)")
    tp.add_argument("--scenarios-ai-max", type=int, default=8, help="Max AI-designed scenarios (default: 8)")
    tp.add_argument("--ui-base-url",   help="Frontend base URL for UI steps (default: same as --base-url); use when the SPA and API are on different hosts")
    tp.add_argument("--field-blackbox", action="store_true", help="DEPTH: generate the full per-field black-box battery (required/type/format/length/enum/boundary/fuzz-robustness) for every writable field. NOTE: the fuzz-robustness case only asserts the server does not 5xx on a hostile-looking string — it is NOT a vulnerability/injection check.")
    tp.add_argument("--field-blackbox-max", type=int, default=4000, help="Cap on per-field black-box cases (default: 4000)")
    tp.add_argument("--field-blackbox-rich-max", type=int, default=12, help="RICH battery: max cases per method per field (default: 12 — e.g. 12 malformed emails, 12 boundary values, 12 XSS/SQLi vectors each).")
    tp.add_argument("--field-blackbox-lean", action="store_true", help="Use the lean one-case-per-method battery instead of the rich multi-case-per-method battery (default is rich).")
    tp.add_argument("--exhaustive", action="store_true", help="EXHAUSTIVE mode: remove EVERY generation cap and sample — turn on field-blackbox + combinatorial, uncap per-method/per-endpoint/global limits, and (with --mutate/--mutate-repo) run ALL discovered mutants (no stratified sampling, no budget/time cap). Computes all possible cases/combinations/mutants. Very slow — completeness over speed.")
    tp.add_argument("--edge-oracle", dest="edge_oracle", action="store_true", default=True, help="After each successful CREATE (POST), issue a read-back GET (and a DB row read when --db is set) and run the in/out edge + requirement oracles over submitted -> stored -> read_back. Additive: never changes a case's PASS/FAIL. On by default.")
    tp.add_argument("--no-edge-oracle", dest="edge_oracle", action="store_false", help="Disable the per-write read-back edge/requirement oracle pass.")
    tp.add_argument("--combinatorial", action="store_true", help="DEPTH: generate pairwise (t-wise) combinatorial tests — multiple fields wrong TOGETHER, not just single-fault isolation. A seeded covering array keeps the count bounded (pairwise, not full cross-product).")
    tp.add_argument("--combinatorial-strength", type=int, default=2, choices=[1, 2], help="Combinatorial strength: 1 = each value-class once; 2 = pairwise (default).")
    tp.add_argument("--combinatorial-max", type=int, default=2000, help="Global cap on combinatorial cases (default: 2000).")
    tp.add_argument("--auth-token",     help="Static bearer token sent on every request (test protected endpoints)")
    tp.add_argument("--auth-cookie",    help="Session cookie sent on every request, e.g. 'PHPSESSID=abc123' (for cookie/session auth instead of a bearer token)")
    tp.add_argument("--auth-login-url", help="Login URL/path to obtain a token before testing")
    tp.add_argument("--auth-user",      help="Username for --auth-login-url")
    tp.add_argument("--auth-pass",      help="Password for --auth-login-url")
    tp.add_argument("--auth-token-path", help="Dot path to the token in the login response JSON (default: token)")
    tp.add_argument("--other-token",   help="A second, NON-admin bearer token. Required by --security-oracles for the IDOR (horizontal) and privilege-escalation (vertical) differential checks — the admin token (--auth-token) is the owner/admin identity, this is the attacker/non-admin identity.")
    tp.add_argument("--security-oracles", action="store_true", help="Run the differential security oracles against the graph's endpoints: injection (boolean-differential SQLi + reflected XSS on every writable request-contract field) and authz (IDOR on resource-id GETs + privilege escalation on /admin/* GETs). A real vuln = FAIL, safe = PASS, can't-evaluate = SKIP. IDOR/privilege need --other-token.")
    tp.add_argument("--ui-audits",     action="store_true", help="Run the WCAG accessibility audit (ui_audits) over the app's pages in the browser (needs Playwright; incompatible with --no-browser). A serious a11y violation on a page = FAIL, moderate/minor = SKIP, clean = PASS.")
    tp.add_argument("--db-host",      default="localhost", help="(PostgreSQL/MySQL) database host")
    tp.add_argument("--db-port",      help="(PostgreSQL/MySQL) database port")
    tp.add_argument("--db-name",      help="(PostgreSQL/MySQL) database name")
    tp.add_argument("--db-user",      help="(PostgreSQL/MySQL) database user")
    tp.add_argument("--db-password",  help="(PostgreSQL/MySQL) database password")
    tp.add_argument("--format",       choices=["json", "html", "junit"], default="json", help="Report format (default: json)")
    tp.add_argument("--output",       default="SystemIntel_Report.json", help="Report output path (default: SystemIntel_Report.json)")
    tp.add_argument("--preset", choices=["smoke", "deep"], help="Convenience preset: 'smoke' = fast API-only pass (no browser); 'deep' = field-blackbox + scenarios. Explicit flags still override.")
    tp.add_argument("--config", help="Path to a YAML config file whose keys set defaults for test flags (explicit CLI flags override).")
    tp.add_argument("--history-file", help="JSONL run-history file (default: .systemintel_runs.jsonl). Each run appends a summary and prints the delta vs the previous run.")
    tp.add_argument("--live-report", help="Record EVERY test in parallel with execution to DIR/ledger.jsonl (one flushed line per test) and DIR/ledger.html (a filterable, searchable ledger refreshed as the run progresses). Captures all tests even if the run is interrupted.")
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
        # --mutate-discover is a static census over a source tree; it needs neither
        # a graph nor a scanned repo path.
        if not args.path and not args.graph and not getattr(args, "mutate_discover", False):
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
