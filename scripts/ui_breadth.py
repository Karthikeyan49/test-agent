#!/usr/bin/env python3
"""UI breadth runner — open the browser on EVERY concrete SPA route, log in once, and
run the full UI black-box battery on each page using SystemIntel's own browser modules:

  * render check (did the route render or bounce to the login page?)
  * control detection (inputs / selects / textareas / buttons / links)
  * WCAG accessibility audit (backend/ui_audits.run_accessibility_assertion)
  * per-field UI black-box validation on form pages (oversize / wrong-type values →
    does the frontend surface a validation signal?)

It produces a per-page + aggregate JSON report. Routes are discovered from a React
Router `App.tsx` (all `path="..."` literals) or read from --routes-file.

Usage:
  python3 scripts/ui_breadth.py \
      --ui-base-url http://127.0.0.1:5174 \
      --app-tsx test-ecosudar/eco-sudar-control/src/App.tsx \
      --email admin@demo.local --password 'Test1234!' \
      --out ui_breadth_report.json
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
from playwright_runner import PlaywrightRunner            # noqa: E402
from ui_audits import run_accessibility_assertion         # noqa: E402

BIG = "A" * 600


def discover_routes(app_tsx=None, routes_file=None):
    if routes_file:
        routes = [r.strip() for r in open(routes_file) if r.strip()]
    else:
        text = open(app_tsx).read()
        routes = sorted(set(re.findall(r'path="([^"]*)"', text)))
    # concrete routes only: no params, no globs, and skip the login page itself
    return [r for r in routes if ":" not in r and "*" not in r and r != "/login"]


def field_blackbox(page):
    findings = []
    inputs = page.locator("input:visible, textarea:visible")
    for i in range(min(inputs.count(), 25)):
        el = inputs.nth(i)
        try:
            itype = (el.get_attribute("type") or "text").lower()
            name = (el.get_attribute("name") or el.get_attribute("id")
                    or el.get_attribute("placeholder") or f"field{i}")
            if itype in ("hidden", "checkbox", "radio", "file", "submit", "button"):
                continue
            for case, val in (("oversize", BIG),
                              ("wrongtype", "not_a_number" if itype == "number" else "<x>@bad")):
                try:
                    el.fill("", timeout=1500); el.fill(val, timeout=1500)
                    el.blur(timeout=1000); page.wait_for_timeout(120)
                    invalid = el.get_attribute("aria-invalid")
                    dom = page.evaluate(
                        "(el)=>{const m=[...document.querySelectorAll('[role=alert],.error,"
                        ".text-red-500,.text-destructive,[aria-live]')];"
                        "return m.some(x=>x.textContent&&x.textContent.trim()&&x.offsetParent!==null);}",
                        el.element_handle())
                    native = el.evaluate("(e)=> e.validity ? !e.validity.valid : false")
                    findings.append({"field": name, "case": case,
                                     "validationSignalled": bool(invalid == "true" or dom or native)})
                except Exception:
                    findings.append({"field": name, "case": case, "validationSignalled": None})
        except Exception:
            continue
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-base-url", required=True)
    ap.add_argument("--app-tsx")
    ap.add_argument("--routes-file")
    ap.add_argument("--email"); ap.add_argument("--password")
    ap.add_argument("--out", default="ui_breadth_report.json")
    ap.add_argument("--shots", default="./ui_breadth_shots")
    args = ap.parse_args()
    if not args.app_tsx and not args.routes_file:
        ap.error("provide --app-tsx or --routes-file")

    routes = discover_routes(args.app_tsx, args.routes_file)
    ui = args.ui_base_url.rstrip("/")
    r = PlaywrightRunner(base_url=ui, headless=True, screenshots_dir=args.shots)
    r.start(); page = r.page

    if args.email:
        page.goto(f"{ui}/login", wait_until="networkidle", timeout=25000)
        try:
            page.fill('input[type="email"], input[name="email"], input#email', args.email, timeout=6000)
            if page.locator('input[type="password"]').count():
                page.fill('input[type="password"]', args.password or "", timeout=6000)
            page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")', timeout=6000)
            page.wait_for_timeout(3500)
        except Exception as e:
            print("login note:", type(e).__name__, str(e)[:100])
        print(f"[i] login {'ok' if '/login' not in page.url else 'FAILED'} -> {page.url}")

    report = []
    for route in routes:
        e = {"route": route}
        try:
            page.goto(f"{ui}{route}", wait_until="networkidle", timeout=25000)
            page.wait_for_timeout(700)
            e["rendered"] = "/login" not in page.url or route == "/"
            e["inputs"] = page.locator("input").count()
            e["selects"] = page.locator("select").count()
            e["textareas"] = page.locator("textarea").count()
            e["buttons"] = page.locator("button").count()
            e["links"] = page.locator("a").count()
            e["wcagViolations"] = len(run_accessibility_assertion(page).get("violations", []) or [])
            if e["rendered"] and e["inputs"] + e["textareas"] > 0:
                fb = field_blackbox(page)
                e["fieldCasesRun"] = len(fb)
                e["fieldsWithValidation"] = sum(1 for f in fb if f.get("validationSignalled") is True)
                e["fieldsNoValidation"] = sum(1 for f in fb if f.get("validationSignalled") is False)
            print(f"  [{route}] rendered={e['rendered']} in={e['inputs']} "
                  f"btn={e['buttons']} wcagV={e['wcagViolations']} cases={e.get('fieldCasesRun',0)}")
        except Exception as ex:
            e["error"] = f"{type(ex).__name__}: {str(ex)[:120]}"
            print(f"  [{route}] ERROR {e['error']}")
        report.append(e)

    try: r.stop()
    except Exception:
        if getattr(r, "browser", None): r.browser.close()

    summary = {
        "concreteRoutesTested": len(routes),
        "rendered": sum(1 for e in report if e.get("rendered")),
        "pagesWithForms": sum(1 for e in report if e.get("fieldCasesRun", 0) > 0),
        "totalControls": sum(e.get("inputs", 0) + e.get("selects", 0) + e.get("textareas", 0) for e in report),
        "totalFieldCasesRun": sum(e.get("fieldCasesRun", 0) for e in report),
        "fieldsWithValidation": sum(e.get("fieldsWithValidation", 0) for e in report),
        "fieldsNoValidation": sum(e.get("fieldsNoValidation", 0) for e in report),
        "totalWcagViolations": sum(e.get("wcagViolations", 0) for e in report),
    }
    json.dump({"summary": summary, "pages": report}, open(args.out, "w"), indent=1)
    print("\n=== UI BREADTH SUMMARY ===")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
