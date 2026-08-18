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
    • injection robustness      SQLi / XSS payload            → must NOT 5xx
    • (endpoint smoke)          all-valid baseline            → must NOT 5xx

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

            # injection robustness — must not 500 (text-ish fields only)
            if not _is_numeric(dt) and not _is_date(dt):
                b = dict(baseline); b[cn] = _SQLI
                add(ep_str, method, table, cn, "injection", b, NO5, "SQLi payload does not crash server")

            if n[0] >= max_cases:
                return tests

        # endpoint smoke: an all-valid baseline should never 5xx
        add(ep_str, method, table, "*", "smoke", dict(baseline), NO5, "valid baseline does not crash server")
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
    for k in ("required", "type", "format", "enum", "length", "injection", "negative", "smoke"):
        assert k in by_case, f"missing black-box method: {k}"
    # every negative expects a 4xx; injection/smoke expect !5xx
    for t in tests:
        exp = t["assertions"][0].get("expectedStatusClass")
        if t["subtype"] in ("injection", "smoke"):
            assert exp == "!5xx"
        else:
            assert exp == "4xx", f"{t['subtype']} should expect 4xx"
    print("SELF-TEST PASS")
