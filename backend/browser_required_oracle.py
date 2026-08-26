"""
Behavioral Required-Field Oracle  (frontend, per-field)
=======================================================
Closes a real gap in the browser field battery: the tool's "submit empty → expect
reject" required-field check fired **0 cases** on these React forms, because the
forms never set the HTML `required` / `aria-required` attribute. Nothing in the DOM
said "this field is required", so `field_value_cases` never emitted a `required_empty`
case and the requiredness of every field went untested.

This module does NOT trust the DOM attribute. It infers requiredness *behaviorally*,
in the same submit-then-observe style as `run_browser_field_validation`:

    1. fill a known-VALID baseline into every field (single-fault isolation),
    2. clear ONLY one field,
    3. submit the form,
    4. read the frontend's reaction to THAT field —
         • native validity      el.checkValidity() == false
         • ARIA                  aria-invalid="true"
         • a visible error near the field, especially a "required" / "cannot be
           empty" style message  (react-hook-form / zod / yup emit these as text,
           not as a DOM attribute)
         • OR the submit being BLOCKED (URL unchanged + no success toast) while the
           all-valid baseline *does* submit — so the block is attributable to the
           one cleared field.

Verdicts (honest — an unknown is never a PASS):
    • field-local error OR attributable block  → field is required, empty correctly
      REJECTED                                  → PASS
    • form submits with the field empty:
        - the field was expected to be required (fields_meta says so, or the tool's
          own detection flagged it) → FAIL  (bad input accepted / validation missing)
        - otherwise                            → SKIP "field appears optional"
    • the field can't be cleared (e.g. a select-only combobox), or the block can't be
      attributed (baseline itself won't submit) → SKIP with the reason.

Each result row:  {field, case:"required_empty", expect:"reject",
                   status:"PASS"/"FAIL"/"SKIP", signal:"..."}

Helpers (valid-baseline builder, the observe JS, native-select handling) are reused
from `browser_field_validation` by import. Execution needs a live Playwright `page`;
the `__main__` self-test runs fully OFFLINE against a mocked page (and, when Chromium
is present, additionally against a real in-memory form) and exits 0.
"""

import re
from typing import Any, Dict, List, Optional

# Reuse the field-validation helpers: the valid-baseline value builder, the
# observe-the-frontend JS, native-<select> detection/forcing, and the signal
# formatter — so this oracle reads the DOM exactly like its sibling does.
try:
    from browser_field_validation import (
        _valid_ui_value, _OBSERVE_JS, _SET_SELECT_VALUE_JS,
        detect_choice_control, _signal_of,
    )
except ImportError:  # package-qualified import path
    from backend.browser_field_validation import (  # type: ignore
        _valid_ui_value, _OBSERVE_JS, _SET_SELECT_VALUE_JS,
        detect_choice_control, _signal_of,
    )

# A visible message near the field that names emptiness/requiredness is the
# strongest behavioral signal that a field is required (these forms carry no
# `required` attribute, so the message is the only DOM evidence).
_REQUIRED_MSG = re.compile(
    r"required|mandatory|cannot be empty|can'?t be empty|must not be empty|"
    r"should not be empty|is empty|field is empty|please (?:fill|enter|select|provide|choose)",
    re.IGNORECASE,
)

# Supplementary near-field scan for a REQUIRED-phrased message. `_OBSERVE_JS` only
# looks at a fixed set of error CSS classes; react-hook-form / zod render "X is
# required" in many wrappers (a plain <p class="text-xs text-red-500">, a <span>,
# etc.). This walks a few ancestors up from the field and returns the first visible
# leaf whose text names requiredness/emptiness — robust to the exact class used.
_REQUIRED_NEAR_JS = r"""
(sel) => {
  const el = document.querySelector(sel);
  if (!el) return '';
  const RE = /required|mandatory|cannot be empty|can't be empty|must not be empty|is empty|please (fill|enter|select|provide|choose)/i;
  let grp = el.closest('div,fieldset,label,section') || el.parentElement;
  for (let i = 0; i < 5 && grp; i++) {
    const leaves = grp.querySelectorAll('*');
    for (const e of leaves) {
      if (e.children.length === 0 && e.offsetParent !== null) {
        const t = (e.textContent || '').trim();
        if (t && t.length < 120 && RE.test(t)) return t.slice(0, 100);
      }
    }
    grp = grp.parentElement;
  }
  return '';
}
"""

# Only a SUCCESS-typed toast counts as "the submit went through". A bare
# [role=status] live-region is often always present (screen-reader announcer) and
# must NOT be read as success — doing so makes every submit look accepted and every
# field look optional. Success is signalled by url change or one of these.
_SUCCESS_TOAST_JS = (
    "() => !!document.querySelector("
    "'.sonner-toast[data-type=\"success\"],[data-sonner-toast][data-type=\"success\"],"
    ".Toastify__toast--success,.toast-success,[data-status=\"success\"]')")


def _meta_says_required(meta: Dict[str, Any]) -> bool:
    """Did the tool's OWN field detection (not the DOM attribute) flag this field
    as required? Used to turn a silently-accepted empty submit into a FAIL rather
    than an optional SKIP — i.e. the app *should* have required it."""
    for k in ("required", "isRequired", "mandatory", "notNull"):
        v = meta.get(k)
        if isinstance(v, bool):
            if v:
                return True
        elif isinstance(v, str) and v.strip().lower() in ("1", "true", "yes", "required"):
            return True
    return False


def run_browser_required_checks(page, route: str, base_url: str,
                                field_selectors: Dict[str, str],
                                fields_meta: Optional[List[Dict[str, Any]]] = None,
                                submit_selector: str = 'button[type="submit"]',
                                max_fields: int = 0) -> Dict[str, Any]:
    """Infer, in a live browser, which fields of the form at `route` are REQUIRED,
    by clearing one field at a time from a valid baseline and submitting.

    `field_selectors` maps field name → real CSS selector (build with
    backend/field_mapper.map_form_fields). `fields_meta` is the tool's field records
    (used only to decide optional-vs-missing-validation when an empty submit is
    accepted). Returns {route, cases, passed, failed, skipped, results:[...]}.
    """
    meta_by_name: Dict[str, Dict[str, Any]] = {}
    for m in (fields_meta or []):
        nm = m.get("name") or m.get("fieldName")
        if nm:
            meta_by_name[nm] = m

    names = list(field_selectors.keys())
    if max_fields:
        names = names[:max_fields]

    url = f"{base_url.rstrip('/')}{route}"

    def _goto():
        page.goto(url, timeout=20000)
        try: page.wait_for_load_state("domcontentloaded")
        except Exception: pass
        try: page.wait_for_load_state("networkidle", timeout=5000)
        except Exception: pass
        try: page.wait_for_selector("input,textarea,select", timeout=5000)
        except Exception: pass

    _goto()

    # Detect choice controls once — a <select>/combobox can't be text-filled, and
    # "clearing" one means restoring the empty placeholder, not typing "".
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
        """Put a choice control onto a real, valid option (for the baseline)."""
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
        try:  # combobox: open and click its first real option
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

    def _fill_baseline():
        for nm in names:
            if nm in controls:
                _select_valid(nm)
            else:
                _fill(nm, _valid_of(nm))

    def _clear(nm):
        """Empty ONLY this field. Returns (ok, kind). A select-only combobox cannot
        be cleared back to "no selection" reliably → (False, 'combobox')."""
        if nm in controls:
            ctl = controls[nm]
            if ctl["kind"] == "select":
                try:
                    page.evaluate(_SET_SELECT_VALUE_JS,
                                  {"sel": field_selectors[nm], "value": ""})
                    return True, "select"
                except Exception:
                    return False, "select"
            return False, "combobox"
        return _fill(nm, ""), "text"

    def _submit_and_observe(sel):
        start_url = page.url
        try:
            btn = page.locator(submit_selector).first
            if btn.count() > 0:
                btn.click(timeout=1500, no_wait_after=True)
        except Exception:
            pass
        page.wait_for_timeout(180)
        try:
            obs = page.evaluate(_OBSERVE_JS, sel)
        except Exception:
            obs = {"found": False}
        # Strengthen the field-local read: if _OBSERVE_JS found no message but a
        # required-phrased message sits near the field, adopt it (react-hook-form
        # renders these in wrappers the fixed class list misses).
        if not obs.get("err"):
            try:
                near = page.evaluate(_REQUIRED_NEAR_JS, sel)
            except Exception:
                near = ""
            if near:
                obs["err"] = near
        try:
            toast = page.evaluate(_SUCCESS_TOAST_JS)
        except Exception:
            toast = False
        blocked = (page.url == start_url) and not toast
        return obs, blocked

    # ── trust probe: does the ALL-VALID baseline actually submit? ──────────────
    # If it does, a per-field submit-block (with that one field cleared) is
    # attributable to the cleared field. If it does NOT, "blocked" is worthless as
    # a requiredness signal here and blocked-only cases are honestly SKIPped.
    _fill_baseline()
    probe_sel = field_selectors[names[0]] if names else "body"
    _b_obs, baseline_blocked = _submit_and_observe(probe_sel)
    baseline_submits = not baseline_blocked

    results: List[Dict[str, Any]] = []

    def rec(field, status, signal):
        results.append({"field": field, "case": "required_empty", "expect": "reject",
                        "status": status, "signal": signal})

    for name in names:
        sel = field_selectors[name]
        # Fresh page each field: a successful submit may navigate/reset the form, so
        # re-establish the valid baseline before clearing exactly one field.
        _goto()
        _fill_baseline()
        cleared, kind = _clear(name)
        if not cleared:
            rec(name, "SKIP",
                f"cannot clear {kind} to test emptiness (structurally un-clearable)")
            continue

        obs, blocked = _submit_and_observe(sel)
        native = bool(obs.get("native"))
        aria = bool(obs.get("aria"))
        err = obs.get("err") or ""
        required_phrased = bool(err and _REQUIRED_MSG.search(err))
        field_local = native or aria or bool(err)
        attributable_block = blocked and baseline_submits

        if field_local or attributable_block:
            # empty value was REJECTED → field behaves as required.
            if required_phrased:
                sig = f'required-message near field: "{err[:80]}"'
            elif native:
                sig = "native-invalid on empty field"
            elif aria:
                sig = "aria-invalid on empty field"
            elif err:
                sig = f'error near field: "{err[:80]}"'
            else:
                sig = "submit blocked (valid baseline submits — fault isolated)"
            rec(name, "PASS", sig)
            continue

        # The form ACCEPTED the empty field (submitted, no field-local error).
        if blocked and not baseline_submits:
            # We couldn't even submit the valid baseline, so a block can't be
            # pinned on this field. Refuse to guess — SKIP, never PASS.
            rec(name, "SKIP",
                "submit blocked even with a valid baseline — block not attributable "
                "to this field")
        elif _meta_says_required(meta_by_name.get(name, {})):
            # Detected as required, yet empty was accepted → missing validation.
            rec(name, "FAIL",
                "empty accepted though field was detected as required "
                "(no client-side required validation)")
        else:
            rec(name, "SKIP", "field appears optional (empty value accepted)")

    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    skipped = sum(1 for r in results if r["status"] == "SKIP")
    return {"route": route, "cases": len(results),
            "passed": passed, "failed": failed, "skipped": skipped,
            "results": results}


# ══════════════════════════════════════════════════════════════════════════════
#  SELF-TEST  —  offline (mocked page), plus a real-Chromium proof when available.
# ══════════════════════════════════════════════════════════════════════════════
class _FakePage:
    """A minimal in-memory Playwright-shaped page modelling a React form that shows
    required errors as TEXT (react-hook-form style) with NO `required` attribute —
    the exact situation that fired 0 cases. Lets the oracle run with no browser.

    Fields (by selector):
      #code  native-required  (browser blocks empty submit — the DOM-attr case)
      #title custom-required, NO attribute, JS shows "Title is required" on submit
             (the BEHAVIORAL case this module exists for)
      #sku   should be required per metadata, but the app never validates it
      #notes genuinely optional
    """
    def __init__(self):
        self._url = "http://mock/form"
        self.keyboard = self  # press() no-op below
        # each field: value, native_required, custom_required
        self._f = {
            "#code":  {"v": "", "native": True,  "custom": False},
            "#title": {"v": "", "native": False, "custom": True},
            "#sku":   {"v": "", "native": False, "custom": False},
            "#notes": {"v": "", "native": False, "custom": False},
        }
        self._aria = {k: False for k in self._f}
        self._err = {k: "" for k in self._f}

    # navigation / waits ------------------------------------------------------
    @property
    def url(self):
        return self._url

    def goto(self, url, timeout=0):
        self._url = "http://mock/form"          # reload clears the form
        for k in self._f:
            self._f[k]["v"] = ""
            self._aria[k] = False
            self._err[k] = ""

    def wait_for_load_state(self, *a, **k): pass
    def wait_for_selector(self, *a, **k): pass
    def wait_for_timeout(self, *a, **k): pass
    def press(self, *a, **k): pass

    # locator -----------------------------------------------------------------
    def locator(self, selector):
        return _FakeLocator(self, selector)

    def _click_submit(self):
        # reset transient validation state (react-hook-form re-validates each submit)
        for k in self._f:
            self._aria[k] = False
            self._err[k] = ""
        # 1) native gate: an empty native-required field blocks the browser submit
        if any(f["native"] and f["v"] == "" for f in self._f.values()):
            return                              # blocked, no navigation
        # 2) custom JS validation: empty custom-required → preventDefault + message
        custom_bad = [k for k, f in self._f.items() if f["custom"] and f["v"] == ""]
        if custom_bad:
            for k in custom_bad:
                self._aria[k] = True
                self._err[k] = "Title is required"
            return                              # blocked, no navigation
        # 3) success → navigate away
        self._url = "http://mock/form?submitted=1"

    # evaluate: dispatch on distinctive substrings of the reused JS constants ---
    def evaluate(self, js, arg=None):
        if "checkValidity" in js:               # _OBSERVE_JS
            sel = arg
            if sel not in self._f:
                return {"found": False}
            native = self._f[sel]["native"] and self._f[sel]["v"] == ""
            return {"found": True, "native": native,
                    "aria": self._aria[sel], "err": self._err[sel]}
        if "aria-haspopup" in js:               # _CHOICE_DETECT_JS → not a choice ctrl
            return {"found": True, "kind": "other", "role": "", "tag": "input",
                    "editable": False, "required": False}
        if "sonner-toast" in js:                # success-toast probe
            return False
        if "args.value" in js:                  # _SET_SELECT_VALUE_JS (unused here)
            return {"found": False, "stuck": False}
        return None


class _FakeLocator:
    def __init__(self, page, selector):
        self.page, self.sel = page, selector
    @property
    def first(self):
        return self
    def count(self):
        if self.sel in ("button[type=\"submit\"]", "[role=option]"):
            return 1 if self.sel.startswith("button") else 0
        return 1 if self.sel in self.page._f else 0
    def fill(self, value, timeout=0):
        if self.sel in self.page._f:
            self.page._f[self.sel]["v"] = value
            return
        raise RuntimeError("no such field")
    def blur(self, timeout=0): pass
    def click(self, timeout=0, no_wait_after=False):
        if self.sel.startswith("button"):
            self.page._click_submit()
    def select_option(self, *a, **k): raise RuntimeError("not a select")


def _run_offline_selftest():
    page = _FakePage()
    field_selectors = {"code": "#code", "title": "#title", "sku": "#sku", "notes": "#notes"}
    fields_meta = [
        {"name": "code",  "required": True},    # native-required
        {"name": "title", "required": True},    # behavioral required, NO attr
        {"name": "sku",   "required": True},    # detected required, app doesn't enforce
        {"name": "notes"},                       # optional
    ]
    summary = run_browser_required_checks(page, "/form", "http://mock",
                                          field_selectors, fields_meta)
    by = {r["field"]: r for r in summary["results"]}

    # the whole point: required cases now FIRE (0 → 4)
    assert summary["cases"] == 4, summary
    # native-required field: empty rejected (blocked / native invalid) → PASS
    assert by["code"]["status"] == "PASS", by["code"]
    # BEHAVIORAL required with NO DOM attribute, only a text message → PASS
    assert by["title"]["status"] == "PASS", by["title"]
    assert "required" in by["title"]["signal"].lower(), by["title"]
    # detected-required but silently accepted empty → honest FAIL (missing validation)
    assert by["sku"]["status"] == "FAIL", by["sku"]
    # genuinely optional → SKIP, never a PASS
    assert by["notes"]["status"] == "SKIP", by["notes"]
    assert "optional" in by["notes"]["signal"].lower(), by["notes"]
    # every row carries the exact contract shape
    for r in summary["results"]:
        assert set(r) == {"field", "case", "expect", "status", "signal"}, r
        assert r["case"] == "required_empty" and r["expect"] == "reject", r
    assert (summary["passed"], summary["failed"], summary["skipped"]) == (2, 1, 1), summary
    print(f"[offline] mocked React-form (no `required` attr): {summary['cases']} required "
          f"cases fired → {summary['passed']} pass / {summary['failed']} fail / "
          f"{summary['skipped']} skip")
    print("[offline] title inferred required with NO DOM attribute (message-only) — correct")
    print("[offline] sku detected-required but empty accepted → FAIL (not a false PASS)")
    return summary


def _run_chromium_selftest():
    """Extra proof against a REAL Chromium: an in-memory form whose 'title' field is
    required only via JS (no `required` attribute), served over loopback."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[live] playwright not installed — offline proof stands. (SKIP)")
        return
    import os as _os
    import http.server as _hs
    import socketserver as _ss
    import threading as _th

    # 'title' has NO required attribute; a submit handler blocks + shows a message
    # when it is empty. 'notes' is optional. This is the exact 0-case scenario.
    FORM = b"""<!doctype html><html><body>
      <form id="f" onsubmit="return validate(event)">
        <div><input id="title" name="title" type="text">
             <span class="error" id="e_title" style="display:none">Title is required</span></div>
        <div><input id="notes" name="notes" type="text"></div>
        <button type="submit">Save</button>
      </form>
      <script>
        function validate(ev){
          var t = document.getElementById('title');
          var e = document.getElementById('e_title');
          if (!t.value.trim()){
            ev.preventDefault();
            t.setAttribute('aria-invalid','true');
            e.style.display='block';
            return false;
          }
          window.location = window.location.pathname + '?submitted=1';
          ev.preventDefault();
          return false;
        }
      </script>
    </body></html>"""

    class _H(_hs.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(FORM)))
            self.end_headers()
            self.wfile.write(FORM)
        def log_message(self, *a): pass

    httpd = _ss.TCPServer(("127.0.0.1", 0), _H)
    port = httpd.server_address[1]
    _th.Thread(target=httpd.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{port}"
    try:
        with sync_playwright() as p:
            _kw = {"headless": True}
            _exe = _os.environ.get("PLAYWRIGHT_CHROMIUM_PATH") or (
                "/opt/pw-browsers/chromium" if _os.path.exists("/opt/pw-browsers/chromium") else None)
            if _exe:
                _kw["executable_path"] = _exe
            b = p.chromium.launch(**_kw)
            pg = b.new_page()
            field_selectors = {"title": "#title", "notes": "#notes"}
            fields_meta = [{"name": "title", "required": True}, {"name": "notes"}]
            # prove the DOM really has NO required attribute on 'title'
            pg.goto(base_url + "/")
            has_attr = pg.evaluate(
                "() => document.getElementById('title').hasAttribute('required') || "
                "document.getElementById('title').getAttribute('aria-required')==='true'")
            assert not has_attr, "test form must NOT declare required (that's the gap)"
            summary = run_browser_required_checks(pg, "/", base_url,
                                                  field_selectors, fields_meta)
            b.close()
    finally:
        httpd.shutdown()

    by = {r["field"]: r for r in summary["results"]}
    assert summary["cases"] == 2, summary
    assert by["title"]["status"] == "PASS", by["title"]     # inferred required, no attr
    assert by["notes"]["status"] == "SKIP", by["notes"]     # optional
    print(f"[live] real Chromium, form with NO `required` attr: {summary['cases']} cases → "
          f"title={by['title']['status']} ({by['title']['signal'][:48]}) / "
          f"notes={by['notes']['status']}")
    print("[live] behavioral inference works on a real browser with zero DOM required attrs")


if __name__ == "__main__":
    _run_offline_selftest()
    _run_chromium_selftest()
    print("SELF-TEST PASS")
