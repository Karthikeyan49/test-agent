"""
Per-Page Documentation Builder  (Phase 0 — AI-enriched, RAG-ready)
==================================================================
For every page in the app, write one Markdown dossier that gathers EVERYTHING
about that page, so later phases generate tests with full context (via RAG):

  • input / display / other fields          (name, type, required)
  • API endpoints the page calls
  • the database tables + columns behind it, and their foreign keys
  • connectivity — field→field to other pages, page→page, module→module
  • use-cases of the page
  • ⚠ recommendations — MISSING foreign keys, MISSING normalization, and a
    completeness-fill list when a page looks copied-from-another and is missing fields

Built in a multi-loop approach, deterministic ground truth first so AI can never
corrupt a fact:

  Loop 0 · FACTS      pulled from the system graph (exact, never overwritten)
  Loop 1 · ENRICH     AI infers missing fields + writes plain-language use-cases
  Loop 2 · AUDIT      AI flags missing FKs / normalization, grounded in the schema

Deterministic heuristics also run for the audit, so useful recommendations exist
even with the AI disabled. The written .md files are the RAG corpus that
backend/repo_memory.RepoMemoryIndex indexes for test generation.
"""

import os
import re
from typing import Any, Dict, List, Optional

try:
    from repo_memory import build_repo_memory
except ImportError:  # pragma: no cover
    from backend.repo_memory import build_repo_memory  # type: ignore


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _slug(s: str) -> str:
    return re.sub(r'[^A-Za-z0-9_-]+', '_', (s or 'page')).strip('_') or 'page'


# ── deterministic data-model audit (works with or without AI) ─────────────────
def _pluralize(stem: str) -> List[str]:
    return [stem, stem + "s", stem + "es", (stem[:-1] + "ies") if stem.endswith("y") else stem + "s"]


def _singular(tn: str) -> str:
    """Rough singular of a normalized table name: orders→order, queries→query."""
    if tn.endswith("ies"):
        return tn[:-3] + "y"
    if tn.endswith("ses") or tn.endswith("xes"):
        return tn[:-2]
    if tn.endswith("s"):
        return tn[:-1]
    return tn


def audit_data_model(graph_data: Dict[str, Any]) -> Dict[str, List[str]]:
    """Deterministic schema smells: candidate missing FKs + denormalization."""
    tables = graph_data.get("dbTables", []) or []
    fks    = graph_data.get("foreignKeys", []) or []
    tnames = {_norm(t.get("name") or "") for t in tables}
    fk_src = {(_norm(fk.get("sourceTable")), _norm(fk.get("sourceColumn"))) for fk in fks}

    missing_fk: List[str] = []
    denorm: List[str] = []
    group_counter: Dict[str, int] = {}

    for t in tables:
        tn = t.get("name") or ""
        cols = t.get("columns") or []
        colnames = {_norm(c.get("name") or "") for c in cols}
        for c in cols:
            cn = c.get("name") or ""
            ncn = _norm(cn)
            # a *_id column that references nothing and isn't this table's own PK
            own_pk_names = ("id", _norm(tn) + "id", _singular(_norm(tn)) + "id")
            if ncn.endswith("id") and ncn not in own_pk_names and not c.get("isPrimaryKey"):
                if (_norm(tn), ncn) not in fk_src:
                    stem = re.sub(r'id$', '', ncn)
                    parent = next((p for p in _pluralize(stem) if p in tnames), None)
                    # skip when the "parent" is this same table — that's the PK, not a FK
                    if parent and _norm(parent) != _norm(tn):
                        missing_fk.append(f"`{tn}.{cn}` looks like a foreign key to `{parent}` but no FK constraint is declared.")
            # storing both x_id and x_name/x_code in the same table = denormalized
            if ncn.endswith("name") or ncn.endswith("code"):
                base = re.sub(r'(name|code)$', '', ncn)
                if base + "id" in colnames:
                    denorm.append(f"`{tn}` stores both `{base}_id` and `{cn}` — the name/code duplicates data from the parent table (denormalized).")
        # repeating column groups across tables (address-ish)
        for key in ("address", "city", "state", "pincode", "country"):
            if any(key in cn for cn in colnames):
                group_counter[key] = group_counter.get(key, 0) + 1

    for key, n in group_counter.items():
        if n >= 3:
            denorm.append(f"`{key}`-style columns repeat across {n} tables — consider a shared `addresses` table (normalization).")

    return {"missing_fk": sorted(set(missing_fk)), "denormalization": sorted(set(denorm))}


# ── assemble deterministic facts for one page ─────────────────────────────────
def _page_facts(page: Dict[str, Any], memory: Dict[str, Any],
                graph_data: Dict[str, Any]) -> Dict[str, Any]:
    pid  = page.get("id") or ""
    name = page.get("name") or "Page"
    route = page.get("route") or page.get("routePath") or ""

    fields = [f for f in memory.get("fields", []) if f.get("page") == name] \
             or [{"name": fn} for fn in (page.get("fields") or [])]

    conns = memory.get("connections", []) or []
    ep_ids = [c["to"] for c in conns if c.get("from", "").startswith(f"page:{name}/") and c.get("to", "").startswith("endpoint:")]
    endpoints = sorted(set(e.replace("endpoint:", "") for e in ep_ids))

    # page→page (module) neighbors
    nav = sorted(set(c["to"].replace("page:", "") for c in conns
                     if c.get("via") == "NAVIGATES_TO" and c.get("from") == f"page:{name}"))

    # cross-page field flows touching this page
    cross = [cp for cp in memory.get("cross_page", [])
             if cp.get("source_page") == name or cp.get("target_page") == name]

    # use-cases mentioning this page
    ucs = [u for u in memory.get("use_cases", []) if name in (u.get("pages") or [])]

    # A form page is rarely wired to its endpoints directly; its use-case cluster
    # holds the real endpoints + tables. Fold those in so the API / Database /
    # completeness / FK sections are populated instead of empty.
    uc_endpoints = sorted({e for u in ucs for e in (u.get("endpoints") or [])})
    uc_tables    = sorted({t for u in ucs for t in (u.get("tables") or [])})
    endpoints = sorted(set(endpoints) | set(uc_endpoints))

    # tables behind the endpoints (via connections endpoint:->table:) + use-case tables
    tbl_ids = [c["to"].replace("table:", "") for c in conns
               if c.get("from", "").startswith("endpoint:") and c.get("to", "").startswith("table:")
               and c.get("from", "").replace("endpoint:", "") in endpoints]
    tables = sorted(set(tbl_ids) | set(uc_tables))
    tbl_by_name = {t.get("name"): t for t in graph_data.get("dbTables", [])}
    fks = graph_data.get("foreignKeys", []) or []
    page_fks = [fk for fk in fks if fk.get("sourceTable") in tables or fk.get("targetTable") in tables]

    return {"name": name, "route": route, "file": page.get("file"),
            "fields": fields, "endpoints": endpoints, "nav": nav,
            "cross": cross, "use_cases": ucs, "tables": tables,
            "table_objs": {t: tbl_by_name.get(t) for t in tables}, "fks": page_fks}


def _facts_markdown(f: Dict[str, Any]) -> str:
    L = [f"# {f['name']}", ""]
    if f.get("route"): L.append(f"**Route:** `{f['route']}`  ")
    if f.get("file"):  L.append(f"**Source:** `{f['file']}`")
    L.append("")
    L.append("## Fields")
    if f["fields"]:
        L.append("| Field | Type | Required |")
        L.append("|---|---|---|")
        for fld in f["fields"]:
            L.append(f"| {fld.get('name')} | {fld.get('type','text')} | {fld.get('required', False)} |")
    else:
        L.append("_No fields detected on this page._")
    L.append("")
    L.append("## API Endpoints")
    L += ([f"- `{e}`" for e in f["endpoints"]] or ["_None detected._"])
    L.append("")
    L.append("## Database")
    if f["tables"]:
        for t in f["tables"]:
            obj = f["table_objs"].get(t)
            cols = ", ".join(c.get("name") for c in (obj.get("columns") if obj else []) or [])
            L.append(f"- **{t}** — {cols or '(columns unknown)'}")
    else:
        L.append("_No backing tables resolved._")
    if f["fks"]:
        L.append("")
        L.append("**Foreign keys:**")
        for fk in f["fks"]:
            L.append(f"- `{fk['sourceTable']}.{fk['sourceColumn']}` → `{fk['targetTable']}.{fk['targetColumn']}`")
    L.append("")
    L.append("## Connectivity")
    L.append(f"- **Navigates to:** {', '.join(f['nav']) if f['nav'] else '—'}")
    if f["cross"]:
        L.append("- **Field → field (cross-page):**")
        for cp in f["cross"]:
            L.append(f"  - `{cp.get('source_page')}.{cp.get('source_field')}` → `{cp.get('target_page')}.{cp.get('target_field')}` — {cp.get('reason','')}")
    L.append("")
    L.append("## Use-cases")
    L += ([f"- **{u.get('name')}** — {u.get('description','')}" for u in f["use_cases"]] or ["_None grouped._"])
    return "\n".join(L)


# ── AI multi-loop enrichment (grounded) ───────────────────────────────────────
def _strip_think(text: str) -> str:
    """Remove <think>…</think> chain-of-thought that reasoning models (qwen) emit,
    so only the final answer lands in the dossier."""
    text = re.sub(r'<think>.*?</think>', '', text or '', flags=re.S | re.I)  # balanced
    text = re.sub(r'<think>.*$', '', text, flags=re.S | re.I)                # truncated/unclosed
    text = re.sub(r'</?think>', '', text, flags=re.I)                        # bare stragglers
    return text.strip()


def _ai_enrich(provider, facts: Dict[str, Any], base_md: str) -> str:
    sys = ("You are a senior QA analyst documenting ONE page of a web app. "
           "Use ONLY the facts given; never invent endpoints, tables, or fields "
           "that are not listed. Be concise and concrete.")
    known_cols = []
    for t, obj in facts["table_objs"].items():
        for c in (obj.get("columns") if obj else []) or []:
            known_cols.append(f"{t}.{c.get('name')}")
    p1 = (f"Facts for page '{facts['name']}':\n{base_md}\n\n"
          f"Backing columns available: {', '.join(known_cols) or 'none'}\n\n"
          "LOOP 1 — Write two short sections in Markdown:\n"
          "### Use-cases (plain language)\nWhat a user does on this page (3-6 bullets).\n"
          "### Completeness check\nIf this page's field list looks INCOMPLETE versus its "
          "backing columns above (e.g. copied from another page), list the fields it is "
          "likely MISSING — chosen only from the backing columns. If it looks complete, say so.")
    out1 = _strip_think(provider._call_llm(p1, sys) or "")

    p2 = (f"Page '{facts['name']}' backing tables: {', '.join(facts['tables']) or 'none'}.\n"
          f"Declared foreign keys:\n" +
          ("\n".join(f"- {fk['sourceTable']}.{fk['sourceColumn']} -> {fk['targetTable']}.{fk['targetColumn']}" for fk in facts['fks']) or "- none") +
          f"\nAll columns: {', '.join(known_cols) or 'none'}\n\n"
          "LOOP 2 — Under '### Data-model recommendations', flag ONLY real issues you can see "
          "in these columns: (a) a *_id column with no matching foreign key = MISSING FK; "
          "(b) storing both an id and its name/code = MISSING normalization. "
          "Reference exact column names. If none, say 'No issues found.'")
    out2 = _strip_think(provider._call_llm(p2, sys) or "")
    return (out1 + "\n\n" + out2).strip()


def build_page_docs(graph_data: Dict[str, Any], out_dir: str,
                    provider=None, pages_limit: Optional[int] = None,
                    only_named: Optional[List[str]] = None) -> Dict[str, Any]:
    os.makedirs(out_dir, exist_ok=True)
    memory = build_repo_memory(graph_data)
    audit  = audit_data_model(graph_data)

    pages = memory.get("pages", []) or []
    # prefer real form/detail pages (they have fields) for the demo/limit
    pages = sorted(pages, key=lambda p: -(len(p.get("fields") or [])))
    if only_named:
        want = {n.lower() for n in only_named}
        pages = [p for p in pages if (p.get("name") or "").lower() in want]
    if pages_limit:
        pages = pages[:pages_limit]

    written = []
    for page in pages:
        facts = _page_facts(page, memory, graph_data)
        md = _facts_markdown(facts)
        if provider is not None and getattr(provider, "is_enabled", lambda: False)():
            try:
                enriched = _ai_enrich(provider, facts, md)
                if enriched:
                    md += "\n\n---\n\n## AI Enrichment (grounded)\n\n" + enriched
            except Exception as e:
                md += f"\n\n> _AI enrichment skipped: {e}_"
        path = os.path.join(out_dir, f"{_slug(facts['name'])}.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")
        written.append(path)

    # app-wide data-model audit file
    audit_md = ["# Data-Model Audit", "", "## Candidate missing foreign keys"]
    audit_md += ([f"- {x}" for x in audit["missing_fk"]] or ["- None detected."])
    audit_md += ["", "## Normalization concerns"]
    audit_md += ([f"- {x}" for x in audit["denormalization"]] or ["- None detected."])
    audit_path = os.path.join(out_dir, "DATA_MODEL_AUDIT.md")
    with open(audit_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(audit_md) + "\n")

    index_md = ["# Page Documentation Index", "",
                f"{len(written)} page dossier(s) + a data-model audit. RAG corpus for test generation.", ""]
    index_md += [f"- [{os.path.basename(p)}]({os.path.basename(p)})" for p in written]
    index_path = os.path.join(out_dir, "INDEX.md")
    with open(index_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(index_md) + "\n")

    return {"pages_written": len(written), "files": written,
            "audit": audit, "index": index_path, "audit_file": audit_path, "out_dir": out_dir}


if __name__ == "__main__":
    import json, tempfile
    G = "/home/karthikeyan/vscode/test-ecosudar/system_graph.json"
    graph = json.load(open(G))
    out = tempfile.mkdtemp(prefix="page_docs_")
    # deterministic path (no AI) — must work standalone
    res = build_page_docs(graph, out, provider=None, pages_limit=5)
    print(f"[self-test] wrote {res['pages_written']} page docs to {out}")
    assert res["pages_written"] == 5
    sample = open(res["files"][0], encoding="utf-8").read()
    for section in ("# ", "## Fields", "## API Endpoints", "## Database", "## Connectivity", "## Use-cases"):
        assert section in sample, f"missing section {section!r}"
    aud = open(res["audit_file"], encoding="utf-8").read()
    assert "Candidate missing foreign keys" in aud and "Normalization" in aud
    print(f"[self-test] audit: {len(res['audit']['missing_fk'])} missing-FK, "
          f"{len(res['audit']['denormalization'])} normalization notes")
    print("SELF-TEST PASS")
