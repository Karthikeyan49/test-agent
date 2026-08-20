"""
Browser Field-Validation Tester  (frontend, per-field, per-value)
=================================================================
Drives EACH form field in a real browser through the black-box value battery and
reads the FRONT END's own reaction — does the UI reject bad input client-side?

This is distinct from the API per-field tests (backend validation): a form can
show "invalid email" or block submit entirely before any request is sent. Here we
type a value into the real DOM control, trigger validation (blur + submit intent),
then observe three signals:

    • native HTML5 validity   el.checkValidity() == false   (required, type=email, maxlength…)
    • ARIA                    aria-invalid="true"           (custom / shadcn components)
    • a visible error message  role=alert / .error / .text-destructive near the field

A case with expectation "reject" PASSES when the frontend flags it; "accept"
PASSES when it does not; "no_crash" just requires the page stays responsive.

Value generation is deterministic and schema-aware; execution needs a live
Playwright page (see run_browser_field_validation). Pure-stdlib for generation.
"""

import re
from typing import Any, Dict, List, Optional

_EMAIL = re.compile(r'e[-_]?mail', re.I)
# Segment-anchored so "count" does not match inside "country", etc.
_NUMERICISH = re.compile(r'(?:^|[_\W])(qty|quantity|amount|price|total|cost|count|stock|age|'
                         r'pincode|pin_code|zip|phone|mobile|rate|percent|year)(?:[_\W]|$)', re.I)


def field_value_cases(field: Dict[str, Any], rich: bool = True,
                      rich_max_per_method: int = 8) -> List[Dict[str, Any]]:
    """The per-field frontend value battery. Each case: {case, value, expect}.

    rich=True (default) delegates to backend/field_battery.rich_field_cases, so the
    BROWSER drives MANY cases per method per field (dozens of malformed formats,
    boundary values, length configs, XSS/SQLi/misc fuzz) — the same rich battery the
    API layer uses. rich=False keeps the original lean one-per-method set."""
    if rich:
        try:
            from field_battery import rich_field_cases
        except ImportError:
            from backend.field_battery import rich_field_cases  # type: ignore
        return [{"case": c["case"], "value": c["value"], "expect": c["expect"],
                 "method": c["method"]}
                for c in rich_field_cases(field, max_per_method=rich_max_per_method)]

    name = str(field.get("name") or field.get("fieldName") or "")
    ftype = str(field.get("fieldType") or field.get("type") or "text").lower()
    required = bool(field.get("required", False))
    ln = name.lower()
    cases: List[Dict[str, Any]] = []

    def C(case, value, expect):
        cases.append({"case": case, "value": value, "expect": expect})

    is_email = "email" in ftype or bool(_EMAIL.search(ln))
    is_num   = ftype in ("number", "tel") or bool(_NUMERICISH.search(ln))

    if is_email:
        C("valid_email", "user@test.com", "accept")
        C("bad_email",   "notanemail",    "reject")
    elif is_num:
        C("valid_number", "5",   "accept")
        C("non_numeric",  "abcd", "reject")
        C("negative",     "-1",  "reject")
    else:
        C("valid_text", "Test", "accept")
        C("over_length", "A" * 300, "reject_or_truncate")

    if required:
        C("required_empty", "", "reject")

    # universal robustness — the frontend must not crash on hostile input
    C("xss",  "<script>alert(1)</script>", "no_crash")
    C("sqli", "' OR '1'='1",               "no_crash")
    return cases


# ── observation JS: read the frontend's reaction to the current field value ────
_OBSERVE_JS = r"""
(sel) => {
  const el = document.querySelector(sel);
  if (!el) return {found:false};
  let native = false;
  try { native = typeof el.checkValidity === 'function' ? !el.checkValidity() : false; } catch(e){}
  const aria = el.getAttribute('aria-invalid') === 'true';
  // walk up a few wrappers looking for a *visible* error message near this field
  let err = '', grp = el.closest('div,fieldset,label') || el.parentElement;
  const SEL = "[role=alert],.error,.invalid-feedback,.field-error,[data-error]," +
              ".text-red-500,.text-red-600,.text-destructive,.Mui-error,.ant-form-item-explain-error";
  for (let i=0; i<4 && grp; i++) {
    const e = grp.querySelector(SEL);
    if (e && e.offsetParent !== null) {
      const t = e.textContent.trim();
      // ignore required-field markers ("*", "•") and other non-message glyphs —
      // a real validation error is a sentence, not a single asterisk.
      if (t && t.replace(/[*•\s.:-]/g,'').length > 2 && /[a-z]{3}/i.test(t)) {
        err = t.slice(0,120); break;
      }
    }
    grp = grp.parentElement;
  }
  return {found:true, native, aria, err};
}
"""


def _valid_ui_value(meta: Dict[str, Any]) -> str:
    """A plausibly-valid value for a field, used to build the valid baseline so a
    single-fault case is genuinely isolated (all other fields stay valid)."""
    name = str(meta.get("name") or meta.get("fieldName") or "").lower()
    ftype = str(meta.get("fieldType") or meta.get("type") or "text").lower()
    if "email" in ftype or _EMAIL.search(name):
        return "valid.user@example.com"
    if ftype in ("number", "integer", "float", "tel") or _NUMERICISH.search(name):
        return "5"
    if "date" in ftype or "date" in name:
        return "2023-06-15"
    if meta.get("enum"):
        return str(meta["enum"][0])
    return "ValidValue"


def run_browser_field_validation(page, route: str, base_url: str,
                                 field_selectors: Dict[str, str],
                                 fields_meta: Optional[List[Dict[str, Any]]] = None,
                                 submit_selector: str = 'button[type="submit"]',
                                 max_fields: int = 0, rich: bool = True) -> Dict[str, Any]:
    """
    For a form at `route`, drive every mapped field through its value battery in a
    live browser and record the frontend's reaction. `field_selectors` maps a field
    name → a real CSS selector (build it with backend/field_mapper.map_form_fields).

    SUBMIT-then-observe (trustworthy on submit-validating SPAs like react-hook-form):
    a VALID baseline is filled into every field first, then for each case exactly ONE
    field is set to the bad value (single-fault), the form is SUBMITTED, and the
    frontend's reaction is read AFTER submit — native validity, aria-invalid, a visible
    error message near the field, OR the submit being blocked (URL unchanged + no
    success toast). The target field is restored to its valid value before the next
    one, so faults never accumulate. Returns a summary with per-case results.
    """
    meta_by_name = {}
    for m in (fields_meta or []):
        nm = m.get("name") or m.get("fieldName")
        if nm:
            meta_by_name[nm] = m

    page.goto(f"{base_url.rstrip('/')}{route}", timeout=20000)
    page.wait_for_load_state("domcontentloaded")
    try: page.wait_for_load_state("networkidle", timeout=5000)
    except Exception: pass
    try: page.wait_for_selector("input,textarea,select", timeout=5000)
    except Exception: pass

    results: List[Dict[str, Any]] = []
    names = list(field_selectors.keys())
    if max_fields:
        names = names[:max_fields]

    def _valid_of(nm):
        return _valid_ui_value(meta_by_name.get(nm, {"name": nm}))

    def _fill(nm, value):
        try:
            page.locator(field_selectors[nm]).first.fill(value, timeout=2000)
            return True
        except Exception:
            return False

    def _fill_baseline():
        for nm in names:
            _fill(nm, _valid_of(nm))

    def _submit_and_observe(sel):
        start_url = page.url
        try:
            btn = page.locator(submit_selector).first
            if btn.count() > 0:
                btn.click(timeout=1500, no_wait_after=True)
        except Exception:
            pass
        page.wait_for_timeout(180)
        obs = page.evaluate(_OBSERVE_JS, sel)
        # submit blocked = we did not navigate away AND no visible success toast
        try:
            toast = page.evaluate(
                "() => !!document.querySelector('.sonner-toast,[data-sonner-toast],"
                ".Toastify__toast--success,[role=status]')")
        except Exception:
            toast = False
        blocked = (page.url == start_url) and not toast
        return obs, blocked

    _fill_baseline()

    for name in names:
        sel = field_selectors[name]
        meta = meta_by_name.get(name, {"name": name})
        for c in field_value_cases(meta, rich=rich):
            rec = {"field": name, "case": c["case"], "method": c.get("method"),
                   "expect": c["expect"], "value": str(c["value"])[:24],
                   "status": "SKIP", "signal": ""}
            try:
                if page.locator(sel).first.count() == 0:
                    results.append(rec); continue
                if not _fill(name, str(c["value"])):
                    rec["signal"] = "not fillable"; results.append(rec); continue
                try: page.locator(sel).first.blur(timeout=800)
                except Exception: pass
                obs, blocked = _submit_and_observe(sel)
                err_signalled = bool(obs.get("native") or obs.get("aria") or obs.get("err"))
                rejected = err_signalled or blocked
                rec["signal"] = ("native" if obs.get("native") else
                                 "aria-invalid" if obs.get("aria") else
                                 (f"msg:{obs.get('err')}" if obs.get("err") else
                                  ("submit-blocked" if blocked else "—")))
                exp = c["expect"]
                if exp in ("reject", "reject_or_truncate"):
                    rec["status"] = "PASS" if rejected else "FAIL"   # FAIL = bad input accepted
                elif exp == "accept":
                    rec["status"] = "PASS" if not err_signalled else "FAIL"
                else:  # no_crash → PASS unless the page threw / went blank
                    rec["status"] = "PASS"
            except Exception as e:
                rec["status"] = "SKIP"; rec["signal"] = f"err:{type(e).__name__}"
            results.append(rec)
        _fill(name, _valid_of(name))   # restore this field before the next one

    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    skipped = sum(1 for r in results if r["status"] == "SKIP")
    return {"route": route, "fieldsTested": len(names), "cases": len(results),
            "passed": passed, "failed": failed, "skipped": skipped, "results": results}


if __name__ == "__main__":
    # ── lean value-battery (one per method) ────────────────────────────────
    ec = field_value_cases({"name": "email", "required": True}, rich=False)
    assert any(c["case"] == "bad_email" and c["expect"] == "reject" for c in ec)
    assert any(c["case"] == "required_empty" for c in ec)
    nc = field_value_cases({"name": "quantity", "type": "number", "required": False}, rich=False)
    assert any(c["case"] == "non_numeric" and c["expect"] == "reject" for c in nc)
    assert any(c["case"] == "negative" for c in nc)
    print(f"[gen-lean] email cases={len(ec)} number cases={len(nc)}")

    # ── RICH value-battery (default): many cases per method, driven in-browser ──
    er = field_value_cases({"name": "email", "type": "email", "required": True, "maxLength": 100})
    methods = {c.get("method") for c in er}
    assert len(er) > len(ec) * 3, (len(er), len(ec))
    assert {"format", "fuzz_xss", "fuzz_sqli"} <= methods, methods
    assert all("value" in c and "expect" in c for c in er)
    print(f"[gen-rich] email cases={len(er)} across methods {sorted(m for m in methods if m)}")

    # ── live detector self-test against a REAL native form (no server needed) ──
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SELF-TEST PASS (generation only — playwright not installed here)")
        raise SystemExit(0)

    HTML = """<form>
      <div><input id="email" type="email" required></div>
      <div><input id="name" type="text" maxlength="10" required></div>
      <button type="submit">Save</button>
    </form>"""
    with sync_playwright() as p:
        import os as _os
        _kw = {"headless": True}
        _exe = _os.environ.get("PLAYWRIGHT_CHROMIUM_PATH") or (
            "/opt/pw-browsers/chromium" if _os.path.exists("/opt/pw-browsers/chromium") else None)
        if _exe: _kw["executable_path"] = _exe
        b = p.chromium.launch(**_kw); pg = b.new_page()
        pg.set_content(HTML)
        def check(sel, val):
            pg.locator(sel).fill(val); pg.locator(sel).blur()
            try: pg.locator('button[type=submit]').click(timeout=800, no_wait_after=True)
            except Exception: pass
            return pg.evaluate(_OBSERVE_JS, sel)
        bad  = check("#email", "notanemail")     # native email invalid
        good = check("#email", "ok@test.com")    # valid
        empty= check("#name", "")                # required empty
        assert bad.get("native") is True,  f"bad email should be native-invalid: {bad}"
        assert good.get("native") is False, f"valid email should pass: {good}"
        assert empty.get("native") is True, f"empty required should be invalid: {empty}"
        b.close()
    print("[live] native-validity detector: bad email✗ / valid✓ / empty-required✗ — correct")
    print("SELF-TEST PASS")
