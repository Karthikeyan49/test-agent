"""
Repo Memory — RAG-style semantic memory of the whole application
==================================================================
Built once at scan time from the parsed System Graph (see graph_builder.py /
system_graph.json), and used afterwards to GROUND test-scenario generation:
instead of an LLM hallucinating page names, field names or endpoints, the
scenario generator retrieves real, graph-derived facts from this memory.

Shape contract lives in scenario_contracts.py — this module imports
`make_repo_memory` / `validate_repo_memory` from there and matches that shape
exactly. Do not redefine the shape here.

Pipeline position:

    system_graph.json -> build_repo_memory() -> RepoMemory dict
                                               -> write_repo_memory_md()  (human-readable)
                                               -> RepoMemoryIndex().retrieve(query) (grounding)

Design notes
------------
  - Pure standard library. graph_rag.py is imported opportunistically (for its
    battle-tested identifier tokenizer) with a local fallback so this module
    never hard-depends on it.
  - Deterministic: no randomness, no wall-clock in the derived data (only the
    md file's generation itself is a static render of the memory dict).
  - "Use-cases" and "cross-page" flows are INFERRED via naming/graph heuristics
    (entity clustering across Page/APIEndpoint/Table names, CALLS-chain walks
    from endpoint to table, form-page vs. list/detail-page field overlap).
    These are best-effort signals to ground AI scenario proposals, not a
    guaranteed-exhaustive analysis.
"""

import os
import re
import sys
import math
import json
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from scenario_contracts import make_repo_memory, validate_repo_memory
except Exception:  # pragma: no cover - contracts module is required, but fail soft for tooling
    def make_repo_memory(pages, fields, use_cases, connections, cross_page) -> Dict[str, Any]:
        return {"pages": pages, "fields": fields, "use_cases": use_cases,
                "connections": connections, "cross_page": cross_page}

    def validate_repo_memory(m: Dict[str, Any]) -> List[str]:
        return [f"missing '{k}'" for k in ("pages", "fields", "use_cases", "connections", "cross_page") if k not in m]

# Optional reuse of graph_rag's identifier tokenizer (camelCase/snake/kebab aware).
try:
    from graph_rag import _tokenize as _gr_tokenize  # type: ignore
except Exception:  # pragma: no cover
    _gr_tokenize = None


# ── tokenization (local fallback, mirrors graph_rag._tokenize) ────────────────
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_ALNUM_TOKEN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    if not text:
        return []
    if _gr_tokenize is not None:
        try:
            return _gr_tokenize(text)
        except Exception:
            pass
    spaced = _CAMEL_BOUNDARY.sub(" ", str(text))
    return _ALNUM_TOKEN.findall(spaced.lower())


_STOPWORDS: Set[str] = {
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with",
    "is", "are", "be", "by", "at", "from", "as", "that", "this", "it",
}


def _query_terms(query: str) -> List[str]:
    return [t for t in _tokenize(query) if len(t) > 1 and t not in _STOPWORDS]


# ── entity-clustering helpers ──────────────────────────────────────────────
# Suffix tokens stripped off a page/component name to expose its domain entity,
# e.g. "CustomerForm" -> ["customer"], "CustomerLedger" -> ["customer"].
_PAGE_SUFFIX_TOKENS: Set[str] = {
    "form", "list", "page", "view", "detail", "details", "table", "dialog",
    "panel", "report", "reports", "ledger", "edit", "new", "create", "add",
    "manager", "widget", "header", "row", "wrapper", "context", "button",
    "picker", "section", "menu", "item", "card", "modal", "tab", "group",
    "overview", "analytics", "summary", "register", "import", "export",
    "filter", "filters", "layout", "sidebar", "index", "dashboard", "scanner",
    "planning", "compliance", "wizard", "grid", "bar", "alert", "text",
}

# Namespace / action tokens dropped from an API path before entity matching
# (they describe *where* or *what verb*, not the domain entity).
_ENDPOINT_SKIP_TOKENS: Set[str] = {
    "admin", "dealer", "auth", "statistics", "stats", "reports", "report",
    "api", "public", "internal", "system", "merge", "recompute", "analytics",
    "summary", "resolve", "conflicts", "register", "login", "logout",
    "refresh", "export", "import", "bulk", "batch", "id",
}

_IRREGULAR_SINGULAR = {
    "children": "child", "people": "person", "men": "man", "women": "woman",
    "data": "data", "status": "status", "analysis": "analysis",
}


def _singularize(tok: str) -> str:
    if tok in _IRREGULAR_SINGULAR:
        return _IRREGULAR_SINGULAR[tok]
    if tok.endswith("ies") and len(tok) > 4:
        return tok[:-3] + "y"
    if tok.endswith("ses") and len(tok) > 4:
        return tok[:-2]
    if tok.endswith("s") and not tok.endswith("ss") and len(tok) > 3:
        return tok[:-1]
    return tok


def _page_entity_tokens(name: str) -> Tuple[str, ...]:
    """Tokens describing the domain entity a page/component represents.

    Strips trailing generic suffix tokens (Form, List, Report, ...) then
    singularizes what's left, preserving original left-to-right order.
    """
    toks = _tokenize(name)
    while len(toks) > 1 and toks[-1] in _PAGE_SUFFIX_TOKENS:
        toks = toks[:-1]
    toks = [_singularize(t) for t in toks if t not in _PAGE_SUFFIX_TOKENS or len(toks) == 1]
    return tuple(t for t in toks if t)


def _endpoint_entity_tokens(path: str) -> Set[str]:
    raw = re.split(r"[/\-_]", path)
    toks: Set[str] = set()
    for seg in raw:
        seg = seg.strip()
        if not seg or seg.startswith("{") or seg.startswith(":") or seg.isdigit():
            continue
        for t in _tokenize(seg):
            if t in _ENDPOINT_SKIP_TOKENS:
                continue
            toks.add(_singularize(t))
    return toks


def _table_entity_tokens(name: str) -> Set[str]:
    return {_singularize(t) for t in name.split("_") if t}


def _is_form_like(page_name: str) -> bool:
    return bool(re.search(r"(form|new|create|add|edit|wizard)$", page_name, re.IGNORECASE))


# ── build_repo_memory ────────────────────────────────────────────────────────
def build_repo_memory(graph_data: Dict[str, Any],
                      page_docs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Build the RAG memory from the System Graph. When ``page_docs`` (the
    machine-readable output of ``page_docs.build_page_docs``) is supplied, its
    per-page fields and use-cases ENRICH the memory — so anything the page-docs
    pass surfaced that the graph-only pass missed (completeness-fill fields,
    AI-inferred fields, extra use-cases) genuinely reaches scenario generation.
    Without it, the memory is graph-derived exactly as before."""
    graph_data = graph_data or {}
    raw_pages = graph_data.get("pages", []) or []
    raw_fields = graph_data.get("fields", []) or []
    raw_endpoints = graph_data.get("apiEndpoints", []) or []
    raw_tables = graph_data.get("dbTables", []) or []
    edges = graph_data.get("edges", []) or []

    # ── lookup maps (ids come straight from the typed lists, matching edges) ──
    page_by_id: Dict[str, Dict[str, Any]] = {p["id"]: p for p in raw_pages if p.get("id")}
    field_by_id: Dict[str, Dict[str, Any]] = {f["id"]: f for f in raw_fields if f.get("id")}
    endpoint_by_id: Dict[str, Dict[str, Any]] = {e["id"]: e for e in raw_endpoints if e.get("id")}
    table_by_id: Dict[str, Dict[str, Any]] = {t["id"]: t for t in raw_tables if t.get("id")}

    def _ep_label(ep: Dict[str, Any]) -> str:
        return f"{ep.get('method', '?')} {ep.get('path', '?')}"

    # ── edges grouped by relationship ─────────────────────────────────────
    edges_by_rel: Dict[str, List[Dict[str, Any]]] = {}
    for e in edges:
        edges_by_rel.setdefault(e.get("relationship"), []).append(e)

    # page -> [field ids]  (CONTAINS_FIELD)
    page_field_ids: Dict[str, List[str]] = {}
    for e in edges_by_rel.get("CONTAINS_FIELD", []):
        page_field_ids.setdefault(e["source"], []).append(e["target"])

    # ═══ 1. pages ═══
    pages_out: List[Dict[str, Any]] = []
    for p in raw_pages:
        pid = p.get("id")
        field_ids = page_field_ids.get(pid, [])
        field_names = [field_by_id[fid]["fieldName"] for fid in field_ids if fid in field_by_id]
        if not field_names:
            # fall back to direct pageId reference on the field records themselves
            field_names = [f["fieldName"] for f in raw_fields if f.get("pageId") == pid]
        pages_out.append({
            "name": p.get("name"),
            "route": p.get("routePath"),
            "file": p.get("filePath"),
            "fields": sorted(set(field_names)),
        })

    # ═══ 2. fields ═══
    fields_out: List[Dict[str, Any]] = []
    for f in raw_fields:
        page = page_by_id.get(f.get("pageId"), {})
        fields_out.append({
            "name": f.get("fieldName"),
            "page": page.get("name"),
            "type": f.get("fieldType"),
            "required": bool(f.get("required")),
        })

    # ═══ entity clustering (shared by use_cases + cross_page) ═══
    # page id -> entity token tuple (order preserved, for display)
    page_entity: Dict[str, Tuple[str, ...]] = {p["id"]: _page_entity_tokens(p.get("name", "")) for p in raw_pages}
    endpoint_tokens: Dict[str, Set[str]] = {e["id"]: _endpoint_entity_tokens(e.get("path", "")) for e in raw_endpoints}
    table_tokens: Dict[str, Set[str]] = {t["id"]: _table_entity_tokens(t.get("name", "")) for t in raw_tables}

    clusters: Dict[Tuple[str, ...], Dict[str, Any]] = {}
    for p in sorted(raw_pages, key=lambda x: x.get("name", "")):
        etoks = page_entity.get(p["id"], ())
        if len(etoks) == 0 or len(etoks) > 3:
            continue
        key = tuple(sorted(etoks))
        eset = set(etoks)
        cl = clusters.setdefault(key, {"display": list(etoks), "page_ids": [], "endpoint_ids": set(), "table_ids": set()})
        cl["page_ids"].append(p["id"])
        for eid, toks in endpoint_tokens.items():
            if eset.issubset(toks):
                cl["endpoint_ids"].add(eid)
        for tid, toks in table_tokens.items():
            if eset.issubset(toks):
                cl["table_ids"].add(tid)

    # ═══ 3. use_cases ═══
    use_cases_out: List[Dict[str, Any]] = []
    for key, cl in sorted(clusters.items()):
        if not cl["endpoint_ids"] and not cl["table_ids"]:
            continue  # pure-UI cluster with no backend tie -> not a real use-case
        title = " ".join(t.capitalize() for t in cl["display"])
        page_names = sorted({page_by_id[pid]["name"] for pid in cl["page_ids"] if pid in page_by_id})
        endpoint_labels = sorted({_ep_label(endpoint_by_id[eid]) for eid in cl["endpoint_ids"] if eid in endpoint_by_id})
        table_names = sorted({table_by_id[tid]["name"] for tid in cl["table_ids"] if tid in table_by_id})
        use_cases_out.append({
            "name": f"Manage {title}",
            "description": (
                f"Create, view, and manage {title} records via "
                f"{', '.join(page_names) if page_names else 'the UI'}"
                f"{'; backed by ' + ', '.join(table_names) if table_names else ''}"
                f"{' through ' + ', '.join(endpoint_labels) if endpoint_labels else ''}."
            ),
            "pages": page_names,
            "endpoints": endpoint_labels,
            "tables": table_names,
        })

    # ═══ 4. connections ═══
    connections_out: List[Dict[str, Any]] = []

    # 4a. field -> endpoint  (SUBMITS_TO)
    for e in edges_by_rel.get("SUBMITS_TO", []):
        f = field_by_id.get(e["source"])
        ep = endpoint_by_id.get(e["target"])
        if not f or not ep:
            continue
        page = page_by_id.get(f.get("pageId"), {})
        frm = f"page:{page.get('name', '?')}/field:{f.get('fieldName', '?')}"
        to = f"endpoint:{_ep_label(ep)}"
        connections_out.append({"from": frm, "to": to, "via": "SUBMITS_TO"})

    # 4b. endpoint -> table  (walk IMPLEMENTED_BY -> CALLS* -> WRITES_TO/READS_FROM)
    calls_adj: Dict[str, List[str]] = {}
    for e in edges_by_rel.get("CALLS", []):
        calls_adj.setdefault(e["source"], []).append(e["target"])

    writes_by_symbol: Dict[str, List[str]] = {}
    for e in edges_by_rel.get("WRITES_TO", []):
        writes_by_symbol.setdefault(e["source"], []).append(e["target"])
    reads_by_symbol: Dict[str, List[str]] = {}
    for e in edges_by_rel.get("READS_FROM", []):
        reads_by_symbol.setdefault(e["source"], []).append(e["target"])

    impl_by_endpoint: Dict[str, List[str]] = {}
    for e in edges_by_rel.get("IMPLEMENTED_BY", []):
        impl_by_endpoint.setdefault(e["source"], []).append(e["target"])

    def _reachable_symbols(start_ids: List[str], max_depth: int = 3) -> Set[str]:
        seen: Set[str] = set(start_ids)
        frontier = list(start_ids)
        depth = 0
        while frontier and depth < max_depth:
            nxt: List[str] = []
            for sid in frontier:
                for nb in calls_adj.get(sid, []):
                    if nb not in seen:
                        seen.add(nb)
                        nxt.append(nb)
            frontier = nxt
            depth += 1
        return seen

    seen_conn: Set[Tuple[str, str, str]] = set()
    for ep in raw_endpoints:
        eid = ep.get("id")
        controllers = impl_by_endpoint.get(eid, [])
        if not controllers:
            continue
        symbols = _reachable_symbols(controllers)
        ep_id_str = f"endpoint:{_ep_label(ep)}"
        for sid in symbols:
            for tid in writes_by_symbol.get(sid, []):
                tbl = table_by_id.get(tid)
                if not tbl:
                    continue
                key = (ep_id_str, tbl["name"], "WRITES_TO")
                if key not in seen_conn:
                    seen_conn.add(key)
                    connections_out.append({
                        "from": ep_id_str, "to": f"table:{tbl['name']}",
                        "via": "IMPLEMENTED_BY+CALLS*+WRITES_TO",
                    })
            for tid in reads_by_symbol.get(sid, []):
                tbl = table_by_id.get(tid)
                if not tbl:
                    continue
                key = (ep_id_str, tbl["name"], "READS_FROM")
                if key not in seen_conn:
                    seen_conn.add(key)
                    connections_out.append({
                        "from": ep_id_str, "to": f"table:{tbl['name']}",
                        "via": "IMPLEMENTED_BY+CALLS*+READS_FROM",
                    })

    # 4c. page -> page  (NAVIGATES_TO)
    for e in edges_by_rel.get("NAVIGATES_TO", []):
        src = page_by_id.get(e["source"])
        tgt = page_by_id.get(e["target"])
        if not src or not tgt:
            continue
        connections_out.append({
            "from": f"page:{src.get('name', '?')}", "to": f"page:{tgt.get('name', '?')}", "via": "NAVIGATES_TO",
        })

    # ═══ 5. cross_page ═══
    cross_page_out: List[Dict[str, Any]] = []
    seen_cross: Set[Tuple[str, str, str, str]] = set()

    # 5a. same field name on a form-like page and a different (list/detail) page
    field_names_by_page: Dict[str, Set[str]] = {}
    for f in raw_fields:
        pid = f.get("pageId")
        if pid:
            field_names_by_page.setdefault(pid, set()).add(f.get("fieldName"))

    pages_sorted = sorted(raw_pages, key=lambda x: x.get("name", ""))
    for src_p in pages_sorted:
        if not _is_form_like(src_p.get("name", "")):
            continue
        src_fields = field_names_by_page.get(src_p["id"], set())
        if not src_fields:
            continue
        for tgt_p in pages_sorted:
            if tgt_p["id"] == src_p["id"] or _is_form_like(tgt_p.get("name", "")):
                continue
            shared = src_fields & field_names_by_page.get(tgt_p["id"], set())
            for field in sorted(shared):
                key = (src_p["name"], field, tgt_p["name"], field)
                if key in seen_cross:
                    continue
                seen_cross.add(key)
                cross_page_out.append({
                    "source_page": src_p["name"], "source_field": field,
                    "target_page": tgt_p["name"], "target_field": field,
                    "reason": f"'{field}' entered on {src_p['name']} (form) shares its field name with "
                              f"{tgt_p['name']}, so the value likely surfaces there too.",
                })

    # 5b. entity created on a form page (writes table T) surfaces on a page that reads table T
    for key, cl in sorted(clusters.items()):
        if not cl["table_ids"]:
            continue
        title = " ".join(t.capitalize() for t in cl["display"])
        cluster_pages = [page_by_id[pid] for pid in cl["page_ids"] if pid in page_by_id]
        form_pages = [p for p in cluster_pages if _is_form_like(p.get("name", ""))]
        other_pages = [p for p in cluster_pages if not _is_form_like(p.get("name", ""))]
        table_names = sorted({table_by_id[tid]["name"] for tid in cl["table_ids"] if tid in table_by_id})
        if not form_pages or not other_pages or not table_names:
            continue
        for fp in form_pages:
            fp_fields = sorted(field_names_by_page.get(fp["id"], set()))
            source_field = fp_fields[0] if fp_fields else "*"
            for op in other_pages:
                op_fields = field_names_by_page.get(op["id"], set())
                target_field = source_field if source_field in op_fields else ""
                key2 = (fp["name"], source_field, op["name"], target_field)
                if key2 in seen_cross:
                    continue
                seen_cross.add(key2)
                cross_page_out.append({
                    "source_page": fp["name"], "source_field": source_field,
                    "target_page": op["name"], "target_field": target_field,
                    "reason": f"A {title} record created via {fp['name']} writes {table_names[0]}; "
                              f"{op['name']} reads {table_names[0]} and is expected to display it.",
                })

    # ═══ 6. page-docs enrichment (optional) ═══
    # Merge in fields / use-cases the page-docs corpus captured that the
    # graph-only pass didn't — this is what makes page-docs actually FEED
    # scenario generation (not just be a standalone artifact).
    if page_docs:
        _field_keys = {(f.get("page"), f.get("name")) for f in fields_out}
        _uc_keys    = {(u.get("name"), tuple(sorted(u.get("pages") or []))) for u in use_cases_out}
        added_f = added_u = 0
        for pd in page_docs:
            page = pd.get("name")
            for fld in pd.get("fields", []) or []:
                fn = fld.get("name") if isinstance(fld, dict) else fld
                if fn and (page, fn) not in _field_keys:
                    fields_out.append({"name": fn, "page": page, "source": "page_docs"})
                    _field_keys.add((page, fn)); added_f += 1
            for uc in pd.get("use_cases", []) or []:
                key = (uc.get("name"), tuple(sorted(uc.get("pages") or [])))
                if uc.get("name") and key not in _uc_keys:
                    use_cases_out.append(uc); _uc_keys.add(key); added_u += 1
        if added_f or added_u:
            print(f"[repo_memory] enriched from page-docs: +{added_f} field(s), +{added_u} use-case(s)")

    return make_repo_memory(pages_out, fields_out, use_cases_out, connections_out, cross_page_out)


# ── write_repo_memory_md ────────────────────────────────────────────────────
def write_repo_memory_md(memory: Dict[str, Any], path: str) -> str:
    lines: List[str] = []
    lines.append("# Repo Memory")
    lines.append("")
    lines.append(
        f"Pages: {len(memory.get('pages', []))} | Fields: {len(memory.get('fields', []))} | "
        f"Use-cases: {len(memory.get('use_cases', []))} | Connections: {len(memory.get('connections', []))} | "
        f"Cross-page flows: {len(memory.get('cross_page', []))}"
    )
    lines.append("")

    lines.append("## Pages")
    for p in memory.get("pages", []):
        fields_str = ", ".join(p.get("fields") or []) or "(no fields)"
        lines.append(f"- **{p.get('name')}** — `{p.get('route')}` ({p.get('file')}) — fields: {fields_str}")
    lines.append("")

    lines.append("## Fields")
    for f in memory.get("fields", []):
        req = "required" if f.get("required") else "optional"
        lines.append(f"- `{f.get('page')}.{f.get('name')}` : {f.get('type')} ({req})")
    lines.append("")

    lines.append("## Use-Cases")
    for u in memory.get("use_cases", []):
        lines.append(f"### {u.get('name')}")
        lines.append(u.get("description", ""))
        lines.append(f"- pages: {', '.join(u.get('pages') or []) or '(none)'}")
        lines.append(f"- endpoints: {', '.join(u.get('endpoints') or []) or '(none)'}")
        lines.append(f"- tables: {', '.join(u.get('tables') or []) or '(none)'}")
        lines.append("")

    lines.append("## Connections")
    for c in memory.get("connections", []):
        lines.append(f"- `{c.get('from')}` --[{c.get('via')}]--> `{c.get('to')}`")
    lines.append("")

    lines.append("## Cross-Page Data Flow")
    for x in memory.get("cross_page", []):
        lines.append(
            f"- {x.get('source_page')}.{x.get('source_field')} -> "
            f"{x.get('target_page')}.{x.get('target_field') or '?'} — {x.get('reason')}"
        )
    lines.append("")

    content = "\n".join(lines)
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    return path


# ── RepoMemoryIndex ─────────────────────────────────────────────────────────
class RepoMemoryIndex:
    """Lexical (TF-IDF-lite) retrieval index over a RepoMemory dict.

    Usage::

        idx = RepoMemoryIndex(memory)
        idx.retrieve("customer", k=8)
        # -> [{"kind": "page"|"field"|"use_case"|"connection"|"cross_page",
        #      "score": float, "item": <original memory entry dict>}, ...]
    """

    def __init__(self, memory: Dict[str, Any]):
        self.memory = memory or {}
        self._docs: List[Dict[str, Any]] = []
        self._token_sets: List[Set[str]] = []
        self._idf: Dict[str, float] = {}
        self._built = False

    def build(self) -> "RepoMemoryIndex":
        self._docs = []
        for p in self.memory.get("pages", []):
            text = " ".join(str(x) for x in [p.get("name"), p.get("route"), p.get("file"), *(p.get("fields") or [])] if x)
            self._docs.append({"kind": "page", "text": text, "item": p})
        for f in self.memory.get("fields", []):
            text = " ".join(str(x) for x in [f.get("name"), f.get("page"), f.get("type")] if x)
            self._docs.append({"kind": "field", "text": text, "item": f})
        for u in self.memory.get("use_cases", []):
            text = " ".join(str(x) for x in [
                u.get("name"), u.get("description"), *(u.get("pages") or []),
                *(u.get("endpoints") or []), *(u.get("tables") or [])] if x)
            self._docs.append({"kind": "use_case", "text": text, "item": u})
        for c in self.memory.get("connections", []):
            text = " ".join(str(x) for x in [c.get("from"), c.get("to"), c.get("via")] if x)
            self._docs.append({"kind": "connection", "text": text, "item": c})
        for x in self.memory.get("cross_page", []):
            text = " ".join(str(v) for v in [
                x.get("source_page"), x.get("source_field"), x.get("target_page"),
                x.get("target_field"), x.get("reason")] if v)
            self._docs.append({"kind": "cross_page", "text": text, "item": x})

        self._token_sets = [set(_tokenize(d["text"])) for d in self._docs]
        doc_freq: Dict[str, int] = {}
        for tset in self._token_sets:
            for tok in tset:
                doc_freq[tok] = doc_freq.get(tok, 0) + 1
        total = max(1, len(self._token_sets))
        self._idf = {tok: math.log((total + 1) / (df + 1)) + 1.0 for tok, df in doc_freq.items()}
        self._built = True
        return self

    def retrieve(self, query: str, k: int = 8) -> List[Dict[str, Any]]:
        if not self._built:
            self.build()
        terms = _query_terms(query)
        if not terms or not self._docs:
            return []
        default_idf = math.log(len(self._docs) + 1) + 1.0
        scored: List[Tuple[float, int]] = []
        for i, tset in enumerate(self._token_sets):
            score = 0.0
            for term in terms:
                idf = self._idf.get(term, default_idf)
                if term in tset:
                    score += idf
                    continue
                if len(term) >= 4:
                    for tok in tset:
                        if len(tok) >= 4 and (term in tok or tok in term):
                            score += 0.5 * idf
                            break
            if score > 0.0:
                scored.append((score, i))
        scored.sort(key=lambda sx: (-sx[0], sx[1]))
        out: List[Dict[str, Any]] = []
        for score, i in scored[:max(1, k)]:
            d = self._docs[i]
            out.append({"kind": d["kind"], "score": round(score, 4), "item": d["item"]})
        return out


# ── Self-test ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import tempfile

    # Resolve the graph at the repo root (graph.json), mirroring scenarios.py, so
    # the self-test runs offline from a fresh checkout with no hardcoded paths.
    _here = os.path.dirname(os.path.abspath(__file__))
    _root = os.path.dirname(_here)
    _candidates = [
        os.path.join(_root, "graph.json"),
        os.path.join(_root, "system_graph.json"),
        os.path.join(_root, "test-ecosudar", "system_graph.json"),
        os.path.join(os.path.dirname(_root), "test-ecosudar", "system_graph.json"),
    ]
    GRAPH_PATH = next((p for p in _candidates if os.path.isfile(p)), _candidates[0])
    OUT_MD = os.path.join(tempfile.mkdtemp(prefix="repo_memory_"), "repo_memory.md")

    with open(GRAPH_PATH, "r", encoding="utf-8") as fh:
        graph = json.load(fh)

    memory = build_repo_memory(graph)

    n_pages = len(memory["pages"])
    n_fields = len(memory["fields"])
    n_use_cases = len(memory["use_cases"])
    n_connections = len(memory["connections"])
    n_cross_page = len(memory["cross_page"])
    n_pages_with_fields = sum(1 for p in memory["pages"] if p.get("fields"))

    print(f"pages={n_pages} (with fields={n_pages_with_fields}) fields={n_fields} "
          f"use_cases={n_use_cases} connections={n_connections} cross_page={n_cross_page}")

    assert n_pages > 100 or n_pages_with_fields > 0, "expected >100 pages or some pages with fields"
    assert n_connections > 0, "expected at least one connection"
    assert n_cross_page > 0, "expected at least one cross_page entry"

    # A use-case wired to BOTH endpoints and tables is what grounds the AI summary
    # (scenarios._build_ai_summary renders 'page cluster -> endpoints/tables').
    assert any(u.get("endpoints") and u.get("tables") for u in memory["use_cases"]), \
        "expected at least one use-case wired to both endpoints and tables"

    errs = validate_repo_memory(memory)
    assert errs == [], f"validate_repo_memory failed: {errs}"

    out_path = write_repo_memory_md(memory, OUT_MD)
    assert os.path.exists(out_path), "md file was not written"
    assert os.path.getsize(out_path) > 0, "md file is empty"

    index = RepoMemoryIndex(memory).build()
    results = index.retrieve("customer", k=8)
    print(f"retrieve('customer') -> {len(results)} results; "
          f"kinds={[r['kind'] for r in results]}")
    assert len(results) > 0, "retrieve('customer') returned nothing"

    # page-docs enrichment: a field/use-case only in the page-docs corpus must
    # appear in the memory when passed in (this is what feeds scenario generation).
    base_fields = len(memory["fields"])
    base_ucs    = len(memory["use_cases"])
    enriched = build_repo_memory(graph, page_docs=[{
        "name": (memory["pages"][0]["name"] if memory["pages"] else "SomePage"),
        "fields": [{"name": "__pagedoc_only_field__"}],
        "use_cases": [{"name": "__pagedoc_only_usecase__", "pages": ["ZZ"]}],
    }])
    assert any(f.get("name") == "__pagedoc_only_field__" and f.get("source") == "page_docs"
               for f in enriched["fields"]), "page-docs field was not merged into memory"
    assert any(u.get("name") == "__pagedoc_only_usecase__" for u in enriched["use_cases"]), \
        "page-docs use-case was not merged into memory"
    assert len(enriched["fields"]) == base_fields + 1
    assert len(enriched["use_cases"]) == base_ucs + 1
    print("[self-test] page-docs enrichment merges into memory OK")

    print("SELF-TEST PASS")
