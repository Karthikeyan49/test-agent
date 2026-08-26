"""
Rich per-field black-box battery
================================
The one-value-per-method battery (backend/field_blackbox / browser_field_validation)
proves a method *ran*, but a single representative value under-tests each field: real
black-box testing drives MANY cases per method — many malformed formats, many boundary
values around every declared limit, several length configurations, and a proper
fuzz / security corpus — one fault at a time (single-fault isolation).

`rich_field_cases(field)` returns a large, deduplicated list of cases:

    {"method": <format|type|length|boundary|required|enum|fuzz_xss|fuzz_sqli|fuzz_misc>,
     "case":   <short id>,           # e.g. "email_double_at"
     "value":  <str>,                 # the value to put in the field
     "expect": <"accept"|"reject"|"reject_or_truncate"|"no_crash">}

`field` keys (all optional except name): name, type/fieldType, required, maxLength,
minValue/min, maxValue/max, enum (list). The generator picks the method families that
apply to the field's type/name and expands each into many concrete values, bounded by
`max_per_method` so a single field can't explode the suite. Pass `max_per_method=None`
(or a large int) to lift that bound entirely: every method then yields its FULL corpus
— the intended setting for a truly exhaustive run. The default (20) is unchanged for
existing callers.

Pure standard library. Consumed by the browser UI harness and the API field battery.
"""

import re
from typing import Any, Dict, List, Optional

_EMAIL = re.compile(r"e[-_]?mail", re.IGNORECASE)
_NUMISH = re.compile(r"(amount|price|total|qty|quantity|stock|count|age|number|num|"
                     r"rate|percent|discount|weight|balance|score|year|month|day|id)$",
                     re.IGNORECASE)
_DATEISH = re.compile(r"(date|dob|_at|_on|birth|expiry|expiration)", re.IGNORECASE)
_PHONEISH = re.compile(r"(phone|mobile|tel|contact)", re.IGNORECASE)
_URLISH = re.compile(r"(url|website|link|site)", re.IGNORECASE)

# ── reusable corpora ──────────────────────────────────────────────────────────
_BAD_EMAILS = ["plainaddress", "@no-local.com", "no-at.com", "a@", "a@b", "a@.com",
               "a b@c.com", "a@b c.com", "a@@b.com", "a@b..com", "a@-b.com",
               ".a@b.com", "a.@b.com", "a@b.c_m", "<script>@b.com", "a@b,com",
               "a@b;c.com", "两@b.com", "a@b." + "x" * 80]
_BAD_DATES = ["2023-13-01", "2023-00-10", "2023-02-30", "2023-04-31", "31/31/9999",
              "0000-00-00", "9999-99-99", "not-a-date", "2023/13/40", "13:61:99",
              "2023-1-1extra", "-2023-01-01"]
_BAD_NUMBERS = ["abc", "12abc", "1.2.3", "1,000", "$5", "5px", "one", "  ", "0x1F",
                "1e999", "NaN", "Infinity", "--5", "+-5", "5.", ".5.5", "٥", "1 2"]
_BAD_URLS = ["notaurl", "http://", "://missing-scheme", "http://" + "a" * 300,
             "javascript:alert(1)", "ftp://x", "http://exa mple.com", "http://.com"]
_BAD_PHONES = ["abc", "12", "+", "()-", "00000000000000000000", "phone", "1234567890123456789",
               "12-34-", "+()"]
# security / robustness — the server/UI must not 5xx or execute
_XSS = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
        '"><svg onload=alert(1)>', "<a href='javascript:alert(1)'>x</a>",
        "'';!--\"<XSS>=&{()}", "<body onload=alert(1)>", "<iframe src=javascript:alert(1)>",
        "{{7*7}}", "${7*7}", "#{7*7}", "<%= 7*7 %>"]
_SQLI = ["' OR '1'='1", "' OR 1=1--", "'; DROP TABLE users;--", "' UNION SELECT NULL--",
         "admin'--", "1' AND SLEEP(5)--", "\" OR \"\"=\"", "') OR ('1'='1",
         "1;SELECT pg_sleep(5)--", "' OR 'x'='x"]
_MISC = ["../../../../etc/passwd", "..\\..\\windows\\win.ini", "%2e%2e%2f",
         "\x00nullbyte", "a\r\nInjected: header", "😀🔥𝕏", "‮RTLoverride",
         " " * 50, "\t\n\r", "-0", "0.0000001", "A" * 50000]


def _f(field, *keys, default=None):
    for k in keys:
        if k in field and field[k] not in (None, ""):
            return field[k]
    return default


def _cap(seq, limit: Optional[int]):
    """Return the first `limit` items of `seq`, or the WHOLE sequence when `limit`
    is None (the exhaustive setting). Explicit so no method is ever silently capped
    when the caller asked for the full corpus."""
    if limit is None:
        return list(seq)
    return list(seq)[:limit]


def rich_field_cases(field: Dict[str, Any],
                     max_per_method: Optional[int] = 20) -> List[Dict[str, Any]]:
    name = str(_f(field, "name", "fieldName", default="") or "")
    ftype = str(_f(field, "type", "fieldType", default="text")).lower()
    required = bool(field.get("required", False))
    maxlen = _f(field, "maxLength", "maxlen")
    minv = _f(field, "minValue", "min")
    maxv = _f(field, "maxValue", "max")
    enum = _f(field, "enum", "enumValues")
    ln = name.lower()

    is_email = "email" in ftype or bool(_EMAIL.search(ln))
    is_num = ftype in ("number", "integer", "float", "decimal", "tel") or bool(_NUMISH.search(ln))
    is_date = ftype in ("date", "datetime", "datetime-local") or bool(_DATEISH.search(ln))
    is_phone = bool(_PHONEISH.search(ln))
    is_url = bool(_URLISH.search(ln))

    out: List[Dict[str, Any]] = []

    def add(method, case, value, expect):
        out.append({"method": method, "case": case, "value": str(value), "expect": expect})

    # ── required: several "empty" encodings ──
    if required:
        for c, v in [("empty", ""), ("space", " "), ("spaces", "   "),
                     ("tab_newline", "\t\n"), ("zero_width", "​")]:
            add("required", c, v, "reject")

    # ── format ──
    if is_email:
        add("format", "email_valid", "user.name+tag@example.com", "accept")
        for i, v in enumerate(_cap(_BAD_EMAILS, max_per_method)):
            add("format", f"email_bad_{i}", v, "reject")
    if is_date:
        add("format", "date_valid", "2023-06-15", "accept")
        for i, v in enumerate(_cap(_BAD_DATES, max_per_method)):
            add("format", f"date_bad_{i}", v, "reject")
    if is_url:
        add("format", "url_valid", "https://example.com/path", "accept")
        for i, v in enumerate(_cap(_BAD_URLS, max_per_method)):
            add("format", f"url_bad_{i}", v, "reject")
    if is_phone:
        add("format", "phone_valid", "+1-202-555-0173", "accept")
        for i, v in enumerate(_cap(_BAD_PHONES, max_per_method)):
            add("format", f"phone_bad_{i}", v, "reject")

    # ── type: non-numeric into numeric fields ──
    if is_num and not is_date:
        add("type", "num_valid", "42", "accept")
        for i, v in enumerate(_cap(_BAD_NUMBERS, max_per_method)):
            add("type", f"num_nonnumeric_{i}", v, "reject")

    # ── boundary: many values around declared / implied limits ──
    if is_num and not is_date:
        pts = [("negative", -1), ("zero", 0), ("neg_large", -999999999),
               ("large", 2147483648), ("huge", 9999999999999), ("float_in_int", 3.14),
               ("neg_zero", "-0")]
        try:
            if minv is not None:
                mn = float(minv)
                pts += [("min", mn, ), ("below_min", mn - 1), ("min_minus_big", mn - 100000)]
        except (TypeError, ValueError):
            pass
        try:
            if maxv is not None:
                mx = float(maxv)
                pts += [("max", mx), ("above_max", mx + 1), ("max_plus_big", mx + 100000)]
        except (TypeError, ValueError):
            pass
        for item in _cap(pts, max_per_method):
            case, val = item[0], item[1]
            # negatives/zeros/overflows are rejects for a non-negative business field
            expect = "reject" if case not in ("min", "max", "zero") else "accept"
            add("boundary", case, val, expect)

    # ── length: several configs around maxLength ──
    if not is_num and not is_date:
        try:
            ml = int(maxlen) if maxlen is not None else None
        except (TypeError, ValueError):
            ml = None
        if ml:
            add("length", "at_max", "A" * ml, "accept")
            add("length", "over_by_1", "A" * (ml + 1), "reject_or_truncate")
            add("length", "over_2x", "A" * (ml * 2 + 1), "reject_or_truncate")
            add("length", "over_10x", "A" * (ml * 10 + 1), "reject_or_truncate")
        for c, n in [("len_255", 255), ("len_1k", 1000), ("len_10k", 10000)]:
            add("length", c, "A" * (n + 1), "reject_or_truncate")

    # ── enum: values outside the declared set ──
    if enum and isinstance(enum, (list, tuple)) and enum:
        add("enum", "enum_valid", str(enum[0]), "accept")
        variants = ["__not_in_enum__", "", str(enum[0]).upper() + "X", "0", "null",
                    str(enum[0]) + " "]
        for i, v in enumerate(_cap(variants, max_per_method)):
            add("enum", f"enum_bad_{i}", v, "reject")

    # ── fuzz / security: universal, must not crash (5xx / JS error) ──
    for i, v in enumerate(_cap(_XSS, max_per_method)):
        add("fuzz_xss", f"xss_{i}", v, "no_crash")
    for i, v in enumerate(_cap(_SQLI, max_per_method)):
        add("fuzz_sqli", f"sqli_{i}", v, "no_crash")
    for i, v in enumerate(_cap(_MISC, max_per_method)):
        add("fuzz_misc", f"misc_{i}", v, "no_crash")

    # dedupe by (method, value)
    seen, uniq = set(), []
    for c in out:
        k = (c["method"], c["value"])
        if k not in seen:
            seen.add(k); uniq.append(c)
    return uniq


def battery_summary(cases: List[Dict[str, Any]]) -> Dict[str, int]:
    by = {}
    for c in cases:
        by[c["method"]] = by.get(c["method"], 0) + 1
    return by


if __name__ == "__main__":
    # A rich field with constraints exercises every family with MANY cases each.
    email = rich_field_cases({"name": "email", "type": "email", "required": True, "maxLength": 100})
    by = battery_summary(email)
    assert by.get("format", 0) >= 10, by
    assert by.get("required", 0) >= 3, by
    assert by.get("fuzz_xss", 0) >= 5 and by.get("fuzz_sqli", 0) >= 5, by
    print("email field →", len(email), "cases:", by)

    qty = rich_field_cases({"name": "quantity", "type": "number", "required": True,
                            "minValue": 1, "maxValue": 1000})
    byq = battery_summary(qty)
    assert byq.get("type", 0) >= 10, byq
    assert byq.get("boundary", 0) >= 6, byq
    # every boundary/type case carries a concrete value + expectation
    for c in qty:
        assert c["value"] != "" or c["case"].startswith("enum") or "empty" in c["case"], c
        assert c["expect"] in ("accept", "reject", "reject_or_truncate", "no_crash"), c
    print("quantity field →", len(qty), "cases:", byq)

    txt = rich_field_cases({"name": "description", "type": "text", "maxLength": 50})
    byt = battery_summary(txt)
    assert byt.get("length", 0) >= 4, byt
    print("text field →", len(txt), "cases:", byt)

    st = rich_field_cases({"name": "status", "type": "enum", "enum": ["active", "inactive"]})
    assert battery_summary(st).get("enum", 0) >= 4
    print("enum field →", len(st), "cases:", battery_summary(st))

    # single-field bound holds
    assert all(len(rich_field_cases(f, max_per_method=5)) < 120
               for f in [{"name": "email", "type": "email", "required": True, "maxLength": 100}])

    # ── EXHAUSTIVE mode: max_per_method=None (or a large int) ⇒ the FULL corpus ──
    # No method may be silently capped. Verify each method's count equals the raw
    # corpus size, and that None and a huge int agree (no hidden internal cap).
    full = rich_field_cases({"name": "email", "type": "email", "required": True,
                             "maxLength": 100}, max_per_method=None)
    huge = rich_field_cases({"name": "email", "type": "email", "required": True,
                             "maxLength": 100}, max_per_method=10_000)
    assert battery_summary(full) == battery_summary(huge), "None must equal a large int"
    bf = battery_summary(full)
    # format = 1 valid + every bad email; fuzz families = their whole corpora
    assert bf["format"] == 1 + len(_BAD_EMAILS), (bf["format"], len(_BAD_EMAILS))
    assert bf["fuzz_xss"] == len(_XSS) and bf["fuzz_sqli"] == len(_SQLI), bf
    assert bf["fuzz_misc"] == len(_MISC), bf
    # a numeric field's type family is the whole bad-number corpus at None
    qn = battery_summary(rich_field_cases({"name": "quantity", "type": "number",
                                           "required": True, "minValue": 1,
                                           "maxValue": 1000}, max_per_method=None))
    assert qn["type"] == 1 + len(_BAD_NUMBERS), (qn["type"], len(_BAD_NUMBERS))

    # Report the FULL per-method corpus size for every method family.
    full_sizes = {
        "required":  5,
        "format:email": 1 + len(_BAD_EMAILS), "format:date": 1 + len(_BAD_DATES),
        "format:url": 1 + len(_BAD_URLS),     "format:phone": 1 + len(_BAD_PHONES),
        "type:number": 1 + len(_BAD_NUMBERS),
        "boundary(base+min+max)": 7, "boundary(+min +max declared)": 13,
        "length(maxLen declared)": 7, "length(no maxLen)": 3,
        "enum": 1 + 6,
        "fuzz_xss": len(_XSS), "fuzz_sqli": len(_SQLI), "fuzz_misc": len(_MISC),
    }
    print("FULL per-method corpus sizes (max_per_method=None):", full_sizes)
    print("field_battery SELF-TEST PASS")
