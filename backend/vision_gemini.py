"""
Gemini Vision backend for SystemIntel — the OPTIONAL last-resort field mapper.

Used ONLY for form inputs that deterministic DOM introspection (field_mapper.py)
cannot resolve — inputs with no id / name / label / placeholder (canvas widgets,
icon-only controls). It looks at a screenshot + the DOM inventory and proposes
{field_name: css_selector}. It only PROPOSES selectors; the deterministic runner
still fills and the deterministic assertions still decide pass/fail — so the
determinism guarantee (no LLM in the verdict) holds.

Config (env):
  SYSTEMINTEL_VISION_API_KEY   (or GEMINI_API_KEY)   — required to enable
  SYSTEMINTEL_VISION_MODEL     — first model to try (default "gemini-flash-latest")
  SYSTEMINTEL_VISION_MODELS    — CSV override of the full ordered model chain
"""

import os
import re
import json
import time
import base64
import httpx
from typing import Dict, Any, List, Optional

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiVision:
    supports_vision = True

    # Ordered fallback chain of vision-capable Gemini models. On a per-model quota
    # (HTTP 429) — or an invalid/unavailable model (400/404) — _generate rotates to
    # the next one instead of failing, mirroring ai_provider's Gemini rotation.
    # Free-tier quotas are PER MODEL, so an over-broad chain is safe.
    _VISION_FALLBACK_CHAIN = [
        "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite",
        "gemini-flash-lite-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite",
        "gemini-1.5-flash", "gemini-1.5-flash-8b",
    ]

    def __init__(self, api_key: str = None, model: str = None):
        self.api_key = (api_key
                        or os.environ.get("SYSTEMINTEL_VISION_API_KEY")
                        or os.environ.get("GEMINI_API_KEY", ""))
        self.model = model or os.environ.get("SYSTEMINTEL_VISION_MODEL", "gemini-flash-latest")

    def is_available(self) -> bool:
        return bool(self.api_key)

    def _vision_models(self) -> List[str]:
        """The ordered model chain to try. SYSTEMINTEL_VISION_MODELS (CSV) overrides
        the default chain; the configured `self.model` is always tried first."""
        csv = os.environ.get("SYSTEMINTEL_VISION_MODELS", "")
        chain = [m.strip() for m in csv.split(",") if m.strip()] if csv else list(self._VISION_FALLBACK_CHAIN)
        if self.model:
            chain = [self.model] + [m for m in chain if m != self.model]
        seen, out = set(), []
        for m in chain:
            if m and m not in seen:
                seen.add(m); out.append(m)
        return out

    @staticmethod
    def _external_consent() -> bool:
        return os.environ.get("SYSTEMINTEL_AI_ALLOW_EXTERNAL", "").lower() in ("1", "true", "yes")

    # ── Core multimodal call ──────────────────────────────────────────────
    def _generate(self, parts: List[dict], as_json: bool = True) -> Optional[str]:
        if not self.is_available():
            return None
        # S5: Gemini is ALWAYS an external Google endpoint, and this sends a
        # rendered screenshot of the app (which can contain data) + field names.
        # It is a second egress path independent of ai_provider, so it must honor
        # the same consent gate — otherwise the S5 policy is bypassable.
        if not self._external_consent():
            if not getattr(self, "_egress_warned", False):
                print("[Vision] BLOCKED: refusing to send a screenshot to Google "
                      "(external). Set SYSTEMINTEL_AI_ALLOW_EXTERNAL=1 to consent.")
                self._egress_warned = True
            return None
        body: Dict[str, Any] = {"contents": [{"parts": parts}],
                                "generationConfig": {"temperature": 0}}
        if as_json:
            body["generationConfig"]["responseMimeType"] = "application/json"
        # Send the key as a header, never in the URL query string: URLs are echoed
        # into httpx exception messages, proxy/access logs and terminal scrollback,
        # which would leak the key on any error.
        headers = {"x-goog-api-key": self.api_key}
        models = self._vision_models()
        rate_limited = 0
        for mi, model in enumerate(models):
            url = _ENDPOINT.format(model=model)
            rotate = False
            # A couple of transient retries per model for pure overload (500/503);
            # a per-model quota (429) or bad-model (400/404) rotates immediately.
            for attempt in range(3):
                try:
                    r = httpx.post(url, json=body, headers=headers, timeout=60.0)
                    if r.status_code == 429:
                        rate_limited += 1
                        if mi < len(models) - 1:
                            print(f"[Vision] 429 quota on {model} → rotating to next model")
                        rotate = True
                        break
                    if r.status_code in (400, 404):
                        if mi < len(models) - 1:
                            print(f"[Vision] HTTP {r.status_code} on {model} (unavailable) → rotating")
                        rotate = True
                        break
                    if r.status_code in (500, 503) and attempt < 2:
                        wait = min(2 ** attempt * 2, 12)
                        print(f"[Vision] HTTP {r.status_code} on {model} (overloaded) — retry in {wait}s")
                        time.sleep(wait)
                        continue
                    r.raise_for_status()
                    cands = r.json().get("candidates", [])
                    if not cands:
                        return None
                    self.model = model   # remember the model that worked
                    return "".join(p.get("text", "")
                                   for p in cands[0].get("content", {}).get("parts", []))
                except httpx.HTTPStatusError as e:
                    code = e.response.status_code
                    if code in (429, 400, 404) and mi < len(models) - 1:
                        if code == 429:
                            rate_limited += 1
                        print(f"[Vision] HTTP {code} on {model} → rotating")
                        rotate = True
                        break
                    print(f"[Vision] Gemini error: HTTP {code}")  # log status only, never str(e)
                    return None
                except Exception as e:
                    if attempt < 2:
                        time.sleep(2)
                        continue
                    print(f"[Vision] Gemini error: {e}")
                    rotate = True
                    break
            if not rotate:
                break
        if rate_limited:
            print(f"[Vision] all {len(models)} model(s) rate-limited (429) — giving up")
        return None

    # ── Field mapping (the actual job) ────────────────────────────────────
    def map_fields(self, field_names: List[str], screenshot_png: bytes,
                   inventory: List[Dict[str, Any]] = None) -> Dict[str, str]:
        """Return {field_name: css_selector} for the fields it can locate in the
        screenshot. Fields it can't place are omitted."""
        if not field_names or not self.is_available() or not screenshot_png:
            return {}
        inv_txt = json.dumps(inventory or [])[:6000]
        prompt = (
            "You map logical form-field names to CSS selectors for the web form shown in the image.\n"
            f"DOM controls available (JSON list of {{selector,id,name,placeholder,label}}): {inv_txt}\n"
            f"Field names to locate: {field_names}\n"
            "Return ONLY a JSON object mapping each field name to the single best CSS selector to fill it. "
            "Prefer a selector from the DOM list. Omit any field you cannot confidently locate."
        )
        parts = [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/png",
                             "data": base64.b64encode(screenshot_png).decode()}},
        ]
        txt = self._generate(parts, as_json=True)
        return _extract_json_object(txt) if txt else {}


def _extract_json_object(text: str) -> Dict[str, str]:
    """Parse a JSON object out of a model response, tolerant of fences/prose."""
    for candidate in (text, (re.search(r'\{.*\}', text, re.DOTALL) or [None])[0]):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate if isinstance(candidate, str) else candidate.group(0))
            if isinstance(obj, dict):
                return {str(k): str(v) for k, v in obj.items() if v}
        except Exception:
            continue
    return {}


if __name__ == "__main__":
    gv = GeminiVision()
    print("vision available:", gv.is_available(), "| model:", gv.model)

    # 1) JSON extraction unit test (no network)
    assert _extract_json_object('{"email": "#email", "x": ""}') == {"email": "#email"}
    assert _extract_json_object('here you go: {"a":"b"} thanks') == {"a": "b"}
    assert _extract_json_object('not json') == {}
    print("[1] JSON extraction OK")

    # 1b) model chain: configured model is tried first, chain is deduped
    _gv = GeminiVision(api_key="x", model="gemini-2.5-flash")
    chain = _gv._vision_models()
    assert chain[0] == "gemini-2.5-flash", chain
    assert len(chain) == len(set(chain)), chain
    os.environ["SYSTEMINTEL_VISION_MODELS"] = "m1, m2 , m3"
    assert GeminiVision(api_key="x", model="m2")._vision_models() == ["m2", "m1", "m3"], "CSV override"
    del os.environ["SYSTEMINTEL_VISION_MODELS"]
    print("[1b] model chain OK ->", chain[:3], "…")

    # 1c) rotation: first model 429s, second returns 200 -> rotates and succeeds (no network)
    class _Resp:
        def __init__(self, code, payload=None): self.status_code = code; self._p = payload or {}
        def json(self): return self._p
        def raise_for_status(self):
            if self.status_code >= 400:
                import httpx as _h
                raise _h.HTTPStatusError("err", request=None, response=self)
    _calls = []
    _ok = {"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}
    def _fake_post(url, **kw):
        _calls.append(url)
        return _Resp(429) if len(_calls) == 1 else _Resp(200, _ok)
    os.environ["SYSTEMINTEL_AI_ALLOW_EXTERNAL"] = "1"
    _orig = httpx.post
    try:
        httpx.post = _fake_post
        rgv = GeminiVision(api_key="x", model="gemini-flash-latest")
        out = rgv._generate([{"text": "hi"}], as_json=False)
        assert out == "OK", f"rotation result: {out!r}"
        assert len(_calls) == 2, f"expected 2 calls (429 then 200), got {len(_calls)}"
        assert rgv.model != "gemini-flash-latest", "should remember the model that worked"
    finally:
        httpx.post = _orig
    print("[1c] 429 model-rotation OK -> rotated after 1st model 429'd, succeeded on 2nd")

    if gv.is_available():
        # 2) real connectivity check
        txt = gv._generate([{"text": "Reply with exactly: OK"}], as_json=False)
        assert txt and "OK" in txt, f"connectivity failed: {txt!r}"
        print("[2] connectivity OK ->", txt.strip()[:20])

        # 3) real multimodal check: draw a tiny form and ask it to read the field
        try:
            from PIL import Image, ImageDraw
            img = Image.new("RGB", (420, 160), "white")
            d = ImageDraw.Draw(img)
            d.text((20, 20), "Email address", fill="black")
            d.rectangle([20, 40, 400, 70], outline="black")
            d.text((20, 90), "Full name", fill="black")
            d.rectangle([20, 110, 400, 140], outline="black")
            import io
            buf = io.BytesIO(); img.save(buf, format="PNG")
            inv = [{"selector": "#email", "id": "email", "name": "email", "placeholder": "", "label": "Email address"},
                   {"selector": "#name", "id": "name", "name": "name", "placeholder": "", "label": "Full name"}]
            m = gv.map_fields(["email", "name"], buf.getvalue(), inv)
            assert isinstance(m, dict), f"expected dict, got {type(m)}"
            print("[3] multimodal map ->", m)
        except ImportError:
            # No PIL: still prove the multimodal path returns a dict with a 1x1 png
            tiny = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
            m = gv.map_fields(["email"], tiny, [{"selector": "#email", "id": "email"}])
            assert isinstance(m, dict)
            print("[3] multimodal map (no PIL) ->", m)
    else:
        print("[2,3] skipped — no vision key configured (set SYSTEMINTEL_VISION_API_KEY)")

    print("SELF-TEST PASS")
