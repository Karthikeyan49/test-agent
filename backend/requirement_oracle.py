"""
Requirement Oracle  (checks intent, not just persistence — closes Gap #2)
=========================================================================
The round-trip / cross-layer oracles answer "did the value persist and come back
the same?". They do NOT answer "is that what the requirement asked for?" — the tool
has no spec, so it can only check self-consistency. This oracle closes that gap for
the machine-checkable SUBSET of requirements.

It takes two things:
  1. a REQUIREMENT SOURCE — the natural-language use-cases already extracted into the
     page-docs corpus, and/or a structured requirements dict / OpenAPI response schema,
  2. an OBSERVED evidence dict — a response body and/or UI evidence,
and decides PASS / FAIL / SKIP.

Honesty is the whole point:
  • A requirement is judged ONLY on what it literally, unambiguously constrains
    (a named field present, a value equal / in range, an item count, a status code).
  • A vague NL requirement that cannot be turned into a deterministic check is SKIPPED
    with reason "requirement not machine-checkable" — it is NEVER silently PASSED.
  • A checkable requirement whose evidence violates it is a FAIL with expected-vs-actual.

`extract_requirements()` is deliberately conservative: it only emits an assertion when
it can ground one in literal text (a quoted/keyed field name + a comparator + a value,
or an OpenAPI `required` / `enum` / numeric bound). Everything else stays NL and skips.

Modelled on backend/injection_oracle.py / backend/authz_oracle.py: pure functions +
a __main__ self-test with hand-built PASS / FAIL / SKIP fixtures. Consumed by cli.py.
"""

import re
from typing import Any, Dict, List, Optional


# ── evidence access ───────────────────────────────────────────────────────────
def _nk(s: str) -> str:
    """Normalise a key so orderId ≡ order_id ≡ orderid (case/separator-insensitive)."""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _get_ci(d: Dict[str, Any], field: str) -> Any:
    """Case/separator-insensitive lookup of `field` in dict `d`."""
    if field in d:
        return d[field]
    target = _nk(field)
    for k, v in d.items():
        if _nk(k) == target:
            return v
    return _MISSING


def _dig(evidence: Any, field: str) -> Any:
    """Fetch `field` from an evidence dict, tolerating camelCase/snake_case, nesting
    under common wrappers (data / result / item), and dotted paths. _MISSING if absent."""
    if not isinstance(evidence, dict):
        return _MISSING
    if "." in field:
        cur: Any = evidence
        for part in field.split("."):
            if isinstance(cur, dict):
                cur = _get_ci(cur, part)
                if cur is _MISSING:
                    return _MISSING
            else:
                return _MISSING
        return cur
    v = _get_ci(evidence, field)
    if v is not _MISSING:
        return v
    for wrap in ("data", "result", "item", "record", "attributes"):
        sub = evidence.get(wrap)
        if isinstance(sub, dict):
            v = _get_ci(sub, field)
            if v is not _MISSING:
                return v
    return _MISSING


_MISSING = object()


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _eq(a: Any, b: Any) -> bool:
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return na == nb
    return str(a).strip().lower() == str(b).strip().lower()


# ── requirement assertion model ───────────────────────────────────────────────
# A machine-checkable requirement is a small dict:
#   {"kind": "present"|"equals"|"min"|"max"|"in"|"count"|"status",
#    "field": <name> (not for status), "value": <expected> (kind-dependent),
#    "text": <original NL, for reporting>}
_VERDICT_TECH = "REQUIREMENT"


def _verdict(passed: Optional[bool], reason: str, req: Dict[str, Any],
             skipped: bool = False, expected: Any = None, actual: Any = None) -> Dict[str, Any]:
    return {
        "technique": _VERDICT_TECH,
        "requirement": req.get("text", req.get("kind")),
        "kind": req.get("kind"),
        "field": req.get("field"),
        "verdict": ("SKIP" if skipped else ("PASS" if passed else "FAIL")),
        "passed": (None if skipped else bool(passed)),
        "skipped": bool(skipped),
        "reason": reason,
        "expected": expected,
        "actual": actual,
    }


def check_requirement(req: Dict[str, Any], evidence: Dict[str, Any],
                      status_code: Optional[int] = None) -> Dict[str, Any]:
    """Evaluate ONE machine-checkable requirement against observed evidence."""
    kind = req.get("kind")

    if kind == "status":
        if status_code is None:
            return _verdict(None, "no status code observed — cannot check", req, skipped=True)
        ok = int(status_code) == int(req["value"])
        return _verdict(ok, f"status {status_code} vs required {req['value']}", req,
                        expected=req["value"], actual=status_code)

    if kind is None or "field" not in req or kind == "nl":
        return _verdict(None, "requirement not machine-checkable — left for a human oracle",
                        req, skipped=True)

    field = req["field"]
    val = _dig(evidence, field)

    if kind == "present":
        if _val_missing(val):
            return _verdict(False, f"required field '{field}' absent from the response", req,
                            expected="present", actual="absent")
        return _verdict(True, f"required field '{field}' is present", req,
                        expected="present", actual="present")

    # every remaining kind needs the field to exist first
    if _val_missing(val):
        return _verdict(None, f"field '{field}' not in evidence — cannot check {kind}", req,
                        skipped=True)

    if kind == "equals":
        ok = _eq(val, req["value"])
        return _verdict(ok, f"'{field}' == {req['value']!r}?", req,
                        expected=req["value"], actual=val)
    if kind in ("min", "max"):
        nv, nr = _num(val), _num(req["value"])
        if nv is None or nr is None:
            return _verdict(None, f"'{field}' or bound is non-numeric — cannot check {kind}",
                            req, skipped=True)
        ok = (nv >= nr) if kind == "min" else (nv <= nr)
        return _verdict(ok, f"'{field}' {kind} {req['value']}?", req,
                        expected=f"{kind} {req['value']}", actual=val)
    if kind == "in":
        opts = req["value"] if isinstance(req["value"], (list, tuple, set)) else [req["value"]]
        ok = any(_eq(val, o) for o in opts)
        return _verdict(ok, f"'{field}' in {list(opts)}?", req,
                        expected=list(opts), actual=val)
    if kind == "count":
        if not isinstance(val, (list, tuple)):
            return _verdict(None, f"'{field}' is not a list — cannot count", req, skipped=True)
        ok = len(val) == int(req["value"])
        return _verdict(ok, f"len('{field}') == {req['value']}?", req,
                        expected=req["value"], actual=len(val))

    return _verdict(None, f"unknown requirement kind {kind!r}", req, skipped=True)


def _val_missing(v: Any) -> bool:
    return v is _MISSING or v is None


# ── conservative NL → assertion extraction ────────────────────────────────────
# Only patterns we can ground literally become assertions; everything else stays NL
# (kind="nl") and will SKIP. Better to under-extract than to invent a false check.
_FIELD = r"[`'\"]?([a-zA-Z][a-zA-Z0-9_ ]{0,40}?)[`'\"]?"
_PAT_EQUALS = re.compile(rf"\b{_FIELD}\s+(?:must be|should be|is|equals?)\s+[`'\"]?([^`'\".,;]+)",
                         re.IGNORECASE)
_PAT_REQUIRED = re.compile(rf"\b{_FIELD}\s+(?:is\s+)?required\b", re.IGNORECASE)
_PAT_MIN = re.compile(rf"\b{_FIELD}\s+(?:>=|at least|minimum|min)\s+(\d+(?:\.\d+)?)", re.IGNORECASE)
_PAT_MAX = re.compile(rf"\b{_FIELD}\s+(?:<=|at most|maximum|max)\s+(\d+(?:\.\d+)?)", re.IGNORECASE)


def _clean_field(s: str) -> str:
    return re.sub(r"\s+", "_", s.strip().lower())


def extract_requirements(source: Any) -> List[Dict[str, Any]]:
    """Turn a requirement source into machine-checkable assertions (best-effort,
    conservative). Accepts:
      • a list of NL use-case strings (page-docs use_cases),
      • a dict of {field: expected} (already structured),
      • an OpenAPI-ish response schema: {"required":[...], "properties":{f:{enum/minimum/maximum}}}.
    Un-grounded NL sentences become {"kind":"nl", ...} so they SKIP rather than lie."""
    reqs: List[Dict[str, Any]] = []

    if isinstance(source, dict) and ("properties" in source or "required" in source):
        for f in (source.get("required") or []):
            reqs.append({"kind": "present", "field": f, "text": f"'{f}' is required"})
        for f, spec in (source.get("properties") or {}).items():
            if not isinstance(spec, dict):
                continue
            if "enum" in spec:
                reqs.append({"kind": "in", "field": f, "value": spec["enum"],
                             "text": f"'{f}' in {spec['enum']}"})
            if "minimum" in spec:
                reqs.append({"kind": "min", "field": f, "value": spec["minimum"],
                             "text": f"'{f}' >= {spec['minimum']}"})
            if "maximum" in spec:
                reqs.append({"kind": "max", "field": f, "value": spec["maximum"],
                             "text": f"'{f}' <= {spec['maximum']}"})
        return reqs

    if isinstance(source, dict):
        for f, v in source.items():
            reqs.append({"kind": "equals", "field": f, "value": v,
                         "text": f"'{f}' should equal {v!r}"})
        return reqs

    if isinstance(source, str):
        source = [source]
    for sentence in (source or []):
        if not isinstance(sentence, str):
            continue
        matched = False
        for m in _PAT_REQUIRED.finditer(sentence):
            reqs.append({"kind": "present", "field": _clean_field(m.group(1)), "text": sentence})
            matched = True
        for m in _PAT_MIN.finditer(sentence):
            reqs.append({"kind": "min", "field": _clean_field(m.group(1)),
                         "value": float(m.group(2)), "text": sentence})
            matched = True
        for m in _PAT_MAX.finditer(sentence):
            reqs.append({"kind": "max", "field": _clean_field(m.group(1)),
                         "value": float(m.group(2)), "text": sentence})
            matched = True
        if not matched:
            for m in _PAT_EQUALS.finditer(sentence):
                fld, val = _clean_field(m.group(1)), m.group(2).strip()
                # guard against absurd matches (whole sentence captured as a field)
                if 1 <= len(fld) <= 40 and fld not in ("the", "a", "it", "this"):
                    reqs.append({"kind": "equals", "field": fld, "value": val, "text": sentence})
                    matched = True
                    break
        if not matched:
            reqs.append({"kind": "nl", "text": sentence})   # → SKIP (not machine-checkable)
    return reqs


def evaluate_requirements(source: Any, evidence: Dict[str, Any],
                          status_code: Optional[int] = None) -> Dict[str, Any]:
    """Extract + evaluate a whole requirement source against evidence. Returns
    {results:[...], passed, failed, skipped, verdict} where verdict is FAIL if any
    requirement failed, else PASS if any was actually checked, else SKIP."""
    reqs = extract_requirements(source)
    results = [check_requirement(r, evidence, status_code) for r in reqs]
    failed = [r for r in results if r["passed"] is False]
    passed = [r for r in results if r["passed"] is True]
    skipped = [r for r in results if r["skipped"]]
    verdict = "FAIL" if failed else ("PASS" if passed else "SKIP")
    return {"results": results, "passed": len(passed), "failed": len(failed),
            "skipped": len(skipped), "verdict": verdict}


if __name__ == "__main__":
    # PASS: a required field present + a value in range.
    r = check_requirement({"kind": "present", "field": "orderId", "text": "orderId required"},
                          {"orderId": 42})
    assert r["passed"] is True, r
    r = check_requirement({"kind": "min", "field": "total", "value": 0, "text": "total >= 0"},
                          {"total": 10})
    assert r["passed"] is True, r

    # FAIL: a required field absent, and a value out of range, with concrete diff.
    r = check_requirement({"kind": "present", "field": "orderId", "text": "orderId required"},
                          {"data": {"name": "x"}})
    assert r["passed"] is False and r["actual"] == "absent", r
    r = check_requirement({"kind": "equals", "field": "status", "value": "paid",
                           "text": "status must be paid"}, {"status": "pending"})
    assert r["passed"] is False and r["actual"] == "pending", r

    # nesting: value dug out from under a "data" wrapper.
    r = check_requirement({"kind": "equals", "field": "email", "value": "a@b.com", "text": "x"},
                          {"data": {"email": "a@b.com"}})
    assert r["passed"] is True, r

    # SKIP: field simply not in the evidence (can't check) — must NOT be a false pass/fail.
    r = check_requirement({"kind": "equals", "field": "phone", "value": "123", "text": "x"},
                          {"email": "a@b.com"})
    assert r["skipped"] is True and r["passed"] is None, r

    # SKIP: a vague NL requirement that cannot be grounded.
    reqs = extract_requirements(["The dashboard should feel responsive and look modern."])
    assert len(reqs) == 1 and reqs[0]["kind"] == "nl", reqs
    r = check_requirement(reqs[0], {"anything": 1})
    assert r["skipped"] is True, r

    # extraction grounds the checkable subset.
    reqs = extract_requirements(["email is required", "quantity at least 1",
                                 "status must be active"])
    kinds = sorted(x["kind"] for x in reqs)
    assert "present" in kinds and "min" in kinds and "equals" in kinds, reqs

    # OpenAPI schema extraction.
    reqs = extract_requirements({"required": ["id"],
                                 "properties": {"status": {"enum": ["a", "b"]},
                                                "qty": {"minimum": 1, "maximum": 99}}})
    ks = sorted(x["kind"] for x in reqs)
    assert ks == ["in", "max", "min", "present"], ks

    # end-to-end: mixed source, one real FAIL dominates the verdict.
    summary = evaluate_requirements(
        ["orderId is required", "total at least 100", "looks nice"],
        {"orderId": 7, "total": 50})
    assert summary["verdict"] == "FAIL", summary
    assert summary["failed"] == 1 and summary["passed"] == 1 and summary["skipped"] == 1, summary

    print("requirement_oracle SELF-TEST PASS (PASS/FAIL/SKIP incl. not-machine-checkable → SKIP)")
