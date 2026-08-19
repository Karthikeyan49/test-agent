"""
Per-Field Black-Box Test Generator  (depth, schema-driven)
==========================================================
The endpoint-level matrix asks "does this endpoint work?"; this asks the deeper
question a human tester asks of EVERY input: "does this field reject bad data?"

For each writable field it derives the field's domain from the schema the tool
already parsed — SQL column type, length, NOT NULL, ENUM values, FK, and the
field name — and emits the classic black-box battery, one fault at a time
(single-fault isolation: a valid baseline body with exactly ONE field made bad):

    • required / missing        NOT NULL field omitted        → expect 4xx
    • type mismatch             text into a numeric field     → expect 4xx
    • format                    bad email / date              → expect 4xx
    • length / overflow         VARCHAR(n) + 1 chars          → expect 4xx
    • enum domain               value outside ENUM(...)       → expect 4xx
    • boundary / negative       -1 into a qty/price field     → expect 4xx
    • fuzz robustness           SQLi-shaped payload           → must NOT 5xx
    • (endpoint smoke)          all-valid baseline            → must NOT 5xx

WARNING — the "fuzz_robustness" case is NOT a vulnerability check. It only asserts
the server did not 5xx on a hostile-looking string; a successful SQL injection that
returns 200 would PASS. It therefore proves robustness (no crash), never security
(not injectable). Do not report a PASS here as "injection-safe". A real injection
oracle (differential row-count on `' OR '1'='1` vs `' AND '1'='2`, or error-signature
detection) is tracked as future work.

The negatives are robust: they don't need a passing happy-path baseline — if the
API validates the field a bad value yields 4xx (PASS); if it doesn't, the bad
value slips through as 2xx (FAIL = a real missing-validation / security defect).

Endpoint→table lineage is taken from the graph's WRITES_TO edges (no HAR needed);
column metadata from ``dbTables``. Pure standard library. Consumed by cli.py.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

# ── SQL dataType classification ───────────────────────────────────────────────
_NUMERIC_RE = re.compile(r'\b(INT|INTEGER|BIGINT|TINYINT|SMALLINT|MEDIUMINT|'
                         r'DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)\b', re.IGNORECASE)
_DATE_RE    = re.compile(r'\b(DATE|DATETIME|TIMESTAMP|TIME)\b', re.IGNORECASE)
_LEN_RE     = re.compile(r'\b(?:VAR)?CHAR\s*\(\s*(\d+)\s*\)', re.IGNORECASE)
_ENUM_RE    = re.compile(r"\bENUM\s*\((.*)\)", re.IGNORECASE | re.DOTALL)
_EMAIL_NAME = re.compile(r'e[-_]?mail', re.IGNORECASE)
_URL_NAME   = re.compile(r'\b(url|website|link)\b', re.IGNORECASE)
_NONNEG_NAME = re.compile(
    r'(?:^|_)(price|amount|total|subtotal|qty|quantity|stock|cost|weight|paid|'
    r'age|count|limit|discount|rate|percent|balance)(?:_|$)', re.IGNORECASE)
# Skip structural columns: exact id/timestamps, and any *_id (PK/FK) — those are
# auto-increment or foreign keys (often with DEFAULT/AUTO_INCREMENT the SQL parser
# doesn't capture), so a "required"/"type" probe on them yields false positives.
# Per-field black-box targets user-facing INPUT fields; FK/PK are covered by the
# FK-integrity and cross-layer oracles instead.
_SKIP_NAME  = re.compile(r'^(id|created_at|updated_at|deleted_at)$|_id$', re.IGNORECASE)

_SQLI = "' OR '1'='1"
_XSS  = "<script>alert(1)</script>"


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _enum_values(dt: str) -> Optional[List[str]]:
    m = _ENUM_RE.search(dt or '')
    if not m:
        return None
    return re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))


def _maxlen(dt: str) -> Optional[int]:
    m = _LEN_RE.search(dt or '')
    return int(m.group(1)) if m else None


def _is_numeric(dt: str) -> bool:
    return bool(_NUMERIC_RE.search(dt or '')) and not _ENUM_RE.search(dt or '')


def _is_date(dt: str) -> bool:
    return bool(_DATE_RE.search(dt or ''))


def _valid_value(col: Dict[str, Any]) -> Any:
    """A schema-valid value for a column (used to build the baseline body)."""
    name = str(col.get("name") or "")
    dt   = str(col.get("dataType") or "")
    ev   = _enum_values(dt)
    if ev:
        return ev[0]
    if _EMAIL_NAME.search(name):
        return "valid@test.com"
    if _URL_NAME.search(name):
        return "https://test.com"
    if _is_date(dt):
        return "2026-01-01"
    if _is_numeric(dt):
        return 5
    ml = _maxlen(dt)
    base = "Test" + re.sub(r'[^A-Za-z]', '', name)[:6]
    return base[:ml] if ml else base


# ── endpoint → primary write-table resolution (HAR-free) ──────────────────────
def _adjacency(edges: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[str]]:
    out: Dict[Tuple[str, str], List[str]] = {}
    for e in edges or []:
        out.setdefault((e.get("source"), e.get("relationship")), []).append(e.get("target"))
    return out


def _write_tables(ep_id: str, out: Dict[Tuple[str, str], List[str]]) -> List[str]:
    seen, frontier, tables = set(), list(out.get((ep_id, "IMPLEMENTED_BY"), [])), []
    while frontier:
        cur = frontier.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for t in out.get((cur, "WRITES_TO"), []):
            if t not in tables:
                tables.append(t)
        frontier.extend(out.get((cur, "CALLS"), []))
    return tables


def generate_field_blackbox_tests(graph_data: Dict[str, Any],
                                  max_cases: int = 4000) -> List[Dict[str, Any]]:
    endpoints = graph_data.get("apiEndpoints", []) or []
    tables    = graph_data.get("dbTables", []) or []
    nodes     = graph_data.get("nodes", []) or []
    edges     = graph_data.get("edges", []) or []
    if not endpoints or not tables:
        return []

    out = _adjacency(edges)
    tname_by_id = {n["id"]: n["name"] for n in nodes if n.get("type") == "Table"}
    cols_by_name: Dict[str, List[Dict[str, Any]]] = {}
    name_by_norm: Dict[str, str] = {}
    for t in tables:
        nm = t.get("name") or t.get("id")
        if nm:
            cols_by_name[_norm(nm)] = t.get("columns") or []
            name_by_norm[_norm(nm)] = nm

    def _match_name(seg_norm: str) -> Optional[str]:
        for cand in (seg_norm, seg_norm.rstrip('s'), seg_norm + 's'):
            if cand in name_by_norm:
                return name_by_norm[cand]
        return None

    def _primary_table(ep: Dict[str, Any]) -> Optional[str]:
        """Resolve the endpoint's target table CONSERVATIVELY. Path-name match is
        the strongest signal and wins; the WRITES_TO walk is only trusted when it
        is unambiguous (single table) or confirmed by the path. Anything ambiguous
        (e.g. /auth/register, whose controller writes many tables) is SKIPPED — a
        wrong table would test the wrong fields, so no test beats a misleading one."""
        path = ep.get("path", "")
        pnorm = _norm(path)
        # 1. direct name match on a real (non-param) path segment, last segment first
        segs = [s for s in path.split('/') if s and '{' not in s]
        for seg in reversed(segs):
            hit = _match_name(_norm(seg))
            if hit:
                return hit
        # 2. WRITES_TO walk — accept only when it's safe to
        wt = [tname_by_id[t] for t in _write_tables(ep.get("id", ""), out) if t in tname_by_id]
        in_path = [w for w in wt if _norm(w) in pnorm]
        if in_path:
            return in_path[0]
        if len(wt) == 1:
            return wt[0]
        return None  # ambiguous / unknown → skip rather than guess the wrong table

    tests: List[Dict[str, Any]] = []
    n = [0]

    def add(ep_str, method, table, col, case, body, status_expect, note):
        n[0] += 1
        a = {"type": "API", "method": method, "endpoint": ep_str}
        a.update(status_expect)   # expectedStatusClass or expectedStatusIn
        tests.append({
            "id":         f"FBB-{n[0]:04d}",
            "title":      f"[Field-{case}] {method} {table}.{col} — {note}",
            "category":   "Per-field black-box",
            "technique":  "BLACK_BOX_FIELD",
            "subtype":    case,
            "priority":   "medium",
            "confidence": 0.7,
            "status":     "CONFIRMED",
            "steps":      [],
            "testData":   body,
            "assertions": [a],
            "sourceEvidence": [{"field": f"{table}.{col}", "case": case}],
        })

    for ep in endpoints:
        method = (ep.get("method") or "").upper()
        if method not in ("POST", "PUT", "PATCH"):
            continue
        table = _primary_table(ep)
        if not table:
            continue
        cols = cols_by_name.get(_norm(table)) or []
        writable = [c for c in cols
                    if c.get("name") and not c.get("isPrimaryKey")
                    and not _SKIP_NAME.search(str(c.get("name")))]
        if not writable:
            continue

        path   = ep.get("path", "")
        ep_str = f"{method} {path}"
        C4  = {"expectedStatusClass": "4xx"}
        NO5 = {"expectedStatusClass": "!5xx"}

        # A schema-valid baseline body (all writable fields valid).
        baseline = {c["name"]: _valid_value(c) for c in writable}

        # One-field-at-a-time faults.
        for col in writable:
            cn   = col["name"]
            dt   = str(col.get("dataType") or "")
            nn   = not col.get("isNullable", True)
            ev   = _enum_values(dt)
            ml   = _maxlen(dt)

            # required / missing — only when the column truly must be supplied:
            # NOT NULL, and NOT auto-increment / NOT server-defaulted (those are
            # filled by the DB, so omitting them is legal — avoids false positives).
            if nn and not col.get("hasDefault") and not col.get("isAutoIncrement"):
                b = dict(baseline); b.pop(cn, None)
                add(ep_str, method, table, cn, "required", b, C4, "missing NOT NULL field is rejected")

            # type mismatch (numeric field ← text)
            if _is_numeric(dt):
                b = dict(baseline); b[cn] = "not_a_number"
                add(ep_str, method, table, cn, "type", b, C4, "non-numeric rejected")
                if _NONNEG_NAME.search(cn):
                    b = dict(baseline); b[cn] = -1
                    add(ep_str, method, table, cn, "negative", b, C4, "negative value rejected")

            # email / date format
            if _EMAIL_NAME.search(cn):
                b = dict(baseline); b[cn] = "not-an-email"
                add(ep_str, method, table, cn, "format", b, C4, "malformed email rejected")
            if _is_date(dt):
                b = dict(baseline); b[cn] = "31/31/9999"
                add(ep_str, method, table, cn, "format", b, C4, "invalid date rejected")

            # enum domain
            if ev:
                b = dict(baseline); b[cn] = "__not_in_enum__"
                add(ep_str, method, table, cn, "enum", b, C4, "value outside ENUM rejected")

            # length / overflow (cap the payload; skip absurd/huge declared lengths)
            if ml and ml <= 1024:
                b = dict(baseline); b[cn] = "A" * (ml + 1)
                add(ep_str, method, table, cn, "length", b, C4, f"over-length (>{ml}) rejected")

            # fuzz robustness — must not 500 (text-ish fields only).
            # NOTE: this only checks the server does not crash on a hostile-looking
            # string; it does NOT verify the app is injection-safe (a successful SQLi
            # returning 200 would still PASS). Labelled "fuzz_robustness", not
            # "injection/security", so a PASS is never mistaken for "not injectable".
            if not _is_numeric(dt) and not _is_date(dt):
                b = dict(baseline); b[cn] = _SQLI
                add(ep_str, method, table, cn, "fuzz_robustness", b, NO5,
                    "robustness only: server did not 5xx on a SQLi-shaped payload "
                    "(does NOT prove the endpoint is injection-safe)")

            if n[0] >= max_cases:
                return tests

        # endpoint smoke: an all-valid baseline should never 5xx
        add(ep_str, method, table, "*", "smoke", dict(baseline), NO5, "valid baseline does not crash server")
        if n[0] >= max_cases:
            return tests

    return tests


# ── Contract-rule-driven black-box NEGATIVE generation ────────────────────────
# generate_field_blackbox_tests derives a field's domain from the SQL *schema*.
# This sibling derives it from the CONTROLLER's own declared *validation rules*
# — the request contracts that backend/endpoint_contracts.py (Phase 1.5) parsed
# onto the graph under "requestContracts". Those rules are the endpoint's own
# statement of what it accepts, so a value that violates a rule SHOULD be rejected.
#
# For each contract it builds one all-valid baseline body and, per field, emits a
# single-fault negative for every rule that field carries (single-fault isolation:
# exactly one field is made bad, every other required field stays valid — so a 2xx
# means precisely that one rule is unenforced, i.e. a real missing-validation bug):
#
#     • required  omit a required field                       → expect 4xx
#     • type      non-numeric text into a number field        → expect 4xx
#     • format    non-email string into an email field        → expect 4xx
#     • length    maxLength=N given N+1 chars                  → expect 4xx
#     • range     numeric minValue=N given N-1                 → expect 4xx
#     • enum      value outside a declared enum set            → expect 4xx
#
# Plus ONE positive happy-path per contract (all-valid body) that must NOT be
# 4xx-rejected — expressed with this file's own "!<class>" convention as "!4xx".
# testData keys are always a subset of the contract's declared field names (they
# are built only from those fields), so no table columns ever leak in.

_CONTRACT_BAD_EMAIL  = "not-an-email"
_CONTRACT_BAD_ENUM   = "__not_a_valid_enum__"
_CONTRACT_BAD_NUMBER = "NaN_text"


def _is_real_number(v: Any) -> bool:
    """int/float but not bool (bool is an int subclass in Python)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _contract_valid_value(field: Dict[str, Any]) -> Any:
    """A contract-valid value for a field, from its declared type/constraints.
    Used to build the all-valid baseline body onto which one fault is then applied."""
    ftype = str(field.get("type") or "text").lower()
    name  = str(field.get("name") or "")
    if ftype == "email":
        return "valid@test.com"
    if ftype == "number":
        mv = field.get("minValue")
        return mv if _is_real_number(mv) else 5          # minValue itself satisfies min:N
    if ftype == "bool":
        return True
    if ftype == "date":
        return "2026-01-01"
    if ftype == "enum":
        enum = field.get("enum") or []
        return enum[0] if enum else "valid"              # first declared member when known
    # text (default): a string within maxLength and at/above any min-length (minValue)
    ml = field.get("maxLength")
    mn = field.get("minValue")
    s = ("Valid" + re.sub(r'[^A-Za-z0-9]', '', name).title()) or "ValidValue"
    if _is_real_number(mn) and len(s) < int(mn):
        s = s + "x" * (int(mn) - len(s))                 # pad up to the declared min length
    if _is_real_number(ml) and int(ml) > 0 and len(s) > int(ml):
        s = s[:int(ml)]                                  # clamp down to the declared max length
    return s


def generate_contract_negative_tests(graph_data: Dict[str, Any],
                                     max_cases: int = 4000) -> List[Dict[str, Any]]:
    """Emit contract-rule-driven single-fault NEGATIVE tests (+ one positive per
    contract) from graph_data["requestContracts"]. Additive sibling of
    generate_field_blackbox_tests; ids are prefixed FBC-#### to distinguish them."""
    contracts = graph_data.get("requestContracts", []) or []
    if not contracts:
        return []

    tests: List[Dict[str, Any]] = []
    n = [0]

    def add(endpoint, method, fname, case, body, status_expect, note, file, line, conf):
        n[0] += 1
        a = {"type": "API", "method": method, "endpoint": endpoint}
        a.update(status_expect)   # expectedStatusClass: "4xx" (negative) / "!4xx" (positive)
        tests.append({
            "id":         f"FBC-{n[0]:04d}",
            "title":      f"[Contract-{case}] {endpoint} · {fname} — {note}",
            "category":   "Per-field black-box",
            "technique":  "BLACK_BOX_CONTRACT",
            "subtype":    case,
            "priority":   "medium",
            "confidence": conf,
            "status":     "CONFIRMED",
            "steps":      [],
            "testData":   body,
            "assertions": [a],
            "sourceEvidence": [{"endpoint": endpoint, "field": fname, "case": case,
                                "file": file, "line": line}],
        })

    C4  = {"expectedStatusClass": "4xx"}    # negative: bad value must be rejected
    NO4 = {"expectedStatusClass": "!4xx"}   # positive: valid body must not be 4xx-rejected

    for c in contracts:
        method   = (c.get("method") or "").upper()
        endpoint = c.get("endpoint") or f"{method} {c.get('path', '')}".strip()
        file     = c.get("file")
        line     = c.get("line")
        conf     = c.get("confidence", 0.9)
        fields   = c.get("fields", []) or []
        named    = [f for f in fields if f.get("name")]
        if not named:
            continue

        # All-valid baseline body: every declared field at a contract-valid value.
        baseline = {f["name"]: _contract_valid_value(f) for f in named}

        for f in named:
            fname = f["name"]
            ftype = str(f.get("type") or "text").lower()
            ml    = f.get("maxLength")
            mn    = f.get("minValue")
            enum  = f.get("enum") or []

            # required → omit the field entirely
            if f.get("required"):
                b = dict(baseline); b.pop(fname, None)
                add(endpoint, method, fname, "required", b, C4,
                    "omitting required field is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

            # type → numeric field given non-numeric text
            if ftype == "number":
                b = dict(baseline); b[fname] = _CONTRACT_BAD_NUMBER
                add(endpoint, method, fname, "type", b, C4,
                    "non-numeric value in numeric field is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

            # format → email field given a non-email string
            if ftype == "email":
                b = dict(baseline); b[fname] = _CONTRACT_BAD_EMAIL
                add(endpoint, method, fname, "format", b, C4,
                    "malformed email is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

            # length → maxLength=N given N+1 chars
            if _is_real_number(ml) and int(ml) > 0:
                b = dict(baseline); b[fname] = "A" * (int(ml) + 1)
                add(endpoint, method, fname, "length", b, C4,
                    f"over-length (>{int(ml)}) value is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

            # range → numeric minValue=N given N-1
            if ftype == "number" and _is_real_number(mn):
                b = dict(baseline); b[fname] = mn - 1
                add(endpoint, method, fname, "range", b, C4,
                    f"below-minimum (<{mn}) value is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

            # enum → value outside the declared set (only when the set is known)
            if ftype == "enum" and enum:
                b = dict(baseline); b[fname] = _CONTRACT_BAD_ENUM
                add(endpoint, method, fname, "enum", b, C4,
                    "value outside declared enum is rejected", file, line, conf)
                if n[0] >= max_cases:
                    return tests

        # one positive happy-path per contract: an all-valid body must not be 4xx
        add(endpoint, method, "*", "positive", dict(baseline), NO4,
            "valid happy-path body is accepted (not 4xx)", file, line, conf)
        if n[0] >= max_cases:
            return tests

    return tests


if __name__ == "__main__":
    graph = {
        "apiEndpoints": [{"id": "api_ep_POST__vendors", "method": "POST", "path": "/vendors",
                          "controllerName": "VendorController"}],
        "nodes": [{"id": "tbl_vendors", "type": "Table", "name": "vendors"}],
        "edges": [
            {"source": "api_ep_POST__vendors", "target": "symbol_VendorController", "relationship": "IMPLEMENTED_BY"},
            {"source": "symbol_VendorController", "target": "symbol_Vendor", "relationship": "CALLS"},
            {"source": "symbol_Vendor", "target": "tbl_vendors", "relationship": "WRITES_TO"},
        ],
        "dbTables": [{"name": "vendors", "columns": [
            {"name": "vendor_id",  "dataType": "INT",           "isPrimaryKey": True,  "isNullable": False},
            {"name": "name",       "dataType": "VARCHAR(50)",   "isPrimaryKey": False, "isNullable": False},
            {"name": "email",      "dataType": "VARCHAR(100)",  "isPrimaryKey": False, "isNullable": False},
            {"name": "quantity",   "dataType": "INT",           "isPrimaryKey": False, "isNullable": True},
            {"name": "status",     "dataType": "ENUM('active','inactive')", "isPrimaryKey": False, "isNullable": True},
            {"name": "created_at", "dataType": "TIMESTAMP",     "isPrimaryKey": False, "isNullable": True},
        ]}],
    }
    tests = generate_field_blackbox_tests(graph)
    by_case = {}
    for t in tests:
        by_case[t["subtype"]] = by_case.get(t["subtype"], 0) + 1
    for t in tests:
        a = t["assertions"][0]
        exp = a.get("expectedStatusClass") or a.get("expectedStatusIn")
        print(f"  {t['subtype']:10s} {t['title'][:60]:60s} expect={exp}  body_keys={sorted(t['testData'].keys())}")
    print(f"\ncases by type: {by_case}")

    # endpoint→table lineage resolved from WRITES_TO (no HAR)
    assert all("vendors" in t["title"] for t in tests), "should target vendors table"
    # required only on NOT NULL, never on the PK or created_at
    reqs = {t["sourceEvidence"][0]["field"] for t in tests if t["subtype"] == "required"}
    assert "vendors.name" in reqs and "vendors.email" in reqs
    assert "vendors.vendor_id" not in reqs and "vendors.created_at" not in reqs
    # method coverage
    for k in ("required", "type", "format", "enum", "length", "fuzz_robustness", "negative", "smoke"):
        assert k in by_case, f"missing black-box method: {k}"
    # every negative expects a 4xx; fuzz_robustness/smoke expect !5xx
    for t in tests:
        exp = t["assertions"][0].get("expectedStatusClass")
        if t["subtype"] in ("fuzz_robustness", "smoke"):
            assert exp == "!5xx"
        else:
            assert exp == "4xx", f"{t['subtype']} should expect 4xx"

    # ── contract-rule-driven negative generation (generate_contract_negative_tests) ──
    import json, os
    _GRAPH_PATH = "/home/user/test-agent/graph.json"
    if os.path.exists(_GRAPH_PATH):
        with open(_GRAPH_PATH) as _fh:
            cgraph = json.load(_fh)
    else:  # self-contained fallback so the self-test runs without the graph file
        cgraph = {"requestContracts": [{
            "endpoint": "POST /queries", "method": "POST", "path": "/queries",
            "controller": "QueryController", "action": "store",
            "file": "/abs/QueryController.php", "line": 10, "confidence": 0.95,
            "fields": [
                {"name": "name",    "type": "text",  "required": True,
                 "rules": ["required", "string", "max:100"], "maxLength": 100},
                {"name": "email",   "type": "email", "required": True,
                 "rules": ["required", "email", "max:100"], "maxLength": 100},
                {"name": "message", "type": "text",  "required": True,
                 "rules": ["required", "string"]},
            ],
        }]}

    cneg = generate_contract_negative_tests(cgraph)
    assert cneg, "contract negative generation produced no tests"

    fields_by_ep = {c["endpoint"]: {f["name"] for f in c.get("fields", []) if f.get("name")}
                    for c in cgraph.get("requestContracts", [])}

    q = [t for t in cneg if t["assertions"][0]["endpoint"] == "POST /queries"]
    assert q, "no POST /queries contract tests generated"

    # a required case that omits `name`
    q_req_name = [t for t in q if t["subtype"] == "required"
                  and t["sourceEvidence"][0]["field"] == "name"]
    assert q_req_name, "missing POST /queries required-name negative"
    assert "name" not in q_req_name[0]["testData"], "required case must omit the field"

    # a format case with an invalid email
    q_fmt = [t for t in q if t["subtype"] == "format"
             and t["sourceEvidence"][0]["field"] == "email"]
    assert q_fmt, "missing POST /queries email format negative"
    assert q_fmt[0]["testData"]["email"] == "not-an-email", "format case must send a non-email"

    # a length case where `name` exceeds its 100-char max
    q_len = [t for t in q if t["subtype"] == "length"
             and t["sourceEvidence"][0]["field"] == "name"]
    assert q_len, "missing POST /queries name length negative"
    assert len(q_len[0]["testData"]["name"]) == 101, "length case must exceed maxLength(100) by one"

    # every negative asserts 4xx; every positive asserts non-4xx (this file's "!4xx")
    for t in cneg:
        exp = t["assertions"][0].get("expectedStatusClass")
        if t["subtype"] == "positive":
            assert exp == "!4xx", "positive happy-path must assert non-4xx"
        else:
            assert exp == "4xx", f"contract negative {t['subtype']} must assert 4xx"

    # testData keys never leak beyond the contract's own declared field names
    for t in cneg:
        allowed = fields_by_ep.get(t["assertions"][0]["endpoint"], set())
        leaked = set(t["testData"].keys()) - allowed
        assert not leaked, f"{t['id']} leaked non-contract keys: {leaked}"

    _cn = [t for t in cneg if t["subtype"] != "positive"]
    _cp = [t for t in cneg if t["subtype"] == "positive"]
    print(f"contract tests: {len(_cn)} negative + {len(_cp)} positive "
          f"from {len(cgraph.get('requestContracts', []))} contracts")

    print("SELF-TEST PASS")
