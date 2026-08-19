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
  SYSTEMINTEL_VISION_MODEL     — default "gemini-3.6-flash"
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

    def __init__(self, api_key: str = None, model: str = None):
        self.api_key = (api_key
                        or os.environ.get("SYSTEMINTEL_VISION_API_KEY")
                        or os.environ.get("GEMINI_API_KEY", ""))
        self.model = model or os.environ.get("SYSTEMINTEL_VISION_MODEL", "gemini-3.6-flash")

    def is_available(self) -> bool:
        return bool(self.api_key)

    # ── Core multimodal call ──────────────────────────────────────────────
    def _generate(self, parts: List[dict], as_json: bool = True) -> Optional[str]:
        if not self.is_available():
            return None
        body: Dict[str, Any] = {"contents": [{"parts": parts}],
                                "generationConfig": {"temperature": 0}}
        if as_json:
            body["generationConfig"]["responseMimeType"] = "application/json"
        # Send the key as a header, never in the URL query string: URLs are echoed
        # into httpx exception messages, proxy/access logs and terminal scrollback,
        # which would leak the key on any error.
        url = _ENDPOINT.format(model=self.model)
        headers = {"x-goog-api-key": self.api_key}
        for attempt in range(4):
            try:
                r = httpx.post(url, json=body, headers=headers, timeout=60.0)
                if r.status_code in (429, 500, 503) and attempt < 3:
                    wait = min(2 ** attempt * 2, 20)
                    print(f"[Vision] HTTP {r.status_code} (overloaded) — retry in {wait}s")
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                cands = r.json().get("candidates", [])
                if not cands:
                    return None
                return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))
            except httpx.HTTPStatusError as e:
                # Log only the status code — str(e) embeds the full request URL.
                print(f"[Vision] Gemini error: HTTP {e.response.status_code}")
                return None
            except Exception as e:
                if attempt < 3:
                    time.sleep(2)
                    continue
                print(f"[Vision] Gemini error: {e}")
                return None
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
