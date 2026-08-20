"""
Field In/Out Edge Oracle  (per-field round-trip correctness — closes Gap #1)
============================================================================
The per-field black-box battery asks "does this field reject bad data?". This
oracle asks the complementary question the System Graph is uniquely able to pose:
for a field the graph knows about, is the value SUBMITTED on the incoming edge
(a page's SUBMITS_TO) the SAME value that comes out the OTHER side — STORED in the
DB (the WRITES_TO edge to a column) and READ BACK by a downstream read endpoint or
shown on a cross-page?

    incoming edge            outgoing edge (DB)        outgoing edge (read)
    value SUBMITTED    →     value STORED         →    value READ BACK
    (SUBMITS_TO)             (WRITES_TO column)        (read endpoint / cross-page)

A field can pass every single-fault check and still silently corrupt data:

    • truncation      a VARCHAR(20) quietly stores the first 20 chars of a longer input
    • encoding change "<b>" persisted / echoed as "&lt;b&gt;"
    • silent drop     a non-empty value submitted, an empty/NULL value stored

Those are only visible by COMPARING the two ends — exactly what the graph's in/out
edges give us. This oracle does the comparison deterministically from evidence
dicts the runner already collects (the request it sent, the DB row it read, the
read-back response). It makes NO live calls itself.

Verdicts (honesty is non-negotiable — a missing leg is never a PASS):
    • all present legs consistent            → PASS
    • a provable mismatch (with before/after)→ FAIL  (truncation / encoding / drop / change)
    • evidence missing for a leg             → SKIP  (with the reason)

Type coercion is handled sanely so serialization noise is not a false FAIL:
    "5" vs 5            → consistent (numeric)
    "true" vs True     → consistent (boolean)
    "abc" vs ""        → FAIL (silent drop)

Modelled on backend/injection_oracle.py / backend/authz_oracle.py: pure functions
+ a __main__ self-test with hand-built PASS/FAIL/SKIP fixtures. Consumed by cli.py.
"""

import html
from typing import Any, Dict, Optional, Tuple

# A distinct "no evidence for this leg" sentinel. It is NOT None — None is a valid
# observed value (a column that legitimately stored NULL), so the two must differ:
# absent evidence → SKIP, an observed NULL → compared like any other value.
_MISSING = object()


def _is_missing(v: Any) -> bool:
    return v is _MISSING


def _num(v: Any) -> Optional[float]:
    """The numeric value of v if it represents a number, else None (bool excluded —
    bool is an int subclass in Python and must be compared as a boolean, not 0/1)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _as_bool(v: Any) -> Optional[bool]:
    """v interpreted as a boolean when it clearly is one, else None.

    A DB round-trips a boolean as 0/1 (int or the strings "0"/"1"), so those are
    accepted too. This only matters when the OTHER side is a real boolean: the
    numeric comparison in _consistent runs first and needs BOTH sides numeric, so
    a genuine number pair (1 vs 1) never reaches here — only a bool-vs-1/0 pair
    (True vs 1) does, which is exactly the benign coercion we want to allow."""
    if isinstance(v, bool):
        return v
    if isinstance(v, int) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "false"):
            return s == "true"
        if s in ("0", "1"):
            return s == "1"
    return None


def _empty(v: Any) -> bool:
    """Empty on the wire: NULL/None or a blank/whitespace-only string."""
    return v is None or (isinstance(v, str) and v.strip() == "")


def _consistent(a: Any, b: Any) -> bool:
    """True when a and b are the SAME value modulo benign type coercion:
    numeric strings compare as numbers ("5"==5==5.0), boolean strings as booleans
    ("true"==True), two empties are equal, otherwise a plain string comparison."""
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return na == nb
    ba, bb = _as_bool(a), _as_bool(b)
    if ba is not None and bb is not None:
        return ba == bb
    if _empty(a) and _empty(b):
        return True
    return str(a) == str(b)


def _classify(before: Any, after: Any) -> Tuple[str, str]:
    """Name the concrete corruption between an inbound `before` and an outbound
    `after` that are already known to be inconsistent. Returns (kind, detail)."""
    # silent drop — something non-empty went in, nothing came out
    if not _empty(before) and _empty(after):
        return "silent_drop", f"submitted {before!r} but stored/read {after!r} (silently dropped)"
    if isinstance(before, str) and isinstance(after, str):
        # truncation — the output is a strict prefix of the input, and shorter
        if len(after) < len(before) and before.startswith(after):
            return ("truncation",
                    f"{len(before)}→{len(after)} chars — value truncated ('{before}' → '{after}')")
        # encoding change — same text, different encoding (HTML-escaped either way)
        if html.unescape(after) == before or after == html.escape(before, quote=True) \
                or html.unescape(after) == html.unescape(before):
            return "encoding_change", f"value re-encoded ('{before}' → '{after}')"
    return "changed", f"value changed ('{before}' → '{after}')"


def _verdict(field: str, passed: Optional[bool], reason: str,
             skipped: bool = False, mismatch: Optional[Dict[str, Any]] = None,
             legs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "technique": "FIELD_EDGE",
        "field": field,
        "verdict": ("SKIP" if skipped else ("PASS" if passed else "FAIL")),
        "passed": (None if skipped else bool(passed)),
        "skipped": bool(skipped),
        "reason": reason,
        "mismatch": mismatch,
        "legs": legs or {},
    }


def check_field_edge(field: str,
                     submitted: Any = _MISSING,
                     stored: Any = _MISSING,
                     read_back: Any = _MISSING) -> Dict[str, Any]:
    """Compare a field's value across the graph's in/out edges.

    Args (any leg may be omitted — an omitted leg is treated as "no evidence",
    NOT as a NULL value; pass None only for a genuinely observed NULL):
      field      – field / column name (for the verdict).
      submitted  – value on the incoming edge (what the page SUBMITS_TO the API).
      stored     – value on the outgoing edge to the DB (the WRITES_TO column).
      read_back  – value READ BACK downstream (read endpoint / cross-page display).

    Returns a verdict dict:
      {technique, field, verdict: PASS|FAIL|SKIP, passed: bool|None,
       skipped: bool, reason, mismatch: {kind, before, after, leg}|None, legs}
    where passed is True (consistent), False (a provable corruption — see
    mismatch), or None (SKIP: a needed leg had no evidence)."""
    legs: Dict[str, Any] = {}
    if not _is_missing(submitted):
        legs["submitted"] = submitted
    if not _is_missing(stored):
        legs["stored"] = stored
    if not _is_missing(read_back):
        legs["read_back"] = read_back

    # The incoming edge is the anchor; without it there is nothing to compare to.
    if _is_missing(submitted):
        return _verdict(field, None,
                        "no incoming-edge evidence (value submitted is unknown) — cannot compare",
                        skipped=True, legs=legs)

    # Need at least one outgoing leg (DB store or downstream read) to compare against.
    if _is_missing(stored) and _is_missing(read_back):
        return _verdict(field, None,
                        "no outgoing-edge evidence (neither a stored value nor a read-back) — "
                        "cannot verify the round-trip",
                        skipped=True, legs=legs)

    # Write leg: submitted → stored (only when the store was observed).
    if not _is_missing(stored):
        if not _consistent(submitted, stored):
            kind, detail = _classify(submitted, stored)
            return _verdict(field, False,
                            f"write leg (submitted→stored): {detail}",
                            mismatch={"kind": kind, "before": submitted, "after": stored,
                                      "leg": "submitted->stored"},
                            legs=legs)
        # Read leg: stored → read_back (both observed).
        if not _is_missing(read_back):
            if not _consistent(stored, read_back):
                kind, detail = _classify(stored, read_back)
                return _verdict(field, False,
                                f"read leg (stored→read_back): {detail}",
                                mismatch={"kind": kind, "before": stored, "after": read_back,
                                          "leg": "stored->read_back"},
                                legs=legs)
            return _verdict(field, True,
                            "consistent across all legs: submitted → stored → read_back", legs=legs)
        return _verdict(field, True,
                        "consistent on the write leg: submitted → stored "
                        "(no read-back leg to check)", legs=legs)

    # Only an end-to-end read leg is available (store not observed): submitted → read_back.
    if not _consistent(submitted, read_back):
        kind, detail = _classify(submitted, read_back)
        return _verdict(field, False,
                        f"end-to-end leg (submitted→read_back): {detail}",
                        mismatch={"kind": kind, "before": submitted, "after": read_back,
                                  "leg": "submitted->read_back"},
                        legs=legs)
    return _verdict(field, True,
                    "consistent end-to-end: submitted → read_back "
                    "(no DB-store leg to check)", legs=legs)


if __name__ == "__main__":
    # ── Offline self-test with hand-built evidence fixtures (no network/DB). ────

    # PASS — clean round-trip, all three legs agree.
    r = check_field_edge("name", submitted="Acme", stored="Acme", read_back="Acme")
    assert r["passed"] is True and r["verdict"] == "PASS", r

    # PASS — type coercion is benign: "5" submitted, 5 stored, "5" read back.
    r = check_field_edge("quantity", submitted="5", stored=5, read_back="5")
    assert r["passed"] is True, r

    # PASS — boolean coercion: "true" ↔ True.
    r = check_field_edge("is_active", submitted="true", stored=True, read_back=1)
    assert r["passed"] is True, r

    # FAIL — truncation on the write leg (VARCHAR(5) quietly clipped the input).
    r = check_field_edge("code", submitted="ABCDEFGH", stored="ABCDE")
    assert r["passed"] is False and r["mismatch"]["kind"] == "truncation", r
    assert r["mismatch"]["before"] == "ABCDEFGH" and r["mismatch"]["after"] == "ABCDE", r

    # FAIL — silent drop: a real value in, an empty value stored.
    r = check_field_edge("email", submitted="a@b.com", stored="")
    assert r["passed"] is False and r["mismatch"]["kind"] == "silent_drop", r

    # FAIL — encoding change surfaced only on the read leg (stored raw, echoed escaped).
    r = check_field_edge("title", submitted="<b>Hi</b>", stored="<b>Hi</b>",
                         read_back="&lt;b&gt;Hi&lt;/b&gt;")
    assert r["passed"] is False and r["mismatch"]["kind"] == "encoding_change", r
    assert r["mismatch"]["leg"] == "stored->read_back", r

    # FAIL — a plain value change (neither truncation nor encoding).
    r = check_field_edge("status", submitted="active", stored="archived")
    assert r["passed"] is False and r["mismatch"]["kind"] == "changed", r

    # FAIL — end-to-end leg only (no DB store observed), value corrupted.
    r = check_field_edge("phone", submitted="12345", read_back="123")
    assert r["passed"] is False and r["mismatch"]["leg"] == "submitted->read_back", r

    # SKIP — no incoming-edge evidence (never a PASS on absence).
    r = check_field_edge("name", stored="Acme")
    assert r["skipped"] is True and r["passed"] is None, r

    # SKIP — incoming present but no outgoing leg at all.
    r = check_field_edge("name", submitted="Acme")
    assert r["skipped"] is True and r["passed"] is None, r

    # An observed NULL is evidence, NOT a missing leg: a real value dropped to NULL is a FAIL.
    r = check_field_edge("notes", submitted="hello", stored=None)
    assert r["passed"] is False and r["mismatch"]["kind"] == "silent_drop", r

    # Two genuine empties agree (blank in, NULL stored) → PASS, not a false drop.
    r = check_field_edge("middle_name", submitted="", stored=None)
    assert r["passed"] is True, r

    print("field_edge_oracle SELF-TEST PASS (round-trip PASS/FAIL[trunc/drop/encode/change]/SKIP)")
