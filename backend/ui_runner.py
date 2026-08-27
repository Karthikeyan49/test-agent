"""
Committed browser-UI runner for the orchestrator.

Drives each create form through the black-box battery (submit-then-observe), using
the constraint-aware realistic baseline (valid_data) so strict forms actually
submit, and captures an evidence SCREENSHOT on every UI failure (screenshots.py),
embedded into the consolidated report as a thumbnail. Streams one per-case JSONL
row per test to <out_dir>/ui_ledger.jsonl.

CLI:
  python3 -m ui_runner --ui-url http://127.0.0.1:5174 --out-dir ./run \
      --user admin@demo.local --pass Test1234! [--routes /a,/b] [--rich-max N] [--shots fail|all|none]
"""
import argparse, json, os, sys, time
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_ROUTES = ["/customers/new", "/products/new", "/purchase/vendors/new",
                  "/purchase/orders/new", "/employees/new", "/expenses/new",
                  "/sops/new", "/meetings/new", "/invoices/new"]


def _build_fields(page) -> (Dict[str, str], List[Dict[str, Any]]):
    sels, metas = {}, []
    inputs = page.locator("input:visible, textarea:visible, select:visible")
    for i in range(min(inputs.count(), 20)):
        el = inputs.nth(i)
        try:
            tag = el.evaluate("e=>e.tagName.toLowerCase()")
            t = (el.get_attribute("type") or ("select" if tag == "select" else "text")).lower()
            if t in ("hidden", "checkbox", "radio", "file", "submit", "button", "search"):
                continue
            attr = next((a for a in ("name", "id", "placeholder", "aria-label")
                         if el.get_attribute(a)), None)
            if not attr:
                continue
            nm = el.get_attribute(attr)
            sels[nm] = f'[{attr}="{nm}"]'
            metas.append({"name": nm, "type": t})
        except Exception:
            continue
    return sels, metas


def run(ui_url: str, out_dir: str, user: str, pw: str, routes: List[str],
        rich_max=None, shots: str = "fail") -> Dict[str, Any]:
    from playwright_runner import PlaywrightRunner
    from browser_field_validation import run_browser_field_validation
    from screenshots import data_uri

    os.makedirs(out_dir, exist_ok=True)
    shots_dir = os.path.join(out_dir, "ui_shots")
    os.makedirs(shots_dir, exist_ok=True)
    led = open(os.path.join(out_dir, "ui_ledger.jsonl"), "w", encoding="utf-8")
    n = [0]

    def row(cat, method, ep, verdict, reason, shot=None, ms=0):
        n[0] += 1
        rec = {"ts": time.time(), "id": f"UI-{n[0]:05d}", "cat": cat, "layer": "UI",
               "m": str(method or ""), "ep": str(ep)[:90], "exp": "reject bad input",
               "act": "rejected" if verdict == "PASS" else ("accepted-bad" if verdict == "FAIL" else "untrusted"),
               "v": verdict, "r": str(reason)[:170], "ms": ms}
        if shot:
            rec["shot"] = shot
        led.write(json.dumps(rec, ensure_ascii=False) + "\n"); led.flush()

    r = PlaywrightRunner(base_url=ui_url, headless=True, screenshots_dir=shots_dir)
    r.start(); p = r.page
    p.goto(f"{ui_url}/login", wait_until="domcontentloaded", timeout=25000); p.wait_for_timeout(1200)
    try:
        p.fill('input[type="email"], input[name="email"]', user, timeout=6000)
        if p.locator('input[type="password"]').count():
            p.fill('input[type="password"]', pw, timeout=6000)
        p.click('button[type="submit"]', timeout=6000); p.wait_for_timeout(3000)
    except Exception as e:
        print("login note:", str(e)[:80], flush=True)

    agg = {"forms": 0, "pages": []}
    _shots_dir = shots_dir if shots in ("fail", "all") else None
    for route in routes:
        try:
            p.goto(f"{ui_url}{route}", wait_until="domcontentloaded", timeout=25000); p.wait_for_timeout(900)
            if "/login" in p.url:
                row("Browser form-load", "GET", route, "SKIPPED", "auth gate redirected"); continue
            sels, metas = _build_fields(p)
            if not sels:
                row("Browser form-load", "GET", route, "SKIPPED", "no detectable fields"); continue
            agg["forms"] += 1
            p.goto(f"{ui_url}{route}", wait_until="domcontentloaded", timeout=25000); p.wait_for_timeout(700)
            fv = run_browser_field_validation(p, route, ui_url, sels, metas, rich=True,
                                              rich_max_per_method=rich_max, shots_dir=_shots_dir)
            for x in fv["results"]:
                st = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIPPED"}.get(x["status"], x["status"])
                shot = data_uri(x["shot"]) if x.get("shot") else None
                row(f'Browser · {x.get("method","text")}', x.get("method"),
                    f'{route} [{x.get("field","")}]', st,
                    f'{x.get("case","")} — {x.get("signal","")}', shot=shot)
            agg["pages"].append({"route": route, "fields": len(sels),
                                 "baselineSubmits": fv.get("baselineSubmits"),
                                 "cases": fv["cases"], "fail": fv["failed"]})
            print(f"  [{route}] baseOK={fv.get('baselineSubmits')} cases={fv['cases']} "
                  f"fail={fv['failed']} rows={n[0]}", flush=True)
        except Exception as e:
            row("Browser form-load", "", route, "SKIPPED", f"{type(e).__name__}: {str(e)[:90]}")
    try: r.stop()
    except Exception: pass
    led.close()
    print(f"UI runner done: {n[0]} rows, {agg['forms']} forms -> {out_dir}/ui_ledger.jsonl", flush=True)
    return agg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-url", default="http://127.0.0.1:5174")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--user", default="admin@demo.local")
    ap.add_argument("--pass", dest="pw", default="Test1234!")
    ap.add_argument("--routes", default="")
    ap.add_argument("--rich-max", type=int, default=0, help="0 = full corpus")
    ap.add_argument("--shots", default="fail", choices=["fail", "all", "none"])
    a = ap.parse_args()
    routes = [x.strip() for x in a.routes.split(",") if x.strip()] or DEFAULT_ROUTES
    run(a.ui_url, a.out_dir, a.user, a.pw, routes,
        rich_max=(a.rich_max or None), shots=a.shots)


if __name__ == "__main__":
    main()
