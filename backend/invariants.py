"""
Business-Invariant Oracle  (beyond metamorphic)
================================================
Metamorphic relations check how two *operations* relate (POST then GET, apply
twice, etc.). This oracle checks a different, complementary thing: invariants the
*stored data itself* must always satisfy, regardless of how it got there — the
data-correctness rules a human tester carries in their head:

    • money / quantity columns are never negative
    • an email column actually holds an email address
    • an is_* / has_* boolean column only ever holds 0 or 1
    • an ENUM column only holds one of its declared values
    • updated_at is never earlier than created_at

Each rule is mined deterministically from the schema (column names, SQL data
types, ENUM definitions) and emitted as a real, executable DB assertion of the
form "COUNT of rows that VIOLATE the rule must be 0". Point the suite at a live
database and these catch genuine corruption; point it at the seeded fixture DB
and they confirm the generated data is itself self-consistent.

Pure standard library. Consumed by cli.py exactly like the metamorphic tests.
"""

import re
from typing import Any, Dict, List, Optional

try:
    from db_seeder import map_datatype
except ImportError:  # pragma: no cover - packaging fallback
    from backend.db_seeder import map_datatype  # type: ignore

# ── Column-name classifiers ───────────────────────────────────────────────────
# Money / quantity words that are, by business meaning, never negative. Kept
# deliberately conservative: "discount", "adjustment", "balance" are excluded
# because they legitimately go negative.
_MONEY_QTY_RE = re.compile(
    r'(?:^|_)(price|amount|total|subtotal|grand_total|qty|quantity|stock|'
    r'cost|weight|paid|unit_price|line_total|mrp|rate_per|selling_price)(?:_|$)',
    re.IGNORECASE)
_EMAIL_RE = re.compile(r'e[-_]?mail', re.IGNORECASE)
_BOOL_RE  = re.compile(
    r'^(is_|has_|can_|should_|allow_|enable_)\w+$'
    r'|^(active|enabled|disabled|deleted|verified|available|featured|published)$',
    re.IGNORECASE)
# Columns to never treat as a business value (ids / keys).
_ID_RE = re.compile(r'(^id$|_id$|_code$|_no$|_number$)', re.IGNORECASE)


def _safe(identifier: str) -> str:
    """Whitelist an identifier to word characters so it is safe to inline in SQL."""
    return re.sub(r'[^A-Za-z0-9_]', '', str(identifier or ''))


def _enum_values(data_type: Optional[str]) -> Optional[List[str]]:
    """Return the declared values of an ``ENUM('a','b',...)`` type, else None."""
    m = re.match(r"\s*ENUM\s*\((.*)\)\s*$", str(data_type or ''), re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))


def _sql_str(value: str) -> str:
    """Single-quote a string literal for SQL, doubling embedded quotes."""
    return "'" + str(value).replace("'", "''") + "'"


def _columns(table: Dict[str, Any]) -> List[Dict[str, Any]]:
    return table.get("columns") or []


def generate_invariant_tests(graph_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Mine data-correctness invariants from ``graph_data['dbTables']`` and return a
    list of executable test cases (each with a single ``checkType='invariant'``
    DB assertion). Every assertion's ``violationWhere`` selects rows that BREAK
    the rule; the runner passes the test when that count is zero.
    """
    tables = graph_data.get("dbTables") or graph_data.get("tables") or []
    tests: List[Dict[str, Any]] = []
    n = [0]

    def add(table: str, column: Optional[str], kind: str, rule: str, where: str):
        n[0] += 1
        tests.append({
            "id":         f"INV-{n[0]:03d}",
            "title":      f"[Invariant] {rule}",
            "category":   "Business Invariant / Data Correctness",
            "technique":  "INVARIANT",
            "priority":   "high",
            "confidence": 0.8,
            "status":     "CONFIRMED",
            "steps":      [],
            "assertions": [{
                "type":           "DB",
                "checkType":      "invariant",
                "table":          table,
                "column":         column,
                "violationWhere": where,
                "invariant":      rule,
            }],
            "sourceEvidence": [{"table": table, "column": column, "rule": kind}],
        })

    for table in tables:
        tname = table.get("name") or table.get("id")
        if not tname:
            continue
        cols = _columns(table)
        col_names = {str(c.get("name")).lower() for c in cols if c.get("name")}

        for col in cols:
            cname = col.get("name")
            if not cname:
                continue
            c = _safe(cname)
            if not c:
                continue
            affinity  = map_datatype(col.get("dataType"))
            enum_vals = _enum_values(col.get("dataType"))
            is_id     = bool(_ID_RE.search(cname)) or col.get("isPrimaryKey")

            # 1. ENUM domain — value must be one of the declared options.
            if enum_vals:
                vals_sql = ", ".join(_sql_str(v) for v in enum_vals)
                add(tname, cname, "enum_domain",
                    f"{tname}.{cname} ∈ {{{', '.join(enum_vals)}}}",
                    f'"{c}" IS NOT NULL AND "{c}" NOT IN ({vals_sql})')
                continue

            # 2. Boolean domain — an is_/has_ flag only holds 0 or 1.
            if affinity == "INTEGER" and _BOOL_RE.search(cname):
                add(tname, cname, "boolean_domain",
                    f"{tname}.{cname} is boolean (only 0 or 1)",
                    f'"{c}" IS NOT NULL AND "{c}" NOT IN (0, 1)')
                continue

            # 3. Email format — a *email* column holds an address.
            if _EMAIL_RE.search(cname):
                add(tname, cname, "email_format",
                    f"{tname}.{cname} is a valid email address",
                    f'"{c}" IS NOT NULL AND "{c}" <> \'\' '
                    f'AND "{c}" NOT LIKE \'%_@_%.__%\'')
                continue

            # 4. Non-negative money / quantity (skip ids & keys).
            if affinity in ("INTEGER", "REAL") and not is_id and _MONEY_QTY_RE.search(cname):
                add(tname, cname, "non_negative",
                    f"{tname}.{cname} is never negative",
                    f'"{c}" < 0')

        # 5. Temporal ordering — updated_at is never before created_at.
        if "created_at" in col_names and "updated_at" in col_names:
            add(tname, None, "temporal_order",
                f"{tname}.updated_at ≥ created_at",
                '"created_at" IS NOT NULL AND "updated_at" IS NOT NULL '
                'AND "updated_at" < "created_at"')

    return tests


if __name__ == "__main__":
    import sqlite3

    tables = [{
        "id": "orders", "name": "orders",
        "columns": [
            {"name": "id",          "dataType": "INT",           "isPrimaryKey": True},
            {"name": "total",       "dataType": "DECIMAL(10,2)"},
            {"name": "qty",         "dataType": "INT"},
            {"name": "email",       "dataType": "VARCHAR(255)"},
            {"name": "is_paid",     "dataType": "TINYINT"},
            {"name": "status",      "dataType": "ENUM('pending','shipped','cancelled')"},
            {"name": "created_at",  "dataType": "DATETIME"},
            {"name": "updated_at",  "dataType": "DATETIME"},
        ],
    }]
    tests = generate_invariant_tests({"dbTables": tables})
    kinds = {t["sourceEvidence"][0]["rule"] for t in tests}
    for t in tests:
        print(f"  {t['sourceEvidence'][0]['rule']:15s} {t['title']}")
    for expect in ("non_negative", "email_format", "boolean_domain", "enum_domain", "temporal_order"):
        assert expect in kinds, f"missing invariant kind: {expect}"
    # id / primary key must NOT get a non_negative rule
    assert not any(t["assertions"][0]["column"] == "id" for t in tests), "id should be skipped"

    # Execute the generated WHERE clauses against a real SQLite DB — both a clean
    # row (0 violations → PASS) and a corrupt row (violations → FAIL).
    conn = sqlite3.connect(":memory:")
    conn.execute('CREATE TABLE orders (id INT, total REAL, qty INT, email TEXT, '
                 'is_paid INT, status TEXT, created_at TEXT, updated_at TEXT)')
    conn.execute("INSERT INTO orders VALUES (1, 100.0, 2, 'a@b.com', 1, 'pending', "
                 "'2026-01-01', '2026-01-02')")  # perfectly valid row
    for t in tests:
        a = t["assertions"][0]
        q = f'SELECT COUNT(*) FROM "orders" WHERE {a["violationWhere"]}'
        v = conn.execute(q).fetchone()[0]
        assert v == 0, f"clean row wrongly flagged by {a['invariant']}: {v}"
    print("[self-test] clean row: 0 violations on every invariant ✓")

    # Now corrupt every rule at once and confirm each fires.
    conn.execute("INSERT INTO orders VALUES (2, -5.0, -1, 'not-an-email', 7, "
                 "'BOGUS', '2026-02-02', '2026-01-01')")
    fired = 0
    for t in tests:
        a = t["assertions"][0]
        q = f'SELECT COUNT(*) FROM "orders" WHERE {a["violationWhere"]}'
        if conn.execute(q).fetchone()[0] > 0:
            fired += 1
    assert fired == len(tests), f"only {fired}/{len(tests)} invariants caught the corrupt row"
    print(f"[self-test] corrupt row: all {fired} invariants fired ✓")
    conn.close()
    print("SELF-TEST PASS")
