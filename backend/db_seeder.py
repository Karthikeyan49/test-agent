"""
Self-Contained SQLite Test-DB Seeder
Stands up an offline SQLite database from a parsed System Graph so the
cross-layer oracle and DB assertions can execute without production MySQL
credentials.

The tool's DBRunner connects with `sqlite3.connect(path)` and issues
`SELECT ... FROM <table>` queries (see backend/db_runner.py), so the database
produced here is directly consumable: point DBRunner's `path` at the same
db file (or reuse the returned connection for an in-memory db).

Pure standard library — only the built-in `sqlite3` is required.
"""

import json
import sqlite3
from typing import Any, Dict, List, Optional

# ── MySQL-ish dataType → SQLite affinity mapping ───────────────────────────────
# Order matters: integer keywords are checked before real/text keywords so that
# e.g. TINYINT/BIGINT resolve to INTEGER, DATETIME/TIMESTAMP resolve to TEXT.
_INTEGER_KEYWORDS = ("INT", "INTEGER", "BIGINT", "TINYINT", "SMALLINT", "MEDIUMINT")
_REAL_KEYWORDS    = ("DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL")
_TEXT_KEYWORDS    = ("CHAR", "TEXT", "ENUM", "SET", "DATE", "TIME",
                     "TIMESTAMP", "JSON", "BLOB", "BINARY", "UUID")


def map_datatype(data_type: Optional[str]) -> str:
    """
    Map a MySQL-ish column dataType string to a SQLite storage affinity.

    Rules (default is TEXT for anything unrecognised):
      * INT/INTEGER/BIGINT/TINYINT/SMALLINT/MEDIUMINT  -> INTEGER
      * DECIMAL/NUMERIC/FLOAT/DOUBLE/REAL              -> REAL
      * anything with CHAR/TEXT/ENUM/DATE/TIME/JSON/BLOB -> TEXT

    Robust to truncated / malformed types like "DECIMAL(12" or "ENUM(" that can
    appear when a comma inside the type definition was split upstream.
    """
    if not data_type:
        return "TEXT"

    upper = str(data_type).upper()

    if any(kw in upper for kw in _INTEGER_KEYWORDS):
        return "INTEGER"
    if any(kw in upper for kw in _REAL_KEYWORDS):
        return "REAL"
    if any(kw in upper for kw in _TEXT_KEYWORDS):
        return "TEXT"
    return "TEXT"


def _quote_ident(identifier: str) -> str:
    """Quote a SQL identifier with double-quotes, escaping any embedded quotes."""
    return '"' + str(identifier).replace('"', '""') + '"'


def create_sqlite_schema(tables: List[Dict[str, Any]],
                         db_path: str = ":memory:") -> sqlite3.Connection:
    """
    Create a SQLite schema from a list of System-Graph table dicts.

    Each table dict is expected to look like::

        {"id": "table_x", "name": "x", "columnCount": int,
         "columns": [{"name": str, "dataType": str,
                      "isPrimaryKey": bool, "isNullable": bool, ...}, ...]}

    For every table a ``CREATE TABLE IF NOT EXISTS`` statement is executed.
    Identifiers are double-quoted; MySQL-ish dataTypes are mapped to SQLite
    affinities via :func:`map_datatype`; PRIMARY KEY columns are marked (a
    table-level constraint is emitted when several columns are flagged).

    Tables with zero usable columns are skipped. Foreign-key enforcement is
    left OFF so that seeding is order-independent.

    Returns the open :class:`sqlite3.Connection` (caller owns closing it).
    """
    conn = sqlite3.connect(db_path)
    # Keep FK enforcement OFF: seeding must be order-independent + robust.
    conn.execute("PRAGMA foreign_keys = OFF")

    for table in tables or []:
        table_name = table.get("name") or table.get("id")
        if not table_name:
            continue

        columns = table.get("columns") or []

        col_defs: List[str] = []
        pk_columns: List[str] = []
        seen: set = set()

        for col in columns:
            col_name = col.get("name")
            if not col_name:
                continue
            # SQLite rejects duplicate column names — keep the first occurrence.
            key = str(col_name).lower()
            if key in seen:
                continue
            seen.add(key)

            affinity = map_datatype(col.get("dataType"))
            col_defs.append(f"{_quote_ident(col_name)} {affinity}")

            if col.get("isPrimaryKey"):
                pk_columns.append(col_name)

        # Skip tables with no usable columns (empty / malformed column lists).
        if not col_defs:
            continue

        # Single PK -> inline is possible, but a uniform table-level PRIMARY KEY
        # constraint handles single and composite keys identically and safely.
        if pk_columns:
            pk_list = ", ".join(_quote_ident(c) for c in pk_columns)
            col_defs.append(f"PRIMARY KEY ({pk_list})")

        ddl = (
            f"CREATE TABLE IF NOT EXISTS {_quote_ident(table_name)} "
            f"({', '.join(col_defs)})"
        )
        conn.execute(ddl)

    conn.commit()
    return conn


def extract_foreign_keys(graph: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    Return the foreign-key relationships recorded in the graph.

    These are *not* enforced by the SQLite schema (PRAGMA foreign_keys stays
    OFF); they are surfaced purely so callers can inspect / document the
    relationships if desired.
    """
    return list(graph.get("foreignKeys") or [])


def build_test_db_from_graph(graph_json_path: str,
                             db_path: str = ":memory:") -> sqlite3.Connection:
    """
    Load a System Graph JSON file and build a SQLite database from its
    ``dbTables``.

    Returns the open :class:`sqlite3.Connection`. When ``db_path`` is a real
    file path the same file can be handed to DBRunner via its ``path`` config.
    """
    with open(graph_json_path, "r", encoding="utf-8") as fh:
        graph = json.load(fh)

    tables = graph.get("dbTables") or []
    return create_sqlite_schema(tables, db_path=db_path)


def _table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    """Return the actual column names of a table via PRAGMA table_info."""
    cursor = conn.execute(f"PRAGMA table_info({_quote_ident(table)})")
    cols = [row[1] for row in cursor.fetchall()]
    cursor.close()
    return cols


def seed_row(conn: sqlite3.Connection,
             table: str,
             values: Dict[str, Any]) -> int:
    """
    Insert a single row into ``table`` using a parameterized statement.

    Any keys in ``values`` that are not real columns of the table are silently
    ignored, so callers can pass loose dicts without worrying about the exact
    schema. Returns the number of rows inserted (0 if there was nothing valid
    to insert).
    """
    valid_cols = set(_table_columns(conn, table))
    filtered = {k: v for k, v in (values or {}).items() if k in valid_cols}
    if not filtered:
        return 0

    col_names = list(filtered.keys())
    columns_sql = ", ".join(_quote_ident(c) for c in col_names)
    placeholders = ", ".join("?" for _ in col_names)
    params = [filtered[c] for c in col_names]

    sql = (
        f"INSERT INTO {_quote_ident(table)} ({columns_sql}) "
        f"VALUES ({placeholders})"
    )
    cursor = conn.execute(sql, params)
    conn.commit()
    inserted = cursor.rowcount
    cursor.close()
    return inserted


# ── Public API (for wiring into cli.py's future --seed-db option) ──────────────
__all__ = [
    "map_datatype",
    "create_sqlite_schema",
    "build_test_db_from_graph",
    "seed_row",
    "extract_foreign_keys",
]


if __name__ == "__main__":
    import os
    import tempfile

    GRAPH_PATH = "/home/karthikeyan/vscode/test-ecosudar/system_graph.json"

    fd, tmp_db = tempfile.mkstemp(suffix=".db", prefix="systemintel_seed_")
    os.close(fd)

    try:
        conn = build_test_db_from_graph(GRAPH_PATH, db_path=tmp_db)

        # 1) Count created tables from sqlite_master.
        cur = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cur.fetchone()[0]
        cur.close()
        print(f"[self-test] tables created: {table_count}")
        assert table_count > 70, f"expected > 70 tables, got {table_count}"

        # 2) purchase_orders must exist with a vendor_id column.
        po_cols = _table_columns(conn, "purchase_orders")
        assert po_cols, "purchase_orders table missing or has no columns"
        assert "vendor_id" in po_cols, \
            f"purchase_orders missing vendor_id column; has {po_cols[:8]}..."
        print(f"[self-test] purchase_orders columns: {len(po_cols)} "
              f"(vendor_id present)")

        # 3) Seed a row and read it back to confirm the value round-trips.
        seeded = seed_row(conn, "purchase_orders",
                          {"po_id": 4242, "vendor_id": 99,
                           "po_number": "PO-SELFTEST",
                           "not_a_real_column": "ignored"})
        assert seeded == 1, f"expected 1 row seeded, got {seeded}"

        cur = conn.execute(
            'SELECT "vendor_id", "po_number" FROM "purchase_orders" '
            'WHERE "po_id" = ?', (4242,))
        row = cur.fetchone()
        cur.close()
        assert row is not None, "seeded purchase_orders row not found on readback"
        assert row[0] == 99, f"vendor_id did not round-trip: {row[0]}"
        assert row[1] == "PO-SELFTEST", f"po_number did not round-trip: {row[1]}"
        print(f"[self-test] round-trip read: vendor_id={row[0]} po_number={row[1]}")

        conn.close()
        print("SELF-TEST PASS")
    finally:
        try:
            os.remove(tmp_db)
        except OSError:
            pass
