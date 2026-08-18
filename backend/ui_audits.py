"""
UI-Quality Audit Layer (Phase 5)
Adds accessibility auditing + visual-regression on top of the Playwright
browser runner so SystemIntel judges UX, not just API/DB correctness.

This module is intentionally self-contained and does NOT import Playwright or
PIL at import time — Playwright is not installed in every environment and the
CSP on the target ERP blocks CDN scripts (so axe-core can't be bundled/injected).

Instead:
  * audit_accessibility() runs a single deterministic JS pass in the page via
    page.evaluate() and shapes the JSON-able result into WCAG-style findings.
  * visual_snapshot()/visual_compare() drive full-page screenshots and diff them
    with Pillow when available, falling back to a pure-byte comparison otherwise.

The `page` argument is an already-created Playwright sync page object and is
duck-typed here (only .evaluate(), .screenshot(), .title() are used), so tests
can pass a lightweight stub.
"""

import os
import re
from typing import Any, Dict, List, Tuple


# --------------------------------------------------------------------------- #
# Accessibility auditing
# --------------------------------------------------------------------------- #

# A single self-contained function expression. Playwright auto-invokes a string
# that evaluates to a function, so this returns a plain JSON-able dict of
# {ruleKey: {count, sample[]}} that we reshape in Python. No external libraries,
# no network — safe under a strict CSP.
ACCESSIBILITY_JS = r"""
() => {
  const clip = (el) => {
    let s = (el && el.outerHTML) ? el.outerHTML : String(el);
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  };
  const findings = {};

  // (1) <img> with no alt attribute at all.
  const imgs = Array.prototype.slice.call(document.querySelectorAll('img'))
    .filter((el) => !el.hasAttribute('alt'));
  findings.imagesMissingAlt = {
    count: imgs.length,
    sample: imgs.slice(0, 3).map(clip)
  };

  // (2) form controls with no associated label / aria-label / aria-labelledby / title.
  const controls = Array.prototype.slice
    .call(document.querySelectorAll('input, select, textarea'))
    .filter((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].indexOf(type) !== -1) return false;
      if ((el.getAttribute('aria-label') || '').trim()) return false;
      if ((el.getAttribute('aria-labelledby') || '').trim()) return false;
      if ((el.getAttribute('title') || '').trim()) return false;
      const id = el.getAttribute('id');
      if (id) {
        const safe = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
        if (document.querySelector('label[for="' + safe + '"]')) return false;
      }
      if (typeof el.closest === 'function' && el.closest('label')) return false;
      return true;
    });
  findings.controlsMissingLabel = {
    count: controls.length,
    sample: controls.slice(0, 3).map(clip)
  };

  // (3) <button>/<a> with no accessible text (no text content, no aria-label/title,
  //     no inner image with alt text).
  const interactive = Array.prototype.slice
    .call(document.querySelectorAll('button, a'))
    .filter((el) => {
      if ((el.textContent || '').trim()) return false;
      if ((el.getAttribute('aria-label') || '').trim()) return false;
      if ((el.getAttribute('title') || '').trim()) return false;
      const img = el.querySelector && el.querySelector('img[alt]');
      if (img && (img.getAttribute('alt') || '').trim()) return false;
      return true;
    });
  findings.controlsMissingText = {
    count: interactive.length,
    sample: interactive.slice(0, 3).map(clip)
  };

  // (4) missing <html lang>.
  const htmlEl = document.documentElement;
  const langMissing = !(htmlEl && (htmlEl.getAttribute('lang') || '').trim());
  findings.missingHtmlLang = {
    count: langMissing ? 1 : 0,
    sample: langMissing ? ['<html> element has no non-empty lang attribute'] : []
  };

  // (5) missing <title>.
  const titleMissing = !((document.title || '').trim());
  findings.missingTitle = {
    count: titleMissing ? 1 : 0,
    sample: titleMissing ? ['<head> has no non-empty <title>'] : []
  };

  // (6) duplicate element ids.
  const idMap = {};
  Array.prototype.slice.call(document.querySelectorAll('[id]')).forEach((el) => {
    const id = el.getAttribute('id');
    if (!id) return;
    (idMap[id] = idMap[id] || []).push(el);
  });
  let dupCount = 0;
  const dupSample = [];
  Object.keys(idMap).forEach((id) => {
    if (idMap[id].length > 1) {
      dupCount += 1;
      if (dupSample.length < 3) {
        dupSample.push('id="' + id + '" is used ' + idMap[id].length + ' times');
      }
    }
  });
  findings.duplicateIds = { count: dupCount, sample: dupSample };

  return findings;
}
"""

# Maps the raw JS finding keys → (WCAG-ish rule name, severity).
# Severity buckets mirror axe-core's serious / moderate / minor vocabulary.
_RULE_SPECS: List[Tuple[str, str, str]] = [
    ("imagesMissingAlt",     "image-alt",           "serious"),
    ("controlsMissingLabel", "label",               "serious"),
    ("controlsMissingText",  "link-button-name",    "serious"),
    ("missingHtmlLang",      "html-has-lang",        "moderate"),
    ("missingTitle",         "document-title",       "moderate"),
    ("duplicateIds",         "duplicate-id",         "minor"),
]


def audit_accessibility(page: Any) -> List[Dict[str, Any]]:
    """
    Run deterministic WCAG-style accessibility checks against a live page.

    Executes ACCESSIBILITY_JS in the page context via a single page.evaluate()
    call, then reshapes the returned counts/samples into audit findings.

    Args:
        page: A Playwright sync page (duck-typed; only .evaluate() is used).

    Returns:
        A list of findings, one per triggered rule (count > 0), each shaped as::

            {
              "rule":     str,                    # e.g. "image-alt"
              "severity": "serious"|"moderate"|"minor",
              "count":    int,                    # number of offending nodes
              "sample":   [str, ...],             # up to 3 outerHTML snippets
            }

        Rules with a zero count are omitted, so an empty list means "no issues".
    """
    raw = page.evaluate(ACCESSIBILITY_JS) or {}

    issues: List[Dict[str, Any]] = []
    for key, rule, severity in _RULE_SPECS:
        entry = raw.get(key) or {}
        try:
            count = int(entry.get("count", 0) or 0)
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            continue
        sample = entry.get("sample") or []
        issues.append({
            "rule":     rule,
            "severity": severity,
            "count":    count,
            "sample":   [str(s) for s in list(sample)[:3]],
        })
    return issues


def run_accessibility_assertion(page: Any) -> Dict[str, Any]:
    """
    Convenience wrapper that turns audit_accessibility() into a runner-style
    result dict, so it can be dropped into PlaywrightRunner.run_test_case for a
    {"type": "UI", "checkType": "accessibility"} assertion.

    The gate is deterministic: the assertion passes only when there are no
    `serious` violations (moderate/minor issues are reported but don't fail it).

    Args:
        page: A Playwright sync page (duck-typed).

    Returns:
        {
          "type":         "UI",
          "checkType":    "accessibility",
          "passed":       bool,
          "issues":       [ ...audit_accessibility() findings... ],
          "seriousCount": int,
          "moderateCount":int,
          "minorCount":   int,
          "error":        None,
        }
    """
    result: Dict[str, Any] = {
        "type":          "UI",
        "checkType":     "accessibility",
        "passed":        False,
        "issues":        [],
        "seriousCount":  0,
        "moderateCount": 0,
        "minorCount":    0,
        "error":         None,
    }
    try:
        issues = audit_accessibility(page)
        counts = {"serious": 0, "moderate": 0, "minor": 0}
        for issue in issues:
            counts[issue["severity"]] = counts.get(issue["severity"], 0) + issue["count"]
        result.update({
            "passed":        counts["serious"] == 0,
            "issues":        issues,
            "seriousCount":  counts["serious"],
            "moderateCount": counts["moderate"],
            "minorCount":    counts["minor"],
        })
    except Exception as exc:  # noqa: BLE001 - surface, never crash the test run
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


# --------------------------------------------------------------------------- #
# Visual regression
# --------------------------------------------------------------------------- #

# A pixel diff below this fraction of total pixels (or bytes) is treated as noise.
CHANGED_THRESHOLD = 0.01


def _safe_name(name: str) -> str:
    """Sanitise a snapshot name into a filesystem-safe base filename."""
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", str(name)).strip("_")
    return base or "snapshot"


def _baseline_path(name: str, baseline_dir: str) -> str:
    return os.path.join(baseline_dir, _safe_name(name) + ".png")


def _current_path(name: str, baseline_dir: str) -> str:
    return os.path.join(baseline_dir, _safe_name(name) + ".current.png")


def visual_snapshot(page: Any, name: str, baseline_dir: str) -> str:
    """
    Capture a baseline full-page screenshot for `name` if one does not exist.

    Args:
        page:         A Playwright sync page (duck-typed; only .screenshot() used).
        name:         Logical snapshot name (used to derive the file name).
        baseline_dir: Directory in which baselines are stored (created if absent).

    Returns:
        The absolute-or-relative path to the baseline PNG. If a baseline already
        exists it is left untouched and its path is returned.
    """
    os.makedirs(baseline_dir, exist_ok=True)
    path = _baseline_path(name, baseline_dir)
    if not os.path.exists(path):
        page.screenshot(path=path, full_page=True)
    return path


def visual_compare(page: Any, name: str, baseline_dir: str) -> Dict[str, Any]:
    """
    Screenshot the current page and diff it against the stored baseline.

    Uses Pillow for a real per-pixel diff when it is importable; otherwise falls
    back to a pure-byte comparison and records that in the "method" field.

    Args:
        page:         A Playwright sync page (duck-typed).
        name:         Logical snapshot name (must match visual_snapshot()).
        baseline_dir: Directory where the baseline lives.

    Returns:
        {
          "baselineExists": bool,   # was there a baseline to compare against?
          "diffRatio":      float,  # 0.0 (identical) .. 1.0 (fully different)
          "changed":        bool,   # diffRatio > CHANGED_THRESHOLD (0.01)
          "currentPath":    str,    # path of the freshly captured screenshot
          "baselinePath":   str,    # path of the baseline (may not exist)
          "method":         str,    # "pil-pixel" | "byte-fallback" | "none"
        }
    """
    os.makedirs(baseline_dir, exist_ok=True)
    baseline = _baseline_path(name, baseline_dir)
    current = _current_path(name, baseline_dir)

    page.screenshot(path=current, full_page=True)
    baseline_exists = os.path.exists(baseline)

    result: Dict[str, Any] = {
        "baselineExists": baseline_exists,
        "diffRatio":      0.0,
        "changed":        False,
        "currentPath":    current,
        "baselinePath":   baseline,
        "method":         "none",
    }

    if not baseline_exists:
        # Nothing to diff against — first run establishes the baseline elsewhere.
        return result

    diff_ratio, method = _compute_diff_ratio(baseline, current)
    result["diffRatio"] = diff_ratio
    result["method"] = method
    result["changed"] = diff_ratio > CHANGED_THRESHOLD
    return result


def _compute_diff_ratio(baseline_path: str, current_path: str) -> Tuple[float, str]:
    """
    Return (diffRatio, method). Prefers a Pillow per-pixel diff; falls back to a
    byte-level comparison when Pillow (or image decoding) is unavailable.
    """
    try:
        from PIL import Image, ImageChops  # guarded: Pillow may not be installed
    except ImportError:
        return _byte_diff_ratio(baseline_path, current_path)

    try:
        with Image.open(baseline_path) as base_img, Image.open(current_path) as cur_img:
            base_rgb = base_img.convert("RGB")
            cur_rgb = cur_img.convert("RGB")
            if base_rgb.size != cur_rgb.size:
                cur_rgb = cur_rgb.resize(base_rgb.size)
            width, height = base_rgb.size
            total = width * height
            if total == 0:
                return 0.0, "pil-pixel"
            # Per-channel absolute difference collapsed to luminance, then count
            # pixels whose difference exceeds a small tolerance (anti-alias noise).
            diff = ImageChops.difference(base_rgb, cur_rgb).convert("L")
            tolerance = 16
            histogram = diff.histogram()  # 256 luminance buckets
            changed_pixels = sum(histogram[tolerance + 1:])
            return (changed_pixels / total), "pil-pixel"
    except Exception:
        # Corrupt/undecodable image (e.g. stub-written stub bytes) → byte fallback.
        return _byte_diff_ratio(baseline_path, current_path)


def _byte_diff_ratio(baseline_path: str, current_path: str) -> Tuple[float, str]:
    """
    Pure-byte diff ratio used when Pillow is absent. Combines a size-delta ratio
    with a byte-for-byte mismatch ratio over the overlapping region and returns
    the larger (more conservative) of the two.
    """
    with open(baseline_path, "rb") as fh:
        a = fh.read()
    with open(current_path, "rb") as fh:
        b = fh.read()

    if not a and not b:
        return 0.0, "byte-fallback"

    denom = max(len(a), len(b), 1)
    size_ratio = abs(len(a) - len(b)) / denom

    overlap = min(len(a), len(b))
    mismatched = sum(1 for i in range(overlap) if a[i] != b[i])
    mismatched += abs(len(a) - len(b))
    byte_ratio = mismatched / denom

    return max(size_ratio, byte_ratio), "byte-fallback"


# --------------------------------------------------------------------------- #
# Self-test (no live browser / Playwright / PIL required)
# --------------------------------------------------------------------------- #

class _StubPage:
    """
    Minimal duck-typed stand-in for a Playwright sync page, exercising exactly
    the methods this module calls. evaluate() ignores the JS and returns a canned
    findings dict; screenshot() writes a few bytes to `path`.
    """

    def __init__(self) -> None:
        self._shot_count = 0

    def evaluate(self, js: str) -> Dict[str, Any]:  # noqa: ARG002 - js ignored in stub
        # Simulates: 2 images missing alt, 1 unlabeled input, missing <html lang>.
        return {
            "imagesMissingAlt": {
                "count": 2,
                "sample": ["<img src='logo.png'>", "<img src='hero.jpg'>"],
            },
            "controlsMissingLabel": {
                "count": 1,
                "sample": ["<input type='text' name='email'>"],
            },
            "controlsMissingText":  {"count": 0, "sample": []},
            "missingHtmlLang":      {"count": 1, "sample": ["<html> element has no non-empty lang attribute"]},
            "missingTitle":         {"count": 0, "sample": []},
            "duplicateIds":         {"count": 0, "sample": []},
        }

    def screenshot(self, path: str = None, **kwargs: Any) -> bytes:  # noqa: ARG002
        # Write a few deterministic bytes so file-based diffing has real files.
        self._shot_count += 1
        data = b"\x89PNG\r\n\x1a\n" + b"STUBSCREENSHOTBYTES"
        if path:
            with open(path, "wb") as fh:
                fh.write(data)
        return data

    def title(self) -> str:
        return "Test"


def _self_test() -> None:
    import tempfile

    stub = _StubPage()

    # --- accessibility ---
    issues = audit_accessibility(stub)
    assert isinstance(issues, list), "audit_accessibility must return a list"
    assert len(issues) > 0, "expected a non-empty issue list from the stub findings"
    expected_keys = {"rule", "severity", "count", "sample"}
    for issue in issues:
        assert expected_keys.issubset(issue.keys()), f"missing keys in {issue}"
        assert issue["count"] > 0, "only rules with count>0 should appear"
        assert issue["severity"] in ("serious", "moderate", "minor")
        assert isinstance(issue["sample"], list) and len(issue["sample"]) <= 3
    rules_found = {i["rule"] for i in issues}
    assert "image-alt" in rules_found, "image-alt rule should be present"
    assert "label" in rules_found, "label rule should be present"
    assert "html-has-lang" in rules_found, "html-has-lang rule should be present"

    # runner-style wrapper
    wrapped = run_accessibility_assertion(stub)
    assert wrapped["checkType"] == "accessibility"
    assert wrapped["seriousCount"] >= 3, "2 img + 1 input should count as serious"
    assert wrapped["passed"] is False, "serious violations must fail the gate"
    assert wrapped["error"] is None

    # --- visual regression ---
    with tempfile.TemporaryDirectory() as baseline_dir:
        snap_path = visual_snapshot(stub, "home", baseline_dir)
        assert os.path.exists(snap_path), "baseline screenshot should have been written"
        # Calling snapshot again must NOT overwrite an existing baseline.
        assert visual_snapshot(stub, "home", baseline_dir) == snap_path

        cmp_result = visual_compare(stub, "home", baseline_dir)
        documented_keys = {"baselineExists", "diffRatio", "changed", "currentPath"}
        assert documented_keys.issubset(cmp_result.keys()), \
            f"visual_compare result missing keys: {cmp_result}"
        assert cmp_result["baselineExists"] is True
        assert isinstance(cmp_result["diffRatio"], float)
        assert isinstance(cmp_result["changed"], bool)
        assert os.path.exists(cmp_result["currentPath"])
        # Stub writes identical bytes → no meaningful diff.
        assert cmp_result["changed"] is False, "identical bytes should not be 'changed'"

    print("SELF-TEST PASS")


if __name__ == "__main__":
    _self_test()
