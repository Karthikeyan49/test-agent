"""
Screenshot capture + report attachment for UI tests.

Attaching a screenshot to every one of ~14k UI cases would make the report
gigabytes, so the useful policy is: capture on FAIL (the evidence that matters)
plus one baseline per form/scenario. `snap()` saves a PNG; `data_uri()` inlines a
(size-capped) PNG as a data: URI so a single self-contained HTML report carries the
image with no external files.
"""
import base64
import os
from typing import Optional


def snap(page, path: str) -> Optional[str]:
    """Save a screenshot of `page` to `path`. Returns the path, or None on failure.
    Never raises — a screenshot must not break a test run."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        page.screenshot(path=path)
        return path
    except Exception:
        return None


def data_uri(path: str, max_bytes: int = 900_000) -> Optional[str]:
    """Return a base64 `data:image/png` URI for the PNG at `path`, or None if it's
    missing or larger than `max_bytes` (keeps the embedded report a sane size)."""
    try:
        if not path or not os.path.isfile(path):
            return None
        raw = open(path, "rb").read()
        if len(raw) > max_bytes:
            return None
        return "data:image/png;base64," + base64.b64encode(raw).decode()
    except Exception:
        return None


if __name__ == "__main__":
    # offline self-test: data_uri round-trips a real PNG and rejects oversize/missing
    import tempfile
    tiny = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    d = tempfile.mkdtemp()
    p = os.path.join(d, "a.png")
    open(p, "wb").write(tiny)
    u = data_uri(p)
    assert u and u.startswith("data:image/png;base64,"), u
    assert data_uri(p, max_bytes=1) is None          # oversize -> None
    assert data_uri(os.path.join(d, "nope.png")) is None   # missing -> None
    assert data_uri("") is None

    # snap() with a duck-typed page
    class _Pg:
        def screenshot(self, path): open(path, "wb").write(tiny)
    assert snap(_Pg(), os.path.join(d, "s.png")) is not None
    class _Bad:
        def screenshot(self, path): raise RuntimeError("boom")
    assert snap(_Bad(), os.path.join(d, "x.png")) is None   # never raises
    print("SELF-TEST PASS — snap + size-capped data_uri, failure-safe")
