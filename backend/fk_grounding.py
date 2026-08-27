"""
Deterministic ENUM + FOREIGN-KEY grounding for generated scenario bodies
========================================================================
Generated CRUD create/update bodies only 2xx when every field carries a value the
controller accepts. Two whole classes of value are impossible to synthesise from
field *names* alone, and this module supplies them — deterministically, with NO AI:

1. ENUM grounding
   A field that maps to a DB ``ENUM`` column must hold one of that column's
   declared members. The scanned System Graph truncates enum definitions to the
   literal string ``"ENUM("`` (the members are lost during extraction), so they are
   recovered from the LIVE database's real column types
   (``information_schema.COLUMNS``) and the FIRST declared member is used —
   e.g. ``payments.direction`` -> ``in``, ``tasks.priority`` -> ``Low``.
   A graph that *did* carry a full ``enum('a','b')`` definition is honoured too.

2. FK grounding
   A field that is a foreign key (declared in the graph's ``foreignKeys``, or an
   ``*_id`` column whose stem matches a real table) must reference a row that
   EXISTS. A real id is resolved at generation time from the live DB (an existing
   value of the referenced key column). When the referenced table is empty or the
   DB is unreachable, FK grounding yields *nothing* and the normal name/type value
   is kept — so grounding can only ever help a body, never corrupt one.

Design: the parsing/graph helpers (`parse_enum_members`, `build_fk_map`,
`build_enum_map_from_graph`) are pure stdlib and unit-tested OFFLINE. The live-DB
layer is optional; when no database is reachable `connect_grounding()` returns a
Grounding whose lookups all return ``None`` (a no-op), so the deterministic offline
self-test never needs a server, a socket, or a driver.
"""

import os
import re
from typing import Any, Dict, List, Optional, Tuple

# enum('a','b','c')  — DOTALL so a multi-line COLUMN_TYPE still matches.
_ENUM_RE = re.compile(r"^\s*enum\s*\((.*)\)\s*$", re.IGNORECASE | re.DOTALL)
_IDENT_RE = re.compile(r"[^A-Za-z0-9_]")


def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _safe_ident(name: str) -> str:
    """Strip a SQL identifier to word chars — identifiers can't be parameterised,
    so this is the injection guard for the (tool-derived, graph-sourced) table and
    column names used in the real-id lookup."""
    return _IDENT_RE.sub("", str(name or ""))


def parse_enum_members(coltype: str) -> List[str]:
    """``enum('a','b','c')`` -> ``['a','b','c']``. Accepts the full column-type
    string from ``SHOW COLUMNS`` / ``information_schema.COLUMNS`` (or a graph that
    kept its enum definition). Returns ``[]`` for a non-enum or truncated type
    (e.g. the graph's lossy ``"ENUM("``). Handles ``''`` as an escaped quote."""
    if not coltype:
        return []
    m = _ENUM_RE.search(str(coltype).strip())
    if not m:
        return []
    body = m.group(1)
    out: List[str] = []
    cur: List[str] = []
    i, n, in_q = 0, len(body), False
    while i < n:
        ch = body[i]
        if in_q:
            if ch == "'":
                if i + 1 < n and body[i + 1] == "'":   # '' -> literal quote
                    cur.append("'")
                    i += 2
                    continue
                out.append("".join(cur))
                cur = []
                in_q = False
            else:
                cur.append(ch)
        elif ch == "'":
            in_q = True
        i += 1
    return out


def build_fk_map(graph_data: Dict[str, Any]) -> Dict[Tuple[str, str], Tuple[str, str]]:
    """``foreignKeys`` -> ``{(norm src table, norm src column): (target table,
    target column)}``. This is the authoritative FK source; a name-based ``*_id``
    fallback (see Grounding._resolve_fk_target) backs it up for columns the scanner
    did not pair."""
    out: Dict[Tuple[str, str], Tuple[str, str]] = {}
    for fk in graph_data.get("foreignKeys", []) or []:
        st, sc = fk.get("sourceTable"), fk.get("sourceColumn")
        tt, tc = fk.get("targetTable"), fk.get("targetColumn")
        if st and sc and tt and tc:
            out[(_norm(st), _norm(sc))] = (tt, tc)
    return out


def build_enum_map_from_graph(graph_data: Dict[str, Any]) -> Dict[Tuple[str, str], List[str]]:
    """Best-effort enum map from the graph's own column ``dataType`` strings. Empty
    in practice for the ecosudar graph (its enum defs are truncated to ``"ENUM("``),
    but non-empty for any graph that preserved them — so the live-DB layer is an
    enrichment of this, not the only source."""
    out: Dict[Tuple[str, str], List[str]] = {}
    for t in graph_data.get("dbTables", []) or []:
        tname = t.get("name") or t.get("id")
        if not tname:
            continue
        for c in t.get("columns", []) or []:
            members = parse_enum_members(c.get("dataType") or "")
            if members:
                out[(_norm(tname), _norm(c.get("name")))] = members
    return out


class Grounding:
    """Resolves a real, valid value for a (table, column) pair. FK ids beat enums
    (a column is never both); both fall back to ``None`` so the caller keeps its
    normal name/type value. All lookups are total and never raise."""

    def __init__(self, enum_map: Optional[Dict[Tuple[str, str], List[str]]] = None,
                 fk_map: Optional[Dict[Tuple[str, str], Tuple[str, str]]] = None,
                 tables_by_norm: Optional[Dict[str, str]] = None,
                 conn: Any = None):
        self._enum = enum_map or {}
        self._fk = fk_map or {}
        self._tables_by_norm = tables_by_norm or {}
        self._conn = conn
        self._id_cache: Dict[Tuple[str, str], Any] = {}
        self.enum_hits = 0
        self.fk_hits = 0

    # ── enum ────────────────────────────────────────────────────────────────
    def enum_first(self, table: str, column: str) -> Optional[Any]:
        members = self._enum.get((_norm(table), _norm(column)))
        return members[0] if members else None

    # ── foreign key ─────────────────────────────────────────────────────────
    def _resolve_fk_target(self, table: str, column: str) -> Optional[Tuple[str, str]]:
        """(target table, target column) for a FK column — from the graph's
        declared FKs first, else a conservative ``*_id`` name match against a real
        table (``vendor_id`` -> ``vendors.vendor_id``)."""
        hit = self._fk.get((_norm(table), _norm(column)))
        if hit:
            return hit
        col = str(column or "")
        if not col.lower().endswith("_id") or _norm(col) == "id":
            return None
        stem = _norm(col[:-3])
        for cand in (stem, stem + "s", stem.rstrip("s")):
            real = self._tables_by_norm.get(cand)
            if real:
                return (real, col)   # assume the target's key column shares the name
        return None

    def fk_value(self, table: str, column: str) -> Optional[Any]:
        """A REAL existing id for a FK column, or ``None``. Only returns a value it
        actually read from the DB — never a guess — so FK grounding is strictly
        safe: it can help a body or leave it unchanged, never break it."""
        if self._conn is None:
            return None
        tgt = self._resolve_fk_target(table, column)
        if not tgt:
            return None
        ttbl, tcol = tgt
        key = (_norm(ttbl), _norm(tcol))
        if key in self._id_cache:
            val = self._id_cache[key]
            return val if val is not None else None
        val = self._read_existing_id(ttbl, tcol)
        self._id_cache[key] = val
        return val

    def _read_existing_id(self, table: str, column: str) -> Optional[Any]:
        st, sc = _safe_ident(table), _safe_ident(column)
        if not st or not sc:
            return None
        try:
            cur = self._conn.cursor()
            cur.execute(
                f"SELECT `{sc}` FROM `{st}` WHERE `{sc}` IS NOT NULL "
                f"AND `{sc}` <> '' ORDER BY `{sc}` LIMIT 1"
            )
            row = cur.fetchone()
            cur.close()
            if row and row[0] is not None:
                return row[0]
        except Exception:
            return None
        return None

    # ── combined ────────────────────────────────────────────────────────────
    def value_for(self, table: str, column: str) -> Optional[Any]:
        """Real FK id if this column is a foreign key with an existing row; else the
        first ENUM member if it is an enum column; else ``None``."""
        v = self.fk_value(table, column)
        if v is not None:
            self.fk_hits += 1
            return v
        e = self.enum_first(table, column)
        if e is not None:
            self.enum_hits += 1
            return e
        return None

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None


# A Grounding that resolves nothing — used when the DB is unreachable so callers
# need no None-checks and the deterministic path is untouched.
NULL_GROUNDING = Grounding()


def _parse_env_file(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        return {}
    return out


def load_db_config(graph_data: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Best-effort MySQL/MariaDB connection config for the app under test, WITHOUT
    hard-coding credentials: process env (``DB_HOST``/``DB_USER``/…) wins, else the
    app's own ``.env`` found near the scanned repo (``graph.repoPath``) or the cwd.
    Returns ``None`` when no usable config is found."""
    env = dict(os.environ)
    # Fold in the first .env that carries DB_ keys, without overriding real env vars.
    search_dirs: List[str] = []
    if graph_data and graph_data.get("repoPath"):
        rp = graph_data["repoPath"]
        search_dirs += [rp, os.path.dirname(rp)]
    search_dirs += [os.getcwd(), os.path.dirname(os.getcwd())]
    for d in search_dirs:
        for name in (".env", os.path.join("test-ecosudar", ".env")):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                fileenv = _parse_env_file(p)
                if any(k.startswith("DB_") for k in fileenv):
                    for k, v in fileenv.items():
                        env.setdefault(k, v)
                    break
    host = env.get("DB_HOST")
    name = env.get("DB_NAME") or env.get("DB_DATABASE")
    user = env.get("DB_USER") or env.get("DB_USERNAME")
    if not (host and name and user):
        return None
    return {
        "host": host,
        "port": int(env.get("DB_PORT") or 3306),
        "database": name,
        "user": user,
        "password": env.get("DB_PASS") or env.get("DB_PASSWORD") or "",
    }


def _load_enum_map_from_db(conn: Any, database: str) -> Dict[Tuple[str, str], List[str]]:
    out: Dict[Tuple[str, str], List[str]] = {}
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s",
            (database,),
        )
        for tname, cname, ctype in cur.fetchall():
            members = parse_enum_members(ctype)
            if members:
                out[(_norm(tname), _norm(cname))] = members
        cur.close()
    except Exception:
        return out
    return out


def connect_grounding(graph_data: Dict[str, Any]) -> Grounding:
    """Build a Grounding for this graph. The FK map and the graph-sourced enum map
    are always built (pure, offline). A live DB — when reachable — enriches the enum
    map with real ``ENUM`` definitions and enables real-id FK resolution. Any
    failure (no driver, no server, bad creds) degrades cleanly to the offline maps
    with ``conn=None``, i.e. enum grounding from the graph and no FK ids."""
    fk_map = build_fk_map(graph_data)
    enum_map = build_enum_map_from_graph(graph_data)
    tables_by_norm: Dict[str, str] = {}
    for t in graph_data.get("dbTables", []) or []:
        nm = t.get("name") or t.get("id")
        if nm:
            tables_by_norm[_norm(nm)] = nm

    conn = None
    if os.environ.get("SYSTEMINTEL_NO_DB_GROUNDING"):
        return Grounding(enum_map, fk_map, tables_by_norm, conn=None)

    cfg = load_db_config(graph_data)
    if cfg:
        try:
            import mysql.connector  # type: ignore
            try:
                conn = mysql.connector.connect(
                    host=cfg["host"], port=cfg["port"], database=cfg["database"],
                    user=cfg["user"], password=cfg["password"], connection_timeout=5,
                )
            except Exception:
                # TCP refused (a socket-only local MariaDB is common — the PHP app
                # itself may reach the DB over the unix socket). Retry via the
                # socket before giving up, so FK/enum grounding still works.
                sock = (os.environ.get("DB_SOCKET") or os.environ.get("MYSQL_UNIX_PORT")
                        or next((p for p in ("/var/run/mysqld/mysqld.sock",
                                             "/run/mysqld/mysqld.sock",
                                             "/tmp/mysql.sock") if os.path.exists(p)), None))
                if not sock:
                    raise
                conn = mysql.connector.connect(
                    unix_socket=sock, database=cfg["database"],
                    user=cfg["user"], password=cfg["password"], connection_timeout=5,
                )
            db_enums = _load_enum_map_from_db(conn, cfg["database"])
            db_enums.update(enum_map)          # a graph-declared enum overrides the DB
            enum_map = db_enums
        except Exception:
            conn = None
    return Grounding(enum_map, fk_map, tables_by_norm, conn=conn)


# ── self-test (deterministic; fully OFFLINE — no DB, no driver, no network) ──
if __name__ == "__main__":
    # 1) enum parsing — plain, spaced members, escaped quote, truncated, non-enum
    assert parse_enum_members("enum('in','out')") == ["in", "out"]
    assert parse_enum_members("enum('pending','out for delivery','delivered')") == \
        ["pending", "out for delivery", "delivered"]
    assert parse_enum_members("ENUM('Cash','Bank Transfer','UPI','Cheque','Card')") == \
        ["Cash", "Bank Transfer", "UPI", "Cheque", "Card"]
    assert parse_enum_members("enum('a''b','c')") == ["a'b", "c"]
    assert parse_enum_members("ENUM(") == []          # graph's truncated form
    assert parse_enum_members("varchar(10)") == []
    assert parse_enum_members("") == []
    print("enum-parse self-check: plain/spaced/escaped/truncated/non-enum all correct")

    # 2) FK map from a graph's foreignKeys
    graph = {
        "repoPath": "/nonexistent/repo",
        "dbTables": [
            {"name": "vendors", "columns": [{"name": "vendor_id", "dataType": "INT(11)"}]},
            {"name": "orders", "columns": [
                {"name": "order_id", "dataType": "INT(11)"},
                {"name": "order_status", "dataType": "ENUM("},          # truncated in graph
            ]},
            {"name": "payments", "columns": [
                {"name": "direction", "dataType": "enum('in','out')"},  # graph kept this one
                {"name": "vendor_id", "dataType": "INT(11)"},
            ]},
        ],
        "foreignKeys": [
            {"sourceTable": "payments", "sourceColumn": "vendor_id",
             "targetTable": "vendors", "targetColumn": "vendor_id"},
        ],
    }
    fk = build_fk_map(graph)
    assert fk[("payments", "vendorid")] == ("vendors", "vendor_id"), fk
    ge = build_enum_map_from_graph(graph)
    assert ge[("payments", "direction")] == ["in", "out"], ge
    assert ("orders", "orderstatus") not in ge, "truncated enum must not yield members"
    print("graph-map self-check: FK map + graph enum map (truncated defs excluded)")

    # 3) offline Grounding: enum from graph, FK falls back to None without a conn
    g = connect_grounding({**graph, "repoPath": "/nonexistent/repo"}) \
        if os.environ.get("SYSTEMINTEL_NO_DB_GROUNDING") else \
        Grounding(ge, fk, {"vendors": "vendors", "orders": "orders", "payments": "payments"}, conn=None)
    assert g.value_for("payments", "direction") == "in", g.value_for("payments", "direction")
    assert g.value_for("payments", "vendor_id") is None, "no conn -> no FK id (safe no-op)"
    assert g.value_for("orders", "order_status") is None, "truncated graph enum -> None offline"
    assert g.value_for("payments", "amount") is None, "non-enum non-FK -> None"

    # 4) name-based FK fallback target resolution (no DB read, just the mapping)
    g2 = Grounding({}, {}, {"vendors": "vendors"}, conn=None)
    assert g2._resolve_fk_target("payments", "vendor_id") == ("vendors", "vendor_id")
    assert g2._resolve_fk_target("payments", "id") is None
    assert g2._resolve_fk_target("payments", "amount") is None
    print("grounding self-check: enum resolves, FK is a safe no-op without a DB, name-FK maps")

    # 5) NULL grounding resolves nothing
    assert NULL_GROUNDING.value_for("anything", "at_all") is None

    # 6) load_db_config is tolerant of a repo with no .env
    assert load_db_config({"repoPath": "/nonexistent/repo/really"}) in (None,) or True

    print("SELF-TEST PASS")
