"""
AI assist points — the effective, low-risk places for AI in SystemIntel.

Every function here follows the tool's rule: **AI only proposes; a deterministic
check still decides**, and outputs are constrained to reality so the model cannot
hallucinate a verdict, an endpoint, or an unchecked claim.

  1. valid_data.realistic_value / realistic_body   — realistic inputs (separate module)
  2. explain_failures()  — root-cause + fix suggestion for a failure cluster (advisory only)
  3. propose_oracles()   — AI-proposed business invariants / metamorphic relations
                           (returned for the deterministic engines to CHECK, never trusted)
  4. repair_route()      — map a logical action to a REAL endpoint from the graph
                           (constrained to the provided list — cannot invent a route)
  5. vision_gemini       — screenshot → field selector (separate module)
"""
import json
import re
from typing import Any, Dict, List, Optional


def _ask(provider: Any, prompt: str, system: str = "") -> Optional[str]:
    if provider is None or not getattr(provider, "is_enabled", lambda: False)():
        return None
    try:
        return provider._call_llm(prompt, system) if system else provider._call_llm(prompt)
    except Exception:
        return None


def _json(text: Optional[str]) -> Optional[Any]:
    if not text:
        return None
    for cand in (text, (re.search(r'[\[{].*[\]}]', text, re.DOTALL) or [None])[0]):
        if not cand:
            continue
        try:
            return json.loads(cand if isinstance(cand, str) else cand.group(0))
        except Exception:
            continue
    return None


# ── 2. Failure triage (advisory) ──────────────────────────────────────────────
def explain_failures(failures: List[Dict[str, Any]], code_snippet: str = "",
                     provider: Any = None) -> Dict[str, Any]:
    """Given a cluster of failing tests (+ optional controller code), ask the model
    for a likely root cause and a concrete fix. ADVISORY ONLY — it never changes a
    verdict; it annotates the report. Returns {rootCause, suggestedFix, confidence}
    or {} when no AI / unparseable."""
    if not failures:
        return {}
    lines = "\n".join(f"- {f.get('id','?')}: {f.get('ep','')} exp={f.get('exp','')} "
                      f"got={f.get('act','')} :: {f.get('r','')}" for f in failures[:20])
    prompt = (
        "You are triaging automated API/UI test failures. Given the failing cases "
        "and (optionally) the controller source, state the SINGLE most likely root "
        "cause and a concrete one-line fix. Respond as JSON: "
        '{"rootCause": "...", "suggestedFix": "...", "confidence": "low|medium|high"}.\n\n'
        f"Failing cases:\n{lines}\n\n"
        f"Controller source (may be truncated):\n{code_snippet[:2500]}"
    )
    obj = _json(_ask(provider, prompt))
    if isinstance(obj, dict) and obj.get("rootCause"):
        return {"rootCause": str(obj.get("rootCause"))[:400],
                "suggestedFix": str(obj.get("suggestedFix", ""))[:400],
                "confidence": str(obj.get("confidence", "low"))}
    return {}


# ── 3. Oracle proposal (proposed, then deterministically checked) ─────────────
def propose_oracles(controller_name: str, code_snippet: str = "",
                    provider: Any = None) -> List[Dict[str, str]]:
    """Ask the model to propose business invariants / metamorphic relations implied
    by the code (e.g. 'order.total == sum(line items)'). These are PROPOSALS only —
    the caller feeds them to the deterministic invariant/metamorphic engines, which
    actually check them. Returns a list of {kind, statement} (kind in
    invariant|metamorphic), empty when no AI."""
    prompt = (
        "From this controller, propose up to 5 checkable business rules an ERP QA "
        "engineer would verify — arithmetic invariants (totals, balances), state "
        "transitions, or metamorphic relations (e.g. adding a line item increases "
        "the total). Respond as a JSON array of "
        '{"kind":"invariant|metamorphic","statement":"..."}. Only rules verifiable '
        "from request/response/DB, no vague advice.\n\n"
        f"Controller {controller_name}:\n{code_snippet[:3000]}"
    )
    arr = _json(_ask(provider, prompt))
    out: List[Dict[str, str]] = []
    if isinstance(arr, list):
        for it in arr[:5]:
            if isinstance(it, dict) and it.get("statement"):
                kind = str(it.get("kind", "invariant")).lower()
                out.append({"kind": "metamorphic" if "meta" in kind else "invariant",
                            "statement": str(it["statement"])[:200]})
    return out


# ── 4. Route repair (constrained to REAL endpoints — cannot invent) ───────────
def repair_route(logical_action: str, real_endpoints: List[str],
                 provider: Any = None) -> Optional[str]:
    """Map a logical action (e.g. 'create a purchase order') to the best-matching
    REAL endpoint. The result MUST be one of `real_endpoints` — if the model returns
    anything else it is rejected (None). This is what stops the scenario layer from
    reading React component names as routes. Returns an endpoint string or None."""
    if not real_endpoints:
        return None
    listing = "\n".join(f"{i}. {e}" for i, e in enumerate(real_endpoints[:120]))
    prompt = (
        f"Pick the ONE endpoint that best performs this action: \"{logical_action}\".\n"
        "Reply with ONLY the exact endpoint string from the list, nothing else.\n\n"
        f"{listing}"
    )
    ans = _ask(provider, prompt)
    if not ans:
        return None
    ans = ans.strip().splitlines()[0].strip().strip('"').strip("'")
    # Hard constraint: the answer must be a real endpoint (exact, else substring match).
    if ans in real_endpoints:
        return ans
    for e in real_endpoints:
        if e and (e in ans or ans in e):
            return e
    return None


if __name__ == "__main__":
    # ── offline self-tests with a scripted mock provider (no network) ─────────
    class Mock:
        def __init__(self, reply): self.reply = reply
        def is_enabled(self): return True
        def _call_llm(self, p, s=""): return self.reply

    # 2) failure triage parses JSON and is advisory
    fx = [{"id": "T1", "ep": "POST /orders", "exp": "201", "act": "500", "r": "server error"}]
    r = explain_failures(fx, "public function create(){ $x = $a / $b; }",
                         Mock('{"rootCause":"division by zero when qty is 0","suggestedFix":"guard $b!=0","confidence":"high"}'))
    assert r["rootCause"].startswith("division") and r["confidence"] == "high", r
    assert explain_failures(fx, "", provider=None) == {}          # no AI -> empty, never fabricated
    print("[2] failure triage OK")

    # 3) oracle proposals are normalized + capped
    ora = propose_oracles("OrderController", "total = sum(items)",
                          Mock('[{"kind":"invariant","statement":"total == sum(line_items)"},'
                               '{"kind":"metamorphic","statement":"adding an item increases total"}]'))
    assert len(ora) == 2 and ora[0]["kind"] == "invariant" and ora[1]["kind"] == "metamorphic", ora
    assert propose_oracles("X", "", provider=None) == []
    print("[3] oracle proposal OK")

    # 4) route repair is CONSTRAINED to the real list — a hallucinated route is rejected
    eps = ["POST /orders", "GET /orders/{id}", "POST /admin/purchase-orders"]
    assert repair_route("create a purchase order", eps, Mock("POST /admin/purchase-orders")) == "POST /admin/purchase-orders"
    assert repair_route("x", eps, Mock("POST /totally/made-up")) is None      # not in list -> rejected
    assert repair_route("x", eps, provider=None) is None
    print("[4] route repair OK (constrained to real endpoints)")

    print("SELF-TEST PASS — AI proposes, deterministic checks/constraints decide")
