"""
Dependency-Ordered Fixture Seeder
Populates a self-contained SQLite test DB with synthetic-but-valid *related*
rows so cross-layer / functional tests have satisfiable preconditions.

The problem: a functional test that POSTs something referencing ``vendor_id``
(or that later asserts ``SELECT ... WHERE vendor_id = ?``) only passes when a
parent ``vendors`` row already exists. Foreign keys are not enforced by the
seeded schema (db_seeder keeps ``PRAGMA foreign_keys = OFF``), but the *data*
still has to line up — an FK column must hold a value that actually exists in
its parent table, or ``WHERE fk = value`` finds nothing.

This module inserts rows in FK dependency order (parents before children) and
wires every FK column to the primary-key value of an already-inserted parent
row, so no child ends up orphaned.

Companion to ``backend/db_seeder.py`` (whose schema this seeds). Pure standard
library — only ``sqlite3``, ``json`` and ``re`` are used.
"""

import json
import re
import sqlite3
from typing import Any, Dict, List, Tuple

# Reuse the MySQL-ish dataType -> SQLite affinity mapping from the schema seeder
# so value generation classifies types exactly the way the tables were created.
# Support both "run the script directly" (script dir on sys.path) and
# "imported as backend.fixtures" invocation styles.
try:
    from db_seeder import map_datatype
except ImportError:  # pragma: no cover - packaging fallback
    from backend.db_seeder import map_datatype  # type: ignore

# Date/time-ish dataTypes all collapse to the same canonical timestamp string.
_DATETIME_RE = re.compile(r"DATE|TIME|TIMESTAMP")
# Column *names* that look like they hold an email address.
_EMAIL_RE = re.compile(r"mail", re.IGNORECASE)
# Boolean-ish column names (mirror of invariants._BOOL_RE) — seed 0/1, not a
# random int, so the boolean-domain invariant is satisfied by valid fixtures.
_BOOL_RE = re.compile(
    r"^(is_|has_|can_|should_|allow_|enable_)\w+$"
    r"|^(active|enabled|disabled|deleted|verified|available|featured|published)$",
    re.IGNORECASE)


def _enum_values(data_type):
    """Declared values of an ENUM('a','b',...) type, else None."""
    m = re.match(r"\s*ENUM\s*\((.*)\)\s*$", str(data_type or ""), re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))


def _quote_ident(identifier: str) -> str:
    """Quote a SQL identifier with double-quotes, escaping embedded quotes."""
    return '"' + str(identifier).replace('"', '""') + '"'


def _table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    """Return the actual column names of a table via PRAGMA table_info."""
    cursor = conn.execute(f"PRAGMA table_info({_quote_ident(table)})")
    cols = [row[1] for row in cursor.fetchall()]
    cursor.close()
    return cols


def _table_names(tables: List[Dict[str, Any]]) -> List[str]:
    """De-duplicated list of table names (falling back to ``id``)."""
    names: List[str] = []
    seen: set = set()
    for table in tables or []:
        name = table.get("name") or table.get("id")
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def topo_order_tables(tables: List[Dict[str, Any]],
                      foreign_keys: List[Dict[str, Any]]) -> List[str]:
    """
    Order table names so a referenced (parent) table always comes before any
    table that references it (child), via Kahn's algorithm on the FK graph.

    An edge runs parent -> child (child ``sourceTable`` depends on parent
    ``targetTable``); a child cannot be seeded before its parents exist. Only
    FKs whose *both* endpoints are known tables are considered; self-references
    are ignored (a table need not precede itself).

    Ties (tables that become ready at the same time) are broken by name, and any
    tables left inside a dependency cycle are appended in name order — so the
    result is deterministic and the function never loops forever.
    """
    names = _table_names(tables)
    name_set = set(names)

    children: Dict[str, set] = {n: set() for n in names}   # parent -> {children}
    indegree: Dict[str, int] = {n: 0 for n in names}       # child  -> #parents

    for fk in foreign_keys or []:
        parent = fk.get("targetTable")
        child = fk.get("sourceTable")
        if parent not in name_set or child not in name_set:
            continue
        if parent == child:
            continue  # self-reference: irrelevant to ordering
        if child not in children[parent]:
            children[parent].add(child)
            indegree[child] += 1

    # Ready set = tables with no outstanding parents, always popped in name order.
    ready = sorted(n for n in names if indegree[n] == 0)
    order: List[str] = []

    while ready:
        node = ready.pop(0)
        order.append(node)
        newly_ready = []
        for child in sorted(children[node]):
            indegree[child] -= 1
            if indegree[child] == 0:
                newly_ready.append(child)
        if newly_ready:
            ready.extend(newly_ready)
            ready.sort()

    # Cycle break: whatever is left still has indegree > 0. Emit deterministically.
    placed = set(order)
    order.extend(sorted(n for n in names if n not in placed))
    return order


def generate_value(column: Dict[str, Any], pk_counter: int) -> Any:
    """
    Produce a single valid value for ``column`` based on its dataType and name.

      * INTEGER-ish (incl. integer primary keys) -> ``pk_counter`` (unique int)
      * REAL / DECIMAL / NUMERIC / FLOAT / DOUBLE -> a number
      * DATE / TIME / TIMESTAMP                    -> '2026-01-01 00:00:00'
      * an email-ish column name                   -> 'fix{n}@test.com'
      * anything else                              -> 'fix_{name}_{n}'

    ``pk_counter`` is a caller-supplied running counter; passing a fresh value
    each call keeps generated integers (and therefore primary keys) unique.
    """
    name = str(column.get("name") or "col")
    data_type = column.get("dataType")
    affinity = map_datatype(data_type)
    upper_type = str(data_type or "").upper()

    # ENUM columns get one of their DECLARED values (satisfies the enum-domain
    # invariant), regardless of affinity.
    enum_vals = _enum_values(data_type)
    if enum_vals:
        return enum_vals[0]
    # Boolean-ish integer flags get 0/1 (satisfies the boolean-domain invariant)
    # instead of an arbitrary unique id.
    if affinity == "INTEGER" and _BOOL_RE.search(name):
        return pk_counter % 2
    # Integer columns — including integer PKs — get a unique incrementing id.
    if affinity == "INTEGER":
        return pk_counter
    # Real / decimal numerics -> a plain number.
    if affinity == "REAL":
        return float(pk_counter)
    # Remaining columns have TEXT affinity. Date/time-ish -> canonical timestamp.
    if _DATETIME_RE.search(upper_type):
        return "2026-01-01 00:00:00"
    # Email-ish name -> a valid-looking address.
    if _EMAIL_RE.search(name):
        return f"fix{pk_counter}@test.com"
    return f"fix_{name}_{pk_counter}"


def _dedupe_columns(columns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep the first occurrence of each (case-insensitive) column name."""
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for col in columns or []:
        name = col.get("name")
        if not name:
            continue
        key = str(name).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(col)
    return out


def _insert_row(conn: sqlite3.Connection, table: str, row: Dict[str, Any]) -> bool:
    """
    Parameterized INSERT of ``row`` into ``table``. Values for columns that do
    not actually exist in the table are dropped (robust to graph/schema drift).
    Returns True on success; a primary-key / uniqueness clash is swallowed and
    reported as False rather than crashing the whole seed run.
    """
    valid = set(_table_columns(conn, table))
    filtered = {k: v for k, v in row.items() if k in valid}
    if not filtered:
        return False

    col_names = list(filtered.keys())
    sql = (
        f"INSERT INTO {_quote_ident(table)} "
        f"({', '.join(_quote_ident(c) for c in col_names)}) "
        f"VALUES ({', '.join('?' for _ in col_names)})"
    )
    try:
        conn.execute(sql, [filtered[c] for c in col_names])
    except sqlite3.IntegrityError:
        return False
    return True


def seed_fixtures(conn: sqlite3.Connection,
                  tables: List[Dict[str, Any]],
                  foreign_keys: List[Dict[str, Any]],
                  rows_per_table: int = 1) -> Dict[str, List[Any]]:
    """
    Insert ``rows_per_table`` synthetic rows into every table, in FK dependency
    order, wiring foreign-key columns to real parent primary-key values.

    A running registry maps each table to the rows already inserted; when a
    column is the *source* of a foreign key, its value is taken from an
    already-inserted parent row's referenced column (its primary key, in
    practice) instead of a freshly generated one — so ``WHERE fk = value``
    checks resolve and no child row is orphaned.

    Tables with zero usable columns are skipped. Foreign-key PRAGMA enforcement
    is intentionally left untouched (the schema keeps it OFF); correctness comes
    from the *data*, not the constraint.

    Returns ``{table_name: [inserted_pk_values]}`` for every seeded table.
    """
    table_by_name: Dict[str, Dict[str, Any]] = {}
    for table in tables or []:
        name = table.get("name") or table.get("id")
        if name and name not in table_by_name:
            table_by_name[name] = table

    # (sourceTable, sourceColumn) -> (targetTable, targetColumn)
    fk_by_source: Dict[Tuple[str, str], Tuple[str, str]] = {}
    for fk in foreign_keys or []:
        st, sc = fk.get("sourceTable"), fk.get("sourceColumn")
        tt, tc = fk.get("targetTable"), fk.get("targetColumn")
        if st and sc and tt and tc:
            fk_by_source.setdefault((st, sc), (tt, tc))

    n_rows = max(1, int(rows_per_table or 1))

    registry_rows: Dict[str, List[Dict[str, Any]]] = {}  # table -> inserted rows
    result: Dict[str, List[Any]] = {}                    # table -> [pk values]
    counter = 1  # global unique-int source for generate_value

    for table_name in topo_order_tables(tables, foreign_keys):
        table = table_by_name.get(table_name)
        if not table:
            continue
        cols = _dedupe_columns(table.get("columns") or [])
        if not cols:
            continue  # skip zero-column tables

        pk_cols = [c.get("name") for c in cols if c.get("isPrimaryKey")]
        pk_col = pk_cols[0] if pk_cols else None

        registry_rows.setdefault(table_name, [])
        result.setdefault(table_name, [])

        for i in range(n_rows):
            row: Dict[str, Any] = {}

            # ── Pass 1: every NON-foreign-key column gets a fresh generated value.
            # (FK columns are deferred so this row's own PK is available for any
            #  self-referential FK, and every parent has been seeded by topo order.)
            fk_cols: List[Tuple[str, Tuple[str, str]]] = []
            for col in cols:
                col_name = col.get("name")
                fk_target = fk_by_source.get((table_name, col_name))
                if fk_target:
                    fk_cols.append((col_name, fk_target))
                    continue
                row[col_name] = generate_value(col, counter)
                counter += 1

            # ── Pass 2: resolve FK columns to a REAL parent value, or leave NULL.
            # The one rule that guarantees zero orphans: an FK column is NEVER
            # given a fabricated value. It is either wired to an existing parent
            # row (or, for a self-reference, this row's own PK) or set to NULL —
            # and NULL is excluded from the `WHERE fk NOT IN (parent)` orphan test.
            for col_name, (parent_table, parent_col) in fk_cols:
                value = None
                if parent_table == table_name:
                    # Self-reference (e.g. employees.manager_id → employees.id):
                    # point the row at itself so the value always resolves.
                    value = row.get(pk_col) if pk_col else None
                else:
                    parent_rows = registry_rows.get(parent_table) or []
                    if parent_rows:
                        parent_row = parent_rows[i % len(parent_rows)]
                        value = parent_row.get(parent_col)
                        if value is None:
                            # targetColumn wasn't recorded — reuse a parent PK.
                            parent_pks = result.get(parent_table) or []
                            value = parent_pks[i % len(parent_pks)] if parent_pks else None
                    # else: parent unseeded (skipped/cycle/failed) → stays NULL.
                row[col_name] = value

            if _insert_row(conn, table_name, row):
                registry_rows[table_name].append(row)
                if pk_col is not None and pk_col in row:
                    result[table_name].append(row[pk_col])

        conn.commit()

    return result


def seed_from_graph(conn: sqlite3.Connection,
                    graph_json_path: str,
                    rows_per_table: int = 1) -> Dict[str, List[Any]]:
    """
    Load a System Graph JSON file and seed its ``dbTables`` with related fixture
    rows (respecting ``foreignKeys``). Convenience wrapper over
    :func:`seed_fixtures`; returns the same ``{table: [pk values]}`` mapping.
    """
    with open(graph_json_path, "r", encoding="utf-8") as fh:
        graph = json.load(fh)

    tables = graph.get("dbTables") or []
    foreign_keys = graph.get("foreignKeys") or []
    return seed_fixtures(conn, tables, foreign_keys, rows_per_table=rows_per_table)


# ── Public API (for wiring into cli.py's --seed-db path) ───────────────────────
__all__ = [
    "topo_order_tables",
    "generate_value",
    "seed_fixtures",
    "seed_from_graph",
]


if __name__ == "__main__":
    # Self-test WITHOUT the real app: build a tiny two-table schema in-memory via
    # db_seeder.create_sqlite_schema, seed it, and prove FK data lines up.
    try:
        from db_seeder import create_sqlite_schema
    except ImportError:
        from backend.db_seeder import create_sqlite_schema  # type: ignore

    tables = [
        {
            "id": "tbl_vendors",
            "name": "vendors",
            "columns": [
                {"name": "vendor_id", "dataType": "INTEGER",
                 "isPrimaryKey": True, "isNullable": False, "tableName": "vendors"},
                {"name": "name", "dataType": "TEXT",
                 "isPrimaryKey": False, "isNullable": True, "tableName": "vendors"},
            ],
        },
        {
            "id": "tbl_purchase_orders",
            "name": "purchase_orders",
            "columns": [
                {"name": "id", "dataType": "INTEGER",
                 "isPrimaryKey": True, "isNullable": False,
                 "tableName": "purchase_orders"},
                {"name": "vendor_id", "dataType": "INTEGER",
                 "isPrimaryKey": False, "isNullable": True,
                 "tableName": "purchase_orders"},
                {"name": "notes", "dataType": "TEXT",
                 "isPrimaryKey": False, "isNullable": True,
                 "tableName": "purchase_orders"},
            ],
        },
    ]
    foreign_keys = [
        {"sourceTable": "purchase_orders", "sourceColumn": "vendor_id",
         "targetTable": "vendors", "targetColumn": "vendor_id"},
    ]

    conn = create_sqlite_schema(tables, ":memory:")

    # (1) topological order puts the parent before the child.
    order = topo_order_tables(tables, foreign_keys)
    print(f"[self-test] topo order: {order}")
    assert order.index("vendors") < order.index("purchase_orders"), \
        f"vendors must precede purchase_orders, got {order}"

    # Seed a couple of rows per table for a stronger orphan check.
    seeded = seed_fixtures(conn, tables, foreign_keys, rows_per_table=2)
    print(f"[self-test] seeded pk registry: {seeded}")

    # (2a) at least one vendor exists.
    cur = conn.execute("SELECT COUNT(*) FROM vendors")
    vendor_count = cur.fetchone()[0]
    cur.close()
    print(f"[self-test] vendors rows: {vendor_count}")
    assert vendor_count >= 1, f"expected >= 1 vendor, got {vendor_count}"

    # (2b) every purchase_orders.vendor_id points at a real vendors.vendor_id.
    cur = conn.execute(
        "SELECT COUNT(*) FROM purchase_orders "
        "WHERE vendor_id NOT IN (SELECT vendor_id FROM vendors)")
    orphans = cur.fetchone()[0]
    cur.close()

    cur = conn.execute("SELECT COUNT(*) FROM purchase_orders")
    po_count = cur.fetchone()[0]
    cur.close()
    print(f"[self-test] purchase_orders rows: {po_count}, orphaned vendor_id: {orphans}")
    assert po_count >= 1, f"expected >= 1 purchase order, got {po_count}"
    assert orphans == 0, f"found {orphans} orphaned purchase_orders.vendor_id value(s)"

    conn.close()
    print("SELF-TEST PASS")
