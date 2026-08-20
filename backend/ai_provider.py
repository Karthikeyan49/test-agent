"""
Real Ollama / vLLM / OpenAI-compatible AI Provider
Makes actual HTTP calls to a local LLM for:
  - Workflow discovery reasoning
  - Natural language graph query answering
  - Failure root cause hypothesis
  - Ambiguous field mapping resolution
Falls back to deterministic answers when AI is unavailable.
"""

import httpx
import json
import time
import os
import re
from typing import Dict, Any, List, Optional


class AIProvider:
    def __init__(self, config: Dict[str, Any] = None):
        # Read from environment variables first, fall back to provided config, then hardcoded defaults
        env_provider = os.environ.get('SYSTEMINTEL_AI_PROVIDER', '')
        env_base_url = os.environ.get('SYSTEMINTEL_AI_BASE_URL', '')
        env_model    = os.environ.get('SYSTEMINTEL_AI_MODEL', '')
        env_api_key  = os.environ.get('SYSTEMINTEL_AI_API_KEY', '')

        defaults = {
            "provider":    env_provider or "ollama",
            "base_url":    env_base_url or "http://localhost:11434",
            "model":       env_model    or "qwen3-coder:latest",
            "api_key":     env_api_key  or "",
            "temperature": 0.2,
            "max_tokens":  2048,
            "enabled":     env_provider != "disabled",
        }
        # Merge: explicit config overrides env overrides defaults
        if config:
            defaults.update(config)
        self.config = defaults
        self.request_log = []

    def is_enabled(self) -> bool:
        return self.config.get("enabled", True) and self.config.get("provider") != "disabled"

    # ── S5: third-party data-egress policy ────────────────────────────────
    def _is_external(self) -> bool:
        """True when the configured base_url is NOT a local host — i.e. sending a
        prompt would ship repo source/schema to a third party (Groq/OpenAI/…)."""
        from urllib.parse import urlparse
        host = (urlparse(self.config.get("base_url", "")).hostname or "").lower()
        # Only explicit loopback is auto-allowed. `.local` (mDNS) was dropped — on a
        # network where `exfil.local` resolves it could ship code without consent.
        return host not in ("localhost", "127.0.0.1", "::1", "")

    def _external_consent(self) -> bool:
        if self.config.get("allow_external"):
            return True
        return os.environ.get("SYSTEMINTEL_AI_ALLOW_EXTERNAL", "").lower() in ("1", "true", "yes")

    def egress_allowed(self) -> bool:
        """Local providers: always allowed. External: only with explicit consent."""
        return (not self._is_external()) or self._external_consent()

    # ── Core LLM Call ─────────────────────────────────────────────────────

    def _call_llm(self, prompt: str, system_prompt: str = "") -> Optional[str]:
        """Make real HTTP call to Ollama/vLLM/OpenAI, retrying with backoff on 429."""
        if not self.is_enabled():
            return None

        # S5: refuse to send repo content to a third-party host unless the operator
        # explicitly consented. Default provider is local (ollama); an external
        # base_url requires SYSTEMINTEL_AI_ALLOW_EXTERNAL=1 (or allow_external in
        # config). This prevents silent exfiltration of source/schema.
        if not self.egress_allowed():
            if not getattr(self, "_egress_warned", False):
                host = self.config.get("base_url", "")
                print(f"\n[AI] BLOCKED: refusing to send repo content to external host "
                      f"'{host}'. Use a local provider (ollama) or set "
                      f"SYSTEMINTEL_AI_ALLOW_EXTERNAL=1 to consent.")
                self._egress_warned = True
            self._log("llm_call", prompt[:100], 0, "BLOCKED_EXTERNAL_EGRESS")
            return None

        provider = self.config["provider"]
        base_url = self.config["base_url"].rstrip("/")
        model    = self.config["model"]
        max_retries = self.config.get("max_retries", 3)

        for attempt in range(max_retries + 1):
            start = time.time()
            try:
                if provider == "ollama":
                    # Ollama native API: POST /api/generate
                    resp = httpx.post(
                        f"{base_url}/api/generate",
                        json={
                            "model":  model,
                            "prompt": prompt,
                            "system": system_prompt,
                            "stream": False,
                            "options": {
                                "temperature":  self.config.get("temperature", 0.2),
                                "num_predict":  self.config.get("max_tokens", 2048),
                            },
                        },
                        timeout=120.0,
                    )
                    resp.raise_for_status()
                    answer = resp.json().get("response", "")

                elif provider in ("vllm", "openai"):
                    # OpenAI-compatible API: POST /v1/chat/completions
                    headers = {"Content-Type": "application/json"}
                    if self.config.get("api_key"):
                        headers["Authorization"] = f"Bearer {self.config['api_key']}"

                    messages = []
                    if system_prompt:
                        messages.append({"role": "system", "content": system_prompt})
                    messages.append({"role": "user", "content": prompt})

                    resp = httpx.post(
                        f"{base_url}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model":       model,
                            "messages":    messages,
                            "temperature": self.config.get("temperature", 0.2),
                            "max_tokens":  self.config.get("max_tokens", 2048),
                        },
                        timeout=120.0,
                    )
                    resp.raise_for_status()
                    answer = resp.json()["choices"][0]["message"]["content"]

                elif provider == "gemini":
                    # Google Gemini native generateContent API. Key travels in the
                    # x-goog-api-key header (never the URL/query, so it stays out of
                    # logs). base_url defaults to the public endpoint.
                    gbase = base_url or "https://generativelanguage.googleapis.com"
                    url = f"{gbase}/v1beta/models/{model}:generateContent"
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "temperature":     self.config.get("temperature", 0.2),
                            "maxOutputTokens": self.config.get("max_tokens", 2048),
                        },
                    }
                    if system_prompt:
                        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
                    resp = httpx.post(url, headers={"x-goog-api-key": self.config.get("api_key", ""),
                                                    "Content-Type": "application/json"},
                                      json=payload, timeout=120.0)
                    resp.raise_for_status()
                    cands = resp.json().get("candidates") or []
                    answer = ""
                    if cands:
                        parts = (cands[0].get("content") or {}).get("parts") or []
                        answer = "".join(p.get("text", "") for p in parts)
                else:
                    return None

                latency_ms = round((time.time() - start) * 1000)
                self._log("llm_call", prompt[:100], latency_ms, "OK")
                return (answer or "").strip()

            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                # Rate limited or transient server error → back off and retry
                if code in (429, 500, 502, 503, 529) and attempt < max_retries:
                    retry_after = e.response.headers.get("retry-after")
                    try:
                        wait = float(retry_after) if retry_after else min(2 ** attempt * 2, 30)
                    except (TypeError, ValueError):
                        wait = min(2 ** attempt * 2, 30)
                    print(f"\n[AI] HTTP {code} (rate/limit); retrying in {wait:.0f}s "
                          f"(attempt {attempt + 1}/{max_retries})...")
                    self._log("llm_call", prompt[:100], 0, f"RETRY_{code}_{attempt+1}")
                    time.sleep(wait)
                    continue
                body = ""
                try:
                    body = e.response.text[:200]
                except Exception:
                    pass
                print(f"\n[AI Error] HTTP {code}: {body}")
                self._log("llm_call", prompt[:100], 0, f"HTTP_{code}")
                return None
            except httpx.ConnectError as e:
                print(f"\n[AI Error] ConnectError: {e}")
                self._log("llm_call", prompt[:100], 0, f"CONNECTION_REFUSED to {base_url}")
                return None
            except httpx.TimeoutException as e:
                print(f"\n[AI Error] TimeoutException: {e}")
                self._log("llm_call", prompt[:100], 120000, "TIMEOUT")
                return None
            except Exception as e:
                import traceback
                print(f"\n[AI Error] Exception: {e}")
                traceback.print_exc()
                self._log("llm_call", prompt[:100], 0, f"ERROR: {e}")
                return None

        return None

    # ── Workflow Discovery ────────────────────────────────────────────────

    def discover_workflows(self, graph_summary: str) -> List[Dict[str, Any]]:
        """
        Ask AI to discover business workflows from system graph summary.
        Falls back to deterministic graph-path discovery if AI unavailable.
        """
        system_prompt = (
            "You are a software architecture analyst. Given a system graph summary, "
            "identify multi-step business workflows. Return JSON array with fields: "
            "name, description, confidence (0-1), steps (list of {step, entity, action})."
        )
        prompt = f"Analyze this system graph and discover business workflows:\n\n{graph_summary}"

        ai_response = self._call_llm(prompt, system_prompt)
        if ai_response:
            try:
                # Try to parse JSON from AI response
                start = ai_response.find('[')
                end   = ai_response.rfind(']') + 1
                if start >= 0 and end > start:
                    return json.loads(ai_response[start:end])
            except (json.JSONDecodeError, ValueError):
                pass
            # Return as single workflow with raw text
            return [{"name": "AI-Discovered Workflow", "description": ai_response, "confidence": 0.85, "steps": []}]
        return []  # Caller should use deterministic fallback

    # ── Natural Language Query ────────────────────────────────────────────

    def query_system(self, question: str, graph_context: str) -> Dict[str, Any]:
        """
        Answer natural language questions about the system using graph context.
        Falls back to keyword search if AI unavailable.
        """
        system_prompt = (
            "You are SystemIntel, a software system intelligence assistant. "
            "Answer questions about the system architecture using the provided graph context. "
            "Always cite specific files, line numbers, table names, and API endpoints."
        )
        prompt = (
            f"Graph Context:\n{graph_context}\n\n"
            f"Question: {question}\n\n"
            f"Provide a detailed, evidence-based answer."
        )

        ai_response = self._call_llm(prompt, system_prompt)
        if ai_response:
            return {"answer": ai_response, "source": "AI", "confidence": 0.90}

        return {"answer": None, "source": "FALLBACK", "confidence": 0.0}

    # ── Failure Root Cause ────────────────────────────────────────────────

    def analyze_failure(self, failure_context: str) -> Dict[str, Any]:
        """
        Ask AI to analyze test failure and suggest root cause.
        Falls back to pattern matching if AI unavailable.
        """
        system_prompt = (
            "You are a debugging expert. Analyze the test failure context and provide: "
            "1) Probable root cause, 2) Affected file and line, 3) Suggested fix. "
            "Be specific with file names and line numbers from the provided context."
        )

        ai_response = self._call_llm(failure_context, system_prompt)
        if ai_response:
            return {"analysis": ai_response, "source": "AI", "confidence": 0.85}
        return {"analysis": None, "source": "FALLBACK", "confidence": 0.0}

    # ── RAG-grounded scenario proposals ───────────────────────────────────

    def propose_scenarios_with_rag(self, target: str, rag_context: str,
                                   max_items: int = 8) -> Dict[str, Any]:
        """Propose candidate test scenarios for `target`, GROUNDED on retrieved
        page-docs / graph RAG context.

        Two honest paths:
          • a model is reachable AND egress is allowed  → send the RAG context in the
            prompt, return the LLM proposals tagged ai=True, source="llm".
          • otherwise (no model, or S5 blocks external egress) → return DETERMINISTIC
            proposals derived straight from the RAG context, tagged ai=False,
            source="offline-rag". These are clearly NOT a model's output — the caller
            (and the reader) must never mistake offline-rag for "the model said".

        Either way the deterministic engine still decides pass/fail — proposals are
        only candidate scenarios to run, never verdicts."""
        system_prompt = (
            "You are a QA test designer. Using ONLY the provided system context "
            "(pages, form fields, endpoints, tables), propose grounded end-to-end "
            "test scenarios. Return a JSON array of {name, page, endpoint, fields}."
        )
        prompt = (f"Target: {target}\n\nSystem context (retrieved via RAG):\n"
                  f"{rag_context}\n\nPropose up to {max_items} grounded scenarios.")

        if self.is_enabled() and self.egress_allowed():
            ai_response = self._call_llm(prompt, system_prompt)
            if ai_response:
                try:
                    start, end = ai_response.find('['), ai_response.rfind(']') + 1
                    if start >= 0 and end > start:
                        items = json.loads(ai_response[start:end])
                        if isinstance(items, list):
                            return {"ai": True, "source": "llm",
                                    "proposals": items[:max_items]}
                except (json.JSONDecodeError, ValueError):
                    pass
                return {"ai": True, "source": "llm",
                        "proposals": [{"name": "AI proposal", "raw": ai_response}]}
            # model unreachable at call time → fall through to offline derivation.

        proposals = self._offline_rag_proposals(rag_context, max_items)
        return {"ai": False, "source": "offline-rag",
                "reason": ("no model reachable or external egress not consented "
                           "(S5) — proposals derived deterministically from the RAG "
                           "context, NOT from a language model"),
                "proposals": proposals}

    @staticmethod
    def _offline_rag_proposals(rag_context: str, max_items: int) -> List[Dict[str, Any]]:
        """Deterministically mine candidate scenarios from the retrieved RAG context.
        Grounded by construction: every proposal names an endpoint / page / field that
        literally appears in the context, so nothing is invented."""
        endpoints = re.findall(r"\b(GET|POST|PUT|PATCH|DELETE)\s+(/[^\s,]*)", rag_context)
        proposals: List[Dict[str, Any]] = []
        seen: set = set()
        for method, path in endpoints:
            key = (method, path)
            if key in seen:
                continue
            seen.add(key)
            verb = {"POST": "create via", "PUT": "update via", "PATCH": "update via",
                    "DELETE": "delete via", "GET": "read via"}.get(method, "exercise")
            proposals.append({
                "name": f"{verb} {method} {path}",
                "endpoint": f"{method} {path}",
                "grounding": "endpoint present in retrieved RAG context",
                "source": "offline-rag",
            })
            if len(proposals) >= max_items:
                break
        return proposals

    # ── Logging ───────────────────────────────────────────────────────────

    def _log(self, purpose: str, snippet: str, latency_ms: int, status: str):
        self.request_log.append({
            "timestamp":  time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "provider":   self.config["provider"],
            "model":      self.config["model"],
            "purpose":    purpose,
            "snippet":    snippet,
            "latencyMs":  latency_ms,
            "status":     status,
        })

    def get_logs(self) -> List[Dict]:
        return self.request_log


if __name__ == "__main__":
    # ── S5 egress-policy self-test (offline) ──────────────────────────────────
    # Local provider → egress allowed.
    p = AIProvider({"provider": "ollama", "base_url": "http://localhost:11434"})
    assert p.egress_allowed() is True

    # External provider, no consent → blocked; _call_llm returns None without a request.
    p = AIProvider({"provider": "openai", "base_url": "https://api.groq.com/openai/v1"})
    assert p._is_external() is True
    assert p.egress_allowed() is False
    assert p._call_llm("send my source code") is None
    assert any(r["status"] == "BLOCKED_EXTERNAL_EGRESS" for r in p.get_logs())

    # External provider WITH explicit consent → allowed (would then attempt a call).
    p = AIProvider({"provider": "openai", "base_url": "https://api.groq.com/openai/v1",
                    "allow_external": True})
    assert p.egress_allowed() is True

    # ── RAG offline fallback: no model reachable → deterministic, honestly labelled ──
    ctx = ("PAGES:\n  - Checkout (/checkout) [fields: coupon_code]\n"
           "API ENDPOINTS:\n  - POST /checkout\n  - GET /orders\n")
    # A local-but-unreachable provider (is_enabled True, call returns None) OR an
    # external-no-consent provider (egress blocked) must BOTH yield offline-rag, never
    # a fabricated 'model said' proposal.
    p = AIProvider({"provider": "openai", "base_url": "https://api.groq.com/openai/v1"})
    out = p.propose_scenarios_with_rag("test the checkout flow", ctx)
    assert out["ai"] is False and out["source"] == "offline-rag", out
    eps = {pr["endpoint"] for pr in out["proposals"]}
    assert "POST /checkout" in eps and "GET /orders" in eps, out
    # every offline proposal is grounded in an endpoint that literally appears in ctx.
    for pr in out["proposals"]:
        assert pr["endpoint"].split(" ", 1)[1] in ctx, pr
    # S5 is untouched: the external-no-consent provider never actually egressed.
    assert p.egress_allowed() is False

    # ── gemini provider is external → S5-gated; blocked without consent (offline) ──
    g = AIProvider({"provider": "gemini", "model": "gemini-3.6-flash",
                    "base_url": "https://generativelanguage.googleapis.com", "api_key": "x"})
    assert g._is_external() is True, "public Gemini endpoint must be treated as external"
    assert g.egress_allowed() is False, "gemini must be blocked without SYSTEMINTEL_AI_ALLOW_EXTERNAL"
    assert g._call_llm("hello") is None, "no external call may be made without consent"
    assert any(r["status"] == "BLOCKED_EXTERNAL_EGRESS" for r in g.get_logs())

    print("ai_provider SELF-TEST PASS (S5 external-egress policy + offline-rag fallback + gemini gate)")
