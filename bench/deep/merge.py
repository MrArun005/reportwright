#!/usr/bin/env python3
"""Merges results/*.jsonl into results.json, results.md and results.html (self-contained). Standard library only.

    python3 merge.py <dir with *.jsonl> <outdir>
"""
import json, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
JOBS = ['plain', 'report', 'invoice', 'invoice-warm', 'unicode', 'images', 'pdfa', 'read-big', 'read-mixed',
        'merge', 'split', 'encrypt', 'metadata', 'form', 'sign', 'fuzz', 'hostile']
TITLES = {'plain': 'Create, plain text (pages)', 'report': 'Create, grouped report (rows)', 'invoice': 'Invoice, cold (new process)',
          'invoice-warm': 'Invoice, warm (median of the last 40 of 50 in one process)', 'unicode': 'Unicode: Hindi, Arabic, CJK',
          'images': 'Images: 6 MP RGBA PNG + 24 MP JPEG', 'pdfa': 'PDF/A-2b invoice (veraPDF)', 'read-big': 'Read: text of a 1,200-page PDF',
          'read-mixed': 'Read: 11 mixed real-world-style files', 'merge': 'Merge 100 files', 'split': 'Split 100 pages',
          'encrypt': 'Encrypt AES-256', 'metadata': 'Incremental metadata change', 'form': 'Fill and flatten a form',
          'sign': 'Sign (PAdES/CMS, test certificate)', 'fuzz': 'Robustness: fuzzed PDFs', 'hostile': 'Robustness: hostile files'}
FAMILY = {'plain': 'create', 'report': 'create', 'invoice': 'create', 'invoice-warm': 'create', 'unicode': 'create', 'images': 'create',
          'pdfa': 'create', 'read-big': 'read', 'read-mixed': 'read'}


def load(d):
    meta, cells = [], []
    for f in sorted(Path(d).glob('*.jsonl')):
        for line in f.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                (meta if r.get('type') == 'meta' else cells).append(r)
    return meta, cells


def na_reason(c, job):
    na = c.get('na', {})
    return na.get(job) or na.get(FAMILY.get(job, 'edit')) or 'not supported'


def time_of(r):
    """The number a cell is ranked by: warm for the warm invoice, else the cold wall time (process start to exit)."""
    m = r.get('warm_ms') if r['job'] == 'invoice-warm' else r.get('cold_ms')
    return m and m['median']


def fmt_ms(v):
    return '–' if v is None else f'{v / 1000:.2f} s' if v >= 10000 else f'{v:.0f} ms' if v >= 10 else f'{v:.1f} ms'


def cell_text(r):
    if r is None:
        return '—'  # supported but no result (the job did not run, or the language job failed before it)
    st = r['status']
    if r['job'] in ('fuzz', 'hostile'):
        t = r.get('robust', {})
        return ' '.join(f'{k} {t[k]}' for k in ('ok', 'clean-error', 'crash', 'hang', 'oom') if t.get(k))
    if st in ('timeout', 'oom', 'crash', 'error', 'harness-error'):
        return st.upper() if st in ('oom',) else st
    s = fmt_ms(time_of(r))
    if r.get('rss_mb'):
        s += f' · {r["rss_mb"]["median"]:.0f} MB'
    if st == 'invalid':
        s += ' ✗'
    return s


def build(meta, cells, contestants):
    langs = contestants['langs']
    libs = {lib: (lang, c) for lang, v in langs.items() for lib, c in v['libs'].items()}
    by = {(r['lib'], r['job'], r['size']): r for r in cells if r.get('job') != 'version'}
    present = sorted({r['lib'] for r in cells}, key=lambda l: (libs.get(l, ('zz',))[0] != 'ours', libs.get(l, ('zz',))[0], l.lower()))
    tables = []
    for job in JOBS:
        cols = [l for l in present if job in libs.get(l, (0, {}))[1].get('jobs', []) or (job in ('fuzz', 'hostile') and 'parse' in libs[l][1]['jobs'])]
        if not cols:
            continue
        sizes = sorted({s for (l, j, s) in by if j == job})
        if not sizes:
            continue
        rows = []
        for s in sizes:
            ranked = sorted((time_of(by[(l, job, s)]), l) for l in cols if (l, job, s) in by and by[(l, job, s)]['status'] == 'ok' and time_of(by[(l, job, s)]))
            rows.append({'size': s, 'cells': {l: by.get((l, job, s)) for l in cols}, 'best': ranked[0][1] if ranked else None})
        na = {l: na_reason(libs[l][1], job) for l in present if l not in cols and l in libs}
        tables.append({'job': job, 'title': TITLES[job], 'cols': cols, 'rows': rows, 'na': na})
    summary = []
    for l in present:
        mine = [r for r in cells if r['lib'] == l and r.get('job') != 'version']
        wins = sum(1 for t in tables for row in t['rows'] if row['best'] == l)
        summary.append({'lib': l, 'lang': libs.get(l, ('?',))[0], 'version': next((r.get('version') for r in mine if r.get('version')), None),
                        'cells': len(mine), 'ok': sum(r['status'] == 'ok' for r in mine), 'invalid': sum(r['status'] == 'invalid' for r in mine),
                        'failed': sum(r['status'] in ('timeout', 'oom', 'crash', 'error', 'harness-error') for r in mine),
                        'fastest': wins, 'na': sum(1 for t in tables if l not in t['cols'])})
    return tables, summary


def markdown(meta, tables, summary):
    out = ['# Deep PDF benchmark', '']
    if meta:
        m = meta[0]
        out += [f'Run {m["date"]}, tier `{m["tier"]}`, {m["runs"]} measured runs a cell after one warm-up (fewer for the biggest '
                f'sizes, see README). Runner: {m["cpu"]}, {m["cores"]} cores, {m["ram_mb"]} MB RAM, {m["os"]}. Memory cap {m["cap_mb"]} MB a run.', '',
                'Cells: median wall time from process start to exit (warm invoice: in-process median) · peak RSS. ✗ = the output failed '
                'a check (qpdf, MuPDF, pdf.js, or the job\'s own text check) and is not ranked. **Bold** = fastest valid. '
                'Full numbers (CPU, min–max, time to first byte, sizes, checks) are in results.json and results.html.', '']
    for t in tables:
        out += [f'## {t["title"]}', '', '| size | ' + ' | '.join(t['cols']) + ' |', '|---:|' + '---|' * len(t['cols'])]
        for row in t['rows']:
            cs = []
            for l in t['cols']:
                s = cell_text(row['cells'][l])
                cs.append(f'**{s}**' if row['best'] == l else s)
            out.append(f'| {row["size"]:,} | ' + ' | '.join(cs) + ' |')
        if t['na']:
            out += ['', 'n/a: ' + '; '.join(f'{l} ({why})' for l, why in t['na'].items())]
        out.append('')
    out += ['## Per library', '', '| library | lang | version | cells | ok | invalid | failed | fastest | n/a jobs |', '|---|---|---|---:|---:|---:|---:|---:|---:|']
    for s in summary:
        out.append(f'| {s["lib"]} | {s["lang"]} | {s["version"] or "?"} | {s["cells"]} | {s["ok"]} | {s["invalid"]} | {s["failed"]} | {s["fastest"]} | {s["na"]} |')
    return '\n'.join(out) + '\n'


def page(data):
    """A self-contained page: full width, sortable tables, inline SVG charts (time and RSS against rows)."""
    payload = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deep PDF Benchmark</title><style>
:root{--bg:#fbfbfa;--fg:#1d1f22;--mute:#666b73;--line:#e3e5e8;--head:#f1f3f5;--best:#e3f4e8;--bad:#fbe5e3;--acc:#1f4e79}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15171a;--fg:#e6e8eb;--mute:#9aa0a8;--line:#2c3036;--head:#1e2125;--best:#183a24;--bad:#43201d;--acc:#7fb2e5}}
:root[data-theme=dark]{--bg:#15171a;--fg:#e6e8eb;--mute:#9aa0a8;--line:#2c3036;--head:#1e2125;--best:#183a24;--bad:#43201d;--acc:#7fb2e5}
*{box-sizing:border-box}body{margin:0;padding:16px 24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}p{margin:4px 0;color:var(--mute)}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:6px}table{border-collapse:collapse;width:100%}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
th{background:var(--head);cursor:pointer;position:sticky;top:0}th:first-child,td:first-child{text-align:left}
td.best{background:var(--best);font-weight:600}td.bad{background:var(--bad)}small{color:var(--mute)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}svg{width:100%;height:auto;border:1px solid var(--line);border-radius:6px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}nav a{color:var(--acc);text-decoration:none;border:1px solid var(--line);border-radius:4px;padding:2px 8px}
</style></head><body><h1>Deep PDF benchmark</h1><p id="meta"></p><nav id="nav"></nav><div id="charts" class="charts"></div><div id="tables"></div>
<script>
const D=''' + payload + ''';
const $=(t,a={},...k)=>{const e=document.createElement(t);for(const[x,y]of Object.entries(a))x==='html'?e.innerHTML=y:e.setAttribute(x,y);e.append(...k);return e};
const ms=v=>v==null?'–':v>=10000?(v/1000).toFixed(2)+' s':v>=10?v.toFixed(0)+' ms':v.toFixed(1)+' ms';
const time=r=>r&&(r.job==='invoice-warm'?r.warm_ms:r.cold_ms)?.median;
const m=D.meta[0];if(m)document.getElementById('meta').textContent=`${m.date} · tier ${m.tier} · ${m.runs} runs · ${m.cpu}, ${m.cores} cores, ${m.ram_mb} MB · cap ${m.cap_mb} MB a run. Click a header to sort. Cell: median wall time (warm invoice: in-process) · peak RSS; green = fastest valid, red = failed or invalid.`;
function txt(r){if(!r)return['—',''];if(r.robust)return[Object.entries(r.robust).map(([k,v])=>k+' '+v).join(', '),''];
 if(r.status!=='ok'&&r.status!=='invalid')return[r.status,'bad'];let s=ms(time(r));if(r.rss_mb)s+=' · '+r.rss_mb.median.toFixed(0)+' MB';
 if(r.status==='invalid')return[s+' ✗','bad'];return[s,''];}
function tip(r){if(!r)return'';const o={cold:r.cold_ms,warm:r.warm_ms,cpu:r.cpu_ms,rss:r.rss_mb,ttfb:r.ttfb_ms,bytes:r.bytes,pages:r.pages,valid:r.valid,check:r.text,pdfa:r.pdfa,note:r.note,error:r.error};return JSON.stringify(o,null,1)}
const nav=document.getElementById('nav'),host=document.getElementById('tables');
for(const t of D.tables){const id='t-'+t.job;nav.append($('a',{href:'#'+id},t.title));
 const head=$('tr',{},$('th',{},'size'),...t.cols.map(c=>$('th',{},c)));const body=$('tbody');
 for(const row of t.rows){const tr=$('tr',{},$('td',{'data-v':row.size},row.size.toLocaleString('en-US')));
  for(const c of t.cols){const r=row.cells[c];const[s,cls]=txt(r);tr.append($('td',{class:(row.best===c?'best':cls),title:tip(r),'data-v':time(r)??1e18},s));}body.append(tr);}
 const table=$('table',{},$('thead',{},head),body);
 head.querySelectorAll('th').forEach((th,i)=>th.onclick=()=>{const rs=[...body.rows],d=th.dataset.d=th.dataset.d==='1'?'-1':'1';
  rs.sort((a,b)=>(+a.cells[i].dataset.v-+b.cells[i].dataset.v)*d);body.append(...rs)});
 host.append($('h2',{id},t.title),$('div',{class:'wrap'},table));
 if(Object.keys(t.na).length)host.append($('p',{},'n/a: '+Object.entries(t.na).map(([l,w])=>`${l} (${w})`).join('; ')));}
// summary
{const t=$('table',{},$('thead',{},$('tr',{},...['library','lang','version','cells','ok','invalid','failed','fastest','n/a jobs'].map(h=>$('th',{},h)))),
 $('tbody',{},...D.summary.map(s=>$('tr',{},...[s.lib,s.lang,s.version||'?',s.cells,s.ok,s.invalid,s.failed,s.fastest,s.na].map((v,i)=>$('td',{'data-v':typeof v==='number'?v:0},String(v)))))));
 host.append($('h2',{},'Per library'),$('div',{class:'wrap'},t));}
// charts: report time and RSS against rows, log-log
function chart(title,val){const t=D.tables.find(t=>t.job==='report');if(!t)return;const W=640,H=360,L=60,B=40,T=28,R=150;
 const pts=t.cols.map(c=>({c,p:t.rows.map(r=>[r.size,val(r.cells[c])]).filter(([,v])=>v>0)}));
 const xs=t.rows.map(r=>r.size),ys=pts.flatMap(s=>s.p.map(p=>p[1]));if(!ys.length)return;
 const lx=Math.log10,x0=lx(Math.min(...xs)),x1=lx(Math.max(...xs))||x0+1,y0=Math.floor(lx(Math.min(...ys))),y1=Math.ceil(lx(Math.max(...ys)))||y0+1;
 const X=v=>L+(lx(v)-x0)/((x1-x0)||1)*(W-L-R),Y=v=>H-B-(lx(v)-y0)/((y1-y0)||1)*(H-B-T);
 let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><text x="${L}" y="18" fill="currentColor" font-size="13" font-weight="600">${title}</text>`;
 for(let e=y0;e<=y1;e++)s+=`<line x1="${L}" x2="${W-R}" y1="${Y(10**e)}" y2="${Y(10**e)}" stroke="var(--line)"/><text x="${L-6}" y="${Y(10**e)+4}" text-anchor="end" font-size="10" fill="var(--mute)">${val.unit(10**e)}</text>`;
 for(const v of xs)s+=`<text x="${X(v)}" y="${H-B+16}" text-anchor="middle" font-size="10" fill="var(--mute)">${v.toLocaleString('en-US')}</text>`;
 const pal=['#1f77b4','#d62728','#2ca02c','#ff7f0e','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf','#393b79','#637939','#8c6d31','#843c39','#7b4173'];
 pts.forEach((sr,i)=>{if(!sr.p.length)return;const col=pal[i%pal.length];s+=`<polyline fill="none" stroke="${col}" stroke-width="2" points="${sr.p.map(([a,b])=>X(a)+','+Y(b)).join(' ')}"/>`;
  sr.p.forEach(([a,b])=>s+=`<circle cx="${X(a)}" cy="${Y(b)}" r="3" fill="${col}"><title>${sr.c}: ${val.unit(b)} at ${a.toLocaleString('en-US')} rows</title></circle>`);
  const [a,b]=sr.p[sr.p.length-1];s+=`<text x="${X(a)+6}" y="${Y(b)+4}" font-size="11" fill="${col}">${sr.c}</text>`;});
 document.getElementById('charts').insertAdjacentHTML('beforeend',s+`<text x="${(W-R+L)/2}" y="${H-6}" text-anchor="middle" font-size="11" fill="var(--mute)">rows (log)</text></svg>`);}
const okv=f=>r=>r&&r.status==='ok'?f(r):null;
chart('Report: wall time against rows',Object.assign(okv(r=>r.cold_ms.median),{unit:ms}));
chart('Report: peak RSS against rows',Object.assign(okv(r=>r.rss_mb.median),{unit:v=>v.toFixed(0)+' MB'}));
</script></body></html>
'''


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    contestants = json.loads((HERE / 'contestants.json').read_text())
    meta, cells = load(src)
    tables, summary = build(meta, cells, contestants)
    data = {'meta': meta, 'cells': cells, 'tables': tables, 'summary': summary}
    (out / 'results.json').write_text(json.dumps(data, indent=1, ensure_ascii=False))
    (out / 'results.md').write_text(markdown(meta, tables, summary))
    (out / 'results.html').write_text(page(data))
    print(f'{len(cells)} cells from {len(meta)} jobs -> {out}')


if __name__ == '__main__':
    main()
