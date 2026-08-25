"""
Browser Combinatorial (pairwise) Tester  (multi-field, in the real DOM)
======================================================================
The browser field-validation battery (backend/browser_field_validation.py) is
SINGLE-FAULT: it fills a VALID baseline into every control, corrupts exactly ONE
field, submits, and reads the frontend's reaction. That answers "does the UI
enforce each rule in isolation?" — but never "do TWO wrong fields interact?" or
"does the form still flag field B when field A is also bad?".

This module drives the SAME real form through a deterministic PAIRWISE (2-wise)
covering array over the fields: every (fieldA=classX, fieldB=classY) pair appears
in at least one submitted combination, so multiple fields are bad TOGETHER. The
full cross-product of fields × value-classes explodes (K^N); pairwise samples the
interaction space at a tiny fraction while still exercising every 2-way pair — and
most client-side validation gaps are 2-way.

Reuses, unchanged:
    • browser_field_validation._OBSERVE_JS  — per-field reaction reader (native
      HTML5 validity / aria-invalid / a visible error message near the field).
    • browser_field_validation._valid_ui_value — the valid-baseline value builder.
    • combinatorial._pairwise_rows / _onewise_rows — the covering-array algorithm
      (imported when available; a byte-identical fallback is inlined so this file
      stands alone and stays deterministic).

Oracle per combination (the engine's law: "AI proposes, a deterministic check
decides; a SKIP is never a PASS"):
    • ANY field set to a definitely-INVALID class ⇒ the form SHOULD reject: an
      error shown on at least one bad field OR the submit being blocked ⇒ PASS.
      If the submit SUCCEEDS with invalid fields present ⇒ FAIL (a validation gap
      the single-fault battery can miss, because it only ever makes one field bad).
    • ALL fields valid ⇒ expect acceptance ⇒ PASS; if the submit is blocked (the
      form has un-fillable / unmapped required controls we don't manage) ⇒ SKIP,
      never a false FAIL and never a PASS.
    • No definite violation but an UNKNOWABLE class present (e.g. an empty optional
      field) ⇒ the correct behaviour is undecidable ⇒ SKIP, never a PASS.

Generation is pure standard library and deterministic (seedable). Execution needs
a live Playwright page (see run_browser_combinatorial).
"""

import random
from typing import Any, Dict, List, Optional, Tuple

# ── reuse the sibling battery's detector + baseline (do NOT reimplement) ───────
try:
    from browser_field_validation import _OBSERVE_JS, _valid_ui_value, _EMAIL, _NUMERICISH
except ImportError:  # package-qualified import when run as backend.*
    from backend.browser_field_validation import (  # type: ignore
        _OBSERVE_JS, _valid_ui_value, _EMAIL, _NUMERICISH)


# ── value-class model per field ───────────────────────────────────────────────
# Each class carries a validity verdict, mirroring backend/combinatorial.py:
#   True  = a value the form should ACCEPT
#   False = a definite rule violation the form should REJECT
#   None  = genuinely unknowable (e.g. an empty OPTIONAL field — no rule decides)
def field_value_classes(meta: Dict[str, Any], max_classes: int = 4) -> List[Dict[str, Any]]:
    """A small, deterministic value-class set for one field: {valid, empty,
    oversize, wrongtype/badformat}. Bounded by `max_classes` (valid kept first).

    The valid value reuses browser_field_validation._valid_ui_value so the baseline
    matches exactly what the single-fault battery considers valid."""
    name = str(meta.get("name") or meta.get("fieldName") or "")
    ftype = str(meta.get("fieldType") or meta.get("type") or "text").lower()
    required = bool(meta.get("required", False))
    ln = name.lower()

    is_email = "email" in ftype or bool(_EMAIL.search(ln))
    is_num = ftype in ("number", "integer", "float", "decimal", "tel") or bool(_NUMERICISH.search(ln))
    is_date = "date" in ftype or "date" in ln

    ml = meta.get("maxLength") or meta.get("maxlen")
    try:
        ml = int(ml) if ml is not None else None
    except (TypeError, ValueError):
        ml = None

    classes: List[Dict[str, Any]] = [
        {"cls": "valid", "value": _valid_ui_value(meta), "validity": True},
    ]

    # empty — a definite violation iff required, otherwise unknowable
    classes.append({"cls": "empty", "value": "",
                    "validity": False if required else None})

    # wrong-type / bad-format — a definite violation for a typed field
    if is_email:
        classes.append({"cls": "badformat", "value": "notanemail", "validity": False})
    elif is_num and not is_date:
        classes.append({"cls": "wrongtype", "value": "abcd", "validity": False})
    elif is_date:
        classes.append({"cls": "badformat", "value": "31/31/9999", "validity": False})

    # oversize — a definite violation only when a maxLength is declared to violate;
    # without a declared bound the overflow's validity is unknowable, so skip it
    # rather than manufacture a false REJECT expectation.
    if ml and ml > 0 and not is_num and not is_date:
        classes.append({"cls": "oversize", "value": "A" * (ml + 1), "validity": False})

    # dedup by class label, keep "valid" first, then bound the count
    seen, out = set(), []
    for c in classes:
        if c["cls"] in seen:
            continue
        seen.add(c["cls"])
        out.append(c)
    return out[:max(1, max_classes)]


# ── deterministic covering-array core (reuse combinatorial.py; inline fallback) ─
try:
    from combinatorial import _pairwise_rows as _cov_pairwise, _onewise_rows as _cov_onewise
except ImportError:
    try:
        from backend.combinatorial import (  # type: ignore
            _pairwise_rows as _cov_pairwise, _onewise_rows as _cov_onewise)
    except ImportError:
        _cov_pairwise = _cov_onewise = None  # type: ignore


def _fallback_onewise(params: List[List[int]], cap: int) -> List[List[int]]:
    if not params:
        return []
    m = max(len(p) for p in params)
    return [[p[min(r, len(p) - 1)] for p in params] for r in range(min(m, cap))]


def _fallback_pairwise(params: List[List[int]], cap: int) -> List[List[int]]:
    """Byte-identical replica of combinatorial._pairwise_rows: deterministic greedy
    seeded covering array. Every (fieldI=a, fieldJ=b) pair appears in >=1 row."""
    n = len(params)
    if n < 2:
        return _fallback_onewise(params, cap)
    uncovered = set()
    for i in range(n):
        for j in range(i + 1, n):
            for a in params[i]:
                for b in params[j]:
                    uncovered.add(((i, a), (j, b)))
    rows: List[List[int]] = []
    while uncovered and len(rows) < cap:
        (fi, va), (fj, vb) = min(uncovered)
        row: List[Optional[int]] = [None] * n
        row[fi], row[fj] = va, vb
        for f in range(n):
            if row[f] is not None:
                continue
            best_v, best_cov = params[f][0], -1
            for v in params[f]:
                cov = 0
                for g in range(n):
                    if g == f or row[g] is None:
                        continue
                    pair = ((g, row[g]), (f, v)) if g < f else ((f, v), (g, row[g]))
                    if pair in uncovered:
                        cov += 1
                if cov > best_cov:
                    best_cov, best_v = cov, v
            row[f] = best_v
        for i in range(n):
            for j in range(i + 1, n):
                uncovered.discard(((i, row[i]), (j, row[j])))
        rows.append([int(x) for x in row])
    return rows


def _pairwise(params: List[List[int]], cap: int) -> List[List[int]]:
    return (_cov_pairwise or _fallback_pairwise)(params, cap)


def _onewise(params: List[List[int]], cap: int) -> List[List[int]]:
    return (_cov_onewise or _fallback_onewise)(params, cap)


# ── pairwise combinations over a set of fields ────────────────────────────────
def pairwise_field_combinations(field_classes: Dict[str, List[Dict[str, Any]]],
                                strength: int = 2, cap: int = 200,
                                seed: int = 0) -> List[Dict[str, str]]:
    """Build a covering array over the given fields and return one dict per
    combination mapping field name → chosen class label.

    Only fields with >=2 value-classes take part in the array (a single-class field
    adds no interaction and is simply always its one class). `seed` deterministically
    permutes the participating-field order before covering — a reproducible knob that
    varies the array without ever losing pair coverage. `strength` 2 = pairwise,
    1 = each class of each field at least once. `cap` bounds the row count."""
    names_all = list(field_classes.keys())
    active = [nm for nm in names_all if len(field_classes[nm]) >= 2]
    fixed = [nm for nm in names_all if nm not in active]

    # deterministic, seed-controlled field ordering (coverage is order-invariant)
    order = list(range(len(active)))
    if seed:
        random.Random(seed).shuffle(order)
    active_ord = [active[i] for i in order]

    params = [list(range(len(field_classes[nm]))) for nm in active_ord]

    if len(params) >= 2 and strength >= 2:
        rows = _pairwise(params, cap)
    else:
        rows = _onewise(params, cap)

    combos: List[Dict[str, str]] = []
    for row in rows:
        combo = {nm: field_classes[nm][0]["cls"] for nm in fixed}  # fixed → its lone class
        for nm, ci in zip(active_ord, row):
            combo[nm] = field_classes[nm][ci]["cls"]
        combos.append(combo)
    if not combos and names_all:  # all fields single-class → one all-valid combo
        combos.append({nm: field_classes[nm][0]["cls"] for nm in names_all})
    return combos


# ── the live browser driver ───────────────────────────────────────────────────
def run_browser_combinatorial(page, route: str, base_url: str,
                              field_selectors: Dict[str, str],
                              fields_meta: Optional[List[Dict[str, Any]]] = None,
                              submit_selector: str = 'button[type="submit"]',
                              strength: int = 2, cap: int = 200,
                              max_classes_per_field: int = 4,
                              seed: int = 0) -> Dict[str, Any]:
    """Drive a real form at `route` through a PAIRWISE covering array of MULTI-field
    bad states and record, per combination, which fields the frontend flags.

    `field_selectors` maps field name → a real CSS selector (build with
    backend/field_mapper.map_form_fields). `fields_meta` supplies each field's
    declared domain (name/type/required/maxLength/enum) so the value-classes and the
    validity oracle are schema-aware. Returns:

        {route, combinations, passed, failed, skipped,
         results: [{fields:{name:class}, verdict, expect, bad:[names],
                    flagged:[names], signal}]}
    """
    meta_by_name = {}
    for m in (fields_meta or []):
        nm = m.get("name") or m.get("fieldName")
        if nm:
            meta_by_name[nm] = m

    names = list(field_selectors.keys())

    # value-classes per field (indexed by label for O(1) lookup during a combo)
    classes_by_name: Dict[str, List[Dict[str, Any]]] = {}
    for nm in names:
        cs = field_value_classes(meta_by_name.get(nm, {"name": nm}), max_classes_per_field)
        classes_by_name[nm] = cs
    class_by_label = {nm: {c["cls"]: c for c in cs} for nm, cs in classes_by_name.items()}

    combos = pairwise_field_combinations(classes_by_name, strength=strength,
                                         cap=cap, seed=seed)

    # ── navigate once; refill a valid baseline between combinations ──
    page.goto(f"{base_url.rstrip('/')}{route}", timeout=20000)
    page.wait_for_load_state("domcontentloaded")
    try: page.wait_for_load_state("networkidle", timeout=5000)
    except Exception: pass
    try: page.wait_for_selector("input,textarea,select", timeout=5000)
    except Exception: pass

    def _valid_of(nm):
        return _valid_ui_value(meta_by_name.get(nm, {"name": nm}))

    def _fill(nm, value):
        try:
            page.locator(field_selectors[nm]).first.fill(str(value), timeout=2000)
            return True
        except Exception:
            return False

    def _observe(nm):
        try:
            return page.evaluate(_OBSERVE_JS, field_selectors[nm]) or {}
        except Exception:
            return {}

    def _submit():
        start_url = page.url
        try:
            btn = page.locator(submit_selector).first
            if btn.count() > 0:
                btn.click(timeout=1500, no_wait_after=True)
        except Exception:
            pass
        page.wait_for_timeout(180)
        try:
            toast = page.evaluate(
                "() => !!document.querySelector('.sonner-toast,[data-sonner-toast],"
                ".Toastify__toast--success,[role=status]')")
        except Exception:
            toast = False
        blocked = (page.url == start_url) and not toast
        return blocked

    results: List[Dict[str, Any]] = []

    for combo in combos:
        # reset every field to its valid baseline, then apply this combo's classes
        fill_ok = True
        for nm in names:
            if not _fill(nm, _valid_of(nm)):
                fill_ok = False
        for nm in names:
            cls = combo.get(nm, "valid")
            val = class_by_label[nm].get(cls, {"value": _valid_of(nm)})["value"]
            if not _fill(nm, val):
                fill_ok = False
            try: page.locator(field_selectors[nm]).first.blur(timeout=500)
            except Exception: pass

        # classify the combination by its declared validity classes
        bad = [nm for nm in names
               if class_by_label[nm].get(combo.get(nm, "valid"), {}).get("validity") is False]
        unknown = [nm for nm in names
                   if class_by_label[nm].get(combo.get(nm, "valid"), {}).get("validity") is None]

        blocked = _submit()
        flagged = []
        for nm in names:
            obs = _observe(nm)
            if obs.get("native") or obs.get("aria") or obs.get("err"):
                flagged.append(nm)

        rec = {"fields": dict(combo), "bad": bad, "flagged": flagged,
               "verdict": "SKIP", "expect": "", "signal": ""}

        if not fill_ok and bad:
            # a bad field we couldn't set ⇒ attribution untrustworthy ⇒ SKIP
            rec.update(expect="reject", verdict="SKIP", signal="unfillable-control")
        elif bad:
            rec["expect"] = "reject"
            bad_flagged = [nm for nm in flagged if nm in bad]
            rejected = bool(bad_flagged) or blocked
            rec["verdict"] = "PASS" if rejected else "FAIL"  # FAIL = bad input accepted
            rec["signal"] = (f"flagged:{'+'.join(bad_flagged)}" if bad_flagged
                             else "submit-blocked" if blocked
                             else "accepted-with-invalid")
        elif unknown:
            # no definite violation but an unknowable class ⇒ undecidable ⇒ SKIP
            rec.update(expect="skip", verdict="SKIP",
                       signal=f"undecidable:empty-optional {'+'.join(unknown)}")
        else:
            # all-valid ⇒ expect acceptance; a blocked submit means un-fillable /
            # unmapped required controls we don't manage ⇒ SKIP (never a false FAIL)
            rec["expect"] = "accept"
            if not fill_ok or blocked:
                rec.update(verdict="SKIP",
                           signal="baseline-blocked (unmapped required control?)")
            else:
                rec.update(verdict="PASS", signal="accepted")

        results.append(rec)

    passed = sum(1 for r in results if r["verdict"] == "PASS")
    failed = sum(1 for r in results if r["verdict"] == "FAIL")
    skipped = sum(1 for r in results if r["verdict"] == "SKIP")
    return {"route": route, "combinations": len(results),
            "passed": passed, "failed": failed, "skipped": skipped,
            "results": results}


# ── deterministic self-test (offline asserts always run; live part guarded) ────
if __name__ == "__main__":
    from math import prod

    # ── OFFLINE: value-classes + pairwise covering array (no browser) ──────────
    metas = [
        {"name": "email",    "type": "email",  "required": True,  "maxLength": 100},
        {"name": "name",     "type": "text",   "required": True,  "maxLength": 10},
        {"name": "quantity", "type": "number", "required": False},
        {"name": "status",   "type": "text",   "required": False, "maxLength": 20},
    ]
    fc = {m["name"]: field_value_classes(m) for m in metas}
    for nm, cs in fc.items():
        labels = [c["cls"] for c in cs]
        assert labels[0] == "valid", (nm, labels)
        assert len(cs) >= 2, (nm, labels)          # every field contributes to the array
        assert cs[0]["validity"] is True
    # a required typed field yields a definite-invalid class (drives a real reject)
    assert any(c["validity"] is False for c in fc["email"]), fc["email"]
    assert any(c["validity"] is False for c in fc["quantity"]), fc["quantity"]

    combos = pairwise_field_combinations(fc, strength=2, cap=200)

    # completeness: every (fieldA=classX, fieldB=classY) pair appears in some combo
    active = [nm for nm in fc if len(fc[nm]) >= 2]
    idx = {nm: k for k, nm in enumerate(active)}
    cls_i = {nm: {c["cls"]: i for i, c in enumerate(fc[nm])} for nm in active}
    per_field = {nm: len(fc[nm]) for nm in active}
    full_cross = prod(per_field.values())

    want = set()
    for a in range(len(active)):
        for b in range(a + 1, len(active)):
            na, nb = active[a], active[b]
            for ca in range(per_field[na]):
                for cb in range(per_field[nb]):
                    want.add(((idx[na], ca), (idx[nb], cb)))
    got = set()
    for combo in combos:
        for a in range(len(active)):
            for b in range(a + 1, len(active)):
                na, nb = active[a], active[b]
                got.add(((idx[na], cls_i[na][combo[na]]), (idx[nb], cls_i[nb][combo[nb]])))
    missing = want - got
    assert not missing, f"pairwise INCOMPLETE — missing {len(missing)} field-class pairs"
    assert len(combos) < full_cross, (len(combos), full_cross)
    assert len(combos) <= 200, "cap must bound the combination count"
    print(f"[offline] fields×classes {per_field} → full cross-product {full_cross}, "
          f"pairwise {len(combos)} combos "
          f"(reduction {100*(1-len(combos)/full_cross):.0f}%)")

    # determinism: same inputs (and same seed) ⇒ identical array
    assert pairwise_field_combinations(fc, cap=200) == combos, "generation not deterministic"
    # a seed still yields a complete (and reproducible) array
    combos_s = pairwise_field_combinations(fc, cap=200, seed=7)
    assert combos_s == pairwise_field_combinations(fc, cap=200, seed=7), "seed not reproducible"
    got_s = set()
    for combo in combos_s:
        for a in range(len(active)):
            for b in range(a + 1, len(active)):
                na, nb = active[a], active[b]
                got_s.add(((idx[na], cls_i[na][combo[na]]), (idx[nb], cls_i[nb][combo[nb]])))
    assert not (want - got_s), "seeded array is INCOMPLETE"
    print(f"[offline] seed=7 → {len(combos_s)} combos, still covers every pair; "
          f"generation is deterministic")

    # cap enforcement is real
    capped = pairwise_field_combinations(fc, cap=5)
    assert len(capped) <= 5, "cap not enforced"
    print(f"[offline] cap=5 → {len(capped)} combos (bounded)")

    # ── LIVE: guarded end-to-end against a real native <form> (no app server) ──
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SELF-TEST PASS (offline only — playwright not installed here)")
        raise SystemExit(0)

    import os as _os
    import http.server as _hs
    import socketserver as _ss
    import threading as _th

    FORM = b"""<!doctype html><html><body>
      <form>
        <div><input id="email" name="email" type="email" required></div>
        <div><input id="name" name="name" type="text" maxlength="10" required></div>
        <button type="submit">Save</button>
      </form>
    </body></html>"""

    class _H(_hs.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(FORM)))
            self.end_headers()
            self.wfile.write(FORM)
        def log_message(self, *a):
            pass

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

            field_selectors = {"email": "#email", "name": "#name"}
            fields_meta = [
                {"name": "email", "type": "email", "required": True, "maxLength": 100},
                {"name": "name",  "type": "text",  "required": True, "maxLength": 10},
            ]
            summary = run_browser_combinatorial(
                pg, "/", base_url, field_selectors, fields_meta,
                submit_selector='button[type="submit"]', strength=2, cap=200)
            b.close()
    finally:
        httpd.shutdown()

    assert summary["combinations"] >= 1, summary
    # a native form catches every bad state client-side ⇒ zero validation gaps
    assert summary["failed"] == 0, f"native form should have no gaps: {summary}"
    # at least one multi-bad combination was driven and the frontend flagged the bad fields
    multi_bad = [r for r in summary["results"] if len(r["bad"]) >= 2]
    assert multi_bad, f"expected combinations with >=2 bad fields: {summary}"
    detected = [r for r in multi_bad if set(r["bad"]) <= set(r["flagged"]) and r["verdict"] == "PASS"]
    assert detected, f"detector missed multi-field invalidity: {multi_bad}"
    # all-valid combination is accepted (native form submits & navigates)
    assert any(not r["bad"] and r["verdict"] == "PASS" for r in summary["results"]), summary
    print(f"[live] {base_url}/ → {summary['combinations']} combos: "
          f"{summary['passed']} pass / {summary['failed']} fail / {summary['skipped']} skip")
    print(f"[live] multi-bad combo {detected[0]['fields']} → bad={detected[0]['bad']} "
          f"flagged={detected[0]['flagged']} ({detected[0]['signal']})")
    print("SELF-TEST PASS")
