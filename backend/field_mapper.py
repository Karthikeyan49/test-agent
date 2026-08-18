"""
Deterministic DOM Field Mapper
Closes the "form fills are best-effort" gap WITHOUT a vision model: reads the live
form's own DOM (each input's id / name / placeholder / associated <label> / aria)
and maps the tool's detected field names to real, reliable CSS selectors.

A vision model is only needed for inputs with NO textual signal at all (canvas
widgets, icon-only controls). `vision_map_fields` is a clearly-marked hook that
stays inert unless a vision-capable provider is supplied — nothing is faked.
"""

import re
from typing import Dict, Any, List, Optional


# JS injected into the page: return one record per real form control, with a
# robust CSS selector and every textual signal we can use to identify it.
DOM_INVENTORY_JS = r"""
() => {
  const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s;
  const selectorFor = (el) => {
    if (el.id) return '#' + esc(el.id);
    const nm = el.getAttribute('name');
    if (nm) return el.tagName.toLowerCase() + '[name="' + nm + '"]';
    // fallback: :nth-of-type path from a stable ancestor
    let path = [], node = el;
    while (node && node.nodeType === 1 && path.length < 5) {
      let sel = node.tagName.toLowerCase();
      const parent = node.parentNode;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children,
          (c) => c.tagName === node.tagName);
        if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      path.unshift(sel);
      node = node.parentNode;
    }
    return path.join(' > ');
  };
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + esc(el.id) + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    if (typeof el.closest === 'function') {
      const l = el.closest('label');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    return '';
  };
  return Array.prototype.slice
    .call(document.querySelectorAll('input, select, textarea'))
    .map((el) => ({
      selector:    selectorFor(el),
      id:          el.getAttribute('id') || '',
      name:        el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label:       labelFor(el),
      ariaLabel:   el.getAttribute('aria-label') || '',
      type:        (el.getAttribute('type') || '').toLowerCase(),
    }))
    .filter((x) => ['hidden', 'submit', 'button', 'reset', 'image'].indexOf(x.type) === -1);
}
"""


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _tokens(s: str) -> set:
    # split snake/kebab/camel/paths into word tokens
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', s or '')
    return {t for t in re.split(r'[^a-zA-Z0-9]+', s.lower()) if len(t) >= 2}


def score_candidate(field_name: str, cand: Dict[str, Any]) -> int:
    """Score how well a DOM control matches a logical field name (0–100)."""
    fn   = _norm(field_name)
    ftok = _tokens(field_name)
    if not fn:
        return 0

    # strongest signals: id / name equality or containment
    for key, base in (("id", 100), ("name", 100)):
        cv = _norm(cand.get(key, ""))
        if not cv:
            continue
        if cv == fn:
            return base
        stripped = cv.removeprefix("field")
        if stripped == fn:
            return base - 3
        if len(fn) >= 4 and len(cv) >= 4 and (fn in cv or cv in fn):
            return base - 35   # ~65

    # textual signals: label / placeholder / aria — token overlap
    best_text = 0
    for key, base in (("label", 90), ("placeholder", 80), ("ariaLabel", 85)):
        ctok = _tokens(cand.get(key, ""))
        if not ctok or not ftok:
            continue
        overlap = ftok & ctok
        if not overlap:
            continue
        ratio = len(overlap) / len(ftok)
        best_text = max(best_text, int(base * ratio))
    return best_text


def best_selector(field_name: str, inventory: List[Dict[str, Any]],
                  threshold: int = 45) -> Optional[str]:
    """Return the CSS selector of the best-matching control, or None."""
    best, best_score = None, threshold - 1
    for cand in inventory:
        s = score_candidate(field_name, cand)
        if s > best_score:
            best, best_score = cand.get("selector"), s
    return best


def map_form_fields(page, field_names: List[str], use_vision: bool = True) -> Dict[str, str]:
    """Run DOM introspection on a live Playwright `page` and return
    {field_name: css_selector} for every field we can confidently locate.
    For fields DOM introspection can't place, fall back to a VISION model
    (only if one is configured — otherwise those fields stay unmapped).
    Duck-typed: `page` needs `.evaluate(js)` and (for vision) `.screenshot()`."""
    try:
        inventory = page.evaluate(DOM_INVENTORY_JS) or []
    except Exception:
        inventory = []

    mapping, used = {}, set()
    # assign each field its best unused selector (greedy, highest score first)
    scored = []
    for fname in field_names:
        for cand in inventory:
            sc = score_candidate(fname, cand)
            if sc >= 45:
                scored.append((sc, fname, cand.get("selector")))
    for sc, fname, sel in sorted(scored, key=lambda x: -x[0]):
        if fname in mapping or sel in used:
            continue
        mapping[fname] = sel
        used.add(sel)

    # Vision fallback — only for what DOM couldn't resolve, only if configured.
    unmapped = [f for f in field_names if f not in mapping]
    if unmapped and use_vision:
        try:
            from vision_gemini import GeminiVision
            gv = GeminiVision()
            if gv.is_available():
                png = page.screenshot()
                for k, v in gv.map_fields(unmapped, png, inventory).items():
                    if k not in mapping and v and v not in used:
                        mapping[k] = v
                        used.add(v)
        except Exception:
            pass
    return mapping


def vision_map_fields(field_names, screenshot_png: bytes, inventory=None, ai_provider=None):
    """Use a VISION model to map fields DOM introspection couldn't. If no provider
    is passed, auto-uses the configured Gemini backend (env SYSTEMINTEL_VISION_API_KEY).
    Returns {} when no vision model is configured — nothing is faked."""
    if ai_provider is not None and getattr(ai_provider, "supports_vision", False):
        return ai_provider.map_fields(field_names, screenshot_png, inventory)
    try:
        from vision_gemini import GeminiVision
        gv = GeminiVision()
        return gv.map_fields(field_names, screenshot_png, inventory) if gv.is_available() else {}
    except Exception:
        return {}


if __name__ == "__main__":
    # Self-test the matching logic against a mock DOM inventory (no browser needed).
    inventory = [
        {"selector": "#first_name", "id": "first_name", "name": "first_name",
         "placeholder": "First name", "label": "First name", "ariaLabel": "", "type": "text"},
        {"selector": "#email", "id": "email", "name": "email",
         "placeholder": "you@example.com", "label": "Email Address", "ariaLabel": "", "type": "email"},
        {"selector": 'input[name="creditLimit"]', "id": "", "name": "creditLimit",
         "placeholder": "", "label": "Credit Limit ($)", "ariaLabel": "", "type": "number"},
        {"selector": "form > div:nth-of-type(4) > input", "id": "", "name": "",
         "placeholder": "Notes", "label": "Order notes", "ariaLabel": "", "type": "text"},
    ]

    class _Stub:
        def evaluate(self, js):
            return inventory

    # exact id/name
    assert best_selector("first_name", inventory) == "#first_name"
    assert best_selector("email", inventory) == "#email"
    # tool field id "field-credit-limit" → matches name creditLimit (normalized)
    assert best_selector("field-credit-limit", inventory) == 'input[name="creditLimit"]'
    # no id/name → matched via label/placeholder text ("notes")
    assert best_selector("notes", inventory) == "form > div:nth-of-type(4) > input"
    # nonsense field → no confident match
    assert best_selector("xyzzy_nonexistent", inventory) is None

    m = map_form_fields(_Stub(), ["first_name", "email", "field-credit-limit", "notes"])
    assert m["first_name"] == "#first_name"
    assert m["email"] == "#email"
    assert m["notes"] == "form > div:nth-of-type(4) > input"
    # vision hook stays inert without a provider
    assert vision_map_fields(["x"], b"", inventory, None) == {}

    print("mapped:", m)
    print("SELF-TEST PASS")
