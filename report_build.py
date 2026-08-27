#!/usr/bin/env python3
"""Consolidated SystemIntel report builder.

Reads every per-test JSONL ledger under a run directory (one row per test, schema
{ts,id,cat,layer,m,ep,exp,act,v,r,ms}) and emits:
  * a single self-contained, theme-aware, filterable HTML report, and
  * a PDF rendering of it (via the preinstalled Chromium, if available).

Layer -> family:
  API/— -> API   DB -> DB/schema   UI -> UI browser   MUT -> Mutation
  SEC -> Security (injection/authz)   SCN -> Scenario (3-way)   AUD -> UI audit

Usage:  python3 report_build.py --dir <run_dir> [--out report.html] [--pdf report.pdf]
The run dir is scanned for: api_live/ledger.jsonl and *_ledger.jsonl.
"""
import json, os, glob, html, datetime, argparse
from collections import Counter

FAMILY_BY_LAYER = {
    "API": "API", "—": "API", "DB": "DB / schema", "UI": "UI browser",
    "MUT": "Mutation", "SEC": "Security (injection/authz)",
    "SCN": "Scenario (3-way)", "AUD": "UI audit",
}
FAM_ORDER = ["API", "DB / schema", "UI browser", "Mutation",
             "Security (injection/authz)", "Scenario (3-way)", "UI audit"]
FAM_CLS = {"API": "API", "DB / schema": "DB", "UI browser": "UI", "Mutation": "MUT",
           "Security (injection/authz)": "SEC", "Scenario (3-way)": "SCN", "UI audit": "AUD"}
RAILVAR = {"API": "--fApi", "DB / schema": "--fDb", "UI browser": "--fUi",
           "Mutation": "--fMut", "Security (injection/authz)": "--fSec",
           "Scenario (3-way)": "--fScn", "UI audit": "--fAud"}


def load_jsonl(path):
    rows = []
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line:
                try: rows.append(json.loads(line))
                except Exception: pass
    except FileNotFoundError:
        pass
    return rows


def collect(run_dir):
    files = []
    al = os.path.join(run_dir, "api_live", "ledger.jsonl")
    if os.path.isfile(al): files.append(al)
    files += sorted(glob.glob(os.path.join(run_dir, "*_ledger.jsonl")))
    rows = []
    for f in files:
        rows += load_jsonl(f)
    for r in rows:
        r["fam"] = FAMILY_BY_LAYER.get(r.get("layer"), "API")
        if r.get("v") == "SKIP":
            r["v"] = "SKIPPED"
    return rows, files


def build_html(rows):
    fam_ct = Counter(r["fam"] for r in rows)
    v_ct = Counter(r.get("v") for r in rows)
    fams = [f for f in FAM_ORDER if fam_ct.get(f)]
    mut = [r for r in rows if r["fam"] == "Mutation"]
    mk = sum(1 for r in mut if r.get("act") == "killed")
    mex = sum(1 for r in mut if r.get("act") in ("killed", "survived"))
    mscore = round(100 * mk / mex) if mex else 0
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    total = len(rows)
    cats = sorted({r.get("cat", "") for r in rows})
    cat_opts = "".join(f'<option value="{html.escape(c)}">{html.escape(c)}</option>' for c in cats)
    data_json = json.dumps(rows, ensure_ascii=False).replace("</", "<\\/")

    tiles = ""
    tiles += (f'<div class="tile"><span class="rail" style="background:var(--tx)"></span>'
              f'<h3>All tests</h3><div class="big">{total:,}</div><div class="sub">'
              f'<span class="dot-ok">{v_ct.get("PASS",0):,} pass</span>'
              f'<span class="dot-bad">{v_ct.get("FAIL",0):,} fail</span>'
              f'<span class="dot-warn">{v_ct.get("SKIPPED",0):,} skip</span></div></div>')
    for f in fams:
        c = Counter(r.get("v") for r in rows if r["fam"] == f)
        extra = f'<span>score {mscore}%</span>' if f == "Mutation" and mex else ""
        tiles += (f'<div class="tile"><span class="rail" style="background:var({RAILVAR[f]})"></span>'
                  f'<h3>{html.escape(f)}</h3><div class="big">{fam_ct.get(f,0):,}</div><div class="sub">'
                  f'<span class="dot-ok">{c.get("PASS",0):,}✓</span>'
                  f'<span class="dot-bad">{c.get("FAIL",0):,}✗</span>'
                  f'<span class="dot-warn">{c.get("SKIPPED",0):,}⊘</span>{extra}</div></div>')

    pills = ('<span class="pill on" data-k="fam" data-v="ALL">All families</span>'
             + "".join(f'<span class="pill" data-k="fam" data-v="{html.escape(f)}">'
                       f'<span class="sw" style="background:var({RAILVAR[f]})"></span>'
                       f'{html.escape(f.split(" (")[0])}</span>' for f in fams))

    famcls_json = json.dumps(FAM_CLS)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SystemIntel Consolidated Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{{--ground:#eef1f6;--surface:#fff;--surface2:#f5f7fb;--bd:#dce1ea;--bd2:#e7ebf2;--tx:#151a22;--mut:#59636f;--eyebrow:#8892a0;
 --ac:#3b4ee0;--ok:#1f9d55;--bad:#d92d20;--warn:#c07a00;
 --fApi:#3b4ee0;--fDb:#0d8f8f;--fUi:#7b4dd8;--fMut:#c07a00;--fSec:#c0392b;--fScn:#0f766e;--fAud:#9a6a00;}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--ground:#0e1116;--surface:#161b23;--surface2:#1b212b;--bd:#2a323e;--bd2:#232a34;--tx:#e8ecf3;--mut:#96a1b1;--eyebrow:#6d7a8c;
 --ac:#8ea0ff;--ok:#43c47a;--bad:#ff6f66;--warn:#f0a63a;
 --fApi:#8ea0ff;--fDb:#3fc9c9;--fUi:#b18bff;--fMut:#f0a63a;--fSec:#ff8a80;--fScn:#4dd4c0;--fAud:#e6b800;}}}}
:root[data-theme=dark]{{--ground:#0e1116;--surface:#161b23;--surface2:#1b212b;--bd:#2a323e;--bd2:#232a34;--tx:#e8ecf3;--mut:#96a1b1;--eyebrow:#6d7a8c;
 --ac:#8ea0ff;--ok:#43c47a;--bad:#ff6f66;--warn:#f0a63a;
 --fApi:#8ea0ff;--fDb:#3fc9c9;--fUi:#b18bff;--fMut:#f0a63a;--fSec:#ff8a80;--fScn:#4dd4c0;--fAud:#e6b800;}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--ground);color:var(--tx);font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;line-height:1.5;padding:30px 20px 60px}}
.wrap{{max-width:1240px;margin:0 auto}}.eyebrow{{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--eyebrow);font-weight:600;margin:0 0 6px}}
h1{{font-size:27px;margin:0 0 4px;letter-spacing:-.02em;font-weight:700}}.lede{{color:var(--mut);font-size:13.5px;margin:0 0 22px;max-width:74ch}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}}
.tile{{background:var(--surface);border:1px solid var(--bd);border-radius:12px;padding:13px 15px;position:relative;overflow:hidden}}
.tile .rail{{position:absolute;left:0;top:0;bottom:0;width:4px}}.tile h3{{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--mut)}}
.tile .big{{font-family:"IBM Plex Mono",monospace;font-size:24px;font-weight:500;font-variant-numeric:tabular-nums}}
.tile .sub{{font-size:11px;color:var(--mut);margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}}
.dot-ok{{color:var(--ok)}}.dot-bad{{color:var(--bad)}}.dot-warn{{color:var(--warn)}}
.bar{{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:18px 0 12px;position:sticky;top:0;background:linear-gradient(var(--ground) 78%,transparent);padding:10px 0 12px;z-index:6}}
.pill{{border:1px solid var(--bd);background:var(--surface);color:var(--tx);border-radius:999px;padding:5px 13px;font-size:12.5px;cursor:pointer;font-weight:500;display:inline-flex;align-items:center;gap:6px}}
.pill.on{{background:var(--ac);border-color:var(--ac);color:#fff}}.pill .sw{{width:8px;height:8px;border-radius:2px}}
.sep{{width:1px;height:22px;background:var(--bd);margin:0 3px}}input,select{{border:1px solid var(--bd);background:var(--surface);color:var(--tx);border-radius:9px;padding:7px 11px;font-size:13px;font-family:inherit}}
input#q{{flex:1;min-width:180px}}.count{{color:var(--mut);font-size:12.5px;margin-left:auto;font-variant-numeric:tabular-nums}}
.tablewrap{{background:var(--surface);border:1px solid var(--bd);border-radius:12px;overflow-x:auto}}
table{{border-collapse:collapse;width:100%;font-size:12.5px;min-width:820px}}th,td{{padding:7px 11px;text-align:left;vertical-align:top;border-bottom:1px solid var(--bd2)}}
th{{position:sticky;top:64px;background:var(--surface2);color:var(--eyebrow);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}}
td.mono{{font-family:"IBM Plex Mono",monospace}}td.num{{font-family:"IBM Plex Mono",monospace;text-align:right;color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}}
tr:hover td{{background:var(--surface2)}}.fam{{font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;white-space:nowrap;border:1px solid transparent}}
.fam-API{{color:var(--fApi);border-color:color-mix(in srgb,var(--fApi) 40%,transparent)}}.fam-DB{{color:var(--fDb);border-color:color-mix(in srgb,var(--fDb) 40%,transparent)}}
.fam-UI{{color:var(--fUi);border-color:color-mix(in srgb,var(--fUi) 40%,transparent)}}.fam-MUT{{color:var(--fMut);border-color:color-mix(in srgb,var(--fMut) 40%,transparent)}}
.fam-SEC{{color:var(--fSec);border-color:color-mix(in srgb,var(--fSec) 40%,transparent)}}.fam-SCN{{color:var(--fScn);border-color:color-mix(in srgb,var(--fScn) 40%,transparent)}}
.fam-AUD{{color:var(--fAud);border-color:color-mix(in srgb,var(--fAud) 40%,transparent)}}
.v{{font-weight:600;font-family:"IBM Plex Mono",monospace}}.v.PASS{{color:var(--ok)}}.v.FAIL{{color:var(--bad)}}.v.SKIPPED{{color:var(--warn)}}.r{{color:var(--mut);max-width:340px}}
a.shot{{display:inline-block;vertical-align:middle;margin-right:7px}}a.shot img{{height:30px;width:auto;max-width:54px;border:1px solid var(--bd);border-radius:4px;object-fit:cover;object-position:top left}}a.shot:hover img{{outline:2px solid var(--ac)}}
</style></head><body><div class="wrap">
<p class="eyebrow">SystemIntel · consolidated run</p>
<h1>Consolidated Test Report</h1>
<p class="lede">Every test across every family in one run — {total:,} rows · generated {now}. Filter by family / verdict / category or search.</p>
<div class="tiles">{tiles}</div>
<div class="bar">{pills}<span class="sep"></span>
 <span class="pill on" data-k="v" data-v="ALL">All</span>
 <span class="pill" data-k="v" data-v="PASS">Pass</span>
 <span class="pill" data-k="v" data-v="FAIL">Fail</span>
 <span class="pill" data-k="v" data-v="SKIPPED">Skip</span>
 <select id="cat"><option value="">All categories</option>{cat_opts}</select>
 <input id="q" placeholder="search id / endpoint / reason…"><span class="count" id="count"></span></div>
<div class="tablewrap"><table><thead><tr><th>Family</th><th>ID</th><th>Category</th><th>Method</th><th>Endpoint / target</th><th>Exp</th><th>Act</th><th>Verdict</th><th>Detail</th><th>ms</th></tr></thead><tbody id="tb"></tbody></table></div>
</div><script>
const DATA={data_json};const FAMCLS={famcls_json};let fFam="ALL",fV="ALL",fC="",fQ="";
const tb=document.getElementById('tb'),count=document.getElementById('count');
function esc(s){{return (s+'').replace(/[&<>]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;'}}[c]));}}
function render(){{const q=fQ.toLowerCase();
 const rs=DATA.filter(r=>(fFam==="ALL"||r.fam===fFam)&&(fV==="ALL"||r.v===fV)&&(!fC||r.cat===fC)&&(!q||((r.id||'')+(r.ep||'')+(r.r||'')+(r.cat||'')).toLowerCase().includes(q)));
 count.textContent=rs.length.toLocaleString()+" of "+DATA.length.toLocaleString()+" shown";
 const cap=rs.slice(0,4000);let h='';
 for(const r of cap){{h+='<tr><td><span class="fam fam-'+(FAMCLS[r.fam]||'API')+'">'+esc(r.fam.split(' (')[0])+'</span></td><td class=mono>'+esc(r.id)+'</td><td>'+esc(r.cat)+'</td><td class=mono>'+esc(r.m)+'</td><td class=mono>'+esc(r.ep)+'</td><td class=num>'+esc(r.exp)+'</td><td class=num>'+esc(r.act)+'</td><td class="v '+r.v+'">'+esc(r.v)+'</td><td class=r>'+(r.shot?('<a class=shot href="'+r.shot+'" target=_blank rel=noopener title="open screenshot"><img src="'+r.shot+'" alt=shot></a>'):'')+esc(r.r)+'</td><td class=num>'+(r.ms||0)+'</td></tr>';}}
 if(rs.length>4000)h+='<tr><td colspan=10 style="text-align:center;color:var(--mut);padding:14px">…first 4,000 of '+rs.length.toLocaleString()+' — narrow the filter</td></tr>';
 tb.innerHTML=h;}}
document.querySelectorAll('.pill').forEach(p=>p.onclick=()=>{{const k=p.dataset.k;document.querySelectorAll('.pill[data-k="'+k+'"]').forEach(x=>x.classList.remove('on'));p.classList.add('on');if(k==="fam")fFam=p.dataset.v;else fV=p.dataset.v;render();}});
document.getElementById('cat').onchange=e=>{{fC=e.target.value;render();}};document.getElementById('q').oninput=e=>{{fQ=e.target.value;render();}};render();
</script></body></html>"""


def render_pdf(html_path, pdf_path):
    """Render the HTML report to PDF via the preinstalled Chromium (Playwright)."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(f"[pdf] playwright unavailable ({e}); skipping PDF")
        return False
    exe = os.environ.get("PW_CHROMIUM", "/opt/pw-browsers/chromium")
    try:
        with sync_playwright() as p:
            kw = {"headless": True}
            if os.path.exists(exe): kw["executable_path"] = exe
            b = p.chromium.launch(**kw)
            pg = b.new_page()
            pg.goto("file://" + os.path.abspath(html_path), wait_until="networkidle", timeout=60000)
            pg.wait_for_timeout(800)
            pg.pdf(path=pdf_path, format="A4", print_background=True,
                   margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})
            b.close()
        print(f"[pdf] wrote {pdf_path}")
        return True
    except Exception as e:
        print(f"[pdf] render failed: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="run directory containing the *_ledger.jsonl files")
    ap.add_argument("--out", default=None, help="HTML output path (default: <dir>/consolidated_report.html)")
    ap.add_argument("--pdf", default=None, help="PDF output path (default: <dir>/consolidated_report.pdf)")
    a = ap.parse_args()
    out = a.out or os.path.join(a.dir, "consolidated_report.html")
    pdf = a.pdf or os.path.join(a.dir, "consolidated_report.pdf")
    rows, files = collect(a.dir)
    print(f"[report] {len(rows):,} rows from {len(files)} ledger file(s)")
    page = build_html(rows)
    open(out, "w", encoding="utf-8").write(page)
    print(f"[report] wrote {out} ({len(page):,} bytes)")
    render_pdf(out, pdf)


if __name__ == "__main__":
    main()
