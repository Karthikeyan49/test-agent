"""
Endpoint Request-Contract Enrichment  (Phase 1.5 — grounded, deterministic-first)
==================================================================================
The static graph maps a write endpoint to a *table* and guesses its request body
from that table's columns. That guess is wrong whenever the controller reads a
different set of fields than the table stores — e.g. `POST /queries` really wants
`{name, email, message}`, not the `queries` table columns (`user_id`,
`query_number`, `status`, …).

This module reads the CONTROLLER ITSELF and recovers each write endpoint's REAL
request contract — the fields it reads and the validation rules it enforces — so
later phases (cross-layer oracles, per-field black-box, scenarios) generate
accurate request bodies and realistic per-field data instead of `"text"`.

Design law (unchanged):
  • Deterministic FIRST. Loop 0 parses the controller source — hard facts,
    each carrying file+line evidence, `origin="parsed"`. Never overwritten.
  • AI is ADDITIVE and VERIFIED. Loop 1 runs ONLY for endpoints where parsing
    found nothing; every AI-proposed field is dropped unless its name textually
    occurs in the method body (Loop 2 verify gate). `origin="ai"`, lower conf.
  • AI never decides pass/fail. It only proposes candidate field names.

Grounded on real framework idioms found in the target (Laravel-style):
    Validator::make($request->only([...]), ['field' => 'required|email|max:100'])
    $request->validate([...])   ·   $this->validate($request, [...])
    field reads: $request->input('x') · $request->only([...]) · $_POST['x']

Ships a self-test (`python3 backend/endpoint_contracts.py`) that asserts
`POST /queries` resolves to exactly {name, email, message} with the email + max
rules, from parsing alone (no AI, no network).
"""

import os
import re
from typing import Any, Dict, List, Optional, Tuple

WRITE_METHODS = ("POST", "PUT", "PATCH")


# ── path / name helpers ───────────────────────────────────────────────────────
def _norm_path(p: str) -> str:
    """Normalize a route path for matching: lowercase, unify param placeholders,
    strip trailing slash. `/orders/{id}/status` and `/orders/{orderId}/status`
    both become `/orders/{}/status`."""
    p = (p or "").strip().lower()
    p = re.sub(r"\{[^}]*\}", "{}", p)          # {id}, {orderId} -> {}
    p = re.sub(r":[a-z0-9_]+", "{}", p)         # :id (express-style) -> {}
    p = re.sub(r"/+", "/", p).rstrip("/")
    return p or "/"


def _endpoint_key(method: str, path: str) -> str:
    return f"{(method or '').upper()} {_norm_path(path)}"


# ── controller / router discovery (standalone; reads the repo directly) ────────
_CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_]\w*)", re.I)


def _scan_source_files(repo_path: str, exts=(".php",)) -> List[Tuple[str, str]]:
    """Return [(path, content)] for candidate source files, skipping vendor/build."""
    skip = {"node_modules", "vendor", "dist", "build", ".git", "__pycache__"}
    out: List[Tuple[str, str]] = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip]
        for fn in files:
            if not fn.endswith(exts):
                continue
            fp = os.path.join(root, fn)
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                    out.append((fp, fh.read()))
            except OSError:
                continue
    return out


def _index_controllers(files: List[Tuple[str, str]]) -> Dict[str, Tuple[str, str]]:
    """ClassName -> (file_path, content) for every class that looks like a controller."""
    idx: Dict[str, Tuple[str, str]] = {}
    for fp, content in files:
        for m in _CLASS_RE.finditer(content):
            idx.setdefault(m.group(1), (fp, content))
    return idx


# `$router->post('/queries', [QueryController::class, 'store'], true)`
_ROUTE_RE = re.compile(
    r"->(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*\[\s*"
    r"([A-Za-z0-9_\\]+)::class\s*,\s*['\"]([A-Za-z_]\w*)['\"]",
    re.I,
)


def _build_router_map(files: List[Tuple[str, str]]) -> Dict[str, Tuple[str, str]]:
    """(METHOD norm_path) -> (ControllerClass, action)."""
    rmap: Dict[str, Tuple[str, str]] = {}
    for _fp, content in files:
        for m in _ROUTE_RE.finditer(content):
            method, path, ctrl, action = m.group(1), m.group(2), m.group(3), m.group(4)
            ctrl = ctrl.split("\\")[-1]
            rmap[_endpoint_key(method, path)] = (ctrl, action)
    return rmap


# ── method-body extraction (brace-balanced) ────────────────────────────────────
def _extract_method_body(content: str, action: str) -> Optional[Tuple[str, int]]:
    """Return (body_source, 1-based line of the signature) for `function <action>(`.
    Brace-matched so nested { } inside the body don't end it early. Skips braces
    that appear inside strings so a `{` in SQL/text can't unbalance the scan."""
    sig = re.search(r"function\s+" + re.escape(action) + r"\s*\(", content)
    if not sig:
        return None
    i = content.find("{", sig.end())
    if i < 0:
        return None
    line_no = content.count("\n", 0, sig.start()) + 1
    depth, j, n = 0, i, len(content)
    quote = None
    while j < n:
        c = content[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        else:
            if c in ("'", '"'):
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return content[i + 1:j], line_no
        j += 1
    return content[i + 1:], line_no   # unbalanced; return best effort


# ── validation-rule + field-read parsing ───────────────────────────────────────
# ['name' => 'required|string|max:100', ...]  — value must be a STRING literal.
_RULE_PAIR_RE = re.compile(r"['\"]([A-Za-z_][\w\.]*)['\"]\s*=>\s*'([^']*)'")
_INPUT_RE     = re.compile(r"\$request->(?:input|post|query)\s*\(\s*['\"]([A-Za-z_][\w]*)['\"]")
_ONLY_RE      = re.compile(r"\$request->only\s*\(\s*\[([^\]]*)\]")
_POST_RE      = re.compile(r"\$_(?:POST|REQUEST|GET)\s*\[\s*['\"]([A-Za-z_][\w]*)['\"]\s*\]")


def _rule_to_field(name: str, rule_str: str) -> Dict[str, Any]:
    """Turn 'required|email|max:100' into a typed field spec."""
    rules = [r.strip() for r in rule_str.split("|") if r.strip()]
    field: Dict[str, Any] = {"name": name, "rules": rules, "required": False,
                             "type": "text", "source": "validate"}
    for r in rules:
        low = r.lower()
        if low in ("required", "sometimes", "present"):
            field["required"] = field["required"] or (low == "required")
        elif low == "nullable":
            field["required"] = False
        elif low == "email":
            field["type"] = "email"
        elif low in ("integer", "numeric", "int"):
            field["type"] = "number"
        elif low in ("string",):
            field["type"] = "text"
        elif low in ("boolean", "bool"):
            field["type"] = "bool"
        elif low in ("date", "date_format", "datetime"):
            field["type"] = "date"
        elif low.startswith("max:"):
            v = low.split(":", 1)[1]
            if v.isdigit():
                field["maxLength"] = int(v)
        elif low.startswith("min:"):
            v = low.split(":", 1)[1]
            if v.isdigit():
                field["minValue"] = int(v)
        elif low.startswith("in:"):
            field["type"] = "enum"
            field["enum"] = [x for x in r.split(":", 1)[1].split(",") if x]
    return field


def _parse_contract_from_body(body: str) -> Tuple[List[Dict[str, Any]], List[int]]:
    """Extract validated fields (with rules) + plain field reads from a method body.
    Returns (fields, rule_line_offsets)."""
    fields: Dict[str, Dict[str, Any]] = {}

    # 1. validation rule maps — the strongest signal (types + required + limits)
    #    Matches both `Validator::make(<arg>, [ ... ])` and `$request->validate([ ... ])`.
    for vm in re.finditer(r"(Validator::make|->validate|this->validate)", body):
        seg = body[vm.end(): vm.end() + 1200]     # rules block follows shortly after
        # only accept pairs up to the closing of the first bracket group
        bracket = seg.find("[")
        if bracket < 0:
            continue
        for pm in _RULE_PAIR_RE.finditer(seg):
            name, rule_str = pm.group(1), pm.group(2)
            if "." in name:                        # nested rule like items.*.qty
                name = name.split(".")[0]
            f = _rule_to_field(name, rule_str)
            prev = fields.get(name)
            if not prev or len(f["rules"]) >= len(prev.get("rules", [])):
                fields[name] = {**(prev or {}), **f}

    # 2. plain reads not covered by a rule — still part of the contract, weaker
    read_names = set(_INPUT_RE.findall(body)) | set(_POST_RE.findall(body))
    for only_blk in _ONLY_RE.findall(body):
        read_names |= {q for q in re.findall(r"['\"]([A-Za-z_][\w]*)['\"]", only_blk)}
    for nm in read_names:
        if nm not in fields:
            fields[nm] = {"name": nm, "rules": [], "required": False,
                          "type": "text", "source": "read"}

    return list(fields.values()), []


# ── optional AI fallback (grounded + verified) ─────────────────────────────────
def _strip_think(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S | re.I)
    text = re.sub(r"<think>.*$", "", text, flags=re.S | re.I)
    return re.sub(r"</?think>", "", text, flags=re.I).strip()


def _ai_infer_fields(provider, endpoint: str, body: str,
                     candidate_cols: List[str]) -> List[Dict[str, Any]]:
    """Ask the provider which request fields the method reads. VERIFIED: any
    proposed name that does not textually appear in the method body is dropped.
    Returns [] on any failure — never raises, never fabricates."""
    if provider is None or not getattr(provider, "is_enabled", lambda: False)():
        return []
    sys = ("You infer the REQUEST BODY fields a web controller reads from the HTTP "
           "request. Use ONLY identifiers that appear in the given source. "
           "Answer with a bare comma-separated list of field names, nothing else.")
    prompt = (f"Endpoint: {endpoint}\n\nController method source:\n```\n{body[:4000]}\n```\n\n"
              f"Candidate column names (hint): {', '.join(candidate_cols[:40]) or 'none'}\n\n"
              "List the request-body field names this method reads from the client.")
    try:
        raw = _strip_think(provider._call_llm(prompt, sys) or "")
    except Exception:
        return []
    proposed = re.findall(r"[A-Za-z_][\w]*", raw)
    out, seen = [], set()
    for nm in proposed:
        if nm in seen:
            continue
        # VERIFY GATE: the field name must actually occur in the source
        if re.search(r"['\"]" + re.escape(nm) + r"['\"]", body):
            seen.add(nm)
            out.append({"name": nm, "rules": [], "required": False,
                        "type": "text", "source": "ai"})
    return out


# ── public API ─────────────────────────────────────────────────────────────────
def build_endpoint_contracts(graph_data: Dict[str, Any], repo_path: str,
                             provider=None) -> Dict[str, Dict[str, Any]]:
    """For every write endpoint in the graph, recover its request contract from
    the controller source. Deterministic parse first; AI fallback (verified) only
    where parsing found nothing. Returns {endpoint_key: contract}."""
    files       = _scan_source_files(repo_path)
    controllers = _index_controllers(files)
    router_map  = _build_router_map(files)

    # candidate columns per endpoint (only used as an AI hint, never authoritative)
    cols_by_table: Dict[str, List[str]] = {}
    for t in graph_data.get("dbTables", []) or []:
        cols_by_table[_norm_path(t.get("name") or "")] = \
            [c.get("name") for c in (t.get("columns") or []) if c.get("name")]

    contracts: Dict[str, Dict[str, Any]] = {}
    for ep in graph_data.get("apiEndpoints", []) or []:
        method = (ep.get("method") or "").upper()
        path   = ep.get("path") or ep.get("route") or ""
        if method not in WRITE_METHODS:
            continue
        key = _endpoint_key(method, path)

        # resolve controller + action: router map first, then endpoint's own field
        ctrl, action = router_map.get(key, (ep.get("controllerName"), None))
        if not action:
            continue
        entry = controllers.get(ctrl or "")
        if not entry:
            continue
        cfile, ccontent = entry
        mb = _extract_method_body(ccontent, action)
        if not mb:
            continue
        body, line_no = mb

        fields, _ = _parse_contract_from_body(body)
        origin, confidence = "parsed", 0.95
        if not fields:
            hint = cols_by_table.get(_norm_path(path.strip("/").split("/")[0]), [])
            ai_fields = _ai_infer_fields(provider, key, body, hint)
            if ai_fields:
                fields, origin, confidence = ai_fields, "ai", 0.6

        if not fields:
            continue

        contracts[key] = {
            "endpoint":   key,
            "method":     method,
            "path":       path,
            "controller": ctrl,
            "action":     action,
            "file":       cfile,
            "line":       line_no,
            "fields":     fields,
            "origin":     origin,
            "confidence": confidence,
            "evidence":   [{"file": cfile, "line": line_no,
                            "note": f"{ctrl}::{action} request-field parse"}],
        }
    return contracts


def enrich_graph(graph_data: Dict[str, Any],
                 contracts: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    """ADDITIVE annotation: attach `requestContract` to each write-endpoint node
    and add `READS_FIELD` edges endpoint->column-ish field name. Never removes or
    overwrites a parsed graph fact. Returns counts for reporting."""
    nodes = {n["id"]: n for n in graph_data.get("nodes", [])}
    ann_eps, new_edges = 0, 0
    # index endpoint nodes by (method, norm path)
    by_key: Dict[str, Dict[str, Any]] = {}
    for n in nodes.values():
        if n.get("type") == "APIEndpoint":
            md = n.get("metadata", {}) or {}
            by_key[_endpoint_key(md.get("method", ""), md.get("path", n.get("name", "")))] = n

    edges = graph_data.setdefault("edges", [])
    existing = {(e.get("source"), e.get("relationship"), e.get("target")) for e in edges}
    for key, contract in contracts.items():
        node = by_key.get(key)
        if not node:
            continue
        node.setdefault("metadata", {})["requestContract"] = contract
        ann_eps += 1
        for f in contract["fields"]:
            tgt = f"reqfield:{key}:{f['name']}"
            trip = (node["id"], "READS_FIELD", tgt)
            if trip not in existing:
                edges.append({"source": node["id"], "relationship": "READS_FIELD",
                              "target": tgt, "metadata": {"field": f["name"],
                              "type": f.get("type"), "required": f.get("required"),
                              "origin": contract["origin"]}})
                existing.add(trip)
                new_edges += 1
    return {"endpoints_annotated": ann_eps, "edges_added": new_edges,
            "contracts": len(contracts)}


# ── self-test (no AI, no network) ──────────────────────────────────────────────
if __name__ == "__main__":
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.join(os.path.dirname(here), "test-ecosudar")

    graph_path = os.path.join(os.path.dirname(here), "graph.json")
    if os.path.isfile(graph_path):
        graph = json.load(open(graph_path))
    else:  # minimal graph so the self-test is self-contained
        graph = {"apiEndpoints": [{"method": "POST", "path": "/queries",
                                   "controllerName": "QueryController"}],
                 "dbTables": [], "nodes": [], "edges": []}

    contracts = build_endpoint_contracts(graph, repo, provider=None)
    print(f"[self-test] parsed {len(contracts)} write-endpoint contract(s) from {repo}")

    q = contracts.get("POST /queries")
    assert q, "POST /queries contract not recovered"
    assert q["origin"] == "parsed", f"expected deterministic parse, got {q['origin']}"
    names = {f["name"]: f for f in q["fields"]}
    for expected in ("name", "email", "message"):
        assert expected in names, f"contract missing field {expected!r}: got {sorted(names)}"
    assert names["email"]["type"] == "email", "email field type not inferred"
    assert names["name"].get("maxLength") == 100, "max:100 rule not parsed"
    assert names["name"]["required"] and names["message"]["required"], "required not parsed"
    # it must NOT be the queries-table columns (the old wrong guess)
    assert "query_number" not in names and "status" not in names, \
        "contract leaked table columns — should be the real request fields only"
    print(f"[self-test] POST /queries -> {sorted(names)}  "
          f"(email={names['email']['type']}, name.maxLength={names['name'].get('maxLength')})")

    # a status-update endpoint should recover its enum field
    st = contracts.get("PUT /orders/{}/status")
    if st:
        sn = {f["name"]: f for f in st["fields"]}
        if "order_status" in sn:
            print(f"[self-test] PUT /orders/{{}}/status -> order_status "
                  f"(type={sn['order_status']['type']})")

    # enrichment is additive + counts
    if graph.get("nodes"):
        stats = enrich_graph(graph, contracts)
        print(f"[self-test] enrich_graph: {stats}")
        assert stats["endpoints_annotated"] >= 1

    print("SELF-TEST PASS")
