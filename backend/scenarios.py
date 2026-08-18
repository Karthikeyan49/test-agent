"""
Professional Test-Scenario Generator  (multi-page use-case flows)
===================================================================
Where field_blackbox.py asks "does this ONE field reject bad input?", this
module asks the question a human QA engineer asks first: "walk me through
the feature — what does a user actually DO, across pages and API calls and
the database, to accomplish something?"

It emits ``Scenario`` dicts (see scenario_contracts.py — the single source of
truth for the shape) covering four categories:

    crud_lifecycle   create -> read -> db exists -> update -> delete -> db gone
    use_case_flow    ui navigate -> fill -> submit -> api create -> db exists
    cross_page_data  a value entered on page A must reappear on page B
    (ai-assisted)    LLM proposes realistic flows; grounding filter keeps only
                      those that reference real pages/endpoints/tables

Design law (never broken, see scenario_contracts.py): AI may PROPOSE a scenario
and its steps, but every expectation is a DETERMINISTIC check — HTTP status
class, DB row existence/absence/equality, DOM text presence. The LLM never
decides pass/fail; it only decides what to try. When the AI provider is
disabled or absent, this module still produces the deterministic scenarios
(crud_lifecycle / use_case_flow / cross_page_data) without it.

Endpoint -> table resolution reuses field_blackbox's conservative resolver
(name-match first, WRITES_TO walk only when unambiguous). That resolver is a
closure inside generate_field_blackbox_tests() and can't be imported directly,
so it is faithfully re-implemented here on top of the SAME importable
primitives (_adjacency, _write_tables, _norm) field_blackbox exports — see
_primary_table() below. Field-value synthesis reuses _valid_value() directly.

Pure standard library + scenario_contracts + field_blackbox. Works with
provider=None (AI section is skipped entirely).
"""

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from scenario_contracts import make_scenario, make_step, validate_scenario, SCENARIO_CATEGORIES
from field_blackbox import _valid_value, _adjacency, _write_tables, _norm, _EMAIL_NAME, _URL_NAME, _NONNEG_NAME

_DATE_NAME = re.compile(r'date', re.IGNORECASE)
_ID_PARAM  = re.compile(r'\{[^}]+\}')


# ── graph indexing helpers ──────────────────────────────────────────────────

def _index_tables(graph_data: Dict[str, Any]) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, str]]:
    """norm(table name) -> columns, and norm(table name) -> real table name."""
    cols_by_name: Dict[str, List[Dict[str, Any]]] = {}
    name_by_norm: Dict[str, str] = {}
    for t in graph_data.get("dbTables", []) or []:
        nm = t.get("name") or t.get("id")
        if nm:
            cols_by_name[_norm(nm)] = t.get("columns") or []
            name_by_norm[_norm(nm)] = nm
    return cols_by_name, name_by_norm


def _match_table_name(seg_norm: str, name_by_norm: Dict[str, str]) -> Optional[str]:
    for cand in (seg_norm, seg_norm.rstrip('s'), seg_norm + 's'):
        if cand in name_by_norm:
            return name_by_norm[cand]
    return None


def _primary_table(ep: Dict[str, Any], name_by_norm: Dict[str, str],
                   tname_by_id: Dict[str, str], out: Dict[Tuple[str, str], List[str]]) -> Optional[str]:
    """CONSERVATIVE endpoint -> table resolver. Faithful re-implementation of
    field_blackbox's nested _primary_table() (that one is an unexported
    closure); see module docstring. Path-name match wins; the WRITES_TO walk
    is only trusted when unambiguous or path-confirmed; otherwise -> None."""
    path = ep.get("path", "")
    pnorm = _norm(path)
    segs = [s for s in path.split('/') if s and '{' not in s]
    for seg in reversed(segs):
        hit = _match_table_name(_norm(seg), name_by_norm)
        if hit:
            return hit
    wt = [tname_by_id[t] for t in _write_tables(ep.get("id", ""), out) if t in tname_by_id]
    in_path = [w for w in wt if _norm(w) in pnorm]
    if in_path:
        return in_path[0]
    if len(wt) == 1:
        return wt[0]
    return None


def _looks_like_pk(col: Dict[str, Any], table: str, position: int) -> bool:
    """isPrimaryKey is sometimes missing/false in this graph's parsed schema
    (e.g. orders.order_id), so back it up with the near-universal MySQL
    convention: the row's own auto-increment id is named 'id' or
    '<singular table>_id' and is declared first."""
    if col.get("isPrimaryKey"):
        return True
    name = _norm(col.get("name") or "")
    if not name:
        return False
    if name == "id":
        return True
    tn = _norm(table)
    if tn.endswith("ies"):      # queries → query, categories → category
        singular = tn[:-3] + "y"
    elif tn.endswith("s"):
        singular = tn[:-1]
    else:
        singular = tn
    return position == 0 and name == singular + "id"


def _writable_columns(cols: List[Dict[str, Any]], table: str) -> List[Dict[str, Any]]:
    """Columns worth putting in a create/update body: not the PK, not the
    server-managed timestamps. FK id columns ARE kept (unlike field_blackbox's
    per-field probe filter) because a CRUD create needs them to succeed."""
    skip_exact = {"created_at", "updated_at", "deleted_at"}
    return [c for i, c in enumerate(cols)
            if c.get("name") and not _looks_like_pk(c, table, i)
            and str(c.get("name")).lower() not in skip_exact]


def _pk_column(cols: List[Dict[str, Any]], table: str) -> str:
    for i, c in enumerate(cols):
        if _looks_like_pk(c, table, i):
            return c.get("name") or "id"
    # Fallback when the schema flags no PK: the first column ending in 'id' is
    # almost always the auto-increment key (query_id, order_id), never bare 'id'
    # on a table that has no 'id' column.
    for c in cols:
        n = str(c.get("name") or "")
        if n.lower().endswith("id"):
            return n
    return (cols[0].get("name") if cols and cols[0].get("name") else "id")


def _normalize_path(path: str) -> str:
    """Collapse any {param} to a single canonical token so paths that differ
    only in the param's name (e.g. {id} vs {vendorId}) still line up."""
    return _ID_PARAM.sub("{id}", path or "")


def _with_id_var(path: str) -> str:
    """Replace the (single) path param with the runner's ${id} binding."""
    return _ID_PARAM.sub("${id}", path or "", count=1)


def _field_value(field_name: str, spec: Optional[Dict[str, Any]] = None) -> Any:
    """Best-effort VALID value for a field. When a request-contract `spec`
    (type + validation rules, recovered by endpoint_contracts.py) is available,
    honor it — a real email for `email`, an enum member for `in:`, a number
    within `min:`, a string trimmed to `max:` — so generated request bodies
    satisfy the controller instead of guessing from the field name."""
    if spec:
        t = spec.get("type")
        if t == "email":
            return "valid@test.com"
        if t == "enum" and spec.get("enum"):
            return spec["enum"][0]
        if t == "number":
            return spec.get("minValue", 1) or 1
        if t == "bool":
            return True
        if t == "date":
            return "2026-01-01"
        # typed text (or unspecified) — fit the max length if the rule gave one
        base = "Test" + re.sub(r'[^A-Za-z0-9]', '', spec.get("name") or field_name or "")[:12]
        base = base or "TestValue"
        mx = spec.get("maxLength")
        return base[:mx] if isinstance(mx, int) and mx > 0 else base
    name = field_name or ""
    if _EMAIL_NAME.search(name):
        return "valid@test.com"
    if _URL_NAME.search(name):
        return "https://test.com"
    if _DATE_NAME.search(name):
        return "2026-01-01"
    if _NONNEG_NAME.search(name):
        return 5
    base = "Test" + re.sub(r'[^A-Za-z0-9]', '', name)[:12]
    return base or "TestValue"


def _contracts_by_key(graph_data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index request contracts (from Phase 1.5 enrichment) by 'METHOD /path'
    with the path param collapsed, so a scenario can look up the REAL request
    fields an endpoint reads. Empty when the graph wasn't enriched."""
    out: Dict[str, Dict[str, Any]] = {}
    for c in graph_data.get("requestContracts", []) or []:
        key = f"{(c.get('method') or '').upper()} {_normalize_path(c.get('path') or '')}"
        out[key] = c
    return out


def _dedupe_pages(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The raw graph can list the same page id twice (multi-project scans);
    keep the first occurrence, preserve order."""
    seen = set()
    out = []
    for p in pages:
        pid = p.get("id")
        if pid in seen:
            continue
        seen.add(pid)
        out.append(p)
    return out


# ── 1. CRUD lifecycle ────────────────────────────────────────────────────────

def _crud_lifecycle_scenarios(graph_data: Dict[str, Any],
                              cols_by_name: Dict[str, List[Dict[str, Any]]],
                              name_by_norm: Dict[str, str],
                              tname_by_id: Dict[str, str],
                              out: Dict[Tuple[str, str], List[str]]) -> List[Dict[str, Any]]:
    endpoints = graph_data.get("apiEndpoints", []) or []
    contracts_by_key = _contracts_by_key(graph_data)
    ep_by_mp: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for ep in endpoints:
        m = (ep.get("method") or "").upper()
        p = _normalize_path(ep.get("path") or "")
        if m and p:
            ep_by_mp.setdefault((m, p), ep)

    scenarios: List[Dict[str, Any]] = []
    seen_tables = set()
    idx = 0

    for ep in endpoints:
        method = (ep.get("method") or "").upper()
        path = ep.get("path") or ""
        if method != "POST" or "{" in path:
            continue  # a create endpoint targets a collection, not an item
        table = _primary_table(ep, name_by_norm, tname_by_id, out)
        if not table or table in seen_tables:
            continue
        cols = cols_by_name.get(_norm(table)) or []
        writable = _writable_columns(cols, table)
        if not writable:
            continue
        seen_tables.add(table)
        idx += 1
        pk = _pk_column(cols, table)

        # REQUEST BODY: prefer the endpoint's real request contract (Phase 1.5) —
        # the fields the controller actually reads + their validation rules — over
        # the table's columns. Fixes e.g. POST /queries wanting {name,email,message}
        # instead of the queries-table columns (user_id, query_number, status, …).
        # The DB assertion below still verifies the row in `table`, unchanged.
        contract = contracts_by_key.get(f"POST {_normalize_path(path)}")
        if contract and contract.get("fields"):
            body = {f["name"]: _field_value(f["name"], f) for f in contract["fields"]}
        else:
            body = {c["name"]: _valid_value(c) for c in writable}

        id_path_norm = _normalize_path(path.rstrip('/') + '/{id}')
        get_list_ep   = ep_by_mp.get(("GET", _normalize_path(path)))
        get_by_id_ep  = ep_by_mp.get(("GET", id_path_norm))
        put_ep        = ep_by_mp.get(("PUT", id_path_norm))
        delete_ep     = ep_by_mp.get(("DELETE", id_path_norm))

        steps: List[Dict[str, Any]] = []
        n = 1
        steps.append(make_step(n, "api", "request", method="POST", endpoint=f"POST {path}",
                                body=body, expectStatusClass="2xx", store={"id": "data.id"},
                                expect="record is created (2xx) and its id is captured")); n += 1

        if get_list_ep:
            steps.append(make_step(n, "api", "request", method="GET", endpoint=f"GET {path}",
                                    expectStatusClass="2xx",
                                    expect="the collection endpoint is reachable")); n += 1
        elif get_by_id_ep:
            gp = _with_id_var(get_by_id_ep.get("path") or id_path_norm)
            steps.append(make_step(n, "api", "request", method="GET", endpoint=f"GET {gp}",
                                    expectStatusClass="2xx",
                                    expect="the created record can be read back")); n += 1

        steps.append(make_step(n, "db", "query_exists", table=table, column=pk, value="${id}",
                                expect=f"a row exists in {table} for the new id")); n += 1

        if put_ep:
            up_path = _with_id_var(put_ep.get("path") or id_path_norm)
            steps.append(make_step(n, "api", "request", method="PUT", endpoint=f"PUT {up_path}",
                                    body=body, expectStatusClass="2xx",
                                    expect="the record can be updated")); n += 1

        if delete_ep:
            del_path = _with_id_var(delete_ep.get("path") or id_path_norm)
            steps.append(make_step(n, "api", "request", method="DELETE", endpoint=f"DELETE {del_path}",
                                    expectStatusClass="2xx",
                                    expect="the record can be deleted")); n += 1
            steps.append(make_step(n + 1, "db", "query_absent", table=table, column=pk, value="${id}",
                                    expect=f"the row no longer exists in {table} after delete")); n += 2

        sid = f"SC-CRUD-{idx:03d}"
        scenarios.append(make_scenario(
            sid, f"CRUD lifecycle: {table}", "crud_lifecycle", steps,
            preconditions=["authenticated session"], source="static", priority="high",
            evidence=[{"lineage": f"POST {path} -> table {table} (resolved via field_blackbox-style _primary_table)"}],
        ))

    return scenarios


# ── 2. use_case_flow ─────────────────────────────────────────────────────────

def _post_endpoint_index(endpoints: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """norm(last real path segment) -> [POST endpoint, ...], for name-matching
    a form page to the endpoint it most likely submits to when no SUBMITS_TO
    edge exists (this graph only has 8 such edges total)."""
    idx: Dict[str, List[Dict[str, Any]]] = {}
    for ep in endpoints:
        if (ep.get("method") or "").upper() != "POST":
            continue
        segs = [s for s in (ep.get("path") or "").split('/') if s and '{' not in s]
        if not segs:
            continue
        idx.setdefault(_norm(segs[-1]), []).append(ep)
    return idx


def _resolve_submit_endpoint(page: Dict[str, Any], fields_by_page: Dict[str, List[Dict[str, Any]]],
                             submits_to: List[Tuple[str, str]], endpoints_by_id: Dict[str, Dict[str, Any]],
                             post_by_lastseg: Dict[str, List[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    # 1. strongest evidence: a real SUBMITS_TO edge from one of this page's fields
    fids = {f["id"] for f in fields_by_page.get(page["id"], [])}
    counts: Dict[str, int] = {}
    for src, tgt in submits_to:
        if src in fids and tgt in endpoints_by_id:
            counts[tgt] = counts.get(tgt, 0) + 1
    if counts:
        best = max(counts, key=lambda k: counts[k])
        return endpoints_by_id[best]

    # 2. fallback: name-match the page's entity name to a POST endpoint
    name = page.get("name") or ""
    entity = name[:-4] if name.endswith("Form") else name
    n = _norm(entity)
    if not n:
        return None
    for cand in (n, n.rstrip('s'), n + 's'):
        hits = post_by_lastseg.get(cand)
        if hits:
            return sorted(hits, key=lambda e: len(e.get("path") or ""))[0]
    return None


def _use_case_flow_scenarios(graph_data: Dict[str, Any],
                             cols_by_name: Dict[str, List[Dict[str, Any]]],
                             name_by_norm: Dict[str, str],
                             tname_by_id: Dict[str, str],
                             out: Dict[Tuple[str, str], List[str]]) -> List[Dict[str, Any]]:
    pages = _dedupe_pages(graph_data.get("pages", []) or [])
    fields = graph_data.get("fields", []) or []
    endpoints = graph_data.get("apiEndpoints", []) or []
    edges = graph_data.get("edges", []) or []

    endpoints_by_id = {e.get("id"): e for e in endpoints if e.get("id")}
    pages_by_id = {p["id"]: p for p in pages}
    pages_by_name = {p.get("name"): p for p in pages}

    fields_by_page: Dict[str, List[Dict[str, Any]]] = {}
    for f in fields:
        fields_by_page.setdefault(f.get("pageId"), []).append(f)

    submits_to = [(e.get("source"), e.get("target")) for e in edges if e.get("relationship") == "SUBMITS_TO"]
    navigates_to: Dict[str, List[str]] = {}
    for e in edges:
        if e.get("relationship") == "NAVIGATES_TO":
            navigates_to.setdefault(e.get("source"), []).append(e.get("target"))

    post_by_lastseg = _post_endpoint_index(endpoints)
    contracts_by_key = _contracts_by_key(graph_data)

    scenarios: List[Dict[str, Any]] = []
    idx = 0

    for page in pages:
        pfields = fields_by_page.get(page["id"], [])
        route = page.get("routePath")
        if not pfields or not route:
            continue
        ep = _resolve_submit_endpoint(page, fields_by_page, submits_to, endpoints_by_id, post_by_lastseg)
        if not ep:
            continue
        table = _primary_table(ep, name_by_norm, tname_by_id, out)
        if not table:
            continue  # no db-verifiable outcome -> not a usable flow
        cols = cols_by_name.get(_norm(table)) or []
        pk = _pk_column(cols, table)

        # Prefer the endpoint's REAL request contract (Phase 1.5) over UI-field guesses.
        method0 = (ep.get("method") or "POST").upper()
        contract = contracts_by_key.get(f"{method0} {_normalize_path(ep.get('path') or '')}")
        contract_specs = {f["name"]: f for f in (contract.get("fields") if contract else [])}

        idx += 1
        n = 1
        steps: List[Dict[str, Any]] = [
            make_step(n, "ui", "navigate", page=page.get("name"), route=route,
                      expect="the form page loads"),
        ]
        n += 1

        body: Dict[str, Any] = {}
        for f in pfields:
            fname = f.get("fieldName")
            if not fname:
                continue
            val = _field_value(fname, contract_specs.get(fname))
            body[fname] = val
            steps.append(make_step(n, "ui", "fill", page=page.get("name"), field=fname, value=val,
                                    expect=f"'{fname}' accepts the entered value"))
            n += 1

        # The controller may read fields the UI form doesn't expose (or names them
        # differently). Fold in the contract's REQUIRED fields so the API create
        # step sends a body the endpoint actually accepts.
        for cname, spec in contract_specs.items():
            if spec.get("required") and cname not in body:
                body[cname] = _field_value(cname, spec)

        steps.append(make_step(n, "ui", "submit", page=page.get("name"), selector="button[type=submit]",
                                expect="the form submits"))
        n += 1

        method = (ep.get("method") or "POST").upper()
        steps.append(make_step(n, "api", "request", method=method, endpoint=f"{method} {ep.get('path')}",
                                body=body, expectStatusClass="2xx", store={"id": "data.id"},
                                expect="the submission is accepted"))
        n += 1

        # chain a second page when a real NAVIGATES_TO edge exists (post-submit redirect)
        for target_id in navigates_to.get(page["id"], []):
            target = pages_by_id.get(target_id)
            if target and target.get("routePath"):
                steps.append(make_step(n, "ui", "navigate", page=target.get("name"), route=target.get("routePath"),
                                        expect="the app navigates on to the follow-up page"))
                n += 1
                break  # one chained hop is enough for a readable flow

        steps.append(make_step(n, "db", "query_exists", table=table, column=pk, value="${id}",
                                expect=f"the submission is persisted in {table}"))

        sid = f"SC-FLOW-{idx:03d}"
        scenarios.append(make_scenario(
            sid, f"Use-case flow: {page.get('name')} -> {method} {ep.get('path')}", "use_case_flow", steps,
            preconditions=["authenticated session"], source="static", priority="medium",
            evidence=[{"lineage": f"page {page.get('name')} ({route}) -> {method} {ep.get('path')} -> {table}"}],
        ))

    return scenarios


# ── 3. cross_page_data ───────────────────────────────────────────────────────

def _cross_page_data_scenarios(graph_data: Dict[str, Any], repo_memory: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not repo_memory:
        return []
    cross_page = repo_memory.get("cross_page") or []
    if not cross_page:
        return []

    pages = _dedupe_pages(graph_data.get("pages", []) or [])
    pages_by_name = {p.get("name"): p for p in pages}
    # also allow matching by route, in case repo_memory used routes as identifiers
    pages_by_route = {p.get("routePath"): p for p in pages}

    def _find_page(ident: str) -> Optional[Dict[str, Any]]:
        if not ident:
            return None
        return pages_by_name.get(ident) or pages_by_route.get(ident)

    scenarios: List[Dict[str, Any]] = []
    idx = 0
    for item in cross_page:
        src = _find_page(item.get("source_page"))
        tgt = _find_page(item.get("target_page"))
        src_field = item.get("source_field")
        tgt_field = item.get("target_field")
        if not src or not tgt or not src_field:
            continue  # not grounded in the real page graph -> drop
        idx += 1
        value = f"XPG-{idx:03d}-{_field_value(src_field)}"

        steps = [
            make_step(1, "ui", "navigate", page=src.get("name"), route=src.get("routePath"),
                      expect="the source page loads"),
            make_step(2, "ui", "fill", page=src.get("name"), field=src_field, value=value,
                      expect=f"'{src_field}' accepts the value"),
            make_step(3, "ui", "submit", page=src.get("name"), selector="button[type=submit]",
                      expect="the entry is saved"),
            make_step(4, "ui", "navigate", page=tgt.get("name"), route=tgt.get("routePath"),
                      expect="the target page loads"),
            make_step(5, "ui", "assert_text", page=tgt.get("name"), field=tgt_field, text=value,
                      expect=f"the value entered on {src.get('name')} appears on {tgt.get('name')}"),
        ]
        sid = f"SC-XPG-{idx:03d}"
        scenarios.append(make_scenario(
            sid, f"Cross-page data: {src.get('name')}.{src_field} -> {tgt.get('name')}", "cross_page_data", steps,
            preconditions=["authenticated session"], source="static", priority="medium",
            evidence=[{"lineage": item.get("reason") or f"{src.get('name')}.{src_field} -> {tgt.get('name')}.{tgt_field}"}],
        ))

    return scenarios


# ── 4. AI-assisted (grounded) ────────────────────────────────────────────────

def _segments(path: str) -> List[str]:
    path = (path or "").split("?", 1)[0].split("#", 1)[0]
    raw = [seg for seg in path.split("/") if seg != ""]
    out = []
    for seg in raw:
        if seg.startswith("{") and seg.endswith("}"):
            out.append("*")
        elif seg.startswith(":"):
            out.append("*")
        elif seg.isdigit():
            out.append("*")
        else:
            out.append(seg)
    return out


def _segments_match(a: List[str], b: List[str]) -> bool:
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == "*" or y == "*":
            continue
        if x.lower() != y.lower():
            return False
    return True


def _parse_endpoint_str(s: str) -> Tuple[str, str]:
    s = (s or "").strip()
    tokens = s.split(None, 1)
    methods = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
    if len(tokens) == 2 and tokens[0].upper() in methods:
        return tokens[0].upper(), tokens[1].strip()
    return "", s


def _build_ai_summary(graph_data: Dict[str, Any], repo_memory: Optional[Dict[str, Any]],
                      max_items: int = 40) -> str:
    if repo_memory:
        pages = repo_memory.get("pages") or []
        page_lines = [f"  - {p.get('name')} ({p.get('route')})" for p in pages[:max_items] if p.get("name")]
        use_cases = repo_memory.get("use_cases") or []
        uc_lines = [f"  - {u.get('name')}: {u.get('description', '')}" for u in use_cases[:max_items]]
        parts = ["PAGES:"] + page_lines
        if uc_lines:
            parts += ["\nKNOWN USE CASES:"] + uc_lines
        return "\n".join(parts)

    pages = _dedupe_pages(graph_data.get("pages", []) or [])
    endpoints = graph_data.get("apiEndpoints", []) or []
    tables = graph_data.get("dbTables", []) or []
    page_lines = [f"  - {p.get('name')} ({p.get('routePath')})" for p in pages[:max_items] if p.get("routePath")]
    ep_lines = [f"  - {e.get('method')} {e.get('path')}" for e in endpoints[:max_items]]
    table_lines = [f"  - {t.get('name')}" for t in tables[:max_items] if t.get("name")]
    parts = ["PAGES:"] + page_lines + ["\nAPI ENDPOINTS:"] + ep_lines + ["\nDB TABLES:"] + table_lines
    return "\n".join(parts)


def _parse_json_array(raw: str) -> List[Any]:
    text = (raw or "").strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        parsed = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _ai_step_grounded(step: Dict[str, Any], pages_by_name: Dict[str, Any], pages_by_route: Dict[str, Any],
                      real_endpoints: List[Tuple[str, List[str]]], name_by_norm: Dict[str, str]) -> bool:
    action = step.get("action")
    layer = step.get("layer")
    if layer == "ui" and action == "navigate":
        page = step.get("page")
        route = step.get("route")
        return bool((page and page in pages_by_name) or (route and route in pages_by_route))
    if layer == "api" and action == "request":
        endpoint = step.get("endpoint") or f"{step.get('method', '')} {step.get('path', '')}"
        method, path = _parse_endpoint_str(endpoint)
        if not path:
            return False
        cand = _segments(path)
        for m, segs in real_endpoints:
            if method and method != m:
                continue
            if _segments_match(segs, cand):
                return True
        return False
    if layer == "db":
        table = step.get("table")
        return bool(table and _norm(table) in name_by_norm)
    return True  # ui fill/select/click/submit/assert_* carry no independently-checkable graph reference


def _ai_assisted_scenarios(graph_data: Dict[str, Any], repo_memory: Optional[Dict[str, Any]],
                           provider: Any, max_ai: int) -> List[Dict[str, Any]]:
    if provider is None:
        return []
    try:
        if not provider.is_enabled():
            return []
    except Exception:
        return []

    try:
        pages = _dedupe_pages(graph_data.get("pages", []) or [])
        pages_by_name = {p.get("name"): p for p in pages if p.get("name")}
        pages_by_route = {p.get("routePath"): p for p in pages if p.get("routePath")}
        endpoints = graph_data.get("apiEndpoints", []) or []
        real_endpoints = [((e.get("method") or "").upper(), _segments(e.get("path") or "")) for e in endpoints]
        _, name_by_norm = _index_tables(graph_data)

        summary = _build_ai_summary(graph_data, repo_memory)
        system_prompt = (
            "You are a senior QA engineer. Given a compact summary of a real software "
            "system (real pages, endpoints, tables), propose realistic, professional "
            "multi-step test scenarios a human tester would write — full user journeys, "
            "not single-request checks. Only reference pages/endpoints/tables that "
            "literally appear in the summary. Respond with a JSON array and nothing else."
        )
        prompt = (
            f"SYSTEM SUMMARY\n{summary}\n\n"
            f"Propose up to {max_ai} professional test scenarios. Return a JSON array "
            "where each element has EXACTLY these keys:\n"
            '  "name"     : short human-readable scenario name\n'
            '  "category" : one of "use_case_flow", "crud_lifecycle", "cross_page_data"\n'
            '  "risk"     : one sentence on what this scenario protects against\n'
            '  "steps"    : ordered array of step objects, each with a "layer" '
            '("ui"|"api"|"db") and "action" '
            '("navigate"|"fill"|"select"|"click"|"submit"|"assert_text"|"assert_visible" for ui, '
            '"request" for api, "query_exists"|"query_absent"|"query_equals" for db), plus:\n'
            '    ui:  "page" (exact page name from the summary), "route", "field", "value", "text"\n'
            '    api: "method", "endpoint" ("METHOD /path", must exist in the summary), '
            '"body" (object), "expectStatusClass" (e.g. "2xx")\n'
            '    db:  "table" (must exist in the summary), "column", "value"\n\n'
            "Output the JSON array only — no prose, no markdown fences."
        )

        raw = provider._call_llm(prompt, system_prompt)
        if not raw:
            return []
        proposed = _parse_json_array(raw)
        if not proposed:
            return []

        scenarios: List[Dict[str, Any]] = []
        idx = 0
        for item in proposed:
            if not isinstance(item, dict):
                continue
            raw_steps = item.get("steps") or []
            if not isinstance(raw_steps, list) or not raw_steps:
                continue

            grounded_steps = []
            all_grounded = True
            for i, st in enumerate(raw_steps, start=1):
                if not isinstance(st, dict):
                    all_grounded = False
                    break
                if not _ai_step_grounded(st, pages_by_name, pages_by_route, real_endpoints, name_by_norm):
                    all_grounded = False
                    break
                kw = {k: v for k, v in st.items() if k not in ("layer", "action", "n")}
                grounded_steps.append(make_step(i, st.get("layer", ""), st.get("action", ""), **kw))
            if not all_grounded or not grounded_steps:
                continue

            category = item.get("category")
            if category not in SCENARIO_CATEGORIES:
                category = "use_case_flow"

            idx += 1
            sid = f"SC-AI-{idx:03d}"
            scenario = make_scenario(
                sid, str(item.get("name") or "AI-proposed scenario"), category, grounded_steps,
                preconditions=["authenticated session"], source="ai", priority="medium",
                risk=item.get("risk"),
                evidence=[{"lineage": "AI-proposed, grounding-filtered against the real system graph"}],
            )
            if validate_scenario(scenario) == []:
                scenarios.append(scenario)
            if len(scenarios) >= max_ai:
                break
        return scenarios
    except Exception:
        return []  # AI failures must never crash generation


# ── public API ────────────────────────────────────────────────────────────

def generate_scenarios(graph_data: Dict[str, Any], repo_memory: Optional[Dict[str, Any]] = None,
                       provider: Any = None, max_ai: int = 8) -> List[Dict[str, Any]]:
    """Generate professional, multi-step Scenario dicts (scenario_contracts shape)
    from a System Graph. Deterministic categories (crud_lifecycle, use_case_flow,
    cross_page_data) always run; the AI-assisted category only runs when
    `provider` is given and enabled, and never raises on failure."""
    graph_data = graph_data or {}
    nodes = graph_data.get("nodes", []) or []
    edges = graph_data.get("edges", []) or []

    cols_by_name, name_by_norm = _index_tables(graph_data)
    tname_by_id = {n["id"]: n["name"] for n in nodes if n.get("type") == "Table"}
    out = _adjacency(edges)

    scenarios: List[Dict[str, Any]] = []
    scenarios += _crud_lifecycle_scenarios(graph_data, cols_by_name, name_by_norm, tname_by_id, out)
    scenarios += _use_case_flow_scenarios(graph_data, cols_by_name, name_by_norm, tname_by_id, out)
    scenarios += _cross_page_data_scenarios(graph_data, repo_memory)
    scenarios += _ai_assisted_scenarios(graph_data, repo_memory, provider, max_ai)
    return scenarios


# ── self-test ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os

    _here = os.path.dirname(os.path.abspath(__file__))
    _root = os.path.dirname(_here)
    _candidates = [
        os.path.join(_root, "graph.json"),
        os.path.join(_root, "system_graph.json"),
        os.path.join(_root, "test-ecosudar", "system_graph.json"),
        os.path.join(os.path.dirname(_root), "test-ecosudar", "system_graph.json"),
    ]
    GRAPH_PATH = next((p for p in _candidates if os.path.isfile(p)), _candidates[0])
    with open(GRAPH_PATH, "r") as fh:
        graph = json.load(fh)

    scenarios = generate_scenarios(graph, provider=None)

    by_cat: Dict[str, int] = {}
    for s in scenarios:
        by_cat[s["category"]] = by_cat.get(s["category"], 0) + 1
    print("counts by category:", by_cat)

    assert by_cat.get("crud_lifecycle", 0) > 0, "expected at least one crud_lifecycle scenario"
    assert by_cat.get("use_case_flow", 0) > 0, "expected at least one use_case_flow scenario"

    for s in scenarios:
        errs = validate_scenario(s)
        assert errs == [], f"{s['id']} invalid: {errs}"

    # ── explicit grounding assertion: every api endpoint / db table referenced
    #    by any step of any generated scenario must exist in the real graph ──
    real_endpoints = [((e.get("method") or "").upper(), _segments(e.get("path") or ""))
                      for e in graph.get("apiEndpoints", []) or []]
    _, real_name_by_norm = _index_tables(graph)
    real_pages = _dedupe_pages(graph.get("pages", []) or [])
    real_page_names = {p.get("name") for p in real_pages if p.get("name")}
    real_page_routes = {p.get("routePath") for p in real_pages if p.get("routePath")}

    checked_endpoints = 0
    checked_tables = 0
    checked_pages = 0
    for s in scenarios:
        for st in s["steps"]:
            if st["layer"] == "api" and st.get("action") == "request":
                method, path = _parse_endpoint_str(st.get("endpoint", ""))
                cand = _segments(path)
                ok = any((not method or method == m) and _segments_match(segs, cand)
                        for m, segs in real_endpoints)
                assert ok, f"{s['id']}: endpoint '{st.get('endpoint')}' not grounded in real graph"
                checked_endpoints += 1
            if st["layer"] == "db":
                table = st.get("table")
                assert table and _norm(table) in real_name_by_norm, \
                    f"{s['id']}: table '{table}' not grounded in real graph"
                checked_tables += 1
            if st["layer"] == "ui" and st.get("action") == "navigate":
                page = st.get("page")
                route = st.get("route")
                ok = (page in real_page_names) or (route in real_page_routes)
                assert ok, f"{s['id']}: page '{page}' ({route}) not grounded in real graph"
                checked_pages += 1

    print(f"grounding check: {checked_endpoints} api-endpoint refs, "
         f"{checked_tables} db-table refs, {checked_pages} ui-navigate refs — all grounded")

    # provider=None path must work without raising and must not add "ai" scenarios
    assert all(s["source"] != "ai" for s in scenarios), "provider=None must not produce AI scenarios"

    # sanity: a repo_memory-driven cross_page_data scenario, grounded in real pages
    if len(real_pages) >= 2:
        p0, p1 = real_pages[0], real_pages[1]
        rm = {
            "pages": [], "fields": [], "use_cases": [], "connections": [],
            "cross_page": [{
                "source_page": p0.get("name"), "source_field": "note",
                "target_page": p1.get("name"), "target_field": "note",
                "reason": "self-test synthetic cross-page link",
            }],
        }
        xpg = _cross_page_data_scenarios(graph, rm)
        assert len(xpg) == 1 and validate_scenario(xpg[0]) == [], "cross_page_data generation should work"
        print(f"cross_page_data self-check: generated {len(xpg)} scenario, valid")

    print(f"\ntotal scenarios: {len(scenarios)}")
    for cat in SCENARIO_CATEGORIES:
        print(f"  {cat:16s}: {by_cat.get(cat, 0)}")

    print("\n--- example crud_lifecycle scenario ---")
    example = next(s for s in scenarios if s["category"] == "crud_lifecycle")
    print(json.dumps(example, indent=2))

    print("\nSELF-TEST PASS")
