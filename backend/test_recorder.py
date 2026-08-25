"""
Live Test Recorder  (records every test in parallel with execution)
===================================================================
The normal report is written once, at the END of a run. This records EACH test the
moment it finishes to an append-only JSONL ledger, and (re)renders a filterable HTML
ledger on demand — so a run in progress can be watched live, and every single test is
captured even if the run is interrupted.

Usage in the runner (see cli.py --live-report):
    rec = TestRecorder(out_dir)          # opens <out_dir>/ledger.jsonl
    for tc in tests:
        ... run tc ...
        rec.record(tc_result)            # one flushed JSONL line per test
    rec.finalize(summary)                # writes ledger.html + ledger_summary.json

A parallel watcher can call render_ledger(jsonl, html) any time to refresh the HTML
from whatever has been recorded so far. Pure standard library.
"""
import json
import os
import time
from typing import Any, Dict, List, Optional


def flatten_result(tc: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a runner tc_result into one compact ledger row."""
    http = (tc.get("httpResults") or [{}])[0] if tc.get("httpResults") else {}
    dbr = (tc.get("dbResults") or [])
    layer = ("API" if tc.get("httpResults") else
             "DB" if tc.get("dbResults") else
             "UI" if tc.get("playwrightResult") else "—")
    ep = http.get("endpoint") or (dbr[0].get("table") if dbr and dbr[0] else "")
    act = http.get("actualStatus")
    if act is None and layer == "DB" and dbr and dbr[0]:
        act = dbr[0].get("actualValue", dbr[0].get("actualRowsCount", ""))
    return {
        "ts": round(time.time(), 3),
        "id": tc.get("testId", ""),
        "cat": tc.get("category", ""),
        "layer": layer,
        "m": str(http.get("method") or ("DB" if layer == "DB" else "")),
        "ep": str(ep)[:80],
        "exp": str(http.get("expectedStatus") or http.get("expectedStatusClass") or ""),
        "act": str(act if act is not None else ""),
        "v": tc.get("overallStatus", ""),
        "r": str((tc.get("failureReasons") or [""])[0])[:160],
        "ms": round(tc.get("durationMs", 0)),
    }


class TestRecorder:
    def __init__(self, out_dir: str):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.jsonl = os.path.join(out_dir, "ledger.jsonl")
        self.html = os.path.join(out_dir, "ledger.html")
        self._fh = open(self.jsonl, "w", encoding="utf-8")
        self.n = 0
        self.counts = {"PASS": 0, "FAIL": 0, "SKIPPED": 0}

    def record(self, tc_result: Dict[str, Any]) -> None:
        row = flatten_result(tc_result)
        self._fh.write(json.dumps(row) + "\n")
        self._fh.flush()                      # parallel watchers see it immediately
        os.fsync(self._fh.fileno())
        self.n += 1
        self.counts[row["v"]] = self.counts.get(row["v"], 0) + 1

    def finalize(self, summary: Optional[Dict[str, Any]] = None) -> str:
        try:
            self._fh.close()
        except Exception:
            pass
        summ = dict(summary or {})
        summ.setdefault("total", self.n)
        summ.setdefault("passed", self.counts.get("PASS", 0))
        summ.setdefault("failed", self.counts.get("FAIL", 0))
        summ.setdefault("skipped", self.counts.get("SKIPPED", 0))
        json.dump(summ, open(os.path.join(self.out_dir, "ledger_summary.json"), "w"), indent=1)
        render_ledger(self.jsonl, self.html, summ)
        return self.html


def _read_rows(jsonl_path: str) -> List[Dict[str, Any]]:
    rows = []
    try:
        for line in open(jsonl_path, encoding="utf-8"):
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    except FileNotFoundError:
        pass
    return rows


def render_ledger(jsonl_path: str, html_path: str,
                  summary: Optional[Dict[str, Any]] = None) -> str:
    """Render the filterable HTML ledger from whatever the JSONL holds so far.
    Safe to call repeatedly while a run is in progress (live refresh)."""
    import html as _h
    rows = _read_rows(jsonl_path)
    summ = summary or {"total": len(rows),
                       "passed": sum(1 for r in rows if r.get("v") == "PASS"),
                       "failed": sum(1 for r in rows if r.get("v") == "FAIL"),
                       "skipped": sum(1 for r in rows if r.get("v") == "SKIPPED")}
    cats = sorted({r.get("cat", "") for r in rows})
    cat_opts = "".join(f'<option value="{_h.escape(c)}">{_h.escape(c)}</option>' for c in cats)
    data_json = json.dumps(rows).replace("</", "<\\/")
    doc = _LEDGER_HTML.replace("__DATA__", data_json).replace("__CATOPTS__", cat_opts) \
        .replace("__N__", str(len(rows))).replace("__TOTAL__", str(summ.get("total", len(rows)))) \
        .replace("__PASS__", str(summ.get("passed", 0))).replace("__FAIL__", str(summ.get("failed", 0))) \
        .replace("__SKIP__", str(summ.get("skipped", 0))) \
        .replace("__WHEN__", time.strftime("%Y-%m-%d %H:%M:%S"))
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return html_path


_LEDGER_HTML = r"""<!doctype html><meta charset="utf-8"><title>Live Test Ledger</title>
<style>
:root{--g:#eef1f6;--s:#fff;--s2:#f6f8fb;--bd:#dde2ea;--tx:#141922;--mut:#5c6675;--ac:#3b4ee0;--ok:#1f9d55;--bad:#d92d20;--warn:#c77700;}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--g:#0e1116;--s:#161b23;--s2:#1b212b;--bd:#2a323e;--tx:#e8ecf3;--mut:#95a1b3;--ac:#8ea0ff;--ok:#43c47a;--bad:#ff6f66;--warn:#f0a63a;}}
:root[data-theme=dark]{--g:#0e1116;--s:#161b23;--s2:#1b212b;--bd:#2a323e;--tx:#e8ecf3;--mut:#95a1b3;--ac:#8ea0ff;--ok:#43c47a;--bad:#ff6f66;--warn:#f0a63a;}
*{box-sizing:border-box}body{margin:0;background:var(--g);color:var(--tx);font-family:system-ui,sans-serif;font-size:14px;padding:24px 18px}
.wrap{max-width:1200px;margin:0 auto}h1{font-size:22px;margin:0 0 2px}.lede{color:var(--mut);font-size:13px;margin:0 0 14px}
.tot{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}.tot b{font-family:ui-monospace,monospace}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;position:sticky;top:0;background:var(--g);padding:8px 0;z-index:5}
.chip{border:1px solid var(--bd);background:var(--s);color:var(--tx);border-radius:999px;padding:5px 13px;font-size:12.5px;cursor:pointer}
.chip.on{background:var(--ac);border-color:var(--ac);color:#fff}
input,select{border:1px solid var(--bd);background:var(--s);color:var(--tx);border-radius:8px;padding:6px 10px;font-size:13px}input{flex:1;min-width:160px}
.count{color:var(--mut);font-size:12.5px;margin-left:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--bd);padding:6px 9px;text-align:left;vertical-align:top}
th{position:sticky;top:52px;background:var(--s2);color:var(--mut);font-size:11px;text-transform:uppercase;z-index:4}
td.mono,td.num{font-family:ui-monospace,monospace}td.num{text-align:right;color:var(--mut)}
.v{font-weight:600;font-family:ui-monospace,monospace}.v.PASS{color:var(--ok)}.v.FAIL{color:var(--bad)}.v.SKIPPED{color:var(--warn)}
tr:hover td{background:var(--s2)}.r{color:var(--mut)}
</style><div class="wrap">
<h1>Live Test Ledger</h1><p class="lede">Recorded in parallel with execution · __N__ tests · rendered __WHEN__</p>
<div class="tot"><span>Total <b>__TOTAL__</b></span><span style="color:var(--ok)">Pass <b>__PASS__</b></span>
<span style="color:var(--bad)">Fail <b>__FAIL__</b></span><span style="color:var(--warn)">Skip <b>__SKIP__</b></span></div>
<div class="bar"><span class="chip on" data-v="ALL">All</span><span class="chip" data-v="PASS">Pass</span>
<span class="chip" data-v="FAIL">Fail</span><span class="chip" data-v="SKIPPED">Skip</span>
<select id="cat"><option value="">All categories</option>__CATOPTS__</select>
<input id="q" placeholder="search id / endpoint / reason…"><span class="count" id="count"></span></div>
<table><thead><tr><th>ID</th><th>Category</th><th>Layer</th><th>Method</th><th>Endpoint</th><th>Exp</th><th>Act</th><th>Verdict</th><th>Reason</th><th>ms</th></tr></thead><tbody id="tb"></tbody></table>
</div><script>
const DATA=__DATA__;let fV="ALL",fC="",fQ="";
const tb=document.getElementById('tb'),count=document.getElementById('count');
function esc(s){return (s+'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function render(){const q=fQ.toLowerCase();
 const rows=DATA.filter(r=>(fV==="ALL"||r.v===fV)&&(!fC||r.cat===fC)&&(!q||(r.id+r.ep+r.r+r.cat).toLowerCase().includes(q)));
 count.textContent=rows.length+" of "+DATA.length+" shown";
 tb.innerHTML=rows.slice(0,3000).map(r=>`<tr><td class=mono>${esc(r.id)}</td><td>${esc(r.cat)}</td><td>${esc(r.layer)}</td><td class=mono>${esc(r.m)}</td><td class=mono>${esc(r.ep)}</td><td class=num>${esc(r.exp)}</td><td class=num>${esc(r.act)}</td><td class="v ${r.v}">${esc(r.v)}</td><td class=r>${esc(r.r)}</td><td class=num>${r.ms}</td></tr>`).join('')+(rows.length>3000?`<tr><td colspan=10 style="text-align:center;color:var(--mut)">first 3000 of ${rows.length} — narrow the filter</td></tr>`:'');}
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));c.classList.add('on');fV=c.dataset.v;render();});
document.getElementById('cat').onchange=e=>{fC=e.target.value;render();};
document.getElementById('q').oninput=e=>{fQ=e.target.value;render();};
render();</script>"""


if __name__ == "__main__":
    import tempfile
    d = tempfile.mkdtemp(prefix="ledger_selftest_")
    rec = TestRecorder(d)
    rec.record({"testId": "T1", "category": "Functional / Positive",
                "httpResults": [{"endpoint": "GET /orders", "method": "GET",
                                 "expectedStatus": 200, "actualStatus": 200}],
                "overallStatus": "PASS", "durationMs": 12})
    rec.record({"testId": "T2", "category": "Validation / Boundary",
                "httpResults": [{"endpoint": "POST /vendors", "method": "POST",
                                 "expectedStatusClass": "4xx", "actualStatus": 200}],
                "overallStatus": "FAIL", "failureReasons": ["accepted bad input"], "durationMs": 30})
    rec.record({"testId": "T3", "category": "Security / Auth",
                "httpResults": [{"endpoint": "GET /admin", "method": "GET"}],
                "overallStatus": "SKIPPED", "durationMs": 1})
    # ledger.jsonl must have exactly one flushed line per recorded test (parallel-safe)
    lines = [l for l in open(rec.jsonl) if l.strip()]
    assert len(lines) == 3, lines
    html = rec.finalize({"total": 3, "passed": 1, "failed": 1, "skipped": 1})
    body = open(html).read()
    assert "Live Test Ledger" in body and "GET /orders" in body and "accepted bad input" in body
    # a parallel watcher can re-render from the JSONL at any time
    import os as _os
    p2 = _os.path.join(d, "live.html")
    render_ledger(rec.jsonl, p2)
    assert "POST /vendors" in open(p2).read()
    # flatten maps DB rows too
    fr = flatten_result({"dbResults": [{"table": "orders", "actualRowsCount": 5}],
                         "overallStatus": "PASS", "durationMs": 4})
    assert fr["layer"] == "DB" and fr["ep"] == "orders", fr
    print("test_recorder SELF-TEST PASS (per-test JSONL ledger + live HTML render)")
