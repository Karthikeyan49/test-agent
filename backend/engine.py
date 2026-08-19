"""
SystemIntel Core Python Engine
Handles SQL schema parsing, test case generation, and system graph construction.
All deterministic — zero LLM dependency.
"""

import re
import os
import json
from typing import List, Dict, Any

# Language/framework built-ins that are not repo data classes — excluded from CALLS
_CALL_DENYLIST = {
    "Exception", "Throwable", "Error", "TypeError", "ValueError", "RuntimeException",
    "PDO", "PDOException", "PDOStatement", "DateTime", "DateTimeImmutable", "DateInterval",
    "Closure", "ArrayObject", "SplStack", "Generator", "Countable", "Iterator",
    "Str", "Arr", "Carbon", "Collection", "JsonException", "InvalidArgumentException",
}

# ── Cross-framework route detectors ───────────────────────────────────────────
# Used only when the primary PHP/Express/decorator matchers MISS a line, and
# gated by file extension so a pattern for one language never fires on another.
_RX_FLASK_ROUTE    = re.compile(r'@\w+\.route\(\s*["\']([^"\']+)["\'](?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?', re.I)
_RX_VERB_DECORATOR = re.compile(r'@(Get|Post|Put|Delete|Patch)\(\s*(?:["\']([^"\']*)["\'])?')  # NestJS / Micronaut (path optional → root)
_RX_SPRING_REQMAP  = re.compile(r'@RequestMapping\(([^)]*)\)')                              # Spring
_RX_DJANGO_PATH    = re.compile(r'\b(?:path|re_path|url)\(\s*[rR]?["\']([^"\']*)["\']\s*,') # Django urlconf
_RX_RAILS_VERB     = re.compile(r'^\s*(get|post|put|patch|delete)\s+["\']([^"\']+)["\']', re.I)  # Rails routes.rb
_RX_RAILS_RES      = re.compile(r'^\s*resources?\s+:([a-zA-Z0-9_]+)')                       # Rails resources :x
_RX_GO_ROUTE       = re.compile(r'\.\s*(GET|POST|PUT|DELETE|PATCH|HandleFunc)\(\s*["\']([^"\']+)["\']')  # gin/echo/mux
_RX_STRING_LIT     = re.compile(r'["\']([^"\']+)["\']')


# A2: parse errors were previously swallowed with `except: pass`, so a file that
# failed to parse silently vanished from the graph — which was then presented as
# complete. Collect them here and surface a coverage warning after a scan, so a
# missing edge is never mistaken for "no such link exists".
PARSE_ERRORS: List[Dict[str, str]] = []


def _record_parse_error(where: str, exc: Exception, file_path: str = "") -> None:
    PARSE_ERRORS.append({"where": where, "file": file_path or "?",
                         "error": f"{type(exc).__name__}: {exc}"})


def get_parse_errors() -> List[Dict[str, str]]:
    return list(PARSE_ERRORS)


class PythonSystemIntelligenceEngine:

    # ─── SQL Schema Parser ────────────────────────────────────────────────────

    def parse_sql_schema(self, sql_content: str) -> Dict[str, Any]:
        """
        Deterministically parse SQL DDL to extract tables, columns, and foreign keys.
        Supports PostgreSQL, MySQL, SQLite DDL syntax.
        """
        tables       = []
        foreign_keys = []

        # Split on CREATE TABLE (case-insensitive)
        blocks = re.split(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?', sql_content, flags=re.IGNORECASE)

        for block in blocks[1:]:
            block = block.strip()
            # Extract table name (handles optional schema prefix: public.customers)
            name_match = re.match(r'[`"]?([a-zA-Z0-9_.]+)[`"]?\s*\(', block)
            if not name_match:
                continue

            raw_name   = name_match.group(1)
            table_name = raw_name.split('.')[-1].lower().strip('`"')

            # Extract body between the outermost ( )
            open_pos = block.index('(')
            depth, close_pos = 0, -1
            for i, ch in enumerate(block[open_pos:], start=open_pos):
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
                    if depth == 0:
                        close_pos = i
                        break
            if close_pos == -1:
                continue

            body    = block[open_pos + 1:close_pos]
            columns = []

            for raw_line in body.split('\n'):
                line = raw_line.strip().rstrip(',').strip()
                if not line or line.startswith('--'):
                    continue

                upper = line.upper()

                # Foreign key constraint
                if 'FOREIGN KEY' in upper:
                    fk = re.search(
                        r'FOREIGN\s+KEY\s*\(([`"\w]+)\)\s*REFERENCES\s+[`"]?([a-zA-Z0-9_.]+)[`"]?\s*\(([`"\w]+)\)',
                        line, re.IGNORECASE
                    )
                    if fk:
                        foreign_keys.append({
                            "sourceTable":  table_name,
                            "sourceColumn": fk.group(1).strip('`"').lower(),
                            "targetTable":  fk.group(2).split('.')[-1].strip('`"').lower(),
                            "targetColumn": fk.group(3).strip('`"').lower(),
                        })
                    continue

                # Skip constraint/index lines (incl. mysqldump FULLTEXT/SPATIAL/FOREIGN)
                if re.match(r'^(PRIMARY\s+KEY|UNIQUE|FULLTEXT|SPATIAL|KEY|INDEX|CONSTRAINT|CHECK|FOREIGN|REFERENCES)\b', upper):
                    continue

                # Column definition
                col_match = re.match(r'[`"]?([a-zA-Z_][a-zA-Z0-9_]*)[`"]?\s+([a-zA-Z][a-zA-Z0-9_()]+)', line)
                if not col_match:
                    continue

                col_name  = col_match.group(1).lower()
                data_type = col_match.group(2).upper()

                # Auto-generated columns don't need to be supplied on insert —
                # MySQL AUTO_INCREMENT, SQLite AUTOINCREMENT, Postgres SERIAL /
                # GENERATED ... AS IDENTITY. Used to suppress false "required" tests.
                is_auto = bool(re.search(r'AUTO_?INCREMENT|SERIAL|GENERATED\s+.*AS\s+IDENTITY', upper))

                columns.append({
                    "id":             f"col_{table_name}_{col_name}",
                    "name":           col_name,
                    "dataType":       data_type,
                    "isPrimaryKey":   'PRIMARY KEY' in upper,
                    "isNullable":     'NOT NULL' not in upper,
                    "hasDefault":     'DEFAULT' in upper,
                    "isAutoIncrement": is_auto,
                    "isUnique":       'UNIQUE' in upper,
                    "tableName":      table_name,
                })

            tables.append({
                "id":         f"table_{table_name}",
                "name":       table_name,
                "columns":    columns,
                "columnCount": len(columns),
            })

        # ── Foreign keys declared via ALTER TABLE (mysqldump puts FKs here) ──
        #   ALTER TABLE `child`
        #     ADD CONSTRAINT `fk` FOREIGN KEY (`col`) REFERENCES `parent` (`pcol`) ...
        current_alter = None
        for raw in sql_content.split('\n'):
            ln = raw.strip()
            am = re.match(r'ALTER\s+TABLE\s+[`"]?([a-zA-Z0-9_.]+)[`"]?', ln, re.IGNORECASE)
            if am:
                current_alter = am.group(1).split('.')[-1].strip('`"').lower()
            fk = re.search(
                r'FOREIGN\s+KEY\s*\(\s*[`"]?(\w+)[`"]?\s*\)\s*REFERENCES\s+'
                r'[`"]?([a-zA-Z0-9_.]+)[`"]?\s*\(\s*[`"]?(\w+)[`"]?\s*\)',
                ln, re.IGNORECASE
            )
            if fk and current_alter:
                foreign_keys.append({
                    "sourceTable":  current_alter,
                    "sourceColumn": fk.group(1).strip('`"').lower(),
                    "targetTable":  fk.group(2).split('.')[-1].strip('`"').lower(),
                    "targetColumn": fk.group(3).strip('`"').lower(),
                })

        # Deduplicate foreign keys
        seen_fk, deduped_fk = set(), []
        for fk in foreign_keys:
            k = (fk["sourceTable"], fk["sourceColumn"], fk["targetTable"], fk["targetColumn"])
            if k not in seen_fk:
                seen_fk.add(k)
                deduped_fk.append(fk)

        return {"tables": tables, "foreign_keys": deduped_fk}

    # ─── Frontend File Parsing ─────────────────────────────────────────────────

    def parse_frontend_file(self, file: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a single JSX/TSX/JS frontend file for pages, fields, and API calls."""
        content = file.get('content', '')
        path    = file.get('path', file.get('abs_path', ''))
        name    = file.get('name', os.path.basename(path))
        lines   = content.split('\n')

        result = {"pages": [], "fields": [], "api_calls": [], "components": [], "routes": []}

        # Extract real React Router route→component definitions. Used to give pages
        # their true route and to resolve navigation targets to the right page:
        #   <Route path="/products" element={<Products />} />
        #   { path: "/products", element: <Products /> }
        for rp, comp in re.findall(
                r'<Route\b[^>]*?path=["\']([^"\']*)["\'][^>]*?element=\{\s*<\s*([A-Za-z0-9_]+)', content):
            result["routes"].append({"path": rp, "component": comp})
        for rp, comp in re.findall(
                r'path:\s*["\']([^"\']*)["\'][^}]*?element:\s*<\s*([A-Za-z0-9_]+)', content):
            result["routes"].append({"path": rp, "component": comp})

        # Files that are NOT user-facing pages/screens must not become Page nodes
        # (config, type declarations, build/setup entry). Routes above are still kept.
        lower_name = name.lower()
        if (re.search(r'\.config\.[cm]?[jt]sx?$', lower_name)
                or lower_name.endswith('.d.ts')
                or lower_name in {'vite-env.d.ts', 'service-worker.js', 'sw.js', 'setup.ts', 'setup.js'}):
            return result

        # Route detection — try multiple patterns before falling back to filename
        # 1. Explicit comment: // Route: /path
        route_match = re.search(r'//\s*Route:\s*([^\n]+)', content)
        # 2. React Router <Route path="/..."> or path="/..."
        if not route_match:
            route_match = re.search(r'path=["\']([/][^"\']+)["\']', content)
        # 3. Next.js/Nuxt filename-based routing (pages/customers/create.tsx → /customers/create)
        if not route_match:
            route_path = '/' + re.sub(r'\.[^.]+$', '', name.lower()).replace('page', '').replace('view', '').replace('_', '-')
        else:
            route_path = route_match.group(1).strip()

        page_id = f"page_{re.sub(r'[^a-zA-Z0-9]', '_', name)}"
        result["pages"].append({
            "id":        page_id,
            "type":      "Page",
            "name":      re.sub(r'\.[^.]+$', '', name),
            "routePath": route_path,
            "filePath":  path,
            "lineStart": 1,
            "lineEnd":   len(lines),
        })

        # ── Field detection (raw HTML inputs + React controlled/component fields) ──
        # Real apps rarely use <input id="field-x">; they bind component inputs
        # (<Input>/<Select>/<Textarea>) to a form-state object. Recover field names
        # from all the common patterns, deduped per page.
        seen_fields = set()

        def _line_of(pos: int) -> int:
            return content.count('\n', 0, pos) + 1

        def _add_field(fname: str, pos: int, ftype: str = "text"):
            fname = (fname or "").strip()
            if not fname or fname in seen_fields or fname in ('undefined', 'null', 'true', 'false'):
                return
            seen_fields.add(fname)
            result["fields"].append({
                "id":        f"field_{page_id}_{fname}",
                "type":      "Field",
                "fieldName": fname,
                "fieldType": ftype,
                "required":  False,
                "pageId":    page_id,
                "filePath":  path,
                "lineStart": _line_of(pos),
            })

        # 1. Raw HTML inputs (may span lines): <input id="x"> / <select name="x">
        for m in re.finditer(r'<(?:input|select|textarea)\b[^>]*?\b(?:id|name)=["\']([^"\']+)["\']',
                             content, re.IGNORECASE):
            _add_field(m.group(1), m.start())
        # 2. Form-state setter helper: set("first_name", ...)  (not obj.set / reset)
        for m in re.finditer(r'(?<![.\w])set\(\s*["\']([a-zA-Z_]\w*)["\']', content):
            _add_field(m.group(1), m.start())
        # 3. react-hook-form: register("email")
        for m in re.finditer(r'\bregister\(\s*["\']([a-zA-Z_]\w*)["\']', content):
            _add_field(m.group(1), m.start())
        # 4. Controlled bindings: value={form.x} / value={state.x} / value={values.x}
        for m in re.finditer(r'value=\{\s*(?:form|state|values|data|fields)\.([a-zA-Z_]\w*)', content):
            _add_field(m.group(1), m.start())

        for idx, line in enumerate(lines, start=1):
            # fetch() / axios call detection
            if 'fetch(' in line or 'axios.' in line:
                # fetch('/endpoint', { method: 'POST' ...})
                m2 = re.search(r"fetch\(['\"]([^'\"]+)['\"].*?method:\s*['\"]([^'\"]+)['\"]", line)
                m1 = re.search(r"fetch\(['\"]([^'\"]+)['\"]", line)
                ax = re.search(r"axios\.(get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]", line)
                if m2:
                    result["api_calls"].append({"endpoint": m2.group(1), "method": m2.group(2).upper(), "pageId": page_id, "filePath": path, "lineStart": idx})
                elif m1:
                    result["api_calls"].append({"endpoint": m1.group(1), "method": "GET", "pageId": page_id, "filePath": path, "lineStart": idx})
                elif ax:
                    result["api_calls"].append({"endpoint": ax.group(2), "method": ax.group(1).upper(), "pageId": page_id, "filePath": path, "lineStart": idx})

        return result

    # ─── Backend File Parsing ──────────────────────────────────────────────────

    @staticmethod
    def _normalize_route(p: str) -> str:
        """Normalise a discovered route: strip regex anchors, convert Django named
        groups to ``{name}``, ensure a single leading slash, drop trailing slash."""
        p = (p or "").strip().lstrip('^').rstrip('$')
        p = re.sub(r'\(\?P<(\w+)>[^)]*\)', r'{\1}', p)   # Django (?P<id>\d+) → {id}
        p = re.sub(r'<[^:>]+:(\w+)>', r'{\1}', p)         # Django <int:id>   → {id}
        p = re.sub(r':([A-Za-z_]\w*)', r'{\1}', p)        # Express/NestJS :id → {id}
        if not p.startswith('/'):
            p = '/' + p
        return re.sub(r'/+$', '', p) or '/'

    def _extra_framework_routes(self, line: str, path: str) -> List[tuple]:
        """
        Detect endpoints from frameworks the primary matchers don't cover:
        Flask/FastAPI ``.route(methods=[...])``, NestJS/Micronaut ``@Get('/x')``,
        Spring ``@RequestMapping``, Django ``path()/re_path()``, Rails routes
        (``get 'x'`` + ``resources :x``) and Go (gin/echo/mux). Extension-gated to
        keep one language's syntax from matching another's. Returns [(METHOD, path)].
        """
        ext  = os.path.splitext(path)[1].lower()
        base = os.path.basename(path).lower()
        out: List[tuple] = []
        norm = self._normalize_route

        if ext == '.py':
            m = _RX_FLASK_ROUTE.search(line)
            if m:
                methods = re.findall(r'["\'](\w+)["\']', m.group(2) or '') or ['GET']
                for meth in methods:
                    out.append((meth.upper(), norm(m.group(1))))
            for dm in _RX_DJANGO_PATH.finditer(line):
                raw = dm.group(1)
                if raw is not None and not raw.lstrip('^/').startswith(('admin', 'static', 'media')):
                    out.append(('GET', norm(raw)))

        elif ext in ('.ts', '.js', '.mjs'):
            vm = _RX_VERB_DECORATOR.search(line)
            if vm:
                out.append((vm.group(1).upper(), norm(vm.group(2) or '/')))

        elif ext in ('.java', '.kt'):
            sm = _RX_SPRING_REQMAP.search(line)
            if sm:
                body = sm.group(1)
                pm   = _RX_STRING_LIT.search(body)
                meth = re.search(r'RequestMethod\.(GET|POST|PUT|DELETE|PATCH)', body, re.I)
                if pm:
                    out.append(((meth.group(1).upper() if meth else 'GET'), norm(pm.group(1))))

        elif ext == '.rb' or 'routes' in base:
            rm = _RX_RAILS_VERB.search(line)
            if rm:
                out.append((rm.group(1).upper(), norm(rm.group(2))))
            res = _RX_RAILS_RES.search(line)
            if res:
                n = res.group(1)
                out += [('GET', f'/{n}'), ('POST', f'/{n}'), ('GET', f'/{n}/{{id}}'),
                        ('PUT', f'/{n}/{{id}}'), ('DELETE', f'/{n}/{{id}}')]

        elif ext == '.go':
            gm = _RX_GO_ROUTE.search(line)
            if gm:
                verb = gm.group(1).upper()
                out.append((verb if verb in ('GET', 'POST', 'PUT', 'DELETE', 'PATCH') else 'GET',
                            norm(gm.group(2))))
        return out

    def parse_backend_file(self, file: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a backend .ts/.py/.java file for classes, endpoints, and SQL queries."""
        content = file.get('content', '')
        path    = file.get('path', '')
        lines   = content.split('\n')

        result = {"symbols": [], "api_endpoints": [], "db_queries": [], "calls": []}
        current_class = None

        for idx, line in enumerate(lines, start=1):
            stripped   = line.strip()
            is_comment = stripped.startswith(('//', '*', '/*', '#'))

            # Class detection (TypeScript/Java/Python) — never inside a comment
            cls_m = None if is_comment else re.search(r'(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z0-9_]+)', line)
            if cls_m:
                current_class = cls_m.group(1)
                sym_type = "Class"
                if "Controller" in current_class: sym_type = "Controller"
                elif "Service"    in current_class: sym_type = "Service"
                elif "Repository" in current_class: sym_type = "Repository"
                result["symbols"].append({
                    "id":       f"symbol_{current_class}",
                    "type":     sym_type,
                    "name":     current_class,
                    "filePath": path,
                    "lineStart": idx,
                })

            # REST route comment e.g.  // POST /api/v1/customers
            route_m = re.search(r'//\s*(GET|POST|PUT|DELETE|PATCH)\s+(/[^\s\n]+)', line)
            if route_m:
                method, ep_path = route_m.group(1), route_m.group(2)
                result["api_endpoints"].append({
                    "id":             f"api_ep_{method}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                    "method":         method,
                    "path":           ep_path,
                    "controllerName": current_class,
                    "filePath":       path,
                    "lineStart":      idx,
                })

            # Decorator-based routes (@app.post, @router.get, @PostMapping, @RequestMapping)
            dec_m = re.search(r'@(?:app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)["\']', line, re.IGNORECASE)
            if not dec_m:
                dec_m = re.search(r'@(?:Post|Get|Put|Delete|Patch)Mapping\(["\']([^"\']+)["\']', line, re.IGNORECASE)
            
            # Express/Node.js routes (app.post('/path'), router.get('/path'))
            expr_m = re.search(r'(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*[\'"]([^\'"]+)[\'"]', line, re.IGNORECASE)

            # PHP router routes: $router->get('/products/{id}', [ProductController::class, 'show'], true)
            php_m = re.search(
                r'\$\w+->(get|post|put|delete|patch)\s*\(\s*[\'"]([^\'"]+)[\'"]\s*,\s*\[\s*([A-Za-z0-9_\\]+)::class',
                line, re.IGNORECASE
            )
            # PHP router without a [Class::class, ...] handler (fallback)
            php_bare = None
            if not php_m:
                php_bare = re.search(r'\$\w+->(get|post|put|delete|patch)\s*\(\s*[\'"]([^\'"]+)[\'"]', line, re.IGNORECASE)

            if php_m:
                method, ep_path = php_m.group(1).upper(), php_m.group(2)
                ctrl = php_m.group(3).split('\\')[-1]  # strip any PHP namespace prefix
                # protected route? trailing "..., true" (or a string scope) after the handler
                route_auth = bool(re.search(r'\]\s*,\s*(true|["\'])', line, re.IGNORECASE))
                result["api_endpoints"].append({
                    "id":             f"api_ep_{method}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                    "method":         method,
                    "path":           ep_path,
                    "controllerName": ctrl,
                    "auth":           route_auth,
                    "filePath":       path,
                    "lineStart":      idx,
                })
            elif php_bare:
                method, ep_path = php_bare.group(1).upper(), php_bare.group(2)
                result["api_endpoints"].append({
                    "id":             f"api_ep_{method}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                    "method":         method,
                    "path":           ep_path,
                    "controllerName": current_class or "Router",
                    "filePath":       path,
                    "lineStart":      idx,
                })
            elif dec_m:
                # Handle both 2-group and 1-group matches
                if dec_m.lastindex == 2:
                    method, ep_path = dec_m.group(1).upper(), dec_m.group(2)
                else:
                    method  = "POST"
                    ep_path = dec_m.group(1)
                result["api_endpoints"].append({
                    "id":             f"api_ep_{method}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                    "method":         method,
                    "path":           ep_path,
                    "controllerName": current_class or "Global",
                    "filePath":       path,
                    "lineStart":      idx,
                })
            elif expr_m:
                method, ep_path = expr_m.group(1).upper(), expr_m.group(2)
                result["api_endpoints"].append({
                    "id":             f"api_ep_{method}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                    "method":         method,
                    "path":           ep_path,
                    "controllerName": current_class or "ExpressRouter",
                    "filePath":       path,
                    "lineStart":      idx,
                })
            elif not is_comment:
                # No PHP/Express/decorator hit — try the broader framework matchers
                # (Flask/FastAPI, NestJS, Spring, Django, Rails, Go), extension-gated.
                for meth, ep_path in self._extra_framework_routes(line, path):
                    result["api_endpoints"].append({
                        "id":             f"api_ep_{meth}_{re.sub(r'[^a-zA-Z0-9]','_', ep_path)}",
                        "method":         meth,
                        "path":           ep_path,
                        "controllerName": current_class or "Router",
                        "filePath":       path,
                        "lineStart":      idx,
                    })

            # SQL query detection — take the TABLE from the right clause per op
            # (SELECT/DELETE → after FROM, INSERT → after INTO, UPDATE → after UPDATE)
            if not is_comment:
                op_m = re.search(r'\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|SELECT)\b', line, re.IGNORECASE)
                if op_m:
                    op = re.sub(r'\s+', '_', op_m.group(1).upper())  # INSERT_INTO / DELETE_FROM / UPDATE / SELECT
                    table = None
                    if op.startswith('SELECT') or op.startswith('DELETE'):
                        fm = re.search(r'\bFROM\s+[`"]?([a-zA-Z0-9_]+)', line, re.IGNORECASE)
                        table = fm.group(1) if fm else None
                    elif op.startswith('INSERT'):
                        im = re.search(r'INSERT\s+INTO\s+[`"]?([a-zA-Z0-9_]+)', line, re.IGNORECASE)
                        table = im.group(1) if im else None
                    else:  # UPDATE
                        um = re.search(r'UPDATE\s+[`"]?([a-zA-Z0-9_]+)', line, re.IGNORECASE)
                        table = um.group(1) if um else None
                    if table:
                        result["db_queries"].append({
                            "id":             f"db_q_{len(result['db_queries'])+1}",
                            "operation":      'SELECT' if op.startswith('SELECT') else op,
                            "tableName":      table.lower(),
                            "repositoryName": current_class,
                            "filePath":       path,
                            "lineStart":      idx,
                            "rawSql":         stripped[:200],
                        })

            # Class-to-class calls: X::method(...) / new X(...) — fills the CALLS bridge
            if current_class and not is_comment:
                callees = set(re.findall(r'\b([A-Z][A-Za-z0-9_]+)::', line))
                callees |= set(re.findall(r'\bnew\s+([A-Z][A-Za-z0-9_]+)', line))
                for callee in callees:
                    if callee != current_class and callee not in _CALL_DENYLIST:
                        result["calls"].append({
                            "caller": current_class, "callee": callee,
                            "filePath": path, "lineStart": idx,
                        })

        return result

    # ── OpenAPI / Test / Trace Parsing ─────────────────────────────────────────

    def parse_openapi_schema(self, content: str) -> List[Dict[str, Any]]:
        """Extract API endpoints from OpenAPI/Swagger YAML/JSON."""
        endpoints = []
        try:
            import yaml
            spec = yaml.safe_load(content)
            paths = spec.get('paths', {})
            for path, methods in paths.items():
                for method, details in methods.items():
                    if method.lower() not in ['get', 'post', 'put', 'delete', 'patch']:
                        continue
                    endpoints.append({
                        "id": f"api_ep_{method.upper()}_{re.sub(r'[^a-zA-Z0-9]','_', path)}",
                        "method": method.upper(),
                        "path": path,
                        "controllerName": details.get('operationId', 'Unknown'),
                        "filePath": "openapi.yaml",
                        "lineStart": 1
                    })
        except Exception as e:
            _record_parse_error("openapi_endpoints", e)
        return endpoints

    def parse_test_file(self, file: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Parse test files for existing scenarios (Jest/Pytest)."""
        content = file.get('content', '')
        path    = file.get('path', '')
        lines   = content.split('\n')
        tests = []
        for idx, line in enumerate(lines, start=1):
            m = re.search(r'(test|it)\s*\(\s*[\'"]([^\'"]+)[\'"]', line) or re.search(r'def\s+(test_[a-zA-Z0-9_]+)\s*\(', line)
            if m:
                tests.append({
                    "id": f"test_{len(tests)}",
                    "title": m.group(2) if m.lastindex == 2 else m.group(1),
                    "filePath": path,
                    "lineStart": idx
                })
        return tests

    def parse_trace_file(self, file: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Parse execution traces (HAR). Captures method, URL path, the request-body
        field keys, and the referring page — the raw material for deterministic
        field→API (SUBMITS_TO) links built from *observed* traffic, not guesses."""
        import urllib.parse as _url
        content = file.get('content', '')
        traces = []
        if not file.get('name', '').endswith('.har'):
            return traces
        try:
            har = json.loads(content)
        except Exception as e:
            _record_parse_error("har_parse", e, file.get('name', ''))
            return traces

        for e in har.get('log', {}).get('entries', []):
            req    = e.get('request', {}) or {}
            method = (req.get('method') or '').upper()
            url    = req.get('url') or ''
            if not method or not url:
                continue
            path = _url.urlparse(url).path or url

            # request-body field keys (JSON, form-urlencoded, or multipart)
            body_keys = []
            post   = req.get('postData', {}) or {}
            params = post.get('params')
            if params:
                body_keys = [p.get('name') for p in params if p.get('name')]
            elif post.get('text'):
                text = post['text']
                try:
                    obj = json.loads(text)
                    if isinstance(obj, dict):
                        body_keys = list(obj.keys())
                    elif isinstance(obj, list) and obj and isinstance(obj[0], dict):
                        body_keys = list(obj[0].keys())
                except Exception:
                    try:
                        body_keys = [k for k, _ in _url.parse_qsl(text)]
                    except Exception:
                        body_keys = []

            # referring page → tells us which form submitted
            referer = ''
            for h in req.get('headers', []):
                if h.get('name', '').lower() == 'referer':
                    referer = _url.urlparse(h.get('value', '')).path
                    break

            traces.append({
                "method":   method,
                "url":      url,
                "path":     path,
                "status":   e.get('response', {}).get('status'),
                "bodyKeys": [k for k in body_keys if k],
                "referer":  referer,
            })
        return traces

    # ─── Full Repo Analysis ────────────────────────────────────────────────────

    def analyze_repository(self, scan_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze all files from a scan_result (output of file_scanner.scan_repository).
        Returns merged frontend, backend, and DB analysis suitable for graph building.
        """
        all_pages       = []
        all_fields      = []
        all_api_calls   = []
        all_symbols     = []
        all_api_endpoints = []
        all_db_queries  = []

        all_routes = []
        for f in scan_result.get("frontend_files", []):
            parsed = self.parse_frontend_file(f)
            all_pages.extend(parsed["pages"])
            all_fields.extend(parsed["fields"])
            all_api_calls.extend(parsed["api_calls"])
            all_routes.extend(parsed.get("routes", []))

        # Give each page its REAL route when a <Route> maps its component name.
        comp_to_route = {}
        for r in all_routes:
            comp, rp = r.get("component", ""), r.get("path", "")
            if comp and rp and comp not in comp_to_route:
                comp_to_route[comp] = rp if rp.startswith('/') else '/' + rp
        for p in all_pages:
            if p["name"] in comp_to_route:
                p["routePath"] = comp_to_route[p["name"]]

        all_calls = []
        for f in scan_result.get("backend_files", []):
            parsed = self.parse_backend_file(f)
            all_symbols.extend(parsed["symbols"])
            all_api_endpoints.extend(parsed["api_endpoints"])
            all_db_queries.extend(parsed["db_queries"])
            all_calls.extend(parsed.get("calls", []))

        for f in scan_result.get("openapi_files", []):
            all_api_endpoints.extend(self.parse_openapi_schema(f.get("content", "")))

        test_scenarios = []
        for f in scan_result.get("test_files", []):
            test_scenarios.extend(self.parse_test_file(f))

        runtime_traces = []
        for f in scan_result.get("trace_files", []):
            runtime_traces.extend(self.parse_trace_file(f))

        # Merge schema SQL content from all schema files
        combined_sql = "\n".join(f.get("content", "") for f in scan_result.get("schema_files", []))
        db_result    = self.parse_sql_schema(combined_sql) if combined_sql.strip() else {"tables": [], "foreign_keys": []}

        return {
            "pages":          all_pages,
            "fields":         all_fields,
            "apiCalls":       all_api_calls,
            "symbols":        all_symbols,
            "apiEndpoints":   all_api_endpoints,
            "dbQueries":      all_db_queries,
            "existingTests":  test_scenarios,
            "runtimeTraces":  runtime_traces,
            "filesAnalyzed":  scan_result.get("total_files_scanned", 0),
            "linesOfCode":    scan_result.get("total_lines_of_code", 0),
            "dbResult":       db_result,
            "routes":         all_routes,
            "calls":          all_calls,
            "_raw_frontend_files": scan_result.get("frontend_files", []),
            "_raw_backend_files":  scan_result.get("backend_files", []),
        }

    # ─── Test Case Generation ──────────────────────────────────────────────────

    def generate_test_cases(self, analysis: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """
        Generate evidence-based test cases.
        When `analysis` is passed, generates tests from actual discovered nodes.
        Falls back to demo ERP tests when called without analysis.
        """
        if analysis:
            return self._generate_from_analysis(analysis)
        return self._demo_test_cases()

    # HTTP error codes a handler may explicitly return (white-box signal)
    _ERR_CODE_RE = re.compile(
        r'(?:Response::error|->\s*status|res\.status|http_response_code|status_code)\s*'
        r'\([^;)]*?\b([45]\d\d)\b|,\s*([45]\d\d)\s*\)')

    def _extract_error_codes(self, content: str):
        """White-box: the set of HTTP error codes the code explicitly returns → {code: line}."""
        codes = {}
        for m in self._ERR_CODE_RE.finditer(content):
            code = int(m.group(1) or m.group(2))
            if code in (400, 401, 403, 404, 409, 422, 429):
                codes.setdefault(code, content.count('\n', 0, m.start()) + 1)
        return codes

    def _generate_from_analysis(self, analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate a BLACK-BOX test matrix (positive / negative / boundary / auth /
        not-found) plus WHITE-BOX conditions derived from real controller guards and
        DB foreign keys. Every test is tagged with the technique + category it covers."""
        tests = []
        n = [0]

        # controllerName -> its source file content (for white-box guard reading)
        sym_file = {s["name"]: s.get("filePath", "") for s in analysis.get("symbols", [])}
        file_content = {f.get("path", ""): f.get("content", "")
                        for f in analysis.get("_raw_backend_files", [])}

        def add(title, category, technique, assertions, evidence=None, priority="high"):
            n[0] += 1
            tests.append({
                "id":            f"TEST-{n[0]:04d}",
                "title":         title,
                "category":      category,
                "technique":     technique,          # BLACK_BOX | WHITE_BOX
                "priority":      priority,
                "status":        "CONFIRMED",
                "confidence":    0.9,
                "steps":         [],
                "assertions":    assertions,
                "sourceEvidence": evidence or [],
            })

        for ep in analysis.get("apiEndpoints", []):
            method = ep["method"].upper()
            path   = ep["path"]
            ep_str = f"{method} {path}"
            ok     = 201 if method == "POST" else 200
            has_param = bool(re.search(r'[:{][a-zA-Z_]', path))
            auth   = ep.get("auth", False)
            ev     = [{"file": ep.get("filePath", ""), "line": ep.get("lineStart", 0)}]

            # ── BLACK-BOX: happy path (valid-input equivalence class) ──
            add(f"[Happy path] {ep_str} → {ok}", "Functional / Positive", "BLACK_BOX",
                [{"type": "API", "endpoint": ep_str, "expectedStatusCode": ok}], ev)

            # ── BLACK-BOX: auth boundary (protected route, no token → 401) ──
            if auth:
                add(f"[Auth] {ep_str} without token → 401", "Security / Auth", "BLACK_BOX",
                    [{"type": "API", "endpoint": ep_str, "expectedStatusCode": 401,
                      "noAuth": True, "authSensitive": False}], ev)

            # ── BLACK-BOX: not-found (bogus id in path → 404) ──
            if has_param and method in ("GET", "PUT", "DELETE", "PATCH"):
                bogus = re.sub(r'[:{][^/}]+\}?', '999999999', path)
                add(f"[Not found] {method} {bogus} → 404", "Functional / Negative", "BLACK_BOX",
                    [{"type": "API", "endpoint": f"{method} {bogus}", "expectedStatusCode": 404}], ev)

            # ── BLACK-BOX: input validation (empty/malformed body → 400) ──
            if method in ("POST", "PUT", "PATCH"):
                add(f"[Validation] {ep_str} with empty body → 400", "Validation / Boundary", "BLACK_BOX",
                    [{"type": "API", "endpoint": ep_str, "expectedStatusCode": 400, "body": {}}], ev)

            # ── WHITE-BOX: negatives tied to real guards in the controller code ──
            content = file_content.get(sym_file.get(ep.get("controllerName", ""), ""), "")
            if content:
                for code, ln in list(self._extract_error_codes(content).items())[:3]:
                    add(f"[Branch] {ep_str} has a {code} error path (cover it)",
                        "White-box / Branch coverage", "WHITE_BOX",
                        [{"type": "API", "endpoint": ep_str, "expectedStatusCode": code, "softMatch": True}],
                        [{"file": sym_file.get(ep.get("controllerName", ""), ""), "line": ln}], "medium")

        # ── DB: schema (black-box) + referential integrity from FKs (white-box) ──
        db = analysis.get("dbResult", {})
        for table in db.get("tables", []):
            add(f"[Schema] `{table['name']}` exists & is queryable", "Database / Schema", "BLACK_BOX",
                [{"type": "DB", "table": table["name"], "checkType": "schema_exists"}])
        for fk in db.get("foreign_keys", []):
            add(f"[Integrity] {fk['sourceTable']}.{fk['sourceColumn']} → {fk['targetTable']}.{fk['targetColumn']}",
                "Database / Referential integrity", "WHITE_BOX",
                [{"type": "DB", "table": fk["sourceTable"], "checkType": "fk_integrity",
                  "column": fk["sourceColumn"], "refTable": fk["targetTable"], "refColumn": fk["targetColumn"]}],
                priority="medium")

        # ── UI (Playwright): each form loads, renders, accepts input, submits ──
        def fake_value(fname: str) -> str:
            nm = fname.lower()
            if 'email' in nm:                                                return 'test@example.com'
            if 'phone' in nm or 'mobile' in nm:                              return '9999999999'
            if 'date' in nm:                                                 return '2025-01-01'
            if 'gstin' in nm:                                                return '22AAAAA0000A1Z5'
            if 'pan' in nm:                                                  return 'ABCDE1234F'
            if any(k in nm for k in ('amount','price','qty','quantity','count','number','pincode','limit','salary','balance','rate','fee','discount')):
                return '10'
            return f'Test {fname}'

        fields_by_page = {}
        for f in analysis.get("fields", []):
            fields_by_page.setdefault(f.get("pageId"), []).append(f)
        page_by_id = {p["id"]: p for p in analysis.get("pages", [])}

        for pid, flds in fields_by_page.items():
            page = page_by_id.get(pid)
            if not page:
                continue
            route = page.get("routePath", "")
            if not route or not route.startswith("/"):
                continue
            steps = [{"step": 1, "action": "navigate", "route": route}]
            for i, fl in enumerate(flds[:12], start=2):
                steps.append({"step": i, "action": f"fill {fl['fieldName']}",
                              "target": fl["fieldName"], "value": fake_value(fl["fieldName"])})
            steps.append({"step": len(steps) + 1, "action": "click submit", "target": "submit"})

            add(f"[UI] {page['name']} form loads, accepts {len(flds)} fields & submits",
                "UI / Form", "BLACK_BOX",
                [{"type": "UI", "checkType": "renders"},
                 {"type": "UI", "checkType": "accessibility"}],
                [{"file": page.get("filePath", ""), "line": 1}])
            tests[-1]["steps"] = steps          # attach the browser steps

        return tests

    def _demo_test_cases(self) -> List[Dict[str, Any]]:
        """Fallback demo test cases for the embedded ERP sample."""
        return [
            {
                "id": "TEST-CUST-001",
                "title": "Create customer and verify DB persistence",
                "category": "Functional / End-to-End",
                "priority": "high", "status": "CONFIRMED", "confidence": 0.98,
                "steps": [
                    {"step": 1, "action": "navigate to /customer/create", "target": "/customer/create"},
                    {"step": 2, "action": "fill customer name", "target": "field-customer-name", "value": "Acme Logistics Inc."},
                    {"step": 3, "action": "fill email", "target": "field-email", "value": "billing@acme.com"},
                    {"step": 4, "action": "fill credit limit", "target": "field-credit-limit", "value": "25000"},
                    {"step": 5, "action": "click submit", "target": "btn-submit-customer"},
                ],
                "testData": {"name": "Acme Logistics Inc.", "email": "billing@acme.com", "creditLimit": 25000},
                "assertions": [
                    {"type": "API", "endpoint": "POST /api/v1/customers", "expectedStatusCode": 201},
                    {"type": "DB",  "table": "customers", "column": "credit_limit", "value": 25000},
                ],
            },
            {
                "id": "TEST-CUST-002",
                "title": "Reject customer with negative credit limit",
                "category": "Validation / Boundary",
                "priority": "medium", "status": "CONFIRMED", "confidence": 0.95,
                "steps": [
                    {"step": 1, "action": "navigate to /customer/create", "target": "/customer/create"},
                    {"step": 2, "action": "fill credit limit", "target": "field-credit-limit", "value": "-5000"},
                    {"step": 3, "action": "click submit", "target": "btn-submit-customer"},
                ],
                "testData": {"creditLimit": -5000},
                "assertions": [
                    {"type": "API", "endpoint": "POST /api/v1/customers", "expectedStatusCode": 400},
                    {"type": "DB",  "table": "customers", "condition": "credit_limit = -5000", "expectedRowsCount": 0},
                ],
            },
            {
                "id": "TEST-SALES-001",
                "title": "Sales Order Grand Total transformation: qty=5, price=100 → total=550",
                "category": "Integration / Transformation",
                "priority": "high", "status": "CONFIRMED", "confidence": 0.97,
                "steps": [
                    {"step": 1, "action": "navigate to /sales/order/create", "target": "/sales/order/create"},
                    {"step": 2, "action": "fill quantity", "target": "field-quantity", "value": "5"},
                    {"step": 3, "action": "assert text #field-grand-total contains 550", "target": "field-grand-total"},
                    {"step": 4, "action": "click confirm order", "target": "btn-confirm-order"},
                ],
                "testData": {"quantity": 5, "unitPrice": 100, "expectedGrandTotal": 550},
                "assertions": [
                    {"type": "UI",  "selector": "#field-grand-total", "expectedText": "550"},
                    {"type": "API", "endpoint": "POST /api/v1/sales-orders", "expectedStatusCode": 201},
                    {"type": "DB",  "table": "sales_orders", "column": "grand_total", "value": 550.0},
                ],
            },
        ]
