"""
Real Database Assertion Runner
Connects to a live database (SQLite, PostgreSQL, MySQL) and
runs SQL SELECT queries to verify actual row insertions and column values.
Supports: sqlite3 (built-in), psycopg2 (PostgreSQL), mysql-connector (MySQL).
"""

import re
import time
from typing import Dict, Any, List, Optional


def _safe_ident(name: str) -> str:
    """Sanitize a SQL identifier (table/column) — strip anything but word chars and
    dots so it can't break out of the query. Identifiers can't be parameterized, so
    this is the guard; values are always passed as bound params."""
    return re.sub(r'[^A-Za-z0-9_.]', '', str(name or ''))


class DBRunner:
    def __init__(self, db_config: Dict[str, Any]):
        """
        db_config keys:
          driver    - "sqlite" | "postgresql" | "mysql"
          path      - (sqlite only) path to .db file
          host      - (pg/mysql) hostname
          port      - (pg/mysql) port
          database  - database name
          user      - username
          password  - password
        """
        self.db_config  = db_config
        self.driver     = db_config.get('driver', 'sqlite')
        self.connection = None
        self.result_log = []

    def connect(self):
        """Establish a real database connection."""
        if self.driver == 'sqlite':
            import sqlite3
            db_path = self.db_config.get('path', ':memory:')
            self.connection = sqlite3.connect(db_path, check_same_thread=False)
            self.connection.row_factory = sqlite3.Row
            return True

        elif self.driver == 'postgresql':
            try:
                import psycopg2
                import psycopg2.extras
                self.connection = psycopg2.connect(
                    host     = self.db_config.get('host', 'localhost'),
                    port     = self.db_config.get('port', 5432),
                    dbname   = self.db_config.get('database', 'erp'),
                    user     = self.db_config.get('user', 'postgres'),
                    password = self.db_config.get('password', ''),
                    connect_timeout = 5,
                )
                return True
            except ImportError:
                raise RuntimeError("psycopg2 not installed. Run: pip install psycopg2-binary")
            except Exception as e:
                raise RuntimeError(f"PostgreSQL connection failed: {e}")

        elif self.driver == 'mysql':
            try:
                import mysql.connector
                self.connection = mysql.connector.connect(
                    host     = self.db_config.get('host', 'localhost'),
                    port     = self.db_config.get('port', 3306),
                    database = self.db_config.get('database', 'erp'),
                    user     = self.db_config.get('user', 'root'),
                    password = self.db_config.get('password', ''),
                    connection_timeout = 5,
                )
                # The runner quotes identifiers with "double quotes"; MySQL/MariaDB
                # treat those as string literals unless ANSI_QUOTES is on. Enable it
                # so the same assertion SQL works across sqlite/postgres/mysql.
                try:
                    cur = self.connection.cursor()
                    cur.execute("SET SESSION sql_mode='ANSI_QUOTES'")
                    cur.close()
                except Exception:
                    pass
                return True
            except ImportError:
                raise RuntimeError("mysql-connector-python not installed. Run: pip install mysql-connector-python")
            except Exception as e:
                raise RuntimeError(f"MySQL connection failed: {e}")
        else:
            raise ValueError(f"Unsupported DB driver: {self.driver}")

    def disconnect(self):
        if self.connection:
            try:
                self.connection.close()
            except Exception:
                pass
            self.connection = None

    def fetch_row(self, table: str, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Return a single matching row as {column: value}, or None. Identifiers are
        whitelisted via _safe_ident (S9) and values are parameterized — used by the
        flat-path edge oracle to read the STORED value after a write. Never raises to
        the caller: a missing table/column or driver error yields None."""
        if not self.connection:
            return None
        try:
            st = _safe_ident(table)
            ph = "?" if self.driver == "sqlite" else "%s"
            conds, params = [], []
            for col, val in (where or {}).items():
                conds.append(f'"{_safe_ident(col)}" = {ph}')
                params.append(val)
            if not conds:
                return None
            q = f'SELECT * FROM "{st}" WHERE ' + " AND ".join(conds) + " LIMIT 1"
            cur = self.connection.cursor()
            cur.execute(q, tuple(params))
            row = cur.fetchone()
            if row is None:
                cur.close()
                return None
            cols = [d[0] for d in cur.description]
            cur.close()
            return {cols[i]: row[i] for i in range(len(cols))}
        except Exception:
            return None

    def run_assertion(self, assertion: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run a single DB assertion.
        assertion keys:
          type            - must be "DB"
          table           - table name to query
          column          - column to check (optional)
          value           - expected value for that column (optional)
          condition       - raw WHERE clause string (optional, e.g. "email = 'test@test.com'")
          expectedRowsCount - expected number of rows matching query (optional)
          sql             - raw SELECT query (overrides table/column/condition)
        """
        if assertion.get('type') != 'DB':
            return {"type": "DB", "passed": True, "skipped": True, "reason": "not a DB assertion"}

        table               = assertion.get('table', '')
        column              = assertion.get('column')
        expected_val        = assertion.get('value')
        condition           = assertion.get('condition')
        expected_rows_count = assertion.get('expectedRowsCount')
        equals              = assertion.get('equals')          # parameterized value match
        raw_sql             = assertion.get('sql')
        check_type          = assertion.get('checkType', '')  # 'schema_exists' | 'fk_integrity' | ''

        start_ms = time.time() * 1000
        result = {
            "type":         "DB",
            "table":        table,
            "column":       column,
            "expectedValue": expected_val,
        }

        if not self.connection:
            result.update({
                "passed": False,
                "error":  "No active database connection. Call connect() first.",
                "durationMs": 0,
            })
            self.result_log.append(result)
            return result

        try:
            cursor = self.connection.cursor()

            # ── schema_exists: verify the table exists at all ──────────────────
            if check_type == 'schema_exists':
                driver = self.driver
                # S9: sanitize the identifier even in the string-literal position
                # (a table name with a quote could otherwise break out).
                safe_table = _safe_ident(table)
                if driver == 'sqlite':
                    query = f"SELECT name FROM sqlite_master WHERE type='table' AND name='{safe_table}'"
                elif driver == 'postgresql':
                    query = f"SELECT tablename FROM pg_tables WHERE tablename='{safe_table}'"
                elif driver == 'mysql':
                    query = f"SHOW TABLES LIKE '{safe_table}'"
                else:
                    query = f"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='{safe_table}'"

                cursor.execute(query)
                rows = cursor.fetchall()
                duration_ms = round(time.time() * 1000 - start_ms, 2)
                exists = len(rows) > 0
                result.update({
                    "query":       query,
                    "passed":      exists,
                    "checkType":   "schema_exists",
                    "tableFound":  exists,
                    "durationMs":  duration_ms,
                    "error":       None if exists else f"Table `{table}` not found in database.",
                })
                cursor.close()
                self.result_log.append(result)
                return result

            # ── fk_integrity: no orphaned foreign-key values ───────────────────
            if check_type == 'fk_integrity':
                ref_table = assertion.get('refTable', '')
                ref_col   = assertion.get('refColumn', '')
                # S9: sanitize every identifier — these come from the scanned
                # schema / a caller-supplied graph JSON and were previously raw.
                st, sc = _safe_ident(table), _safe_ident(column)
                srt, src = _safe_ident(ref_table), _safe_ident(ref_col)
                query = (f'SELECT COUNT(*) FROM "{st}" c '
                         f'WHERE c."{sc}" IS NOT NULL '
                         f'AND c."{sc}" NOT IN (SELECT p."{src}" FROM "{srt}" p)')
                cursor.execute(query)
                orphans = cursor.fetchone()[0]
                duration_ms = round(time.time() * 1000 - start_ms, 2)
                passed = (orphans == 0)
                result.update({
                    "query":      query,
                    "checkType":  "fk_integrity",
                    "orphanRows": orphans,
                    "passed":     passed,
                    "durationMs": duration_ms,
                    "error":      None if passed else f"{orphans} orphaned `{table}.{column}` value(s) with no `{ref_table}.{ref_col}` match.",
                })
                cursor.close()
                self.result_log.append(result)
                return result

            # ── invariant: zero rows may violate a mined business rule ─────────
            # `violationWhere` is tool-generated with whitelisted identifiers
            # (see backend/invariants.py) — the same trust model as `condition`.
            if check_type == 'invariant':
                where = assertion.get('violationWhere') or '1=0'
                query = f'SELECT COUNT(*) FROM "{_safe_ident(table)}" WHERE {where}'
                try:
                    cursor.execute(query)
                    violations = cursor.fetchone()[0]
                except Exception as ie:
                    # Unknown table/column in this DB → not applicable, skip (never a false red)
                    msg = str(ie).lower()
                    if 'no such' in msg or 'unknown' in msg or 'does not exist' in msg:
                        cursor.close()
                        # Q8: an invariant we could not evaluate is UNKNOWN, not a
                        # pass. Mark passed=None + skipped so it is excluded from the
                        # pass count and reported honestly as "not verified" rather
                        # than silently inflating green.
                        result.update({"passed": None, "skipped": True,
                                       "status": "unknown",
                                       "checkType": "invariant",
                                       "invariant": assertion.get('invariant', ''),
                                       "reason": f"not verified — table/column absent in this DB: {ie}",
                                       "durationMs": round(time.time() * 1000 - start_ms, 2)})
                        self.result_log.append(result)
                        return result
                    raise
                duration_ms = round(time.time() * 1000 - start_ms, 2)
                passed = (violations == 0)
                result.update({
                    "query":        query,
                    "checkType":    "invariant",
                    "invariant":    assertion.get('invariant', ''),
                    "violatingRows": violations,
                    "passed":       passed,
                    "durationMs":   duration_ms,
                    "error":        None if passed
                                    else f"{violations} row(s) violate invariant: {assertion.get('invariant', '')}",
                })
                cursor.close()
                self.result_log.append(result)
                return result

            # ── value match (PARAMETERIZED — injection-safe) ───────────────────
            # e.g. cross-layer oracle: "a row exists where <column> == <equals>"
            if column is not None and equals is not None:
                # placeholder is driver-specific: sqlite uses '?', mysql-connector
                # and psycopg2 use '%s'. Using the wrong one raises "Not all
                # parameters were used" on MySQL, so pick per driver.
                ph = "?" if self.driver == "sqlite" else "%s"
                q = f'SELECT COUNT(*) FROM "{_safe_ident(table)}" WHERE "{_safe_ident(column)}" = {ph}'
                cursor.execute(q, [equals])
                cnt = cursor.fetchone()[0]
                want = expected_rows_count if expected_rows_count is not None else 1
                passed = (cnt >= want)
                duration_ms = round(time.time() * 1000 - start_ms, 2)
                result.update({
                    "query": q, "boundParam": equals, "matchingRows": cnt,
                    "expectedRowsCount": want, "passed": passed,
                    "checkType": check_type or "value_exists",
                    "durationMs": duration_ms, "error": None,
                })
                cursor.close()
                self.result_log.append(result)
                return result

            # Build or use provided SQL (identifiers sanitized; conditions are tool-generated)
            if raw_sql:
                query = raw_sql
                params = []
            elif expected_rows_count is not None and condition:
                query = f'SELECT COUNT(*) FROM "{_safe_ident(table)}" WHERE {condition}'
                params = []
            elif column and expected_val is not None:
                if condition:
                    query = f'SELECT "{_safe_ident(column)}" FROM "{_safe_ident(table)}" WHERE {condition} LIMIT 1'
                else:
                    query = f'SELECT "{_safe_ident(column)}" FROM "{_safe_ident(table)}" ORDER BY rowid DESC LIMIT 1'
                params = []
            else:
                query = f'SELECT COUNT(*) FROM "{_safe_ident(table)}"'
                params = []

            cursor.execute(query, params)
            rows = cursor.fetchall()
            duration_ms = round(time.time() * 1000 - start_ms, 2)

            # Evaluate assertion result
            if expected_rows_count is not None:
                actual_count = rows[0][0] if rows else 0
                passed = (actual_count == expected_rows_count)
                result.update({
                    "query":             query,
                    "expectedRowsCount": expected_rows_count,
                    "actualRowsCount":   actual_count,
                    "passed":            passed,
                    "durationMs":        duration_ms,
                    "error":             None,
                })
            elif column and expected_val is not None:
                if not rows or rows[0][0] is None:
                    passed = False
                    actual = None
                else:
                    actual = rows[0][0]
                    # Compare as same type
                    try:
                        passed = (float(actual) == float(expected_val))
                    except (TypeError, ValueError):
                        passed = (str(actual).strip() == str(expected_val).strip())

                result.update({
                    "query":         query,
                    "actualValue":   actual if rows else None,
                    "expectedValue": expected_val,
                    "matched":       passed,
                    "passed":        passed,
                    "durationMs":    duration_ms,
                    "error":         None,
                })
            else:
                actual_count = rows[0][0] if rows else 0
                result.update({
                    "query":      query,
                    "rowCount":   actual_count,
                    "passed":     actual_count > 0,
                    "durationMs": duration_ms,
                    "error":      None,
                })

            cursor.close()

        except Exception as e:
            result.update({
                "passed":     False,
                "error":      f"{type(e).__name__}: {e}",
                "durationMs": round(time.time() * 1000 - start_ms, 2),
            })

        self.result_log.append(result)
        return result

    def run_assertions(self, assertions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run all DB-type assertions in a test case."""
        return [self.run_assertion(a) for a in assertions if a.get('type') == 'DB']

    def print_result(self, result: Dict[str, Any]):
        status_color = "\033[32m" if result.get("passed") else "\033[31m"
        reset = "\033[0m"
        passed_label = "PASS" if result.get("passed") else ("SKIP" if result.get("skipped") else "FAIL")
        table_col = f"{result.get('table','')}.{result.get('column','')}" if result.get('column') else result.get('table','')
        print(f"  {status_color}[{passed_label}]{reset} DB assertion on `{table_col}` "
              f"expected={result.get('expectedValue', result.get('expectedRowsCount', 'exists'))} "
              f"actual={result.get('actualValue', result.get('actualRowsCount', result.get('rowCount', '?')))} "
              f"({result.get('durationMs', 0):.0f}ms)")
        if result.get("error"):
            print(f"         \033[33m⚠ {result['error']}\033[0m")
