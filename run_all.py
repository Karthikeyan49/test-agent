#!/usr/bin/env python3
"""SystemIntel master orchestrator.

Runs EVERY test family against a live app in ordered phases, with bounded
parallelism where it is write-safe, streams each family to its own per-test
JSONL ledger, and emits ONE consolidated HTML + PDF report at the end.

Families / phases (default order):
  1. api        flat black-box + combinatorial + metamorphic + invariants + DB   (cli.py)
  2. security   differential SQLi/XSS (injection_oracle) + IDOR/privilege (authz_oracle)
  3. ui         browser field battery: full corpus + enum + required + exhaustive combos
  4. audit      accessibility audit (ui_audits)
  5. scenarios  3-way UI+API+DB use-case / CRUD / cross-page (cli.py --scenarios)
  6. mutation   repo-wide mutation, isolated parallel workers (cli.py --mutate-repo)
  7. exhaustive uncapped API (cli.py --exhaustive)   [opt-in: --with-exhaustive]
  8. report     consolidated HTML + PDF (report_build.py)

Parallelism: security + audit are light and independent, so they run together;
everything else runs sequentially to avoid overloading the single app process
(concurrent heavy write-load has been observed to OOM the stack). Mutation is
internally parallel across isolated worker DBs.

Model switching: AI-assisted phases (scenarios --ai, explore, vision) use the
tool's AIProvider, which rotates across Gemini models on per-model quota (429).
Provide a key via the env var SYSTEMINTEL_AI_API_KEY (with SYSTEMINTEL_AI_PROVIDER
and SYSTEMINTEL_AI_ALLOW_EXTERNAL=1); the key is read from the environment only
and never written to disk. Without a key, AI phases fall back to deterministic
offline behavior. Enable AI phases with --ai.

Usage:
  python3 run_all.py --out-dir ./run1 \
      --base-url http://localhost:8080 --ui-url http://127.0.0.1:5174 \
      --graph graph.json --admin-token "$TOK" [--non-admin-token "$TOK2"] \
      --db mysql --db-name ecosudar_test --db-user ecosudar --db-password ecosudar \
      [--phases api,security,ui,audit,scenarios,mutation,report] [--ai] [--with-exhaustive]
"""
import argparse, json, os, subprocess, sys, time, re
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "backend")
sys.path.insert(0, BACKEND)

DEFAULT_PHASES = "api,security,ui,audit,scenarios,mutation,report"


def log(msg): print(f"[run_all {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def ledger_writer(path):
    f = open(path, "w", encoding="utf-8"); n = [0]
    def emit(cat, layer, m, ep, exp, act, v, r, ms=0):
        n[0] += 1
        f.write(json.dumps({"ts": time.time(), "id": f"{layer}-{n[0]:05d}", "cat": cat,
            "layer": layer, "m": str(m or ""), "ep": str(ep)[:90], "exp": str(exp),
            "act": str(act), "v": v, "r": str(r)[:170], "ms": ms}, ensure_ascii=False) + "\n")
        f.flush()
        try: os.fsync(f.fileno())
        except Exception: pass
    emit.close = f.close; emit.count = lambda: n[0]
    return emit


def http_ok(url, timeout=6):
    import urllib.request
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with op.open(url, timeout=timeout) as r: return 200 <= r.status < 500
    except Exception: return False


# ── phases ────────────────────────────────────────────────────────────────────
def phase_api(a, outdir):
    log("PHASE api — flat black-box + combinatorial + DB + edge-oracle")
    cmd = [sys.executable, "cli.py", "test", "--graph", a.graph, "--base-url", a.base_url,
           "--auth-token", a.admin_token, "--timeout", "4", "--no-browser",
           "--field-blackbox", "--field-blackbox-max", str(a.field_max),
           "--combinatorial", "--combinatorial-max", str(a.combo_max),
           "--live-report", os.path.join(outdir, "api_live"),
           "--format", "json", "--output", os.path.join(outdir, "api_report.json")]
    if a.db:
        cmd += ["--db", a.db, "--db-host", a.db_host, "--db-port", str(a.db_port),
                "--db-name", a.db_name, "--db-user", a.db_user, "--db-password", a.db_password]
    if a.page_docs: cmd += ["--page-docs-dir", a.page_docs]
    _run(cmd, os.path.join(outdir, "api.log"))


def phase_security(a, outdir):
    log("PHASE security — injection_oracle (SQLi/XSS) + authz_oracle (IDOR/privilege)")
    from http_runner import HTTPRunner
    from injection_oracle import check_sql_injection, check_reflected_xss
    from authz_oracle import check_idor, check_privilege
    g = json.load(open(a.graph))
    hr = HTTPRunner(base_url=a.base_url, timeout=6)
    def run(x):
        tok = x.get("authToken") or a.admin_token
        return hr.run_assertion({**x, "authToken": tok, "headers": {"Content-Type": "application/json"}})
    emit = ledger_writer(os.path.join(outdir, "sec_ledger.jsonl"))
    def verdict(res): return "PASS" if res.get("passed") is True else ("FAIL" if res.get("passed") is False else "SKIPPED")
    def vv(fld):
        f = fld.lower()
        if "email" in f: return "probe@demo.local"
        if "phone" in f or "mobile" in f: return "9990001112"
        if "password" in f: return "Test1234!"
        if "pin" in f: return "560001"
        if f.endswith("_id") or f == "id": return 1
        if any(k in f for k in ("qty","amount","price","count","total","stock")): return 5
        return "probe"
    for c in [c for c in g.get("requestContracts", []) if c.get("method") in ("POST","PUT","PATCH") and c.get("fields")]:
        ep = f'{c["method"]} {c["path"]}'; fields = c["fields"]
        names = (list(fields) if not isinstance(fields, dict) else list(fields.keys()))[:8]
        baseline = {n: vv(n) for n in names}
        for fld in names:
            for kind, fn in (("SQLi", check_sql_injection), ("XSS", check_reflected_xss)):
                try: res = fn(ep, fld, baseline, run)
                except Exception as e:
                    emit(f"Injection · {kind}", "SEC", kind, f"{ep} [{fld}]", "safe", "err", "SKIPPED", type(e).__name__); continue
                emit(f"Injection · {kind}", "SEC", kind, f"{ep} [{fld}]", "safe", verdict(res).lower(), verdict(res), res.get("reason",""))
    for e in [e for e in g.get("apiEndpoints", []) if e.get("method") == "GET" and "{" in e.get("path","")]:
        ep = f'GET {re.sub(r"{[^}]+}", "1", e["path"])}'
        try: res = check_idor(ep, run, a.admin_token, a.non_admin_token or "")
        except Exception as ex:
            emit("Authz · IDOR", "SEC", "IDOR", ep, "safe", "err", "SKIPPED", type(ex).__name__); continue
        emit("Authz · IDOR", "SEC", "IDOR", ep, "safe", verdict(res).lower(), verdict(res), res.get("reason",""))
    for e in [e for e in g.get("apiEndpoints", []) if "/admin/" in e.get("path","") and e.get("method")=="GET" and "{" not in e.get("path","")][:150]:
        ep = f'GET {e["path"]}'
        try: res = check_privilege(ep, run, a.non_admin_token or "")
        except Exception as ex:
            emit("Authz · Privilege", "SEC", "PRIV", ep, "safe", "err", "SKIPPED", type(ex).__name__); continue
        emit("Authz · Privilege", "SEC", "PRIV", ep, "safe", verdict(res).lower(), verdict(res), res.get("reason",""))
    emit.close(); log(f"  security probes: {emit.count()}")


def phase_audit(a, outdir):
    log("PHASE audit — accessibility (ui_audits)")
    from playwright_runner import PlaywrightRunner
    from ui_audits import audit_accessibility
    emit = ledger_writer(os.path.join(outdir, "audit_ledger.jsonl"))
    r = PlaywrightRunner(base_url=a.ui_url, headless=True, screenshots_dir=os.path.join(outdir, "aud_shots"))
    r.start(); p = r.page
    try:
        p.goto(f"{a.ui_url}/login", wait_until="networkidle", timeout=25000)
        p.fill('input[type="email"], input[name="email"]', a.ui_user, timeout=6000)
        if p.locator('input[type="password"]').count(): p.fill('input[type="password"]', a.ui_pass, timeout=6000)
        p.click('button[type="submit"]', timeout=6000); p.wait_for_timeout(3000)
    except Exception as e: log(f"  login note: {str(e)[:60]}")
    sevv = {"serious": "FAIL", "moderate": "SKIPPED", "minor": "SKIPPED"}
    for route in a.audit_routes:
        try:
            p.goto(f"{a.ui_url}{route}", wait_until="networkidle", timeout=25000); p.wait_for_timeout(600)
            if "/login" in p.url:
                emit("UI audit · a11y", "AUD", "a11y", route, "no serious a11y", "skip", "SKIPPED", "auth redirect"); continue
            issues = audit_accessibility(p)
            if not issues: emit("UI audit · a11y", "AUD", "a11y", route, "no serious a11y", "pass", "PASS", "clean")
            for iss in issues:
                sev = iss.get("severity", "minor")
                emit(f"UI audit · a11y ({sev})", "AUD", "a11y", f'{route} [{iss.get("rule")}]',
                     "no serious a11y", sev, sevv.get(sev, "SKIPPED"),
                     f'{iss.get("rule")}: {iss.get("count")} node(s)')
        except Exception as e:
            emit("UI audit · a11y", "AUD", "a11y", route, "testable", "err", "SKIPPED", type(e).__name__)
    try: r.stop()
    except Exception: pass
    emit.close(); log(f"  audit rows: {emit.count()}")


def phase_scenarios(a, outdir):
    log("PHASE scenarios — 3-way UI+API+DB")
    cmd = [sys.executable, "cli.py", "test", "--graph", a.graph, "--base-url", a.base_url,
           "--ui-base-url", a.ui_url, "--auth-token", a.admin_token, "--timeout", "5",
           "--scenarios", "--scenarios-out", os.path.join(outdir, "scenario_out")]
    if a.db:
        cmd += ["--db", a.db, "--db-host", a.db_host, "--db-port", str(a.db_port),
                "--db-name", a.db_name, "--db-user", a.db_user, "--db-password", a.db_password]
    if a.page_docs: cmd += ["--page-docs-dir", a.page_docs]
    if a.ai: cmd += ["--scenarios-ai", "--scenarios-ai-max", "12"]
    lg = os.path.join(outdir, "scenarios.log"); _run(cmd, lg)
    _scenarios_to_ledger(lg, os.path.join(outdir, "scenario_ledger.jsonl"))


def _scenarios_to_ledger(logpath, out):
    txt = re.sub(r'\x1b\[[0-9;]*m', '', open(logpath, encoding="utf-8", errors="ignore").read())
    emit = ledger_writer(out)
    for m in re.finditer(r'^\s*\[(\d+)/\d+\]\s+(PASS|FAIL|SKIP\w*)\s+(.*?)\s{2,}(ui=\S+ api=\S+ db=\S+)\s*$', txt, re.M):
        n, verd, title, layers = m.groups()
        v = "PASS" if verd == "PASS" else ("SKIPPED" if verd.startswith("SKIP") else "FAIL")
        cat = title.split(":")[0] if ":" in title else "Scenario"
        emit(f"Scenario · {cat}", "SCN", "3-way", title, "pass", verd.lower(), v, layers)
    emit.close()


def phase_mutation(a, outdir):
    log("PHASE mutation — repo-wide, scoped")
    cmd = [sys.executable, "cli.py", "test", "--graph", a.graph, "--base-url", a.base_url,
           "--auth-token", a.admin_token, "--timeout", "2", "--no-browser",
           "--mutate-repo", a.mutate_repo, "--mutate-scope", "auto",
           "--mutate-budget", str(a.mutate_budget), "--mutate-per-file-cap", str(a.mutate_per_file_cap),
           "--mutation-ledger", os.path.join(outdir, "mutation_ledger.jsonl")]
    _run(cmd, os.path.join(outdir, "mutation.log"))


def phase_exhaustive(a, outdir):
    log("PHASE exhaustive — uncapped API (very slow)")
    cmd = [sys.executable, "cli.py", "test", "--graph", a.graph, "--base-url", a.base_url,
           "--auth-token", a.admin_token, "--timeout", "4", "--no-browser", "--exhaustive",
           "--live-report", os.path.join(outdir, "exh_live")]
    if a.db:
        cmd += ["--db", a.db, "--db-host", a.db_host, "--db-port", str(a.db_port),
                "--db-name", a.db_name, "--db-user", a.db_user, "--db-password", a.db_password]
    _run(cmd, os.path.join(outdir, "exhaustive.log"))


def phase_report(a, outdir):
    log("PHASE report — consolidated HTML + PDF")
    _run([sys.executable, os.path.join(HERE, "report_build.py"), "--dir", outdir,
          "--out", os.path.join(outdir, "consolidated_report.html"),
          "--pdf", os.path.join(outdir, "consolidated_report.pdf")],
         os.path.join(outdir, "report.log"), tee=True)
    if a.ai:
        _ai_triage(a, outdir)


def _ai_triage(a, outdir):
    """AI failure-triage (advisory, #2): cluster the top failures by endpoint and ask
    the model for a likely root cause + fix. Written to AI_TRIAGE.md — never changes a
    verdict."""
    try:
        from ai_provider import AIProvider
        from ai_assist import explain_failures
    except Exception as e:
        log(f"  AI triage unavailable: {e}"); return
    prov = AIProvider()
    if not prov.is_enabled():
        log("  AI triage skipped — provider not enabled (set SYSTEMINTEL_AI_API_KEY)"); return
    import glob, json as _json
    from collections import defaultdict
    fails = defaultdict(list)
    for f in ([os.path.join(outdir, "api_live", "ledger.jsonl")] +
              glob.glob(os.path.join(outdir, "*_ledger.jsonl"))):
        try:
            for l in open(f):
                r = _json.loads(l)
                if r.get("v") == "FAIL":
                    key = str(r.get("ep", "")).split(" [")[0]
                    fails[key].append(r)
        except Exception:
            pass
    clusters = sorted(fails.items(), key=lambda kv: -len(kv[1]))[:8]
    out = ["# AI failure triage (advisory)\n",
           "_AI proposes a root cause; it never changes a verdict._\n"]
    for ep, rs in clusters:
        res = explain_failures(rs, provider=prov)
        if res:
            out.append(f"### {ep}  ({len(rs)} failing)\n"
                       f"- **Root cause:** {res['rootCause']}\n"
                       f"- **Fix:** {res['suggestedFix']}  _(confidence: {res['confidence']})_\n")
    open(os.path.join(outdir, "AI_TRIAGE.md"), "w").write("\n".join(out))
    log(f"  AI triage → {outdir}/AI_TRIAGE.md ({len(clusters)} clusters)")


def _run(cmd, logpath, tee=False):
    with open(logpath, "w") as lf:
        p = subprocess.run(cmd, cwd=HERE, stdout=lf, stderr=subprocess.STDOUT)
    if tee:
        try: print(open(logpath).read()[-1200:])
        except Exception: pass
    return p.returncode


PHASES = {"api": phase_api, "security": phase_security, "ui": None, "audit": phase_audit,
          "scenarios": phase_scenarios, "mutation": phase_mutation,
          "exhaustive": phase_exhaustive, "report": phase_report}


def phase_ui(a, outdir):
    """Browser field battery — realistic baselines (valid_data) + screenshot-on-fail."""
    log("PHASE ui — browser black-box battery (+ screenshots on fail)")
    _run([sys.executable, os.path.join(BACKEND, "ui_runner.py"),
          "--ui-url", a.ui_url, "--out-dir", outdir,
          "--user", a.ui_user, "--pass", a.ui_pass, "--shots", "fail",
          "--rich-max", "0"], os.path.join(outdir, "ui.log"), tee=True)
PHASES["ui"] = phase_ui


def main():
    ap = argparse.ArgumentParser(description="SystemIntel master orchestrator")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--graph", required=True)
    ap.add_argument("--base-url", default="http://localhost:8080")
    ap.add_argument("--ui-url", default="http://127.0.0.1:5174")
    ap.add_argument("--admin-token", default="")
    ap.add_argument("--non-admin-token", dest="non_admin_token", default="")
    ap.add_argument("--ui-user", default="admin@demo.local")
    ap.add_argument("--ui-pass", default="Test1234!")
    ap.add_argument("--db", default="")
    ap.add_argument("--db-host", default="127.0.0.1")
    ap.add_argument("--db-port", default="3306")
    ap.add_argument("--db-name", default="")
    ap.add_argument("--db-user", default="")
    ap.add_argument("--db-password", default="")
    ap.add_argument("--page-docs", default="")
    ap.add_argument("--mutate-repo", dest="mutate_repo", default="test-ecosudar/api/controllers")
    ap.add_argument("--mutate-budget", dest="mutate_budget", type=int, default=0)
    ap.add_argument("--mutate-per-file-cap", dest="mutate_per_file_cap", type=int, default=0)
    ap.add_argument("--field-max", dest="field_max", type=int, default=1500)
    ap.add_argument("--combo-max", dest="combo_max", type=int, default=800)
    ap.add_argument("--phases", default=DEFAULT_PHASES)
    ap.add_argument("--with-exhaustive", action="store_true")
    ap.add_argument("--ai", action="store_true", help="enable AI-assisted phases (needs SYSTEMINTEL_AI_API_KEY in env)")
    a = ap.parse_args()
    a.audit_routes = ["/dashboard", "/customers", "/products", "/purchase/vendors", "/employees",
                      "/expenses", "/sops", "/meetings", "/invoices", "/customers/new",
                      "/products/new", "/expenses/new", "/invoices/new"]
    os.makedirs(a.out_dir, exist_ok=True)

    if a.ai and not os.environ.get("SYSTEMINTEL_AI_API_KEY"):
        log("WARNING: --ai set but SYSTEMINTEL_AI_API_KEY is not in the environment; "
            "AI phases will fall back to offline. Export the key (never written to disk) to enable model rotation.")

    if not http_ok(a.base_url.rstrip("/") + "/products"):
        log(f"WARNING: app not reachable at {a.base_url} — bring the stack up first.")

    order = [p.strip() for p in a.phases.split(",") if p.strip()]
    if a.with_exhaustive and "exhaustive" not in order:
        order = order[:-1] + ["exhaustive", "report"] if order and order[-1] == "report" else order + ["exhaustive"]

    t0 = time.time()
    # Bounded parallelism: security + audit are independent & light → run together.
    parallel_set = {"security", "audit"}
    i = 0
    while i < len(order):
        name = order[i]
        if name in parallel_set and i + 1 < len(order) and order[i+1] in parallel_set:
            group = [order[i], order[i+1]]; i += 2
            log(f"parallel group: {group}")
            with ThreadPoolExecutor(max_workers=2) as ex:
                futs = {ex.submit(PHASES[g], a, a.out_dir): g for g in group}
                for fu in futs:
                    try: fu.result()
                    except Exception as e: log(f"  {futs[fu]} FAILED: {e}")
            continue
        fn = PHASES.get(name)
        if not fn: log(f"unknown phase '{name}' — skipping"); i += 1; continue
        try: fn(a, a.out_dir)
        except Exception as e: log(f"phase {name} FAILED: {type(e).__name__}: {e}")
        i += 1
    log(f"ALL PHASES DONE in {round(time.time()-t0)}s → {a.out_dir}/consolidated_report.html (+ .pdf)")


if __name__ == "__main__":
    main()
