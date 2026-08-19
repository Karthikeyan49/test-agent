"""
System Graph Builder & Analyzer
Constructs graph from parsed analysis, provides:
  - Bidirectional lineage traversal
  - Impact analysis
  - Real workflow discovery via BFS/DFS on graph paths
  - Page-to-page navigation detection
  - Component tree construction
  - Graph-grounded NL query context building
"""

import json
import re
from typing import Dict, Any, List, Set, Tuple, Optional


def _normalize_api_path(p: str) -> str:
    """Normalize a route for cross-layer matching: collapse path params to {id}
    and strip a leading api/version prefix (/api, /api/v1, /v2, /rest ...)."""
    p = re.sub(r'\{[^}]+\}|:[A-Za-z_]\w*', '{id}', p or '')
    p = p.strip().rstrip('/')
    p = re.sub(r'^/?(?:api|rest)(?:/v?\d+)?', '', p, flags=re.IGNORECASE)
    p = re.sub(r'^/?v\d+(?=/)', '', p, flags=re.IGNORECASE)
    if not p.startswith('/'):
        p = '/' + p
    return p.lower()


def _api_path_match(ep_path: str, call_endpoint: str) -> bool:
    """True if a frontend call endpoint refers to the same route as a declared
    endpoint, tolerating ONLY a differing api/version base-path prefix.

    F7: normalization already strips the api/version prefix from both sides, so a
    legitimate base-path difference (/api/v1/customers vs /customers) collapses to
    an EXACT match. We therefore require equality after normalization and no longer
    do a loose `endswith` — which previously bound /api/admin/users to /users and
    /customers/orders to /orders (wrong endpoint → wrong cross-layer test)."""
    if (ep_path or '') == (call_endpoint or ''):
        return True
    a, b = _normalize_api_path(ep_path), _normalize_api_path(call_endpoint)
    return bool(a) and a == b


class SystemGraphBuilder:
    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, Any]] = []
        self.edge_index = 0

    # ── Node/Edge Management ──────────────────────────────────────────────

    def add_node(self, node_id: str, node_type: str, name: str,
                 category: str, metadata: Dict[str, Any] = None):
        self.nodes[node_id] = {
            "id":       node_id,
            "type":     node_type,
            "name":     name,
            "category": category,
            "metadata": metadata or {},
        }

    def add_edge(self, source: str, target: str, relationship: str,
                 confidence: float = 1.0, discovery_method: str = "STATIC_ANALYSIS",
                 source_file: str = "", source_line: int = 0, reason: str = ""):
        self.edge_index += 1
        self.edges.append({
            "id":              f"edge_{self.edge_index}",
            "source":          source,
            "target":          target,
            "relationship":    relationship,
            "confidence":      confidence,
            "discoveryMethod": discovery_method,
            "sourceFile":      source_file,
            "sourceLine":      source_line,
            "reason":          reason,
        })

    # ── Build from Analysis ───────────────────────────────────────────────

    def build_from_analysis(self, analysis: Dict[str, Any]):
        """Build full graph from engine.analyze_repository() output."""

        # DB tables & columns
        db = analysis.get("dbResult", {})
        for table in db.get("tables", []):
            self.add_node(table["id"], "Table", table["name"], "Database")
            for col in table.get("columns", []):
                self.add_node(col["id"], "Column", col["name"], "Database",
                              {"dataType": col["dataType"], "isPK": col.get("isPrimaryKey", False)})
                self.add_edge(table["id"], col["id"], "CONTAINS", 1.0, "DATABASE_ANALYSIS")

        for fk in db.get("foreign_keys", []):
            src_id = f"col_{fk['sourceTable']}_{fk['sourceColumn']}"
            tgt_id = f"col_{fk['targetTable']}_{fk['targetColumn']}"
            if src_id in self.nodes and tgt_id in self.nodes:
                self.add_edge(src_id, tgt_id, "REFERENCES", 1.0, "DATABASE_ANALYSIS",
                              reason=f"FK: {fk['sourceTable']}.{fk['sourceColumn']} → {fk['targetTable']}.{fk['targetColumn']}")

        # Frontend pages
        for page in analysis.get("pages", []):
            self.add_node(page["id"], "Page", page["name"], "Frontend",
                          {"routePath": page.get("routePath", ""), "filePath": page.get("filePath", "")})

        # Fields
        for field in analysis.get("fields", []):
            self.add_node(field["id"], "Field", field["fieldName"], "Frontend",
                          {"fieldType": field.get("fieldType"), "filePath": field.get("filePath")})
            self.add_edge(field.get("pageId", ""), field["id"], "CONTAINS_FIELD",
                          1.0, "STATIC_ANALYSIS", field.get("filePath", ""), field.get("lineStart", 0))

        # Backend symbols
        for sym in analysis.get("symbols", []):
            self.add_node(sym["id"], sym["type"], sym["name"], "Backend",
                          {"filePath": sym.get("filePath")})

        # API endpoints
        for ep in analysis.get("apiEndpoints", []):
            self.add_node(ep["id"], "APIEndpoint", f"{ep['method']} {ep['path']}", "API",
                          {"method": ep["method"], "path": ep["path"], "filePath": ep.get("filePath")})
            # Link to controller
            ctrl_id = f"symbol_{ep.get('controllerName', '')}"
            if ctrl_id in self.nodes:
                self.add_edge(ep["id"], ctrl_id, "IMPLEMENTED_BY", 1.0, "STATIC_ANALYSIS",
                              ep.get("filePath", ""), ep.get("lineStart", 0))

        # Field → API endpoint (via API calls on same page)
        for field in analysis.get("fields", []):
            for call in analysis.get("apiCalls", []):
                if call.get("pageId") == field.get("pageId"):
                    matching_ep = next(
                        (ep for ep in analysis.get("apiEndpoints", [])
                         # Q4b: match across a base-path boundary — a frontend call
                         # to /api/v1/customers should bind to a declared /customers
                         # endpoint. Previously exact-equality never fired across the
                         # /api/v1 prefix, so static SUBMITS_TO was ~0 without a HAR.
                         if _api_path_match(ep["path"], call["endpoint"])),
                        None
                    )
                    if matching_ep:
                        self.add_edge(field["id"], matching_ep["id"], "SUBMITS_TO",
                                      0.95, "STATIC_ANALYSIS",
                                      reason=f"Field '{field['fieldName']}' submitted via {call['method']} {call['endpoint']}")

        # Field → API endpoint from RUNTIME TRACES (HAR) — deterministic, observed.
        # This is the honest way to bridge frontend→backend when forms submit through
        # a service/hook layer with no visible fetch in the component.
        import re as _re_tr

        def _norm(s):
            return _re_tr.sub(r'[^a-z0-9]', '', (s or '').lower())

        endpoints = analysis.get("apiEndpoints", [])

        # Only these may precede a matched endpoint — stops a short endpoint like
        # /orders from coincidentally suffix-matching /api/purchase/orders.
        _base_rx = _re_tr.compile(r'^(|/|/api|/api/v\d+|/v\d+|/rest|/api/rest)$', _re_tr.I)

        def _match_endpoint(path, method=None):
            # Match the concrete trace path (which may carry a base prefix like /api)
            # against endpoint patterns — params become wildcards, the prefix before the
            # match must be a real base path, longest match wins, method disambiguates.
            path = path or ''
            best, best_len = None, -1
            for ep in endpoints:
                if method and ep.get("method", "").upper() != method.upper():
                    continue
                inner = _re_tr.sub(r'[:{][^/}]+\}?', r'[^/]+', ep["path"].strip('/'))
                m = _re_tr.search('(^|/)' + inner + '/?$', path)
                if not m or not _base_rx.match(path[:m.start(0)]):
                    continue
                if len(ep["path"]) > best_len:
                    best, best_len = ep, len(ep["path"])
            return best

        pages_for_ref = analysis.get("pages", [])

        def _match_page(referer):
            if not referer:
                return None
            best = None
            for p in pages_for_ref:
                rp = p.get("routePath", "")
                if rp and (referer == rp or referer.rstrip('/').endswith('/' + rp.strip('/'))):
                    if best is None or len(rp) > len(best.get("routePath", "")):
                        best = p
            return best

        fields_all = analysis.get("fields", [])
        # Pre-seed with any static SUBMITS_TO already added, so a trace never double-links
        seen_submits = {(e["source"], e["target"]) for e in self.edges if e["relationship"] == "SUBMITS_TO"}
        for tr in analysis.get("runtimeTraces", []):
            body_keys = tr.get("bodyKeys") or []
            if not body_keys:
                continue
            ep = _match_endpoint(tr.get("path", ""), tr.get("method"))
            if not ep or ep["id"] not in self.nodes:
                continue
            page = _match_page(tr.get("referer", ""))
            candidates = [f for f in fields_all
                          if f["id"] in self.nodes and _norm(f.get("fieldName", ""))
                          and (page is None or f.get("pageId") == page["id"])]

            # Each submitted body key maps to at most ONE field — its best match.
            # exact > field-prefix-stripped exact > shortest field containing the key.
            for raw_key in body_keys:
                bk = _norm(raw_key)
                if len(bk) < 2:
                    continue
                exact    = [f for f in candidates if _norm(f["fieldName"]) == bk]
                stripped = [f for f in candidates if _norm(f["fieldName"]).removeprefix("field") == bk]
                chosen = None
                if exact:
                    chosen = exact[0]
                elif stripped:
                    chosen = stripped[0]
                elif len(bk) >= 4:
                    cont = sorted((f for f in candidates if bk in _norm(f["fieldName"])),
                                  key=lambda f: len(_norm(f["fieldName"])))
                    chosen = cont[0] if cont else None
                if not chosen:
                    continue
                key = (chosen["id"], ep["id"])
                if key in seen_submits:
                    continue
                seen_submits.add(key)
                self.add_edge(chosen["id"], ep["id"], "SUBMITS_TO", 0.97, "RUNTIME_TRACE",
                              reason=f"'{chosen['fieldName']}' sent to {tr['method']} {ep['path']} (observed in trace)")

        # Controller → Service → Repository chains
        for sym in analysis.get("symbols", []):
            if sym["type"] == "Controller":
                svc_id = f"symbol_{sym['name'].replace('Controller', 'Service')}"
                if svc_id in self.nodes:
                    self.add_edge(sym["id"], svc_id, "CALLS", 1.0, "STATIC_ANALYSIS")
            elif sym["type"] == "Service":
                repo_id = f"symbol_{sym['name'].replace('Service', 'Repository')}"
                if repo_id in self.nodes:
                    self.add_edge(sym["id"], repo_id, "CALLS", 1.0, "STATIC_ANALYSIS")

        # Explicit class-to-class calls (X::method / new X) — bridges Controller→Model→Table
        seen_calls = set()
        for c in analysis.get("calls", []):
            src_id = f"symbol_{c.get('caller', '')}"
            tgt_id = f"symbol_{c.get('callee', '')}"
            key = (src_id, tgt_id)
            if src_id != tgt_id and key not in seen_calls and src_id in self.nodes and tgt_id in self.nodes:
                seen_calls.add(key)
                self.add_edge(src_id, tgt_id, "CALLS", 0.9, "STATIC_ANALYSIS",
                              c.get("filePath", ""), c.get("lineStart", 0),
                              f"{c.get('caller')} → {c.get('callee')}")

        # Repository → DB Table (via SQL queries)
        for q in analysis.get("dbQueries", []):
            repo_id  = f"symbol_{q.get('repositoryName', '')}"
            table_id = f"table_{q['tableName']}"
            if repo_id in self.nodes and table_id in self.nodes:
                rel = "READS_FROM" if "SELECT" in q.get("operation", "") else "WRITES_TO"
                self.add_edge(repo_id, table_id, rel, 1.0, "STATIC_ANALYSIS",
                              q.get("filePath", ""), q.get("lineStart", 0),
                              f"SQL {q['operation']} on {q['tableName']}")

        # Page-to-page navigation — resolve real "/path" targets to real pages only.
        import re as _re
        pages_list = analysis.get("pages", [])

        # route → page lookup (real routes now assigned from <Route> definitions)
        route_to_page: Dict[str, Any] = {}
        for p in pages_list:
            rp = p.get("routePath", "")
            if rp and rp not in route_to_page:
                route_to_page[rp] = p

        def _resolve_target(target: str):
            """Map a '/path' navigation target to a Page (exact, then static-prefix,
            then route-template like /products/:id or /products/{id})."""
            if target in route_to_page:
                return route_to_page[target]
            segs = [s for s in target.split('/') if s]
            for cut in range(len(segs), 0, -1):
                cand = '/' + '/'.join(segs[:cut])
                if cand in route_to_page:
                    return route_to_page[cand]
                for rp, pg in route_to_page.items():
                    static = '/' + '/'.join(x for x in rp.split('/')
                                            if x and not x.startswith((':', '{')))
                    if static == cand:
                        return pg
            return None

        # Only genuine navigation: <Link/NavLink to=...>, navigate(...), router/history.push/replace(...)
        nav_re = _re.compile(
            r'(?:<(?:Link|NavLink)\b[^>]*?\bto=\s*\{?\s*'
            r'|(?:navigate|history\.push|router\.push|router\.replace)\s*\(\s*)'
            r'["\']([^"\']+)["\']'
        )
        for page in pages_list:
            file_entry = next(
                (f for f in analysis.get("_raw_frontend_files", [])
                 if f.get("path") == page.get("filePath")),
                None
            )
            if not file_entry:
                continue
            content = file_entry.get("content", "")
            seen = set()
            for target_path in nav_re.findall(content):
                # path-like only: must start with "/", length ≥ 2, no expressions
                if not target_path.startswith('/') or len(target_path) < 2:
                    continue
                if any(c in target_path for c in '{$`'):
                    continue
                if target_path in seen:
                    continue
                seen.add(target_path)
                target_page = _resolve_target(target_path)
                if target_page and target_page["id"] != page["id"]:
                    self.add_edge(page["id"], target_page["id"], "NAVIGATES_TO",
                                  0.90, "STATIC_ANALYSIS",
                                  reason=f"Navigation to {target_path}")

    # ── Cross-layer consistency oracle ────────────────────────────────────

    def cross_layer_oracles(self) -> List[Dict[str, Any]]:
        """Generate cross-layer consistency tests: a value sent to a write endpoint
        must persist UNCHANGED into the DB column it maps to. Walks
        field —SUBMITS_TO→ endpoint —IMPLEMENTED_BY→ controller —CALLS*→ model
        —WRITES_TO→ table, then maps each field to a column by name. A real
        correctness oracle — no spec required. Needs SUBMITS_TO (from a runtime
        trace) + WRITES_TO lineage in the graph."""
        import re as _re_xl

        def _norm(s):
            return _re_xl.sub(r'[^a-z0-9]', '', (s or '').lower())

        out = {}
        for e in self.edges:
            out.setdefault((e["source"], e["relationship"]), []).append(e["target"])

        table_name = {n["id"]: n["name"] for n in self.nodes.values() if n["type"] == "Table"}
        cols_by_table = {}   # table_id -> {norm(col): col}
        for e in self.edges:
            if e["relationship"] == "CONTAINS" and e["source"] in table_name:
                col = self.nodes.get(e["target"])
                if col and col.get("type") == "Column":
                    cols_by_table.setdefault(e["source"], {})[_norm(col["name"])] = col["name"]

        def _write_tables(ep_id):
            seen, frontier, tables = set(), list(out.get((ep_id, "IMPLEMENTED_BY"), [])), set()
            while frontier:
                cur = frontier.pop()
                if cur in seen:
                    continue
                seen.add(cur)
                tables.update(out.get((cur, "WRITES_TO"), []))
                frontier.extend(out.get((cur, "CALLS"), []))
            return tables

        # Q4b: make every probe value UNIQUE per run so the DB assertion matches
        # the row THIS test just created, not a pre-existing or re-run row. The
        # cross-layer check (`equals` + expectedRowsCount:1) then proves the
        # specific write persisted unchanged, instead of "some row with 4242 exists".
        import secrets
        _tok   = secrets.token_hex(3)                 # e.g. 'a1b2c3'
        # F8: keep the unique numeric SMALL enough to fit narrow columns —
        # SMALLINT maxes at 32767 and DECIMAL(10,2) at 8 integer digits, so a
        # 9-digit nonce would be rejected/truncated and fail a correct app. A value
        # in [1000, 31000) is unique-enough against a freshly-seeded test DB and
        # fits SMALLINT/INT/DECIMAL alike.
        _nonce = 1000 + secrets.randbelow(30000)

        def _value_for(col):
            nm = col.lower()
            if 'email' in nm: return f'xlayer+{_tok}@test.com'   # valid, unique email
            if 'date' in nm:  return '2026-01-01'
            if any(k in nm for k in ('amount', 'price', 'qty', 'quantity', 'limit',
                                     'balance', 'salary', 'count', 'stock', 'total')):
                return str(_nonce)                              # unique, column-safe numeric
            return f'XL{_tok}'                                   # unique short text (fits narrow VARCHARs)

        tests, n = [], 0
        for node in self.nodes.values():
            if node["type"] != "APIEndpoint":
                continue
            method = node.get("metadata", {}).get("method", "")
            if method not in ("POST", "PUT", "PATCH"):
                continue
            fields = [self.nodes[e["source"]] for e in self.edges
                      if e["relationship"] == "SUBMITS_TO" and e["target"] == node["id"]
                      and e["source"] in self.nodes]
            if not fields:
                continue
            wtables = _write_tables(node["id"])
            if not wtables:
                continue

            # A POST creates a row in ONE primary table. Pick the write-table that
            # satisfies the MOST submitted fields (name-match as tiebreaker), then map
            # every field to that table — avoids grabbing a side-effect table (e.g.
            # vendor_id landing in `vendors` instead of `purchase_orders`).
            path      = node["metadata"].get("path", node["name"])
            ep_norm   = _norm(path)
            field_norm = {f["id"]: _norm(f["name"]) for f in fields}

            def _covers(t):
                cols = cols_by_table.get(t, {})
                return sum(1 for fn in field_norm.values()
                           if fn in cols or (fn.startswith("field") and fn.removeprefix("field") in cols))

            primary = max(wtables,
                          key=lambda t: (_covers(t), _norm(table_name[t]) in ep_norm),
                          default=None)
            if not primary or _covers(primary) == 0:
                continue
            pcols = cols_by_table.get(primary, {})
            ptable = table_name[primary]

            testdata, db_asserts, lineage = {}, [], []
            for f in fields:
                fn  = field_norm[f["id"]]
                col = pcols.get(fn) or (pcols.get(fn.removeprefix("field")) if fn.startswith("field") else None)
                if not col:
                    continue
                v = _value_for(col)
                testdata[f["name"]] = v
                db_asserts.append({"type": "DB", "table": ptable, "column": col,
                                   "equals": v, "expectedRowsCount": 1, "checkType": "cross_layer"})
                lineage.append(f"{f['name']} → {ptable}.{col}")
            if not db_asserts:
                continue

            n += 1
            tests.append({
                "id":         f"XL-{n:03d}",
                "title":      f"[Cross-layer] {method} {path}: {len(db_asserts)} submitted value(s) persist to DB",
                "category":   "Cross-layer consistency",
                "technique":  "ORACLE",
                "priority":   "high",
                "status":     "CONFIRMED",
                "confidence": 0.9,
                "steps":      [],
                "testData":   testdata,
                "assertions": [{"type": "API", "endpoint": f"{method} {path}",
                                "expectedStatusCode": 201 if method == "POST" else 200}] + db_asserts,
                "sourceEvidence": [{"lineage": l} for l in lineage],
            })
        return tests

    # ── Lineage Traversal ─────────────────────────────────────────────────

    def get_upstream(self, node_id: str, max_depth: int = 6) -> Dict[str, Any]:
        visited: Set[str] = set()
        result_nodes = []
        result_edges = []

        def _traverse(nid: str, depth: int):
            if depth > max_depth or nid in visited:
                return
            visited.add(nid)
            for e in self.edges:
                if e["target"] == nid and e["source"] in self.nodes:
                    result_edges.append(e)
                    result_nodes.append(self.nodes[e["source"]])
                    _traverse(e["source"], depth + 1)

        _traverse(node_id, 0)
        return {"nodes": result_nodes, "edges": result_edges}

    def get_downstream(self, node_id: str, max_depth: int = 6) -> Dict[str, Any]:
        visited: Set[str] = set()
        result_nodes = []
        result_edges = []

        def _traverse(nid: str, depth: int):
            if depth > max_depth or nid in visited:
                return
            visited.add(nid)
            for e in self.edges:
                if e["source"] == nid and e["target"] in self.nodes:
                    result_edges.append(e)
                    result_nodes.append(self.nodes[e["target"]])
                    _traverse(e["target"], depth + 1)

        _traverse(node_id, 0)
        return {"nodes": result_nodes, "edges": result_edges}

    # ── Impact Analysis ───────────────────────────────────────────────────

    def impact_analysis(self, node_id: str) -> Dict[str, Any]:
        ds = self.get_downstream(node_id)
        return {
            "targetNode":     self.nodes.get(node_id),
            "totalAffected":  len(ds["nodes"]),
            "affectedPages":  [n for n in ds["nodes"] if n["type"] == "Page"],
            "affectedAPIs":   [n for n in ds["nodes"] if n["type"] == "APIEndpoint"],
            "affectedTables": [n for n in ds["nodes"] if n["type"] == "Table"],
            "allDownstream":  ds["nodes"],
        }

    # ── Real Workflow Discovery (BFS multi-entity chains) ─────────────────

    def discover_workflows(self) -> List[Dict[str, Any]]:
        """
        Find multi-step business workflows by traversing Page→API→Controller→Service→Table chains.
        A workflow is a path that starts at a Page and ends at a Table, crossing ≥3 layers.
        """
        workflows = []
        pages = [n for n in self.nodes.values() if n["type"] == "Page"]

        for page in pages:
            # BFS from this page, collect paths that reach a Table
            paths = self._find_paths_to_type(page["id"], "Table", max_depth=8)
            for path_nodes, path_edges in paths:
                layer_types = [n["type"] for n in path_nodes]
                if len(set(layer_types)) >= 3:  # crosses at least 3 distinct layers
                    workflows.append({
                        "name":        f"{page['name']} → {path_nodes[-1]['name']}",
                        "startPage":   page["name"],
                        "endTable":    path_nodes[-1]["name"],
                        "confidence":  min(e["confidence"] for e in path_edges) if path_edges else 1.0,
                        "layersCrossed": list(dict.fromkeys(layer_types)),  # unique, ordered
                        "steps":       [{"entity": n["name"], "type": n["type"]} for n in path_nodes],
                        "discoveryMethod": "GRAPH_BFS",
                    })

        # Deduplicate by (start, end)
        seen = set()
        unique = []
        for wf in workflows:
            key = (wf["startPage"], wf["endTable"])
            if key not in seen:
                seen.add(key)
                unique.append(wf)
        return unique

    def _find_paths_to_type(self, start_id: str, target_type: str,
                            max_depth: int = 8) -> List[Tuple[List, List]]:
        """BFS/DFS to find all paths from start_id to any node of target_type."""
        results = []
        stack = [(start_id, [self.nodes[start_id]], [])]

        while stack:
            current, path_nodes, path_edges = stack.pop()
            if len(path_nodes) > max_depth:
                continue

            for e in self.edges:
                if e["source"] == current and e["target"] in self.nodes:
                    target_node = self.nodes[e["target"]]
                    if target_node["id"] in {n["id"] for n in path_nodes}:
                        continue  # avoid cycles
                    new_path = path_nodes + [target_node]
                    new_edges = path_edges + [e]
                    if target_node["type"] == target_type:
                        results.append((new_path, new_edges))
                    else:
                        stack.append((target_node["id"], new_path, new_edges))

        return results

    # ── Graph Context for AI Queries ──────────────────────────────────────

    def build_context_for_query(self, question: str) -> str:
        """Build a text summary of graph relevant to the question for AI context."""
        lower = question.lower()
        context_parts = []

        # Find matching nodes
        matching = [
            n for n in self.nodes.values()
            if any(kw in n["name"].lower() or kw in n.get("metadata", {}).get("filePath", "").lower()
                   for kw in lower.split() if len(kw) > 2)
        ]

        if matching:
            context_parts.append("Matching Graph Nodes:")
            for m in matching[:20]:
                context_parts.append(f"  - {m['type']} '{m['name']}' (category: {m['category']}, file: {m.get('metadata',{}).get('filePath','')})")

                # Show edges for each matching node
                for e in self.edges:
                    if e["source"] == m["id"]:
                        tgt = self.nodes.get(e["target"], {})
                        context_parts.append(f"    → {e['relationship']} → {tgt.get('type','?')}: {tgt.get('name','?')}")
                    elif e["target"] == m["id"]:
                        src = self.nodes.get(e["source"], {})
                        context_parts.append(f"    ← {e['relationship']} ← {src.get('type','?')}: {src.get('name','?')}")
        else:
            # General summary
            type_counts = {}
            for n in self.nodes.values():
                type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
            context_parts.append("Graph Summary:")
            for t, c in sorted(type_counts.items()):
                context_parts.append(f"  - {t}: {c}")

        return "\n".join(context_parts)

    # ── Export ────────────────────────────────────────────────────────────

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "nodeCount": len(self.nodes),
            "edgeCount": len(self.edges),
        }

    def stats(self) -> Dict[str, int]:
        type_counts = {}
        for n in self.nodes.values():
            type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
        return type_counts


if __name__ == "__main__":
    # ── Self-test: Q4b base-path matching + a static SUBMITS_TO end-to-end ─────
    assert _api_path_match("/customers", "/api/v1/customers")
    assert _api_path_match("/api/v1/customers", "/customers")
    assert _api_path_match("/orders/{id}", "/api/orders/:id")
    assert _api_path_match("/customers", "/customers")
    assert _api_path_match("/api/v1/customers", "/customers")
    assert not _api_path_match("/customers", "/vendors")
    assert not _api_path_match("/orders", "/invoices")
    # F7: loose suffix matches must NOT bind
    assert not _api_path_match("/users", "/api/admin/users"), "must not bind /admin/users to /users"
    assert not _api_path_match("/orders", "/customers/orders"), "must not bind /customers/orders to /orders"
    assert not _api_path_match("/orders", "/preorders")

    # A frontend call to /api/v1/customers must bind (SUBMITS_TO) to a declared
    # /customers endpoint across the base-path boundary.
    analysis = {
        "pages": [{"id": "p1", "name": "CustomerPage", "route": "/customers"}],
        "fields": [{"id": "f_email", "fieldName": "email", "pageId": "p1"}],
        "apiCalls": [{"pageId": "p1", "method": "POST", "endpoint": "/api/v1/customers"}],
        "apiEndpoints": [{"id": "ep1", "method": "POST", "path": "/customers",
                          "controllerName": "CustomerController"}],
        "components": [], "dbResult": {"tables": [], "foreign_keys": []},
    }
    gb = SystemGraphBuilder()
    gb.build_from_analysis(analysis)
    submits = [e for e in gb.edges if e["relationship"] == "SUBMITS_TO"]
    assert submits, "static SUBMITS_TO should fire across the /api/v1 base-path boundary"
    print(f"[self-test] static SUBMITS_TO edges: {len(submits)}")
    print("SELF-TEST PASS (Q4b base-path SUBMITS_TO)")
