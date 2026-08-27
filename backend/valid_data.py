"""
Realistic valid-data synthesis — the highest-leverage place for AI in this tool.

The engine's verdicts are only meaningful when the *valid baseline* is genuinely
valid: a form only submits, and a create-endpoint only 2xx's, when every field
holds a value the app accepts (a 10-digit phone, a 6-digit pincode, a real
foreign-key id, a value within maxLength). The old generator used "5" / "ValidValue"
for everything, so strict forms rejected the baseline and hundreds of cases could
only be SKIPped ("baseline does not submit") instead of judged.

This module produces a constraint- and name-aware valid value for a field, with an
OPTIONAL AI layer for ambiguous fields. Design rule is unchanged: **AI only proposes
the value; the deterministic checks still decide pass/fail** — and every AI-proposed
value is validated against the field's own constraints before use, so a bad
suggestion can never weaken a test.

    realistic_value(field, provider=None, context="")   -> a valid value
    realistic_body(fields, real_ids=None, provider=None) -> {field: value, ...}
"""
import re
from typing import Any, Dict, List, Optional

_DIGITS = re.compile(r"\d")


def _clamp_len(s: str, field: Dict[str, Any]) -> str:
    mx = field.get("maxLength") or field.get("max_length")
    mn = field.get("minLength") or field.get("min_length")
    if isinstance(mx, int) and mx > 0 and len(s) > mx:
        s = s[:mx]
    if isinstance(mn, int) and mn > 0 and len(s) < mn:
        s = (s + "x" * mn)[:mn] if s else "x" * mn
    return s


def _by_name(name: str) -> Optional[str]:
    """Highest-signal rule: infer a realistic value from the field NAME."""
    n = name.lower()
    def has(*ks): return any(k in n for k in ks)
    if has("email"):                         return "valid.user@example.com"
    if has("mobile", "phone", "whatsapp", "contact_no", "contactnumber"):
        return "9876543210"                                    # 10-digit Indian mobile
    if has("pincode", "pin_code", "zipcode", "zip", "postal"): return "560001"
    if has("gstin", "gst_no", "gstnumber"):  return "29ABCDE1234F1Z5"   # 15-char GSTIN
    if has("pan"):                           return "ABCDE1234F"        # 10-char PAN
    if has("ifsc"):                          return "HDFC0001234"
    if has("aadhaar", "aadhar"):             return "234123412346"
    if has("first_name", "firstname"):       return "Priya"
    if has("last_name", "lastname", "surname"): return "Sharma"
    if has("full_name", "contact_name") or n in ("name", "customer_name", "vendor_name", "employee_name"):
        return "Priya Sharma"
    if has("company", "business", "firm", "org"): return "Acme Traders Pvt Ltd"
    if has("city", "town"):                  return "Bengaluru"
    if has("state", "province"):             return "Karnataka"
    if has("country"):                       return "India"
    if has("address", "street", "addr"):     return "12 MG Road, Indiranagar"
    if has("landmark"):                      return "Near Metro Station"
    if has("designation", "role", "title") and not has("titleofwork"): return "Manager"
    if has("department", "dept"):            return "Operations"
    if has("username", "user_name", "login"): return "priya.sharma"
    if has("password"):                      return "Test1234!"
    if has("otp"):                           return "123456"
    if has("percent", "percentage", "rate", "tax", "gst_rate", "discount"): return "18"
    if has("amount", "price", "cost", "total", "salary", "wage", "value", "balance"): return "1500"
    if has("qty", "quantity", "stock", "count", "units", "nos"): return "10"
    if has("weight", "kg"):                  return "25"
    if has("age"):                           return "30"
    if has("year"):                          return "2026"
    if has("url", "website", "link"):        return "https://example.com"
    if has("code", "sku", "ref", "invoice_no", "order_no", "number"): return "REF-1001"
    if has("dob", "birth"):                  return "1994-06-15"
    if has("date", "_at", "deadline", "due", "expiry"): return "2026-06-15"
    if has("time"):                          return "10:30"
    if has("description", "notes", "note", "remark", "comment", "message", "details", "summary", "reason"):
        return "Sample text for testing."
    if has("quantity") or has("slug"):       return "sample-slug"
    return None


def realistic_value(field: Dict[str, Any], provider: Any = None, context: str = "") -> Any:
    """Return a valid value for `field`.

    Order: explicit enum → field-NAME heuristic → TYPE default → optional AI
    (for genuinely ambiguous fields), with every result clamped to length limits.
    An AI suggestion is used only if it passes the field's own constraints.
    """
    name = str(field.get("name") or field.get("fieldName") or "")
    ftype = str(field.get("fieldType") or field.get("type") or "text").lower()

    enum = field.get("enum") or field.get("enumValues")
    if enum:
        return enum[0]

    # number/integer honor min/max
    if ftype in ("number", "integer", "float", "decimal"):
        lo = field.get("min"); hi = field.get("max")
        if isinstance(lo, (int, float)) or isinstance(hi, (int, float)):
            lo = lo if isinstance(lo, (int, float)) else 1
            hi = hi if isinstance(hi, (int, float)) else lo + 10
            return int((lo + hi) // 2) if float(lo).is_integer() and float(hi).is_integer() else round((lo + hi) / 2, 2)

    named = _by_name(name)
    if named is not None:
        if ftype in ("number", "integer", "float", "decimal"):
            m = re.search(r"-?\d+(\.\d+)?", named)
            return (int(m.group()) if m and "." not in m.group() else
                    float(m.group()) if m else 5)   # numeric field → a real number
        return _clamp_len(named, field)

    # type defaults
    if "email" in ftype:                     return "valid.user@example.com"
    if ftype in ("number", "integer", "float", "decimal", "tel"): return 5
    if "date" in ftype:                      return "2026-06-15"
    if "url" in ftype:                       return "https://example.com"
    if ftype in ("checkbox", "boolean"):     return True

    # AI layer (optional): only for ambiguous text fields, only if it validates.
    if provider is not None and getattr(provider, "is_enabled", lambda: False)():
        val = _ai_value(field, provider, context)
        if val is not None and _passes(val, field):
            return _clamp_len(str(val), field)

    return _clamp_len("Sample", field)


def _passes(val: Any, field: Dict[str, Any]) -> bool:
    """Cheap constraint check so an AI suggestion can never weaken a test."""
    s = str(val)
    mx = field.get("maxLength") or field.get("max_length")
    if isinstance(mx, int) and mx > 0 and len(s) > mx:
        return False
    ftype = str(field.get("type") or "").lower()
    if "email" in ftype and "@" not in s:
        return False
    if ftype in ("number", "integer") and not re.fullmatch(r"-?\d+", s or ""):
        return False
    return bool(s)


def _ai_value(field: Dict[str, Any], provider: Any, context: str) -> Optional[str]:
    name = field.get("name") or field.get("fieldName") or "field"
    prompt = (
        "Return ONE realistic, valid example value for a form field. Output only the "
        "raw value, no quotes or explanation.\n"
        f"Field name: {name}\nType: {field.get('type','text')}\n"
        f"Max length: {field.get('maxLength','-')}\nContext: {context[:200]}"
    )
    try:
        out = provider._call_llm(prompt) if hasattr(provider, "_call_llm") else None
    except Exception:
        out = None
    if not out:
        return None
    return out.strip().splitlines()[0].strip().strip('"').strip("'")[:120] or None


def realistic_body(fields: List[Dict[str, Any]], real_ids: Optional[Dict[str, Any]] = None,
                   provider: Any = None, context: str = "") -> Dict[str, Any]:
    """Build a valid request body. Foreign-key fields (*_id / id) are filled from
    `real_ids` when available (grounding on rows that actually exist), so a create
    body passes FK checks instead of being rejected."""
    real_ids = real_ids or {}
    body: Dict[str, Any] = {}
    for f in fields:
        nm = str(f.get("name") or f.get("fieldName") or "")
        low = nm.lower()
        if low in real_ids:
            body[nm] = real_ids[low]; continue
        if low.endswith("_id") or low == "id":
            key = low[:-3] if low.endswith("_id") else low
            body[nm] = real_ids.get(key) or real_ids.get(low) or 1
            continue
        body[nm] = realistic_value(f, provider=provider, context=context)
    return body


if __name__ == "__main__":
    # ── deterministic self-test (offline; no AI, no network) ──────────────────
    def v(name, **kw): return realistic_value({"name": name, **kw})
    assert v("mobile") == "9876543210", v("mobile")
    assert v("customer_phone") == "9876543210"
    assert v("pincode") == "560001"
    assert "@" in v("email")
    assert v("gstin") == "29ABCDE1234F1Z5"
    assert v("quantity", type="number") == 10, v("quantity", type="number")   # real qty, not "5"
    assert v("price") == "1500"
    assert v("first_name") == "Priya"
    # maxLength respected
    assert len(v("description", maxLength=6)) <= 6
    # enum wins
    assert realistic_value({"name": "status", "enum": ["active", "inactive"]}) == "active"
    # number range honored
    assert realistic_value({"name": "score", "type": "number", "min": 10, "max": 20}) == 15
    # FK grounding: real id used when known, *_id defaults otherwise
    b = realistic_body(
        [{"name": "customer_id"}, {"name": "product_id"}, {"name": "quantity", "type": "number"}, {"name": "notes"}],
        real_ids={"customer": 42})
    assert b["customer_id"] == 42, b
    assert b["product_id"] == 1
    assert b["quantity"] == 10
    assert isinstance(b["notes"], str) and b["notes"]
    # AI path: a bad suggestion that violates maxLength is REJECTED (fallback used)
    class _BadAI:
        def is_enabled(self): return True
        def _call_llm(self, p): return "this-is-way-too-long-to-fit"
    got = realistic_value({"name": "zzz_unknown_field", "maxLength": 4}, provider=_BadAI())
    assert len(got) <= 4, got
    # AI path: a valid suggestion is used
    class _GoodAI:
        def is_enabled(self): return True
        def _call_llm(self, p): return "Widget"
    assert realistic_value({"name": "zzz_unknown_field"}, provider=_GoodAI()) == "Widget"
    print("SELF-TEST PASS — realistic name/type/enum/range/maxLength + FK grounding + guarded AI")
