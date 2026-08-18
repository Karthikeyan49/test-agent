"""
GraphRAG Retrieval over the SystemIntel System Graph
Given a natural-language query, retrieve only the relevant SUBGRAPH
neighborhood instead of dumping the whole graph into the LLM prompt.

Motivation
----------
The autonomous agent (see agent.py) previously stuffed ~12k chars of graph +
file text into every prompt. On large repos (test-ecosudar has 2000+ nodes,
81 tables) that overflows the context window and trips provider rate limits.

This module scores every node lexically (TF-IDF-lite token overlap) against the
query, keeps the top-k seed nodes, expands to their 1-hop edge neighborhood in
both directions, and renders a compact text "context" describing just that
subgraph. That context is what gets fed to the LLM instead of the full dump.

Design notes
------------
  - Core is pure Python stdlib — no required third-party dependency.
  - If `sentence_transformers` is importable it is used for semantic scoring;
    otherwise (the default here) retrieval falls back to lexical scoring, which
    is fully self-sufficient.
  - Node "documents" are built from name + type + metadata.filePath (plus
    routePath / method / path when present), matching the graph JSON emitted by
    graph_builder.SystemGraphBuilder.
"""

import json
import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple

# Optional semantic backend. NOT installed in this environment — the guarded
# import must fail gracefully and leave lexical scoring as the active path.
try:
    from sentence_transformers import SentenceTransformer  # type: ignore
    _HAS_SENTENCE_TRANSFORMERS = True
except Exception:  # ImportError, or any transitive failure
    SentenceTransformer = None  # type: ignore
    _HAS_SENTENCE_TRANSFORMERS = False


# Common English / query-noise words that carry no discriminative signal.
_STOPWORDS: Set[str] = {
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with",
    "is", "are", "be", "by", "at", "from", "as", "that", "this", "it",
    "show", "list", "find", "get", "all", "me", "which", "what", "where",
    "how", "does", "do", "into", "about", "related", "page", "pages",
}

# Metadata keys worth folding into a node's searchable document, in priority
# order. filePath first because file paths are the strongest lexical anchor.
_SEARCHABLE_META_KEYS: Tuple[str, ...] = (
    "filePath", "routePath", "path", "method", "dataType",
)

# camelCase boundary: a lower/digit immediately followed by an upper.
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_ALNUM_TOKEN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    """Split arbitrary identifier/path text into lowercase word tokens.

    Handles snake_case, kebab-case, path separators, and camelCase so that
    e.g. "PurchaseOrderForm" -> ["purchase", "order", "form"] and
    "purchase_orders" -> ["purchase", "orders"].
    """
    if not text:
        return []
    spaced = _CAMEL_BOUNDARY.sub(" ", text)
    return _ALNUM_TOKEN.findall(spaced.lower())


def _query_terms(query: str) -> List[str]:
    """Tokenize a natural-language query, dropping stopwords and 1-char noise."""
    return [t for t in _tokenize(query) if len(t) > 1 and t not in _STOPWORDS]


class GraphRAGIndex:
    """Lexical (TF-IDF-lite) retrieval index over a System Graph.

    Usage::

        index = GraphRAGIndex(graph_data)
        index.build()
        result = index.retrieve("purchase order vendor", k=8)
        # result == {"node_ids": [...], "files": [...], "context": "..."}

    Parameters
    ----------
    graph_data:
        Parsed system_graph.json — a dict with "nodes" and "edges" lists, as
        produced by graph_builder.SystemGraphBuilder.export()/to_dict().
    """

    def __init__(self, graph_data: Dict[str, Any]):
        self.graph_data: Dict[str, Any] = graph_data or {}
        self.nodes: List[Dict[str, Any]] = list(self.graph_data.get("nodes", []))
        self.edges: List[Dict[str, Any]] = list(self.graph_data.get("edges", []))

        # id -> node, for O(1) lookup during neighborhood expansion.
        self.node_by_id: Dict[str, Dict[str, Any]] = {}
        # node id -> token list / token set for that node's document.
        self._node_tokens: Dict[str, List[str]] = {}
        self._node_token_set: Dict[str, Set[str]] = {}
        # token -> inverse document frequency weight.
        self._idf: Dict[str, float] = {}
        # node id -> list of (edge, "out"|"in", neighbor_id).
        self._adjacency: Dict[str, List[Tuple[Dict[str, Any], str, str]]] = {}

        # Optional semantic layer (only populated if sentence_transformers loads).
        self._embedder: Optional["SentenceTransformer"] = None
        self._node_embeddings: Optional[Any] = None
        self._embed_order: List[str] = []

        self._built = False

    # ── Build ─────────────────────────────────────────────────────────────

    def build(self) -> "GraphRAGIndex":
        """Precompute node documents, IDF weights and the edge adjacency map.

        Returns self so callers can chain ``GraphRAGIndex(g).build()``.
        """
        self.node_by_id = {n["id"]: n for n in self.nodes if "id" in n}

        # 1. Node documents + document frequencies for IDF.
        doc_freq: Dict[str, int] = {}
        for node in self.nodes:
            node_id = node.get("id")
            if not node_id:
                continue
            tokens = self._node_document_tokens(node)
            self._node_tokens[node_id] = tokens
            token_set = set(tokens)
            self._node_token_set[node_id] = token_set
            for tok in token_set:
                doc_freq[tok] = doc_freq.get(tok, 0) + 1

        # 2. Smoothed IDF: rare tokens (e.g. "vendor") outweigh common ones.
        total_docs = max(1, len(self._node_tokens))
        for tok, df in doc_freq.items():
            self._idf[tok] = math.log((total_docs + 1) / (df + 1)) + 1.0

        # 3. Bidirectional adjacency for 1-hop expansion.
        for edge in self.edges:
            src = edge.get("source")
            tgt = edge.get("target")
            if src is None or tgt is None:
                continue
            if src in self.node_by_id:
                self._adjacency.setdefault(src, []).append((edge, "out", tgt))
            if tgt in self.node_by_id:
                self._adjacency.setdefault(tgt, []).append((edge, "in", src))

        # 4. Optional semantic embeddings (skipped when the dep is unavailable).
        if _HAS_SENTENCE_TRANSFORMERS:
            self._try_build_embeddings()

        self._built = True
        return self

    def _node_document_tokens(self, node: Dict[str, Any]) -> List[str]:
        """Build the bag-of-tokens document for a single node."""
        parts: List[str] = [node.get("name", ""), node.get("type", "")]
        meta = node.get("metadata", {}) or {}
        for key in _SEARCHABLE_META_KEYS:
            val = meta.get(key)
            if val:
                parts.append(str(val))
        tokens: List[str] = []
        for part in parts:
            tokens.extend(_tokenize(part))
        return tokens

    def _try_build_embeddings(self) -> None:
        """Best-effort semantic index. Any failure silently disables it."""
        try:
            self._embedder = SentenceTransformer("all-MiniLM-L6-v2")
            self._embed_order = [n["id"] for n in self.nodes if "id" in n]
            corpus = [self._node_text(self.node_by_id[i]) for i in self._embed_order]
            self._node_embeddings = self._embedder.encode(
                corpus, convert_to_numpy=True, normalize_embeddings=True
            )
        except Exception:
            self._embedder = None
            self._node_embeddings = None
            self._embed_order = []

    @staticmethod
    def _node_text(node: Dict[str, Any]) -> str:
        """Human-readable one-line description of a node (for embeddings)."""
        meta = node.get("metadata", {}) or {}
        fp = meta.get("filePath") or meta.get("path") or meta.get("routePath") or ""
        return f"{node.get('type', '')} {node.get('name', '')} {fp}".strip()

    # ── Scoring ───────────────────────────────────────────────────────────

    def _score_nodes_lexical(self, terms: List[str]) -> Dict[str, float]:
        """TF-IDF-lite score of every node against the query terms.

        A node earns an exact-match term's full IDF weight, and a reduced
        weight (0.5x) for a partial match — where a query term is a substring
        of a node token or vice-versa (min length 4). This bridges plural /
        singular and prefix cases such as "orders" vs "order_id".
        """
        scores: Dict[str, float] = {}
        default_idf = math.log(len(self._node_tokens) + 1) + 1.0
        for node_id, token_set in self._node_token_set.items():
            score = 0.0
            for term in terms:
                idf = self._idf.get(term, default_idf)
                if term in token_set:
                    score += idf
                    continue
                # Partial (substring) fallback for near-miss word forms.
                if len(term) >= 4:
                    for tok in token_set:
                        if len(tok) >= 4 and (term in tok or tok in term):
                            score += 0.5 * idf
                            break
            if score > 0.0:
                scores[node_id] = score
        return scores

    def _score_nodes_semantic(self, query: str) -> Dict[str, float]:
        """Cosine-similarity score using sentence-transformer embeddings.

        Only reachable when the optional dependency loaded successfully.
        """
        if self._embedder is None or self._node_embeddings is None:
            return {}
        try:
            q = self._embedder.encode(
                [query], convert_to_numpy=True, normalize_embeddings=True
            )[0]
            sims = self._node_embeddings @ q  # normalized -> dot == cosine
            return {
                self._embed_order[i]: float(sims[i])
                for i in range(len(self._embed_order))
                if sims[i] > 0.0
            }
        except Exception:
            return {}

    # ── Retrieve ──────────────────────────────────────────────────────────

    def retrieve(self, query: str, k: int = 8) -> Dict[str, Any]:
        """Retrieve the relevant subgraph for a natural-language query.

        Scores all nodes, keeps the top-``k`` seed nodes, expands to their
        1-hop edge neighborhood (both directions), and renders a compact text
        context describing the retrieved nodes and their edges.

        Parameters
        ----------
        query:
            The natural-language query, e.g. "purchase order vendor".
        k:
            Number of top-scoring seed nodes to anchor retrieval on.

        Returns
        -------
        dict with keys:
            ``node_ids`` : ids of the retrieved subgraph (seeds first, then
                           neighbors, in relevance order).
            ``files``    : unique, de-duplicated source file paths referenced
                           by the retrieved nodes.
            ``context``  : compact text block listing the retrieved nodes and
                           their edges — the LLM-facing replacement for the
                           full graph dump.
        """
        if not self._built:
            self.build()

        terms = _query_terms(query)

        # Prefer semantic scoring when available, else lexical. Semantic hits
        # can be diffuse, so lexical always contributes as a tie-breaker.
        scores = self._score_nodes_lexical(terms)
        if _HAS_SENTENCE_TRANSFORMERS:
            for node_id, sem in self._score_nodes_semantic(query).items():
                scores[node_id] = scores.get(node_id, 0.0) + sem

        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        seed_ids = [node_id for node_id, _ in ranked[:max(1, k)]]

        # 1-hop expansion (both directions), preserving seed relevance order.
        ordered_ids: List[str] = list(seed_ids)
        seen: Set[str] = set(seed_ids)
        for seed_id in seed_ids:
            for _edge, _direction, neighbor_id in self._adjacency.get(seed_id, []):
                if neighbor_id in self.node_by_id and neighbor_id not in seen:
                    seen.add(neighbor_id)
                    ordered_ids.append(neighbor_id)

        files = self._collect_files(ordered_ids)
        context = self._build_context(query, seed_ids, seen)

        return {
            "node_ids": ordered_ids,
            "files": files,
            "context": context,
        }

    def _collect_files(self, node_ids: List[str]) -> List[str]:
        """De-duplicated, order-preserving list of source files for the nodes."""
        files: List[str] = []
        seen: Set[str] = set()
        for node_id in node_ids:
            node = self.node_by_id.get(node_id, {})
            fp = (node.get("metadata", {}) or {}).get("filePath")
            if fp and fp not in seen:
                seen.add(fp)
                files.append(fp)
        return files

    def _build_context(self, query: str, seed_ids: List[str],
                       subgraph_ids: Set[str]) -> str:
        """Render the compact text context for the retrieved subgraph.

        Each seed node is listed with its type, name and file, followed by up
        to a handful of its edges (relationship + neighbor), so the LLM sees
        how the seeds connect to the rest of the system.
        """
        max_edges_per_node = 6
        lines: List[str] = [f"# Relevant subgraph for query: \"{query}\""]

        for seed_id in seed_ids:
            node = self.node_by_id.get(seed_id)
            if not node:
                continue
            meta = node.get("metadata", {}) or {}
            locator = meta.get("filePath") or meta.get("path") or \
                meta.get("routePath") or "N/A"
            lines.append(
                f"\n[{node.get('type', '?')}] {node.get('name', '?')} "
                f"(id={seed_id}, file={locator})"
            )

            edges = self._adjacency.get(seed_id, [])
            for edge, direction, neighbor_id in edges[:max_edges_per_node]:
                neighbor = self.node_by_id.get(neighbor_id)
                if not neighbor:
                    continue
                rel = edge.get("relationship", "RELATED")
                label = f"[{neighbor.get('type', '?')}] {neighbor.get('name', '?')}"
                if direction == "out":
                    lines.append(f"  --({rel})--> {label}")
                else:
                    lines.append(f"  <--({rel})-- {label}")
            if len(edges) > max_edges_per_node:
                lines.append(f"  ...(+{len(edges) - max_edges_per_node} more edges)")

        return "\n".join(lines)


def retrieve_context(graph_data: Dict[str, Any], query: str,
                     max_chars: int = 4000) -> str:
    """Convenience: build an index and return just the context string.

    This is the drop-in the agent uses in place of the full graph dump.

    Parameters
    ----------
    graph_data:
        Parsed system_graph.json.
    query:
        Natural-language query.
    max_chars:
        Hard cap on the returned context length; longer output is truncated
        with a trailing "...[truncated]..." marker.
    """
    index = GraphRAGIndex(graph_data).build()
    context = index.retrieve(query)["context"]
    if len(context) > max_chars:
        marker = "\n...[truncated]..."
        context = context[:max(0, max_chars - len(marker))] + marker
    return context


# ── Self-test ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    GRAPH_PATH = "/home/karthikeyan/vscode/test-ecosudar/system_graph.json"
    MAX_CHARS = 4000

    with open(GRAPH_PATH, "r", encoding="utf-8") as fh:
        graph = json.load(fh)

    print(f"Loaded graph: {len(graph.get('nodes', []))} nodes, "
          f"{len(graph.get('edges', []))} edges")
    print(f"Semantic backend available: {_HAS_SENTENCE_TRANSFORMERS} "
          f"(lexical fallback {'in use' if not _HAS_SENTENCE_TRANSFORMERS else 'secondary'})")

    index = GraphRAGIndex(graph).build()

    for query in ("orders", "purchase order vendor"):
        result = index.retrieve(query)
        node_ids = result["node_ids"]
        top_names = [index.node_by_id[i].get("name", "?") for i in node_ids[:8]]

        print(f"\n=== retrieve(\"{query}\") ===")
        print(f"  nodes retrieved: {len(node_ids)}")
        print(f"  files retrieved: {len(result['files'])}")
        print(f"  top node names : {top_names}")

        context = retrieve_context(graph, query, max_chars=MAX_CHARS)

        # (a) non-empty results
        assert node_ids, f"no nodes retrieved for {query!r}"
        assert result["context"].strip(), f"empty context for {query!r}"
        # (b) at least one retrieved node name contains a query keyword
        terms = _query_terms(query)
        assert any(
            any(term in index.node_by_id[i].get("name", "").lower() for term in terms)
            for i in node_ids
        ), f"no retrieved node name contains a keyword from {query!r}"
        # (c) context string respects the max_chars cap
        assert len(context) <= MAX_CHARS, (
            f"context {len(context)} exceeds max_chars {MAX_CHARS}"
        )
        print(f"  context length : {len(context)} chars (<= {MAX_CHARS})")

    print("\nSELF-TEST PASS")
