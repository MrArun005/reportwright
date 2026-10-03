'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderReport, pdfBlob, usingWorker } from './engineClient.js';
import { pageToSvg, fontFaceCss, fontFamilyCss } from '@/exporters/svg.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';

const PX = 96 / 72;
const FONT_CSS = fontFaceCss(ALL_FONT_KEYS);
let fontsReady = null;
function loadFonts() {
  if (!fontsReady) fontsReady = Promise.all(ALL_FONT_KEYS.map(k => document.fonts.load(`12px "${fontFamilyCss(k)}"`))).catch(() => {});
  return fontsReady;
}

function initialParams(def, given) {
  const out = {};
  for (const p of def.parameters || []) {
    const v = given?.[p.name] ?? (typeof p.default === 'string' && p.default.startsWith('=') ? '' : p.default) ?? '';
    out[p.name] = v === null ? '' : String(v);
  }
  return out;
}

const Page = ({ page, w, h, scale, index }) => {
  const html = useMemo(() => pageToSvg(page, w, h), [page, w, h]);
  return <div className="vpage" data-page={index + 1} style={{ width: w * scale, height: h * scale }} dangerouslySetInnerHTML={{ __html: html }} />;
};

/**
 * @param {{ definition: any, params?: Record<string,string>, title?: string, compact?: boolean, autoRun?: boolean }} props
 */
export default function ReportViewer({ definition, params: given, title, compact = false, autoRun = true }) {
  const [params, setParams] = useState(() => initialParams(definition, given));
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  const [zoom, setZoom] = useState('fit');
  const [current, setCurrent] = useState(1);
  const [showParams, setShowParams] = useState((definition.parameters || []).some(p => p.required && !p.default) );
  const [exporting, setExporting] = useState(false);
  const scroller = useRef(null);
  const [fitW, setFitW] = useState(800);
  const runId = useRef(0);

  const run = useCallback(async (p = params) => {
    const id = ++runId.current;
    setStatus({ state: 'running' });
    try {
      const [m] = await Promise.all([renderReport(definition, p), loadFonts()]);
      if (id !== runId.current) return;
      setModel(m);
      setStatus({ state: 'done' });
      setCurrent(1);
      scroller.current?.scrollTo({ top: 0 });
    } catch (e) {
      if (id !== runId.current) return;
      setModel(null); // never show old pages under an error
      setStatus({ state: 'error', message: e.message, missing: e.missingParameters });
      if (e.missingParameters) setShowParams(true);
    }
  }, [definition, params]);

  useEffect(() => { if (autoRun) run(initialParams(definition, given)); /* re-run when the definition changes */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitW(el.clientWidth - 40));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = model ? (zoom === 'fit' ? Math.min(2.5, Math.max(0.3, fitW / (model.width * PX))) * PX : zoom * PX) : PX;
  const total = model?.pages.length || 0;

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !model) return;
    const pageH = model.height * scale + 18;
    setCurrent(Math.min(total, Math.max(1, Math.floor((el.scrollTop + el.clientHeight * 0.35) / pageH) + 1)));
  };
  const go = (n) => {
    const p = Math.min(total, Math.max(1, n));
    scroller.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' });
    setCurrent(p);
  };
  const zoomBy = (f) => setZoom(z => Math.min(3, Math.max(0.25, Math.round(((z === 'fit' ? scale / PX : z) * f) * 100) / 100)));

  const exportPdf = async () => {
    if (!model) return;
    setExporting(true);
    try {
      const blob = await pdfBlob(model, definition.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(definition.name || 'report').replace(/[^\w-]+/g, '-')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setStatus({ state: 'error', message: `PDF export failed: ${e.message}` });
    } finally { setExporting(false); }
  };

  const hasParams = (definition.parameters || []).length > 0;

  return (
    <div className="viewer" data-testid="viewer">
      <style>{FONT_CSS}</style>
      <div className="vbar">
        {title && !compact && <b style={{ marginRight: 6 }}>{title}</b>}
        {hasParams && <button className="btn sm" aria-pressed={showParams} onClick={() => setShowParams(s => !s)}>Parameters</button>}
        <button className="btn sm" onClick={() => run()} disabled={status.state === 'running'}>{status.state === 'running' ? 'Running…' : 'Run'}</button>
        <span className="sep" />
        <button className="btn sm icon" title="First page" onClick={() => go(1)} disabled={!total || current === 1}>⏮</button>
        <button className="btn sm icon" title="Previous page" onClick={() => go(current - 1)} disabled={!total || current === 1}>◀</button>
        <input className="input pageno" aria-label="Page" value={total ? current : ''} onChange={e => { const n = parseInt(e.target.value, 10); if (n) go(n); }} />
        <span className="stat">/ {total || '–'}</span>
        <button className="btn sm icon" title="Next page" onClick={() => go(current + 1)} disabled={!total || current === total}>▶</button>
        <button className="btn sm icon" title="Last page" onClick={() => go(total)} disabled={!total || current === total}>⏭</button>
        <span className="sep" />
        <button className="btn sm icon" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <span className="stat" style={{ width: 44, textAlign: 'center' }}>{Math.round((scale / PX) * 100)}%</span>
        <button className="btn sm icon" title="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button className="btn sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</button>
        <span className="sep" />
        <button className="btn sm primary" onClick={exportPdf} disabled={!model || exporting} data-testid="export-pdf">{exporting ? 'Exporting…' : 'Export PDF'}</button>
        {model && <span className="stat" title={usingWorker() ? 'Rendered in a Web Worker' : 'Rendered on the main thread'}>
          {total} pages · {Object.values(model.stats.rows).reduce((a, b) => a + b, 0)} rows · {model.stats.ms} ms{usingWorker() ? ' · worker' : ''}
        </span>}
      </div>
      <div className="vbody" style={{ gridTemplateColumns: showParams && hasParams ? '240px 1fr' : '1fr' }}>
        {showParams && hasParams && (
          <form className="vparams" onSubmit={(e) => { e.preventDefault(); run(params); }}>
            <h3>Parameters</h3>
            {(definition.parameters || []).map(p => (
              <label className="field" key={p.name}>
                <span>{p.prompt || p.name}{p.required ? ' *' : ''}</span>
                {p.type === 'boolean'
                  ? <select className="select" value={params[p.name] ?? ''} onChange={e => setParams(s => ({ ...s, [p.name]: e.target.value }))}><option value="">—</option><option value="true">True</option><option value="false">False</option></select>
                  : <input className={`input${status.missing?.includes(p.name) ? ' invalid' : ''}`} type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                      value={params[p.name] ?? ''} onChange={e => setParams(s => ({ ...s, [p.name]: e.target.value }))} />}
              </label>
            ))}
            <button className="btn primary" type="submit">View report</button>
          </form>
        )}
        <div className="vpages" ref={scroller} onScroll={onScroll}>
          {status.state === 'error' && <div className="vmsg error" role="alert"><b>The report did not run.</b><br />{status.message}</div>}
          {!model && status.state === 'running' && <div className="vmsg">Running the report…</div>}
          {model?.warnings?.length > 0 && (
            <details className="warnings"><summary>{model.warnings.length} warning{model.warnings.length > 1 ? 's' : ''}</summary>
              <ul>{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          )}
          {model?.pages.map((pg, i) => <Page key={i} index={i} page={pg} w={model.width} h={model.height} scale={scale} />)}
        </div>
      </div>
    </div>
  );
}
