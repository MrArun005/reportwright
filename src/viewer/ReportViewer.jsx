'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderReport, pdfBlob, usingWorker, origin } from './engineClient.js';
import { exportBlob } from './exports.js';
import { pageToSvg, fontFaceCss, fontFamilyCss } from '@/exporters/svg.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';
import { parameterOptions } from '@/engine/index.js';
import { t as tr } from './i18n.js';

const PX = 96 / 72;
let FONT_CSS = fontFaceCss(ALL_FONT_KEYS);
export function setFontBase(base) { FONT_CSS = fontFaceCss(ALL_FONT_KEYS, `${base}/fonts`); return FONT_CSS; }
let fontsReady = null;
function loadFonts() {
  if (!fontsReady) fontsReady = Promise.all(ALL_FONT_KEYS.map(k => document.fonts.load(`12px "${fontFamilyCss(k)}"`))).catch(() => {});
  return fontsReady;
}

function initialParams(def, given) {
  const out = {};
  for (const p of def.parameters || []) {
    let v = given?.[p.name] ?? (typeof p.default === 'string' && p.default.startsWith('=') ? '' : p.default) ?? '';
    if (Array.isArray(v)) v = v.join(',');
    out[p.name] = v === null ? '' : String(v);
  }
  return out;
}

// Pages further than this from the current page are empty boxes of the right size, so a
// 1,000-page report shows its first page at once and scrolls without building every SVG.
const WINDOW = 3;

const Page = ({ page, w, h, scale, index, hits, near }) => {
  const html = useMemo(() => (near ? pageToSvg(page, w, h) : ''), [page, w, h, near]);
  return (
    <div className="vpage" data-page={index + 1} style={{ width: w * scale, height: h * scale }}>
      {near && <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: html }} />}
      {near && hits?.map((r, i) => <div key={i} className={`hl${r.cur ? ' cur' : ''}`} style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }} />)}
    </div>
  );
};

/** Find text runs that contain the query. Returns [{page, x, y, w, h}] in points. */
function findText(model, q) {
  if (!q || !model) return [];
  const needle = q.toLowerCase();
  const out = [];
  model.pages.forEach((pg, pi) => {
    for (const it of pg.items) if (it.t === 'text') for (const l of it.lines) {
      if (l.text.toLowerCase().includes(needle)) out.push({ page: pi, x: l.x - 1, y: l.y - it.size * 0.95, w: (l.w || it.size * l.text.length * 0.5) + 2, h: it.size * 1.25 });
    }
  });
  return out;
}

/**
 * @param {{ definition: any, reportId?: string, params?: Record<string,string>, title?: string, compact?: boolean, autoRun?: boolean, lang?: string, onDrill?: (report: string, params: object) => void }} props
 */
export default function ReportViewer({ definition, reportId, params: given, title, compact = false, autoRun = true, lang = 'en', onDrill }) {
  const T = (k, v) => tr(lang, k, v);
  const [params, setParams] = useState(() => initialParams(definition, given));
  const [state, setState] = useState({ toggles: {}, sort: {} });
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  const [zoom, setZoom] = useState('fit');
  const [current, setCurrent] = useState(1);
  const hasParams = (definition.parameters || []).length > 0;
  const [panel, setPanel] = useState((definition.parameters || []).some(p => p.required && !p.default) ? 'params' : null);
  const [exporting, setExporting] = useState(null);
  const [options, setOptions] = useState({});
  const [query, setQuery] = useState('');
  const [hitIdx, setHitIdx] = useState(0);
  const scroller = useRef(null);
  const [fitW, setFitW] = useState(800);
  const runId = useRef(0);

  const run = useCallback(async (p = params, st = state, keepScroll = false) => {
    const id = ++runId.current;
    setStatus({ state: 'running' });
    const top = scroller.current?.scrollTop || 0;
    try {
      const [m] = await Promise.all([renderReport(definition, p, st, reportId), loadFonts()]);
      if (id !== runId.current) return;
      setModel(m);
      setStatus({ state: 'done' });
      if (keepScroll) requestAnimationFrame(() => scroller.current?.scrollTo({ top }));
      else { setCurrent(1); scroller.current?.scrollTo({ top: 0 }); }
    } catch (e) {
      if (id !== runId.current) return;
      setModel(null);
      setStatus({ state: 'error', message: e.message, missing: e.missingParameters });
      if (e.missingParameters) setPanel('params');
    }
  }, [definition, params, state, reportId]);

  useEffect(() => {
    const p0 = initialParams(definition, given);
    setState({ toggles: {}, sort: {} });
    if (autoRun) run(p0, { toggles: {}, sort: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  // choices for parameters (fixed lists and cascading lists from data sets)
  const optKey = JSON.stringify(params);
  useEffect(() => {
    if (!(definition.parameters || []).some(p => p.options || p.optionsFrom)) return;
    const t = setTimeout(() => {
      parameterOptions(definition, params, { baseUrl: origin(), reportId }).then(setOptions).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, optKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitW(el.clientWidth - 40));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = model ? (zoom === 'fit' ? Math.min(2.5, Math.max(0.3, fitW / (model.width * PX))) * PX : zoom * PX) : PX;
  const total = model?.pages.length || 0;

  const hits = useMemo(() => findText(model, query), [model, query]);
  const hitsByPage = useMemo(() => {
    const m = new Map();
    hits.forEach((h, i) => { if (!m.has(h.page)) m.set(h.page, []); m.get(h.page).push({ ...h, cur: i === hitIdx }); });
    return m;
  }, [hits, hitIdx]);
  const goHit = (i) => {
    if (!hits.length) return;
    const k = (i + hits.length) % hits.length;
    setHitIdx(k);
    scrollToPoint(hits[k].page + 1, hits[k].y);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !model) return;
    const pageH = model.height * scale + 18;
    setCurrent(Math.min(total, Math.max(1, Math.floor((el.scrollTop + el.clientHeight * 0.35) / pageH) + 1)));
  };
  const scrollToPoint = (page, y = 0) => {
    const el = scroller.current?.querySelector(`[data-page="${page}"]`);
    if (!el) return;
    scroller.current.scrollTo({ top: el.offsetTop - scroller.current.offsetTop + Math.max(0, y * scale - 40) });
    setCurrent(page);
  };
  const go = (n) => scrollToPoint(Math.min(total, Math.max(1, n)));
  const zoomBy = (f) => setZoom(z => Math.min(3, Math.max(0.25, Math.round(((z === 'fit' ? scale / PX : z) * f) * 100) / 100)));

  /* interactivity: toggles, sorting, links */
  const onClick = (e) => {
    const el = e.target.closest?.('.pw-link');
    if (!el) return;
    let a;
    try { a = JSON.parse(el.getAttribute('data-action')); } catch { return; }
    if (a.type === 'toggle') {
      const st = { ...state, toggles: { ...state.toggles, [a.key]: !a.open } };
      setState(st); run(params, st, true);
    } else if (a.type === 'sort') {
      const st = { ...state, sort: { ...state.sort, [a.table]: [{ by: a.by, dir: a.dir }] } };
      setState(st); run(params, st, true);
    } else if (a.type === 'url') {
      window.open(a.href, '_blank', 'noopener');
    } else if (a.type === 'drill') {
      if (onDrill) onDrill(a.report, a.params);
      else {
        const qs = new URLSearchParams(Object.entries(a.params || {}).map(([k, v]) => [k, v == null ? '' : String(v)]));
        window.open(`/viewer/${encodeURIComponent(a.report)}?${qs}`, '_blank', 'noopener');
      }
    } else if (a.type === 'bookmark') {
      const b = model?.bookmarks?.find(x => x.label === a.target);
      if (b) scrollToPoint(b.page, b.y);
    }
  };

  const doExport = async (fmt) => {
    if (!model) return;
    setExporting(fmt);
    try {
      const blob = fmt === 'pdf' ? await pdfBlob(model, definition.name) : await exportBlob(fmt, model, definition);
      const ext = { pdf: 'pdf', xlsx: 'xlsx', html: 'html', csv: 'csv' }[fmt];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(definition.name || 'report').replace(/[^\w-]+/g, '-')}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setStatus({ state: 'error', message: `${fmt.toUpperCase()} export failed: ${e.message}` });
    } finally { setExporting(null); }
  };

  const bookmarks = model?.bookmarks || [];
  const side = panel === 'params' && hasParams ? 'params' : panel === 'map' && bookmarks.length ? 'map' : null;

  const paramInput = (p) => {
    const opts = options[p.name];
    const val = params[p.name] ?? '';
    const set = (v) => setParams(s => ({ ...s, [p.name]: v }));
    const invalid = status.missing?.includes(p.name);
    if (opts && p.multi) {
      const cur = new Set(String(val).split(',').filter(Boolean));
      return (
        <div style={{ display: 'grid', gap: 2, maxHeight: 160, overflow: 'auto' }}>
          {opts.map(o => (
            <label className="check" key={String(o.value)}>
              <input type="checkbox" checked={cur.has(String(o.value))} onChange={(e) => { const n = new Set(cur); e.target.checked ? n.add(String(o.value)) : n.delete(String(o.value)); set([...n].join(',')); }} />{o.label}
            </label>
          ))}
        </div>
      );
    }
    if (opts) return <select className="select" aria-label={p.prompt || p.name} value={val} onChange={e => set(e.target.value)}><option value="">—</option>{opts.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</select>;
    if (p.type === 'boolean') return <select className="select" aria-label={p.prompt || p.name} value={val} onChange={e => set(e.target.value)}><option value="">—</option><option value="true">{T('true')}</option><option value="false">{T('false')}</option></select>;
    return <input className={`input${invalid ? ' invalid' : ''}`} aria-label={`${p.prompt || p.name}${p.required ? ' *' : ''}`} type={p.type === 'number' && !p.multi ? 'number' : p.type === 'date' && !p.multi ? 'date' : 'text'}
      placeholder={p.multi ? T('commaSeparated') : undefined} value={val} onChange={e => set(e.target.value)} />;
  };

  return (
    <div className="viewer" data-testid="viewer">
      <style>{FONT_CSS}</style>
      <div className="vbar">
        {title && !compact && <b style={{ marginRight: 6 }}>{title}</b>}
        {hasParams && <button className="btn sm" aria-pressed={side === 'params'} onClick={() => setPanel(s => (s === 'params' ? null : 'params'))}>{T('parameters')}</button>}
        {bookmarks.length > 0 && <button className="btn sm" aria-pressed={side === 'map'} onClick={() => setPanel(s => (s === 'map' ? null : 'map'))}>{T('documentMap')}</button>}
        <button className="btn sm" onClick={() => run()} disabled={status.state === 'running'}>{status.state === 'running' ? T('running') : T('run')}</button>
        <span className="sep" />
        <button className="btn sm icon" title={T('firstPage')} onClick={() => go(1)} disabled={!total || current === 1}>⏮</button>
        <button className="btn sm icon" title={T('previousPage')} onClick={() => go(current - 1)} disabled={!total || current === 1}>◀</button>
        <input className="input pageno" aria-label={T('page')} value={total ? current : ''} onChange={e => { const n = parseInt(e.target.value, 10); if (n) go(n); }} />
        <span className="stat">/ {total || '–'}</span>
        <button className="btn sm icon" title={T('nextPage')} onClick={() => go(current + 1)} disabled={!total || current === total}>▶</button>
        <button className="btn sm icon" title={T('lastPage')} onClick={() => go(total)} disabled={!total || current === total}>⏭</button>
        <span className="sep" />
        <button className="btn sm icon" title={T('zoomOut')} onClick={() => zoomBy(1 / 1.2)}>−</button>
        <span className="stat" style={{ width: 44, textAlign: 'center' }}>{Math.round((scale / PX) * 100)}%</span>
        <button className="btn sm icon" title={T('zoomIn')} onClick={() => zoomBy(1.2)}>+</button>
        <button className="btn sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>{T('fitWidth')}</button>
        <span className="sep" />
        <form className="search" onSubmit={(e) => { e.preventDefault(); goHit(hitIdx + 1); }}>
          <input className="input" placeholder={T('search')} aria-label={T('search')} value={query} onChange={e => { setQuery(e.target.value); setHitIdx(0); }} />
          {query && <span className="stat">{hits.length ? `${hitIdx + 1}/${hits.length}` : '0'}</span>}
          {query && hits.length > 0 && <><button type="button" className="btn sm icon" onClick={() => goHit(hitIdx - 1)} aria-label={T('previousMatch')}>↑</button><button type="submit" className="btn sm icon" aria-label={T('nextMatch')}>↓</button></>}
        </form>
        <span className="sep" />
        <button className="btn sm primary" onClick={() => doExport('pdf')} disabled={!model || !!exporting} data-testid="export-pdf">{exporting === 'pdf' ? T('exporting') : 'PDF'}</button>
        <button className="btn sm" onClick={() => doExport('xlsx')} disabled={!model || !!exporting} data-testid="export-xlsx">{exporting === 'xlsx' ? T('exporting') : 'Excel'}</button>
        <button className="btn sm" onClick={() => doExport('html')} disabled={!model || !!exporting} data-testid="export-html">{exporting === 'html' ? T('exporting') : 'HTML'}</button>
        <button className="btn sm" onClick={() => doExport('csv')} disabled={!model || !!exporting} data-testid="export-csv">{exporting === 'csv' ? T('exporting') : 'CSV'}</button>
        {model && <span className="stat" title={usingWorker() ? 'Rendered in a Web Worker' : 'Rendered on the main thread'}>
          {T('pagesRows', { pages: total, rows: Object.values(model.stats.rows).reduce((a, b) => a + b, 0), ms: model.stats.ms })}{usingWorker() ? ' · worker' : ''}
        </span>}
      </div>
      <div className="vbody" style={{ gridTemplateColumns: side ? '240px 1fr' : '1fr' }}>
        {side === 'params' && (
          <form className="vparams" onSubmit={(e) => { e.preventDefault(); const st = { toggles: {}, sort: {} }; setState(st); run(params, st); }}>
            <h3>{T('parameters')}</h3>
            {(definition.parameters || []).map(p => (
              <div className="field" key={p.name}>
                <span>{p.prompt || p.name}{p.required ? ' *' : ''}</span>
                {paramInput(p)}
              </div>
            ))}
            <button className="btn primary" type="submit">{T('viewReport')}</button>
          </form>
        )}
        {side === 'map' && (
          <nav className="vside" aria-label={T('documentMap')}>
            <h3>{T('documentMap')}</h3>
            {bookmarks.map((b, i) => <button key={i} style={{ paddingLeft: 6 + (b.level || 0) * 12 }} onClick={() => scrollToPoint(b.page, b.y)}>{b.label} <span className="hint">p.{b.page}</span></button>)}
          </nav>
        )}
        <div className="vpages" ref={scroller} onScroll={onScroll} onClick={onClick}>
          {status.state === 'error' && <div className="vmsg error" role="alert"><b>{T('didNotRun')}</b><br />{status.message}</div>}
          {!model && status.state === 'running' && <div className="vmsg">{T('runningReport')}</div>}
          {model?.warnings?.length > 0 && (
            <details className="warnings"><summary>{T('warnings', { n: model.warnings.length })}</summary>
              <ul>{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          )}
          {model?.pages.map((pg, i) => <Page key={i} index={i} page={pg} w={model.width} h={model.height} scale={scale} hits={hitsByPage.get(i)} near={Math.abs(i - (current - 1)) <= WINDOW} />)}
        </div>
      </div>
    </div>
  );
}
