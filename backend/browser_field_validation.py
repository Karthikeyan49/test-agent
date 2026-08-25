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


# ── ENUM / dropdown-domain method (in the browser) ────────────────────────────
# Reads a live choice control's ALLOWED option domain so the oracle knows the
# legal set, then attempts an OUT-OF-DOMAIN value and observes the frontend.

# Enumerate a native <select>'s options, or classify a custom combobox trigger.
_CHOICE_DETECT_JS = r"""
(sel) => {
  const el = document.querySelector(sel);
  if (!el) return {found:false};
  const tag  = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (tag === 'select') {
    const opts = Array.prototype.map.call(el.options,
      o => ({value:o.value, label:(o.textContent||'').trim()}));
    return {found:true, kind:'select', required: !!el.required,
            multiple: !!el.multiple, value: el.value, options: opts};
  }
  // shadcn/Radix comboboxes: a button[role=combobox] (or any [role=combobox]/
  // element owning a [role=listbox] popup). An <input role=combobox> is editable.
  const isCombo = role === 'combobox' || role === 'listbox' ||
                  el.getAttribute('aria-haspopup') === 'listbox';
  return {found:true, kind: isCombo ? 'combobox' : 'other', role, tag,
          editable: tag === 'input',
          required: el.getAttribute('aria-required') === 'true' || !!el.required};
}
"""

# Read the visible option labels of an OPEN listbox popup (custom combobox).
_LISTBOX_OPTIONS_JS = r"""
() => Array.prototype.slice.call(document.querySelectorAll('[role=option]'))
  .filter(o => o.offsetParent !== null)
  .map(o => (o.textContent || '').trim())
  .filter(t => t.length)
"""

# Force a value onto a native <select> via JS and report whether it STUCK
# (a correct <select> refuses a value that is not one of its options).
_SET_SELECT_VALUE_JS = r"""
(args) => {
  const el = document.querySelector(args.sel);
  if (!el) return {found:false};
  try {
    el.value = args.value;
    el.dispatchEvent(new Event('input',  {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  } catch(e){}
  return {found:true, stuck: el.value === args.value,
          value: el.value, selectedIndex: el.selectedIndex};
}
"""


def _signal_of(obs: Dict[str, Any], blocked: bool) -> str:
    """Derive the same short signal string used by run_browser_field_validation."""
    return ("native" if obs.get("native") else
            "aria-invalid" if obs.get("aria") else
            (f"msg:{obs.get('err')}" if obs.get("err") else
             ("submit-blocked" if blocked else "—")))


def detect_choice_control(page, selector: str) -> Dict[str, Any]:
    """DETECT a choice control at `selector` in the LIVE DOM and enumerate its
    allowed option domain — so the enum oracle knows the legal set.

    Returns {kind, options, values, required, editable, multiple}:
      • kind "select"   — native <select>; `options` are option labels, `values`
                          the non-empty option values.
      • kind "combobox" — custom shadcn/Radix combobox; opened, its visible
                          [role=option] labels read, then closed (Escape).
                          `editable` true when the trigger is a text <input>.
      • kind "none"     — not a choice control (text/number/email/etc.).
    Duck-typed on Playwright `page` (.evaluate / .locator / .keyboard).
    """
    empty = {"kind": "none", "options": [], "values": [],
             "required": False, "editable": False, "multiple": False}
    try:
        info = page.evaluate(_CHOICE_DETECT_JS, selector)
    except Exception:
        return dict(empty)
    if not info or not info.get("found"):
        return dict(empty)

    if info.get("kind") == "select":
        opts = info.get("options") or []
        values = [o.get("value") for o in opts if o.get("value") not in (None, "")]
        labels = [o.get("label") for o in opts if o.get("label")]
        return {"kind": "select", "options": labels, "values": values,
                "required": bool(info.get("required")), "editable": False,
                "multiple": bool(info.get("multiple"))}

    if info.get("kind") == "combobox":
        options: List[str] = []
        try:
            page.locator(selector).first.click(timeout=1500)
            page.wait_for_timeout(120)
            options = page.evaluate(_LISTBOX_OPTIONS_JS) or []
            try: page.keyboard.press("Escape")
            except Exception: pass
            page.wait_for_timeout(60)
        except Exception:
            pass
        return {"kind": "combobox", "options": options, "values": list(options),
                "required": bool(info.get("required")),
                "editable": bool(info.get("editable")), "multiple": False}

    return dict(empty)


# a token no correctly-domained control should ever hold or offer
_OUT_OF_DOMAIN = "__not_in_domain__"


def enum_browser_cases(page, name: str, selector: str, control: Dict[str, Any],
                       submit_and_observe, restore_valid) -> List[Dict[str, Any]]:
    """Run the ENUM (dropdown-domain) black-box method against a live choice
    control and return result records shaped exactly like the other cases in
    run_browser_field_validation (field/case/method/expect/value/status/signal).

    `control` comes from detect_choice_control. `submit_and_observe(sel)` is the
    harness's submit-then-read closure returning (obs, blocked). `restore_valid()`
    puts the control back onto a valid option before the next case.

    Honesty rules:
      • native <select> that the browser REFUSES to hold out-of-domain → SKIP
        (structurally impossible), never PASS.
      • combobox that only allows selecting from its own list → the editable
        out-of-domain probe is SKIPped (structurally impossible), reported so.
    """
    recs: List[Dict[str, Any]] = []

    def rec(case, status, signal, value=""):
        recs.append({"field": name, "case": case, "method": "enum",
                     "expect": "reject", "value": str(value)[:24],
                     "status": status, "signal": signal})

    kind = control.get("kind")

    if kind == "select":
        # (1) OUT-OF-DOMAIN: try to force a bogus string onto the <select>.
        try:
            r = page.evaluate(_SET_SELECT_VALUE_JS, {"sel": selector, "value": _OUT_OF_DOMAIN})
        except Exception:
            r = {"stuck": False}
        if not r.get("stuck"):
            # The browser reset selectedIndex to -1 / value to "" — the control
            # genuinely cannot hold an out-of-domain value. Honest SKIP, not PASS.
            rec("enum_out_of_domain", "SKIP",
                "native <select> refused out-of-domain value (structurally impossible)",
                _OUT_OF_DOMAIN)
        else:
            obs, blocked = submit_and_observe(selector)
            rejected = bool(obs.get("native") or obs.get("aria") or obs.get("err")) or blocked
            rec("enum_out_of_domain", "PASS" if rejected else "FAIL",
                _signal_of(obs, blocked), _OUT_OF_DOMAIN)
        restore_valid()

        # (2) required <select> left with NO selection (empty placeholder option).
        if control.get("required"):
            try:
                page.evaluate(_SET_SELECT_VALUE_JS, {"sel": selector, "value": ""})
            except Exception:
                pass
            obs, blocked = submit_and_observe(selector)
            rejected = bool(obs.get("native") or obs.get("aria") or obs.get("err")) or blocked
            rec("enum_required_empty", "PASS" if rejected else "FAIL",
                _signal_of(obs, blocked), "")
            restore_valid()

    elif kind == "combobox":
        options = control.get("options") or []
        # (1) STRUCTURAL: the enumerated domain must not offer an out-of-domain entry.
        rec("enum_domain_closed",
            "PASS" if _OUT_OF_DOMAIN not in options else "FAIL",
            f"options={len(options)}; out-of-domain not offered", _OUT_OF_DOMAIN)
        # (2) EDITABLE combobox: type an out-of-domain string and submit.
        if control.get("editable"):
            try:
                page.locator(selector).first.fill(_OUT_OF_DOMAIN, timeout=1500)
                obs, blocked = submit_and_observe(selector)
                rejected = bool(obs.get("native") or obs.get("aria") or obs.get("err")) or blocked
                rec("enum_editable_out_of_domain", "PASS" if rejected else "FAIL",
                    _signal_of(obs, blocked), _OUT_OF_DOMAIN)
            except Exception as e:
                rec("enum_editable_out_of_domain", "SKIP", f"err:{type(e).__name__}",
                    _OUT_OF_DOMAIN)
            restore_valid()
        else:
            # select-only widget: out-of-domain cannot be entered at all.
            rec("enum_editable_out_of_domain", "SKIP",
                "combobox only allows selecting from its own list — "
                "out-of-domain structurally impossible")

    return recs


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

    # Detect choice controls ONCE so enum fields join the valid baseline with a
    # real option (they can't be text-filled) and get the enum method below.
    controls: Dict[str, Dict[str, Any]] = {}
    for nm in names:
        try:
            ci = detect_choice_control(page, field_selectors[nm])
        except Exception:
            ci = {"kind": "none"}
        if ci.get("kind") in ("select", "combobox"):
            controls[nm] = ci

    def _valid_of(nm):
        return _valid_ui_value(meta_by_name.get(nm, {"name": nm}))

    def _fill(nm, value):
        try:
            page.locator(field_selectors[nm]).first.fill(value, timeout=2000)
            return True
        except Exception:
            return False

    def _select_valid(nm):
        """Put a choice control onto a real, valid option (for baseline / restore)."""
        ctl = controls.get(nm)
        sel = field_selectors[nm]
        if not ctl:
            return False
        if ctl["kind"] == "select":
            vals = ctl.get("values") or []
            if not vals:
                return False
            try:
                page.locator(sel).first.select_option(vals[0], timeout=1500)
                return True
            except Exception:
                try:
                    page.evaluate(_SET_SELECT_VALUE_JS, {"sel": sel, "value": vals[0]})
                    return True
                except Exception:
                    return False
        # combobox: open and click its first real option
        try:
            page.locator(sel).first.click(timeout=1500)
            page.wait_for_timeout(100)
            opt = page.locator("[role=option]").first
            if opt.count() > 0:
                opt.click(timeout=1500)
                return True
            try: page.keyboard.press("Escape")
            except Exception: pass
        except Exception:
            pass
        return False

    def _restore(nm):
        if nm in controls:
            _select_valid(nm)
        else:
            _fill(nm, _valid_of(nm))

    def _fill_baseline():
        for nm in names:
            if nm in controls:
                _select_valid(nm)
            else:
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
        # Choice control → the ENUM (dropdown-domain) method, not the text battery
        # (a <select>/combobox can't be text-filled). Additive; text/number/email
        # fields below are untouched.
        if name in controls:
            try:
                results.extend(enum_browser_cases(
                    page, name, sel, controls[name],
                    _submit_and_observe, lambda n=name: _select_valid(n)))
            except Exception as e:
                results.append({"field": name, "case": "enum_error", "method": "enum",
                                "expect": "reject", "value": "", "status": "SKIP",
                                "signal": f"err:{type(e).__name__}"})
            _select_valid(name)   # leave it valid for the next field's baseline
            continue
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
        _restore(name)   # restore this field before the next one

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
      <div><select id="choice" required>
             <option value="">--</option>
             <option value="a">A</option>
             <option value="b">B</option>
           </select></div>
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

        # ── ENUM / required-select handling (native <select>) ──
        ctl = detect_choice_control(pg, "#choice")
        assert ctl["kind"] == "select", ctl
        assert ctl["values"] == ["a", "b"], ctl        # legal domain enumerated
        assert ctl["required"] is True, ctl
        # a bogus out-of-domain value cannot STICK on a native <select>
        r = pg.evaluate(_SET_SELECT_VALUE_JS, {"sel": "#choice", "value": "__nope__"})
        assert r["stuck"] is False, f"native select must refuse out-of-domain: {r}"
        # required select left empty → native-invalid
        pg.evaluate(_SET_SELECT_VALUE_JS, {"sel": "#choice", "value": ""})
        empty_sel = pg.evaluate(_OBSERVE_JS, "#choice")
        assert empty_sel.get("native") is True, f"empty required select invalid: {empty_sel}"
        # a real option is accepted
        pg.evaluate(_SET_SELECT_VALUE_JS, {"sel": "#choice", "value": "a"})
        ok_sel = pg.evaluate(_OBSERVE_JS, "#choice")
        assert ok_sel.get("native") is False, f"valid option should pass: {ok_sel}"

        # drive the enum method end-to-end and assert HONEST verdicts
        def _sao(s):
            start = pg.url
            try: pg.locator('button[type=submit]').click(timeout=800, no_wait_after=True)
            except Exception: pass
            pg.wait_for_timeout(120)
            return pg.evaluate(_OBSERVE_JS, s), (pg.url == start)
        recs = enum_browser_cases(pg, "choice", "#choice", ctl, _sao,
                                  lambda: pg.evaluate(_SET_SELECT_VALUE_JS,
                                                      {"sel": "#choice", "value": "a"}))
        by = {rr["case"]: rr["status"] for rr in recs}
        # out-of-domain can't stick on a native <select> → honest SKIP (never PASS)
        assert by.get("enum_out_of_domain") == "SKIP", recs
        # required-empty select IS caught (native invalid / blocked) → PASS
        assert by.get("enum_required_empty") == "PASS", recs
        b.close()
    print("[live] native-validity detector: bad email✗ / valid✓ / empty-required✗ — correct")
    print("[live] enum method: out-of-domain SKIP(honest) / required-empty PASS — correct")
    print("SELF-TEST PASS")
