"""
Combinatorial (t-wise) Test Generator  (Gap #6 — interaction coverage)
======================================================================
Every other generator in this engine practises SINGLE-FAULT ISOLATION: a valid
baseline body with exactly ONE field made bad (per-field black-box, contract
negatives). That answers "is each rule enforced in isolation?" but never "do two
wrong fields interact?" or "does a valid value in field A change how a bad value
in field B is handled?". The real input space is fields × value-classes, and its
cross-product explodes: 6 fields × 4 classes each = 4^6 = 4096 bodies per endpoint.

This module samples that interaction space with a deterministic PAIRWISE (2-wise)
covering array: every (fieldA=classX, fieldB=classY) pair is guaranteed to appear
in at least one generated request, at a tiny fraction of the full cross-product.
Empirically most interaction bugs are 2-way, so pairwise finds them cheaply.

    strength=1   each value-class of each field appears at least once
    strength=2   (default) every PAIR of (fieldA=classX, fieldB=classY) appears
    cap          a per-endpoint ceiling on generated rows, so a wide endpoint
                 with many fields/classes can never blow up the suite

Value-classes per field are derived deterministically from the field's declared
domain (type, required, maxLength, minValue, enum, non-negative name). Each class
carries a VALIDITY verdict — True (schema-conforming), False (a definite rule
violation), or None (genuinely unknowable, e.g. an empty optional field).

Oracle for a generated combination (the engine's law: "AI proposes, a deterministic
check decides; a SKIP is never a PASS"):
    • ANY field set to an INVALID class → the request SHOULD be rejected → 4xx.
      A 2xx here is a FAIL (a validation gap the single-fault battery can miss,
      because it only ever makes one field bad at a time).
    • ALL fields valid → expect 2xx (the combination is a legal request).
    • No invalid field but at least one UNKNOWABLE class → the correct status is
      genuinely undecidable → emit a SKIP with a reason, never a PASS.

Sources, in preference order (self-contained, standard library only):
    1. graph_data["requestContracts"]  — the controller's own parsed request
       contract (from endpoint_contracts.py): precise field names + rules.
    2. graph_data["apiEndpoints"] + graph_data["dbTables"] — schema-derived
       fields for write endpoints whose path names a table (fallback).

Public entry point (wire into cli.py):
    generate_combinatorial_tests(graph_data, strength=2,
                                 cap_per_endpoint=64, max_cases=2000,
                                 max_classes_per_field=4) -> List[Dict]

Ships a deterministic __main__ self-test (`python3 backend/combinatorial.py`
exits 0) that asserts pairwise-coverage completeness, bounded size, and correct
oracle labelling.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

# ── SQL dataType classification (compact, self-contained) ─────────────────────
_NUMERIC_RE = re.compile(r'\b(INT|INTEGER|BIGINT|TINYINT|SMALLINT|MEDIUMINT|'
                         r'DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b', re.IGNORECASE)
_DATE_RE    = re.compile(r'\b(DATE|DATETIME|TIMESTAMP|TIME)\b', re.IGNORECASE)
_LEN_RE     = re.compile(r'\b(?:VAR)?CHAR\s*\(\s*(\d+)\s*\)', re.IGNORECASE)
_ENUM_RE    = re.compile(r"\bENUM\s*\((.*)\)", re.IGNORECASE | re.DOTALL)
_EMAIL_NAME = re.compile(r'e[-_]?mail', re.IGNORECASE)
_NONNEG_NAME = re.compile(
    r'(?:^|_)(price|amount|total|subtotal|qty|quantity|stock|cost|weight|paid|'
    r'age|count|limit|discount|rate|percent|balance)(?:_|$)', re.IGNORECASE)
# structural columns are not user-input; skip them (matches field_blackbox policy)
_SKIP_NAME  = re.compile(r'^(id|created_at|updated_at|deleted_at)$|_id$', re.IGNORECASE)


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _is_num(v: Any) -> bool:
    """int/float but not bool (bool is an int subclass in Python)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _enum_values(dt: str) -> Optional[List[str]]:
    m = _ENUM_RE.search(dt or '')
    if not m:
        return None
    return re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))


# ── field normalization: contract-field OR schema-column → common shape ───────
def _normalize_contract_field(f: Dict[str, Any]) -> Dict[str, Any]:
    name = str(f.get("name") or "")
    ftype = str(f.get("type") or "text").lower()
    if ftype not in ("text", "email", "number", "bool", "date", "enum"):
        ftype = "text"
    return {
        "name":      name,
        "type":      ftype,
        "required":  bool(f.get("required")),
        "maxLength": f.get("maxLength") if _is_num(f.get("maxLength")) else None,
        "minValue":  f.get("minValue") if _is_num(f.get("minValue")) else None,
        "enum":      list(f.get("enum") or []),
        "nonneg":    bool(_NONNEG_NAME.search(name)),
    }


def _normalize_column(col: Dict[str, Any]) -> Dict[str, Any]:
    name = str(col.get("name") or "")
    dt   = str(col.get("dataType") or "")
    ev   = _enum_values(dt)
    if ev:
        ftype = "enum"
    elif _EMAIL_NAME.search(name):
        ftype = "email"
    elif _NUMERIC_RE.search(dt):
        ftype = "number"
    elif _DATE_RE.search(dt):
        ftype = "date"
    else:
        ftype = "text"
    ml = _LEN_RE.search(dt)
    # required iff NOT NULL and not DB-filled (default / auto-increment)
    required = (col.get("isNullable") is False) and not col.get("hasDefault") \
        and not col.get("isAutoIncrement")
    return {
        "name":      name,
        "type":      ftype,
        "required":  bool(required),
        "maxLength": int(ml.group(1)) if ml else None,
        "minValue":  None,
        "enum":      ev or [],
        "nonneg":    bool(_NONNEG_NAME.search(name)),
    }


# ── a schema/contract-valid value for a normalized field ──────────────────────
def _valid_value(nf: Dict[str, Any]) -> Any:
    t, name = nf["type"], nf["name"]
    if t == "email":
        return "valid@test.com"
    if t == "number":
        return nf["minValue"] if _is_num(nf["minValue"]) else 5
    if t == "bool":
        return True
    if t == "date":
        return "2026-01-01"
    if t == "enum":
        return nf["enum"][0] if nf["enum"] else "valid"
    ml, mn = nf["maxLength"], nf["minValue"]
    s = ("Valid" + re.sub(r'[^A-Za-z0-9]', '', name).title()) or "ValidValue"
    if _is_num(mn) and len(s) < int(mn):
        s = s + "x" * (int(mn) - len(s))
    if _is_num(ml) and int(ml) > 0 and len(s) > int(ml):
        s = s[:int(ml)]
    return s


# ── value-classes for one field (each carries a validity verdict) ─────────────
# validity: True = schema-valid · False = definite rule violation · None = unknowable
def _value_classes(nf: Dict[str, Any], max_classes: int) -> List[Dict[str, Any]]:
    t   = nf["type"]
    ml  = nf["maxLength"]
    mn  = nf["minValue"]
    enum = nf["enum"]
    out: List[Dict[str, Any]] = [
        {"cls": "valid", "value": _valid_value(nf), "present": True, "validity": True},
    ]

    # a required field omitted entirely is a definite violation
    if nf["required"]:
        out.append({"cls": "missing", "value": None, "present": False, "validity": False})

    # type / domain violations (definite)
    if t == "number":
        out.append({"cls": "wrong_type", "value": "not_a_number", "present": True, "validity": False})
        if nf["nonneg"]:
            out.append({"cls": "negative", "value": -1, "present": True, "validity": False})
        if _is_num(mn):
            out.append({"cls": "below_min", "value": mn - 1, "present": True, "validity": False})
    elif t == "email":
        out.append({"cls": "bad_email", "value": "not-an-email", "present": True, "validity": False})
    elif t == "date":
        out.append({"cls": "bad_date", "value": "31/31/9999", "present": True, "validity": False})
    elif t == "enum" and enum:
        out.append({"cls": "out_of_enum", "value": "__not_in_enum__", "present": True, "validity": False})

    # length overflow (definite) for string-ish fields
    if _is_num(ml) and 0 < int(ml) <= 1024 and t in ("text", "email", "enum"):
        out.append({"cls": "oversized", "value": "A" * (int(ml) + 1), "present": True, "validity": False})

    # boundary at exactly maxLength — a valid edge (True) for plain text
    if _is_num(ml) and int(ml) > 0 and t == "text":
        out.append({"cls": "at_max", "value": "A" * int(ml), "present": True, "validity": True})

    # empty string in an OPTIONAL text/email field — genuinely unknowable (None)
    if t in ("text", "email") and not nf["required"]:
        out.append({"cls": "empty", "value": "", "present": True, "validity": None})

    # dedup by class label, then bound the per-field class count (keep "valid" first)
    seen, deduped = set(), []
    for c in out:
        if c["cls"] in seen:
            continue
        seen.add(c["cls"])
        deduped.append(c)
    return deduped[:max(1, max_classes)]


# ── deterministic covering-array generators ───────────────────────────────────
def _onewise_rows(params: List[List[int]], cap: int) -> List[List[int]]:
    """strength=1: every value-class of every field appears at least once.
    Row r assigns each field its class at index min(r, last); a field with fewer
    classes simply repeats its last — so all classes of all fields are covered in
    max(len) rows."""
    if not params:
        return []
    m = max(len(p) for p in params)
    rows = []
    for r in range(min(m, cap)):
        rows.append([p[min(r, len(p) - 1)] for p in params])
    return rows


def _pairwise_rows(params: List[List[int]], cap: int) -> List[List[int]]:
    """strength=2: a deterministic greedy covering array (AETG/IPOG-style seeded
    growth). Every (fieldI=classA, fieldJ=classB) pair appears in ≥1 row.

    Each iteration SEEDS a new row with the smallest still-uncovered pair (fixing
    those two fields), then greedily fills the remaining fields to cover as many
    other uncovered pairs as possible. Seeding guarantees every row retires at
    least the seed pair, so the loop strictly shrinks the uncovered set and
    terminates in at most |pairs| rows (the `cap` is only a safety ceiling)."""
    n = len(params)
    if n < 2:
        return _onewise_rows(params, cap)

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
        rows.append([int(x) for x in row])  # row is fully assigned here
    return rows


# ── endpoint field-set resolution ─────────────────────────────────────────────
def _fields_from_contracts(graph_data: Dict[str, Any]
                           ) -> List[Tuple[str, str, str, List[Dict[str, Any]], Dict[str, Any]]]:
    """(endpoint_str, method, source_label, [normalized fields], evidence) per contract."""
    out = []
    for c in graph_data.get("requestContracts", []) or []:
        method   = (c.get("method") or "").upper()
        endpoint = c.get("endpoint") or f"{method} {c.get('path', '')}".strip()
        named    = [f for f in (c.get("fields") or []) if f.get("name")]
        if not named:
            continue
        nfields = [_normalize_contract_field(f) for f in named]
        ev = {"file": c.get("file"), "line": c.get("line"), "controller": c.get("controller")}
        out.append((endpoint, method, "contract", nfields, ev))
    return out


def _fields_from_schema(graph_data: Dict[str, Any]
                        ) -> List[Tuple[str, str, str, List[Dict[str, Any]], Dict[str, Any]]]:
    """Fallback: write endpoints whose path names a table → that table's writable
    columns. Path-segment name match only (the strongest, self-contained signal);
    ambiguous endpoints are skipped rather than guessed."""
    endpoints = graph_data.get("apiEndpoints", []) or []
    tables    = graph_data.get("dbTables", []) or []
    if not endpoints or not tables:
        return []
    cols_by_norm, name_by_norm = {}, {}
    for t in tables:
        nm = t.get("name") or t.get("id")
        if nm:
            cols_by_norm[_norm(nm)] = t.get("columns") or []
            name_by_norm[_norm(nm)] = nm

    def _match(seg_norm: str) -> Optional[str]:
        for cand in (seg_norm, seg_norm.rstrip('s'), seg_norm + 's'):
            if cand in name_by_norm:
                return name_by_norm[cand]
        return None

    out = []
    for ep in endpoints:
        method = (ep.get("method") or "").upper()
        if method not in ("POST", "PUT", "PATCH"):
            continue
        path = ep.get("path") or ep.get("route") or ""
        table = None
        for seg in reversed([s for s in path.split('/') if s and '{' not in s]):
            table = _match(_norm(seg))
            if table:
                break
        if not table:
            continue
        cols = cols_by_norm.get(_norm(table)) or []
        writable = [c for c in cols
                    if c.get("name") and not c.get("isPrimaryKey")
                    and not _SKIP_NAME.search(str(c.get("name")))]
        if not writable:
            continue
        nfields = [_normalize_column(c) for c in writable]
        out.append((f"{method} {path}", method, "schema",
                    nfields, {"table": table}))
    return out


# ── public API ────────────────────────────────────────────────────────────────
def generate_combinatorial_tests(graph_data: Dict[str, Any],
                                 strength: int = 2,
                                 cap_per_endpoint: int = 64,
                                 max_cases: int = 2000,
                                 max_classes_per_field: int = 4
                                 ) -> List[Dict[str, Any]]:
    """Generate deterministic t-wise combinatorial tests for every write endpoint.

    Args:
        graph_data:  the analysis graph. Uses requestContracts when present (precise),
                     else falls back to apiEndpoints + dbTables (schema-derived).
        strength:    1 = each value-class once; 2 = pairwise (default).
        cap_per_endpoint: hard ceiling on generated rows per endpoint (bounds blow-up).
        max_cases:   global ceiling across all endpoints.
        max_classes_per_field: bound on distinct value-classes considered per field.

    Returns a list of test dicts in the engine's standard shape. Each case carries
    a `combination` (which field=class it combined) so failures are diagnosable, and
    an `expectation` of "accept" (2xx), "reject" (4xx), or "skip" (unknowable). Skip
    cases carry a non-executable SKIP assertion — they are never scored PASS.
    """
    sources = _fields_from_contracts(graph_data)
    if not sources:
        sources = _fields_from_schema(graph_data)
    if not sources:
        return []

    strength = 2 if strength >= 2 else 1
    tests: List[Dict[str, Any]] = []
    n = [0]

    for endpoint, method, src_label, nfields, ev in sources:
        # value-classes per field; drop fields that ended up with a single class
        # (they add no interaction and just inflate the array width).
        classed = [(nf, _value_classes(nf, max_classes_per_field)) for nf in nfields]
        classed = [(nf, cs) for nf, cs in classed if cs]
        if not classed:
            continue
        multi = [(nf, cs) for nf, cs in classed if len(cs) >= 2]
        # keep single-class fields in the body (as their one valid value) but only
        # run the covering array over the multi-class fields.
        active = multi if multi else classed
        fixed  = [(nf, cs) for nf, cs in classed if (nf, cs) not in active]

        params = [list(range(len(cs))) for _, cs in active]
        full_cross = 1
        for p in params:
            full_cross *= len(p)

        if strength == 2 and len(params) >= 2:
            rows = _pairwise_rows(params, cap_per_endpoint)
            subtype = "pairwise"
        else:
            rows = _onewise_rows(params, cap_per_endpoint)
            subtype = "1-wise"

        for row in rows:
            combo = []          # [{field, class, validity}]
            body = {}
            invalid, unknown = [], []
            # fixed single-class fields: always their valid value
            for nf, cs in fixed:
                c = cs[0]
                if c["present"]:
                    body[nf["name"]] = c["value"]
            # active fields per the covering-array row
            for (nf, cs), ci in zip(active, row):
                c = cs[ci]
                combo.append({"field": nf["name"], "class": c["cls"], "validity": c["validity"]})
                if c["present"]:
                    body[nf["name"]] = c["value"]
                if c["validity"] is False:
                    invalid.append(nf["name"])
                elif c["validity"] is None:
                    unknown.append(nf["name"])

            n[0] += 1
            cid = f"CMB-{n[0]:04d}"
            base = {
                "id":         cid,
                "category":   "Combinatorial coverage",
                "technique":  "COMBINATORIAL",
                "subtype":    subtype,
                "priority":   "medium",
                "confidence": 0.8,
                "status":     "CONFIRMED",
                "steps":      [],
                "testData":   body,
                "combination": combo,
                "sourceEvidence": [{"endpoint": endpoint, "source": src_label,
                                    "combination": combo, **ev}],
            }

            if invalid:
                # any invalid field ⇒ the request SHOULD be rejected (4xx).
                a = {"type": "API", "method": method, "endpoint": endpoint,
                     "expectedStatusClass": "4xx",
                     "faultField": invalid[0], "faultFields": invalid}
                base.update({
                    "title": f"[Combinatorial-{subtype}] {endpoint} — "
                             f"{len(invalid)} invalid field(s) must be rejected "
                             f"({', '.join(invalid)})",
                    "expectation": "reject",
                    "assertions": [a],
                })
            elif unknown:
                # no definite violation but an unknowable class ⇒ SKIP (never PASS).
                reason = (f"combination validity is undecidable: optional field(s) "
                          f"{', '.join(unknown)} set to an edge/empty class with no "
                          f"declared rule to decide accept vs reject")
                base.update({
                    "title": f"[Combinatorial-{subtype}] {endpoint} — undecidable "
                             f"combination (SKIP): {', '.join(unknown)}",
                    "expectation": "skip",
                    "skip": True,
                    "skipReason": reason,
                    # non-executable assertion: no type=="API" ⇒ nothing is scored,
                    # so the harness records SKIPPED, never a false PASS.
                    "assertions": [{"type": "SKIP", "endpoint": endpoint,
                                    "reason": reason}],
                })
            else:
                # all fields valid ⇒ a legal request must be accepted (2xx).
                base.update({
                    "title": f"[Combinatorial-{subtype}] {endpoint} — all-valid "
                             f"combination is accepted",
                    "expectation": "accept",
                    "assertions": [{"type": "API", "method": method,
                                    "endpoint": endpoint, "expectedStatusClass": "2xx"}],
                })

            tests.append(base)
            if n[0] >= max_cases:
                return tests

    return tests


# ── self-test (deterministic, no network, no deps) ────────────────────────────
if __name__ == "__main__":
    from math import prod

    # ---- unit: pairwise covering array over a synthetic parameter model --------
    params = [[0, 1, 2], [0, 1, 2, 3], [0, 1], [0, 1, 2]]
    rows = _pairwise_rows(params, cap=999)
    full = prod(len(p) for p in params)

    # completeness: every (fieldI=a, fieldJ=b) pair is present in some row
    need = set()
    for i in range(len(params)):
        for j in range(i + 1, len(params)):
            for a in params[i]:
                for b in params[j]:
                    need.add(((i, a), (j, b)))
    have = set()
    for r in rows:
        for i in range(len(params)):
            for j in range(i + 1, len(params)):
                have.add(((i, r[i]), (j, r[j])))
    missing = need - have
    assert not missing, f"pairwise array is INCOMPLETE, missing {len(missing)} pairs"
    assert len(rows) < full, f"pairwise ({len(rows)}) must be smaller than cross-product ({full})"
    # theoretical lower bound for 2-wise is max_i,j(|Vi|*|Vj|) = 4*3 = 12
    assert len(rows) >= 12, "cannot cover a 4x3 pair block in fewer than 12 rows"
    print(f"[unit] pairwise over {[len(p) for p in params]}: "
          f"{len(rows)} rows vs {full} cross-product "
          f"(reduction {100*(1-len(rows)/full):.0f}%)")

    # 1-wise covers every single value at least once, in fewer rows
    ow = _onewise_rows(params, cap=999)
    seen = {(f, v) for r in ow for f, v in enumerate(r)}
    for f, p in enumerate(params):
        for v in p:
            assert (f, v) in seen, f"1-wise missed field {f} value {v}"
    assert len(ow) <= len(rows)
    print(f"[unit] 1-wise: {len(ow)} rows (each value ≥1)")

    # ---- integration: full generator over a realistic contract -----------------
    graph = {"requestContracts": [{
        "endpoint": "POST /vendors", "method": "POST", "path": "/vendors",
        "controller": "VendorController", "file": "/abs/VendorController.php", "line": 12,
        "fields": [
            {"name": "name",     "type": "text",   "required": True,  "maxLength": 50},
            {"name": "email",    "type": "email",  "required": True,  "maxLength": 100},
            {"name": "quantity", "type": "number", "required": False},
            {"name": "status",   "type": "enum",   "required": False,
             "enum": ["active", "inactive"]},
        ],
    }]}

    tests = generate_combinatorial_tests(graph, strength=2,
                                         cap_per_endpoint=64, max_classes_per_field=4)
    assert tests, "generator produced no combinatorial tests"

    # reconstruct the field/class model the generator used, to prove full pairwise
    # coverage AT THE TEST LEVEL and verify the oracle labelling independently.
    nfields = [_normalize_contract_field(f) for f in graph["requestContracts"][0]["fields"]]
    classed = [(nf, _value_classes(nf, 4)) for nf in nfields]
    active  = [(nf, cs) for nf, cs in classed if len(cs) >= 2]
    idx_of  = {nf["name"]: k for k, (nf, _) in enumerate(active)}
    cls_idx = {nf["name"]: {c["cls"]: i for i, c in enumerate(cs)} for nf, cs in active}
    per_field = {nf["name"]: len(cs) for nf, cs in active}
    full_cross = prod(per_field.values())

    # every pair of (fieldA=classX, fieldB=classY) must appear in some emitted test
    want = set()
    names = list(idx_of)
    for ai in range(len(names)):
        for bi in range(ai + 1, len(names)):
            na, nb = names[ai], names[bi]
            for ca in range(per_field[na]):
                for cb in range(per_field[nb]):
                    want.add(((idx_of[na], ca), (idx_of[nb], cb)))
    got = set()
    for t in tests:
        row = {c["field"]: cls_idx[c["field"]][c["class"]] for c in t["combination"]}
        for ai in range(len(names)):
            for bi in range(ai + 1, len(names)):
                na, nb = names[ai], names[bi]
                got.add(((idx_of[na], row[na]), (idx_of[nb], row[nb])))
    assert not (want - got), f"emitted tests miss {len(want-got)} field-class pairs"
    assert len(tests) < full_cross, "pairwise must beat the full cross-product"

    # oracle labelling: recompute expectation from each combination's validity
    n_reject = n_accept = n_skip = 0
    allowed = {f["name"] for f in graph["requestContracts"][0]["fields"]}
    for t in tests:
        vals = [c["validity"] for c in t["combination"]]
        exp = "reject" if (False in vals) else ("skip" if (None in vals) else "accept")
        assert t["expectation"] == exp, \
            f"{t['id']} mislabelled: got {t['expectation']} expected {exp} ({t['combination']})"
        a = t["assertions"][0]
        if exp == "reject":
            n_reject += 1
            assert a["type"] == "API" and a["expectedStatusClass"] == "4xx"
            assert a["faultField"] in allowed and a["faultField"] in a["faultFields"]
        elif exp == "accept":
            n_accept += 1
            assert a["type"] == "API" and a["expectedStatusClass"] == "2xx"
        else:
            n_skip += 1
            # a SKIP must NOT carry a scoreable API/DB assertion (never a false PASS)
            assert a["type"] == "SKIP" and t.get("skip") is True and t.get("skipReason")
            assert not any(x.get("type") in ("API", "DB") for x in t["assertions"])
        # testData never leaks a key outside the endpoint's declared fields
        assert not (set(t["testData"]) - allowed), f"{t['id']} leaked non-contract keys"

    # bounded size sanity
    assert len(tests) <= 64, "per-endpoint cap must bound the case count"

    print(f"[integration] POST /vendors fields×classes {per_field} → full cross-product "
          f"{full_cross}, pairwise emitted {len(tests)} case(s) "
          f"(reduction {100*(1-len(tests)/full_cross):.0f}%)")
    print(f"[integration] oracle labels: {n_reject} reject(4xx) · "
          f"{n_accept} accept(2xx) · {n_skip} skip(unknowable)")

    # cap enforcement is real
    capped = generate_combinatorial_tests(graph, strength=2, cap_per_endpoint=5)
    assert len(capped) <= 5, "cap_per_endpoint not enforced"
    print(f"[integration] cap_per_endpoint=5 → {len(capped)} case(s) (bounded)")

    # schema-derived fallback path also works (no requestContracts present)
    sgraph = {
        "apiEndpoints": [{"id": "e1", "method": "POST", "path": "/vendors"}],
        "dbTables": [{"name": "vendors", "columns": [
            {"name": "vendor_id", "dataType": "INT", "isPrimaryKey": True, "isNullable": False},
            {"name": "name",   "dataType": "VARCHAR(50)",  "isPrimaryKey": False, "isNullable": False},
            {"name": "email",  "dataType": "VARCHAR(100)", "isPrimaryKey": False, "isNullable": False},
            {"name": "status", "dataType": "ENUM('active','inactive')", "isPrimaryKey": False, "isNullable": True},
        ]}],
    }
    stests = generate_combinatorial_tests(sgraph, strength=2)
    assert stests, "schema fallback produced no tests"
    assert all("vendors" in t["assertions"][0].get("endpoint", "") for t in stests)
    print(f"[integration] schema fallback (POST /vendors) → {len(stests)} case(s)")

    print("SELF-TEST PASS")
