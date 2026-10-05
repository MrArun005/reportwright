'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderReport, pdfBlob, usingWorker, origin, fetchReport, loadModelFonts, loadReportFonts } from './engineClient.js';
import { reportFetch } from './dataFetch.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';
import { exportBlob, EXPORT_DEFAULTS, needsExportData } from './exports.js';
import { pageToSvg } from '@/exporters/svg.js';
import { parameterOptions } from '@/engine/index.js';
import { safeUrl } from '@/engine/url.js';
import { t as tr, dirOf, pickLang } from './i18n.js';
import { arrangeToolbar, findText, frozenAt, galleyDefinition, pageLinks, readingText } from './logic.js';
import ParamInput from './ParamInput.jsx';

const PX = 96 / 72;
const GAP = 18; // space between pages: the .vpages gap
const COMPACT = 640; // a viewer narrower than this uses the phone layout

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

/**
 * The accessible layer of a page: a real button or link over every interactive spot of the drawing (drill-down toggles,
 * sort headers, drill-through, links, chart points), in reading order, focusable and named, plus the page's text in
 * reading order for screen readers. The mouse still clicks the drawing (pointer-events: none); a key press on a control
 * fires the same click, which the viewer's click handler reads from data-action.
 */
const A11yLayer = ({ page, scale, T }) => {
  const links = useMemo(() => pageLinks(page), [page]);
  const lines = useMemo(() => readingText(page), [page]);
  const seen = new Map();
  return (
    <>
      <div className="sr-only">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
      <div className="vlinks">
        {links.map((l, i) => {
          const a = l.action;
          const txt = l.text || l.tip;
          // a stable key: the same toggle or sort header keeps its element (and the focus) when the report runs again
          let key = a.type === 'toggle' ? `t:${a.key}` : a.type === 'sort' ? `s:${a.table}:${a.by}` : `${a.type}:${txt}`;
          const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > 1) key += `#${n}`;
          const style = { left: l.x * scale, top: l.y * scale, width: l.w * scale, height: l.h * scale };
          const common = { className: 'vlink pw-link', style, 'data-action': JSON.stringify(a) };
          if (a.type === 'url') return <a key={key} {...common} href={a.href} target="_blank" rel="noopener noreferrer">{txt || a.href}</a>;
          if (a.type === 'drill') {
            const qs = new URLSearchParams(Object.entries(a.params || {}).map(([k, v]) => [k, v == null ? '' : String(v)]));
            return <a key={key} {...common} href={`${origin()}/viewer/${encodeURIComponent(a.report)}?${qs}`}>{T('ux_a11yOpenReport', { text: txt || a.report, report: a.report })}</a>;
          }
          const label = a.type === 'toggle' ? (txt || T('ux_a11yDetails'))
            : a.type === 'sort' ? T(a.dir === 'desc' ? 'ux_a11ySortDesc' : 'ux_a11ySortAsc', { text: txt })
              : a.type === 'params' ? T('ux_a11yFilterBy', { text: txt })
                : a.type === 'bookmark' ? T('ux_a11yGoTo', { text: txt || a.target }) : txt;
          return <button key={key} type="button" {...common} aria-expanded={a.type === 'toggle' ? !!a.open : undefined}>{label}</button>;
        })}
      </div>
    </>
  );
};

const Page = ({ page, w, h, scale, index, total, hits, near, T }) => {
  const html = useMemo(() => (near ? pageToSvg(page, w, h, { animate: true }) : ''), [page, w, h, near]); // charts with `animation` play it once
  return (
    <div className="vpage" data-page={index + 1} style={{ width: w * scale, height: h * scale }} {...(near ? { role: 'region', 'aria-label': T('ux_a11yPage', { n: index + 1, total }) } : {})}>
      {near && <div style={{ width: '100%', height: '100%' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />}
      {near && hits?.map((r, i) => <div key={i} className={`hl${r.cur ? ' cur' : ''}`} style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }} />)}
      {near && <A11yLayer page={page} scale={scale} T={T} />}
    </div>
  );
};

/** A table header kept at the top while its table scrolls: the page's drawing cropped to the header (no links). */
const Frozen = ({ page, region, w, h, scale }) => {
  const html = useMemo(() => pageToSvg({ items: page.items.filter(i => i.t !== 'link') }, w, h)
    .replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/, `viewBox="${region.x} ${region.y} ${region.w} ${region.h}" width="${region.w}" height="${region.h}"`), [page, region, w, h]);
  return <div className="vfrozen-head" data-testid="frozen-header" aria-hidden="true" style={{ left: region.x * scale, width: region.w * scale, height: region.h * scale }} dangerouslySetInnerHTML={{ __html: html }} />;
};

const MODES = ['single', 'continuous', 'galley'];

/**
 * @typedef {{ page: number, pages: number, goTo: (n: number) => void, run: () => void, print: () => void, exportAs: (fmt: 'pdf'|'xlsx'|'docx'|'pptx'|'html'|'csv'|'json') => void }} ViewerApi
 * @typedef {{ id: string, label: string, title?: string, after?: string, onClick?: (api: ViewerApi) => void }} ToolbarItem
 * @param {{ definition: any, reportId?: string, params?: Record<string,string>, title?: string, compact?: boolean, autoRun?: boolean, lang?: string,
 *   onDrill?: (report: string, params: object) => void, exportHtmlOptions?: object,
 *   toolbar?: { hide?: string[], add?: ToolbarItem[] }, viewMode?: 'single' | 'continuous' | 'galley' }} props
 */
/** Drill-through levels in the address (?_drill=[{id, params}…]), so browser Back and Forward walk them and a drilled view can be shared. */
const DRILL_KEY = '_drill';
const drillOfUrl = () => { try { const v = new URL(window.location.href).searchParams.get(DRILL_KEY); const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a.filter(x => x && typeof x.id === 'string').slice(0, 50) : []; } catch { return []; } };
const urlWithDrill = (list) => { const u = new URL(window.location.href); if (list.length) u.searchParams.set(DRILL_KEY, JSON.stringify(list)); else u.searchParams.delete(DRILL_KEY); return u.toString(); };

export default function ReportViewer({ definition: rootDef, reportId: rootReportId, params: rootParams, title, compact = false, autoRun = true, lang: langIn = 'en', onDrill, exportHtmlOptions, toolbar, viewMode = 'continuous', onExported, urlState = false }) {
  const lang = pickLang(langIn);
  const dir = dirOf(lang);
  const T = (k, v) => tr(lang, k, v);
  const uid = useId();
  // Drill-through stays in this viewer: a stack of reports, root first. Each level keeps its own parameters,
  // so Back returns to the filters the user had. There is no depth limit.
  const [levels, setLevels] = useState(() => [{ def: rootDef, params: rootParams, id: rootReportId }]);
  useEffect(() => { setLevels([{ def: rootDef, params: rootParams, id: rootReportId }]); }, [rootDef]); // eslint-disable-line react-hooks/exhaustive-deps
  const level = levels[levels.length - 1];
  const definition = level.def;
  const given = level.params;
  const reportId = level.id; // the saved report behind this level: its SQL sources run on the server
  const [params, setParams] = useState(() => initialParams(definition, given));
  const [state, setState] = useState({ toggles: {}, sort: {} });
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  // a paged report opens showing whole pages; a pageless one (a dashboard) fills the width
  const [zoom, setZoom] = useState(() => (rootDef?.page?.size === 'Pageless' ? 'fit' : 'page'));
  const [current, setCurrent] = useState(1);
  const hasParams = (definition.parameters || []).some(p => !p.hidden); // hidden: set by URL, API or drill-through only
  const [panel, setPanel] = useState((definition.parameters || []).some(p => !p.hidden && p.required && !p.default && !p.nullable) ? 'params' : null);
  const [exporting, setExporting] = useState(null);
  const [options, setOptions] = useState({});
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const [mode, setMode] = useState(MODES.includes(viewMode) ? viewMode : 'continuous');
  const [fullScreen, setFullScreen] = useState(false);
  const [canFullScreen, setCanFullScreen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [menu, setMenu] = useState(false);
  // Export options (accessible PDF, PDF/A, Excel formulas, kind of HTML file): kept in this browser
  const [xopt, setXopt] = useState(() => { try { return { ...EXPORT_DEFAULTS, ...JSON.parse(localStorage.getItem('pw-export-options') || '{}') }; } catch { return { ...EXPORT_DEFAULTS }; } });
  const [xmenu, setXmenu] = useState(false);
  const setX = (k, v) => setXopt((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem('pw-export-options', JSON.stringify(n)); } catch { /* private window */ } return n; });
  const [frozen, setFrozen] = useState(null); // { page, region }: the table header kept in view
  const root = useRef(null);
  const scroller = useRef(null);
  const [fitW, setFitW] = useState(800);
  const [fitH, setFitH] = useState(700);
  const runId = useRef(0);
  const pendingY = useRef(null);
  const single = mode === 'single';
  const galley = mode === 'galley';
  // galley view is the engine's pageless layout: one long page as wide as the report's page
  const renderDef = useMemo(() => (galley ? galleyDefinition(definition) : definition), [definition, galley]);

  const lastRun = useRef('');
  const run = useCallback(async (p = params, st = state, keepScroll = false) => {
    const id = ++runId.current;
    lastRun.current = JSON.stringify(p);
    setStatus({ state: 'running' });
    const top = scroller.current?.scrollTop || 0;
    try {
      // a fresh run shows the first pages of a long report while the rest renders
      const onPartial = keepScroll ? undefined : (pm) => { if (id === runId.current) { loadModelFonts(pm).then(() => { if (id === runId.current) { setModel(pm); setCurrent(1); } }); } };
      // target: layers meant for the screen show here; print and export render again for theirs (pagedModel)
      const [m] = await Promise.all([renderReport(renderDef, p, { ...st, target: 'screen' }, reportId, { onPartial }), loadReportFonts(ALL_FONT_KEYS)]);
      await loadModelFonts(m); // and the fallback or uploaded fonts this model draws with
      if (id !== runId.current) return;
      setModel(m);
      setStatus({ state: 'done' });
      if (keepScroll) requestAnimationFrame(() => scroller.current?.scrollTo({ top }));
      else { setCurrent(1); setFrozen(null); scroller.current?.scrollTo({ top: 0 }); }
    } catch (e) {
      if (id !== runId.current) return;
      setModel(null);
      setStatus({ state: 'error', message: e.message, missing: e.missingParameters });
      if (e.missingParameters) setPanel('params');
    }
  }, [renderDef, params, state, reportId]);

  useEffect(() => {
    const p0 = level.saved || initialParams(definition, given);
    const st0 = level.state || { toggles: {}, sort: {} };
    setParams(p0);
    setState(st0);
    setModel(null);
    if (autoRun) run(p0, st0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, levels.length]);

  // switching to or from galley view lays the report out again
  const wasGalley = useRef(galley);
  useEffect(() => {
    if (wasGalley.current === galley) return;
    wasGalley.current = galley;
    if (model || status.state === 'error') run(params, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galley]);

  // Parameters apply as you change them (debounced), like a dashboard. "liveParameters": false in the report turns it off.
  const live = definition.liveParameters !== false;
  useEffect(() => {
    if (!live || !model) return;
    const key = JSON.stringify(params);
    if (key === lastRun.current) return;
    const t = setTimeout(() => { const st = { toggles: {}, sort: state.sort }; setState(st); run(params, st, true); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, live]);

  const drillTo = async (report, p, newTab) => {
    const qs = new URLSearchParams(Object.entries(p || {}).map(([k, v]) => [k, v == null ? '' : String(v)]));
    if (newTab) { window.open(`${origin()}/viewer/${encodeURIComponent(report)}?${qs}`, '_blank', 'noopener'); return; }
    setStatus({ state: 'running' });
    try {
      const def = await fetchReport(report);
      const strParams = Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, v == null ? '' : String(v)]));
      setLevels(ls => [...ls.slice(0, -1), { ...ls[ls.length - 1], saved: params, state }, { def, params: strParams, id: report }]);
      if (urlState) pushed.current++;
      if (urlState) window.history.pushState({ pwDrill: levels.length }, '', urlWithDrill([...levels.slice(1).map(l => ({ id: l.id, params: l.params || {} })), { id: report, params: strParams }]));
    } catch (e) { setStatus({ state: 'error', message: e.message }); }
  };
  const back = (to = levels.length - 2) => {
    if (to < 0) return;
    const steps = levels.length - 1 - to;
    // drills made here are history entries: go back over them (popstate sets the levels); a drilled link opened as it is: replace
    if (urlState && pushed.current >= steps) { pushed.current -= steps; window.history.go(-steps); return; }
    if (urlState) window.history.replaceState(window.history.state, '', urlWithDrill(levels.slice(1, to + 1).map(l => ({ id: l.id, params: l.params || {} }))));
    setLevels(ls => ls.slice(0, to + 1));
  };
  const pushed = useRef(0);
  // the address holds the drill levels: a drill pushes an entry; Back, Forward and an opened link restore them
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  useEffect(() => {
    if (!urlState) return undefined;
    let alive = true;
    const restore = async () => {
      const want = drillOfUrl();
      pushed.current = Math.min(pushed.current, want.length);
      const cur = levelsRef.current;
      const same = (lv, w) => lv && lv.id === w.id && JSON.stringify(lv.params || {}) === JSON.stringify(w.params || {});
      const next = [cur[0]];
      for (let i = 0; i < want.length; i++) {
        if (same(cur[i + 1], want[i]) && next.length === i + 1) { next.push(cur[i + 1]); continue; }
        try { next.push({ def: await fetchReport(want[i].id), params: want[i].params || {}, id: want[i].id }); } catch { break; }
      }
      if (alive && (next.length !== cur.length || next.some((x, i) => x !== cur[i]))) setLevels(next);
    };
    if (drillOfUrl().length) restore();
    window.addEventListener('popstate', restore);
    return () => { alive = false; window.removeEventListener('popstate', restore); };
  }, [urlState]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumb = (lv) => {
    const first = (lv.def.parameters || []).find(pp => lv.params?.[pp.name] != null && lv.params[pp.name] !== '');
    return first && lv !== levels[0] ? `${lv.def.name || lv.id} · ${lv.params[first.name]}` : (lv.def.name || lv.id || 'Report');
  };

  // choices for parameters (fixed lists and cascading lists from data sets)
  const optKey = JSON.stringify(params);
  useEffect(() => {
    if (!(definition.parameters || []).some(p => p.options || p.optionsFrom)) return;
    const t = setTimeout(() => {
      parameterOptions(definition, params, { baseUrl: origin(), reportId, fetch: reportFetch(origin()) }).then(setOptions).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, optKey]);

  // fit width, and the phone layout: by the viewer's own width (an embed can be narrow in a wide window)
  useEffect(() => {
    const el = scroller.current, rt = root.current;
    if (!el || !rt) return;
    const ro = new ResizeObserver(() => { setFitW(el.clientWidth - 40); setFitH(el.clientHeight - 48); setNarrow(rt.clientWidth < COMPACT); });
    ro.observe(el);
    ro.observe(rt);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (!narrow) setMenu(false); }, [narrow]);

  // full screen: the viewer element itself, so the embed goes full screen too
  useEffect(() => {
    setCanFullScreen(!!document.fullscreenEnabled);
    const on = () => setFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullScreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    root.current?.requestFullscreen?.()?.catch?.(() => {});
  };

  // body sections may have pages of other sizes (page.width / page.height): fit the widest
  const maxW = model ? model.pages.reduce((m, p) => Math.max(m, p.width || 0), model.width) : 0;
  const maxH = model ? model.pages.reduce((m, p) => Math.max(m, p.height || 0), model.height || 0) : 0;
  const fitWidth = Math.min(2.5, Math.max(0.3, fitW / (maxW * PX)));
  // whole page: the page fits the view both ways (on a phone, fit width: a whole page there is too small to read)
  const scale = model ? (zoom === 'fit' || (zoom === 'page' && narrow) ? fitWidth * PX : zoom === 'page' ? Math.min(fitWidth, Math.max(0.2, fitH / ((maxH || 1) * PX))) * PX : zoom * PX) : PX;
  const total = model?.pages.length || 0;

  const hits = useMemo(() => findText(model, query, { matchCase, wholeWord }), [model, query, matchCase, wholeWord]);
  // a cell showing #Error: the warnings that explain it open by themselves
  const hasErrorCells = useMemo(() => !!model?.warnings?.length && findText(model, '#Error').length > 0, [model]);
  const hitsByPage = useMemo(() => {
    const m = new Map();
    hits.forEach((h, i) => { if (!m.has(h.page)) m.set(h.page, []); m.get(h.page).push({ ...h, cur: i === hitIdx }); });
    return m;
  }, [hits, hitIdx]);

  // where a page starts inside the scrolling area, in pixels
  const topOf = (node) => node.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top + scroller.current.scrollTop;
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !model || single) return;
    // page i starts at tops[i] (pages may differ in height)
    const tops = [0];
    for (const p of model.pages) tops.push(tops[tops.length - 1] + (p.height ?? model.height) * scale + GAP);
    const at = (y) => { let lo = 0, hi = total - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
    setCurrent(Math.min(total, Math.max(1, at(el.scrollTop + el.clientHeight * 0.35) + 1)));
    // the table header to keep in view: the page at the top edge, and how far down that page the view starts
    const first = el.querySelector('.vpage');
    if (!first) return;
    const y = el.scrollTop - topOf(first);
    const i = Math.min(total - 1, Math.max(0, at(y)));
    const region = frozenAt(model.pages[i], (y - tops[i]) / scale);
    setFrozen(f => (region ? (f?.region === region ? f : { page: i, region }) : null));
  };
  const scrollToPoint = (page, y = 0) => {
    if (single) { pendingY.current = y; setCurrent(page); return; }
    const el = scroller.current?.querySelector(`[data-page="${page}"]`);
    if (!el) return;
    scroller.current.scrollTo({ top: topOf(el) + Math.max(0, y * scale - 40) });
    setCurrent(page);
  };
  // single page view: after the page changes, show the point asked for (a search hit, a bookmark), else the top
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!single || !sc) return;
    const el = sc.querySelector('.vpage');
    const y = pendingY.current;
    pendingY.current = null;
    sc.scrollTo({ top: el && y ? topOf(el) + Math.max(0, y * scale - 40) : 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, single]);
  // back to continuous view: keep the page that was showing
  useLayoutEffect(() => {
    const el = !single && current > 1 && scroller.current?.querySelector(`[data-page="${current}"]`);
    if (el) scroller.current.scrollTo({ top: topOf(el) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single]);
  const go = (n) => scrollToPoint(Math.min(total, Math.max(1, n)));
  const goHit = (i) => {
    if (!hits.length) return;
    const k = (i + hits.length) % hits.length;
    setHitIdx(k);
    scrollToPoint(hits[k].page + 1, hits[k].y);
  };
  const zoomBy = (f) => setZoom(z => Math.min(3, Math.max(0.25, Math.round(((typeof z === 'string' ? scale / PX : z) * f) * 100) / 100)));

  // swipe left or right: next or previous page (mirrored right-to-left)
  const touch = useRef(null);
  const onTouchStart = (e) => { const p = e.touches[0]; touch.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null; };
  const onTouchEnd = (e) => {
    const s = touch.current, el = scroller.current;
    touch.current = null;
    if (!s || !el || el.scrollWidth > el.clientWidth + 1) return; // a zoomed-in page pans sideways instead
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    go(current + ((dx < 0) === (dir === 'ltr') ? 1 : -1));
  };

  /* interactivity: toggles, sorting, links */
  const onClick = (e) => {
    const el = e.target.closest?.('.pw-link');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault(); // the accessible layer's links: the viewer opens them as the drawing's would
    let a;
    try { a = JSON.parse(el.getAttribute('data-action')); } catch { return; }
    if (a.type === 'toggle') {
      const st = { ...state, toggles: { ...state.toggles, [a.key]: !a.open } };
      setState(st); run(params, st, true);
    } else if (a.type === 'sort') {
      const st = { ...state, sort: { ...state.sort, [a.table]: [{ by: a.by, dir: a.dir }] } };
      setState(st); run(params, st, true);
    } else if (a.type === 'url') {
      if (safeUrl(a.href)) window.open(a.href, '_blank', 'noopener');
    } else if (a.type === 'drill') {
      if (onDrill) onDrill(a.report, a.params);
      else drillTo(a.report, a.params, e.metaKey || e.ctrlKey);
    } else if (a.type === 'params') {
      // cross-filter: set parameters from the clicked value; clicking the same value again clears it
      const next = { ...params };
      for (const [k, v] of Object.entries(a.params || {})) {
        const val = v == null ? '' : String(v);
        const pdef = (definition.parameters || []).find(pp => pp.name === k);
        const fallback = pdef && pdef.default != null && !(typeof pdef.default === 'string' && pdef.default.startsWith('=')) ? String(pdef.default) : '';
        next[k] = a.toggle && String(params[k] ?? '') === val ? fallback : val;
      }
      const st = { toggles: {}, sort: state.sort };
      setParams(next); setState(st); run(next, st, true);
    } else if (a.type === 'bookmark') {
      const b = a.page ? a : model?.bookmarks?.find(x => x.label === a.target); // TOC entries from headings carry their place
      if (b) scrollToPoint(b.page, b.y);
    }
  };

  // Galley view shows one long page; print and the exports are of the paged report. A report with layers (or a
  // master, which may bring layers) renders again for the print or export target: a screen-only layer stays on screen.
  // A view renders without table data (render option exportData): Excel, CSV, Word, PowerPoint, HTML and the accessible PDF render again with it.
  const pagedModel = (target, exportData = false) => (galley || definition.layers?.length || definition.master || (exportData && model?.regions == null) ? renderReport(definition, params, { ...state, target }, reportId, { exportData }) : model);

  const doExport = async (fmt) => {
    if (!model) return;
    setExporting(fmt);
    try {
      const m = await pagedModel('export', needsExportData(fmt, xopt));
      const strings = { pages: T('htmlPages'), tables: T('htmlTables'), all: T('htmlAll'), filter: T('htmlFilter'), toggle: T('htmlToggle'), sortAsc: T('htmlSortAsc'), sortDesc: T('htmlSortDesc') };
      const blob = fmt === 'pdf'
        ? await pdfBlob(m, definition.name, { tagged: xopt.pdfua ? { lang: definition.locale || lang } : undefined, pdfa: xopt.pdfa })
        : await exportBlob(fmt, m, definition, { params, state, lang, options: xopt, strings, ...(exportHtmlOptions || {}), ...(level.id ? { reportId: level.id } : {}) });
      const ext = { pdf: 'pdf', xlsx: 'xlsx', docx: 'docx', pptx: 'pptx', html: 'html', csv: 'csv', json: 'json' }[fmt];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(definition.name || 'report').replace(/[^\w-]+/g, '-')}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      onExported?.(fmt, level.id, params); // the app's own pages tell the server, for the audit log
    } catch (e) {
      setStatus({ state: 'error', message: T('exportFailed', { fmt: fmt.toUpperCase(), message: e.message }) });
    } finally { setExporting(null); }
  };

  // Print the PDF from a hidden frame on the host page (outside the embed's shadow root). If the browser
  // will not print a frame, the PDF opens in a new tab to print from there.
  const print = async () => {
    if (!model) return;
    setExporting('print');
    try {
      const blob = await pdfBlob(await pagedModel('print'), definition.name);
      onExported?.('print', level.id, params);
      const url = URL.createObjectURL(blob);
      document.querySelector('iframe[data-pw-print]')?.remove();
      const f = document.createElement('iframe');
      f.dataset.pwPrint = '1';
      f.title = T('print');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank', 'noopener'); } };
      f.src = url;
      document.body.appendChild(f);
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      setStatus({ state: 'error', message: T('exportFailed', { fmt: T('print'), message: e.message }) });
    } finally { setExporting(null); }
  };

  const bookmarks = model?.bookmarks || [];
  const side = panel === 'params' && hasParams ? 'params'
    : panel === 'map' && bookmarks.length ? 'map'
      : panel === 'matches' && query ? 'matches' : null;
  const columns = Math.max(1, Math.min(6, Math.floor(Number(definition.parameterLayout?.columns) || 1)));
  const paramsOnTop = side === 'params' && columns > 1 && !narrow;

  /* ---------------- toolbar: every built-in item has a stable id (docs/API.md, "Viewer toolbar") ---------------- */
  /** @type {ViewerApi} */
  const api = { page: current, pages: total, goTo: go, run: () => run(), print, exportAs: doExport };
  const exportItem = (id, fmt, label, extra = {}) => ({
    id, group: 'export',
    node: <button className={`btn sm${fmt === 'pdf' ? ' primary' : ''}`} onClick={() => doExport(fmt)} disabled={!model || !!exporting} data-testid={`export-${fmt}`} {...extra}>{exporting === fmt ? T('exporting') : label}</button>,
  });
  const builtIns = [
    hasParams && { id: 'parameters', group: 'panels', primary: true, node: <button className="btn sm" aria-pressed={side === 'params'} onClick={() => setPanel(s => (s === 'params' ? null : 'params'))}>{T('parameters')}</button> },
    bookmarks.length > 0 && { id: 'documentMap', group: 'panels', node: <button className="btn sm" aria-pressed={side === 'map'} onClick={() => setPanel(s => (s === 'map' ? null : 'map'))}>{T('documentMap')}</button> },
    { id: 'run', group: 'panels', node: <button className="btn sm" onClick={() => run()} disabled={status.state === 'running'}>{status.state === 'running' ? T('running') : T('run')}</button> },
    { id: 'firstPage', group: 'paging', node: <button className="btn sm icon" title={T('firstPage')} aria-label={T('firstPage')} onClick={() => go(1)} disabled={!total || current === 1}><span className="flip" aria-hidden="true">⏮</span></button> },
    { id: 'previousPage', group: 'paging', primary: true, node: <button className="btn sm icon" title={T('previousPage')} aria-label={T('previousPage')} onClick={() => go(current - 1)} disabled={!total || current === 1}><span className="flip" aria-hidden="true">◀</span></button> },
    {
      id: 'pageNumber', group: 'paging', primary: true,
      node: <>
        <input className="input pageno" aria-label={T('page')} value={total ? current : ''} onChange={e => { const n = parseInt(e.target.value, 10); if (n) go(n); }} />
        <span className="stat" title={model?.partial ? T('stillRendering') : undefined}>/ {total ? (model?.partial ? `${total}+` : total) : '–'}</span>
      </>,
    },
    { id: 'nextPage', group: 'paging', primary: true, node: <button className="btn sm icon" title={T('nextPage')} aria-label={T('nextPage')} onClick={() => go(current + 1)} disabled={!total || current === total}><span className="flip" aria-hidden="true">▶</span></button> },
    { id: 'lastPage', group: 'paging', node: <button className="btn sm icon" title={T('lastPage')} aria-label={T('lastPage')} onClick={() => go(total)} disabled={!total || current === total}><span className="flip" aria-hidden="true">⏭</span></button> },
    { id: 'zoomOut', group: 'zoom', node: <button className="btn sm icon" title={T('zoomOut')} aria-label={T('zoomOut')} onClick={() => zoomBy(1 / 1.2)}>−</button> },
    { id: 'zoomValue', group: 'zoom', node: <span className="stat zoomval">{Math.round((scale / PX) * 100)}%</span> },
    { id: 'zoomIn', group: 'zoom', node: <button className="btn sm icon" title={T('zoomIn')} aria-label={T('zoomIn')} onClick={() => zoomBy(1.2)}>+</button> },
    { id: 'fitPage', group: 'zoom', node: <button className="btn sm" aria-pressed={zoom === 'page'} onClick={() => setZoom('page')} data-testid="fit-page">{T('ux_wholePage')}</button> },
    { id: 'fitWidth', group: 'zoom', node: <button className="btn sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>{T('fitWidth')}</button> },
    {
      id: 'viewMode', group: 'view',
      node: <select className="select vmode" aria-label={T('viewMode')} value={mode} onChange={e => { setMode(e.target.value); setFrozen(null); }}>
        {MODES.map(m => <option key={m} value={m}>{T(m)}</option>)}
      </select>,
    },
    canFullScreen && { id: 'fullScreen', group: 'view', node: <button className="btn sm icon" aria-pressed={fullScreen} title={fullScreen ? T('exitFullScreen') : T('fullScreen')} aria-label={T('fullScreen')} onClick={toggleFullScreen}>⛶</button> },
    model && {
      id: 'stats', group: 'stats',
      node: <span className="stat vstats" title={usingWorker() ? 'Rendered in a Web Worker' : 'Rendered on the main thread'}>
        {T('pagesRows', { pages: total, rows: Object.values(model.stats.rows).reduce((a, b) => a + b, 0), ms: model.stats.ms })}{usingWorker() ? ' · worker' : ''}
      </span>,
    },
    {
      id: 'search', group: 'search', primary: true,
      node: <form className="search" onSubmit={(e) => { e.preventDefault(); goHit(hitIdx + 1); }}>
        <input className="input" type="search" placeholder={T('search')} aria-label={T('search')} value={query} onChange={e => { setQuery(e.target.value); setHitIdx(0); }} />
        <button type="button" className="btn sm icon opt" aria-pressed={matchCase} aria-label={T('matchCase')} title={T('matchCase')} onClick={() => { setMatchCase(v => !v); setHitIdx(0); }}>Aa</button>
        <button type="button" className="btn sm icon opt" aria-pressed={wholeWord} aria-label={T('wholeWord')} title={T('wholeWord')} onClick={() => { setWholeWord(v => !v); setHitIdx(0); }}><u>ab</u></button>
        {query && <span className="stat" aria-live="polite">{hits.length ? `${hitIdx + 1}/${hits.length}` : '0'}</span>}
        {query && hits.length > 0 && <>
          <button type="button" className="btn sm icon" onClick={() => goHit(hitIdx - 1)} aria-label={T('previousMatch')}>↑</button>
          <button type="submit" className="btn sm icon" aria-label={T('nextMatch')}>↓</button>
          <button type="button" className="btn sm icon" aria-pressed={side === 'matches'} aria-label={T('allMatches')} title={T('allMatches')} onClick={() => setPanel(s => (s === 'matches' ? null : 'matches'))}>☰</button>
        </>}
      </form>,
    },
    { id: 'print', group: 'export', node: <button className="btn sm" onClick={print} disabled={!model || !!exporting} data-testid="print">{exporting === 'print' ? T('printing') : T('print')}</button> },
    exportItem('pdf', 'pdf', 'PDF'),
    exportItem('excel', 'xlsx', 'Excel'),
    exportItem('word', 'docx', 'Word', { title: T('wordHint') }),
    exportItem('powerpoint', 'pptx', 'PowerPoint', { title: T('pptxHint') }),
    exportItem('html', 'html', 'HTML'),
    exportItem('csv', 'csv', 'CSV'),
    exportItem('json', 'json', 'JSON', { title: T('jsonHint') }),
    {
      id: 'exportOptions', group: 'export',
      node: <span className="vexp">
        <button type="button" className="btn sm icon" aria-label={T('exportOptions')} title={T('exportOptions')} aria-expanded={xmenu} aria-haspopup="true" data-testid="export-options" onClick={() => setXmenu(v => !v)}>⚙</button>
      </span>,
    },
  ].filter(Boolean);
  const items = arrangeToolbar(builtIns, toolbar || {});
  const GROUPS = { paging: T('groupPaging'), zoom: T('groupZoom'), view: T('groupView'), export: T('groupExport') };
  /** Consecutive items of one group go in one .tgroup; a flexible gap comes before the search box. */
  const renderItems = (list) => {
    const out = [];
    for (let i = 0; i < list.length;) {
      const g = list[i].group;
      const chunk = [];
      while (i < list.length && list[i].group === g) chunk.push(list[i++]);
      const nodes = chunk.map(it => (
        <span key={it.id} className="titem" data-toolbar-id={it.id}>
          {it.custom ? <button type="button" className="btn sm" title={it.title} onClick={() => it.onClick?.(api)}>{it.label}</button> : it.node}
        </span>
      ));
      if (g === 'search') out.push(<span key="gap" className="vbar-gap" />);
      out.push(GROUPS[g] ? <div key={`g${i}`} className={`tgroup ${g}`} role="group" aria-label={GROUPS[g]}>{nodes}</div> : nodes);
      if (g === 'panels') out.push(<span key="sep" className="sep" />);
    }
    return out;
  };
  // phone layout: the main items stay in the bar, the rest go into the "more" menu
  const inBar = narrow ? items.filter(i => i.primary) : items;
  const inMenu = narrow ? items.filter(i => !i.primary) : [];
  const onRootPointerDown = (e) => {
    if (menu && !e.target.closest?.('.vmenu, .vmore')) setMenu(false);
    if (xmenu && !e.target.closest?.('.vexp')) setXmenu(false);
  };
  const onRootKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    if (xmenu) setXmenu(false);
    if (menu) setMenu(false);
    else if (narrow && side) setPanel(null);
  };

  // on a phone the side panels open as bottom sheets
  const sheet = (name, content) => (!narrow ? content : (
    <div className="vsheet-wrap">
      <div className="vscrim" onClick={() => setPanel(null)} />
      <div className="vsheet" role="dialog" aria-modal="true" aria-label={name}>
        <button type="button" className="btn sm icon vsheet-close" aria-label={T('close')} onClick={() => setPanel(null)}><span aria-hidden="true">✕</span></button>
        {content}
      </div>
    </div>
  ));

  const shown = !model ? [] : single ? [current - 1].filter(i => model.pages[i]) : model.pages.map((_, i) => i);

  return (
    <div ref={root} className={`viewer${narrow ? ' narrow' : ''}`} data-testid="viewer" data-view-mode={mode} dir={dir} lang={lang}
      onPointerDown={onRootPointerDown} onKeyDown={onRootKeyDown}>
      {levels.length > 1 && (
        <nav className="vcrumbs" aria-label={T('drillPath')}>
          <button type="button" className="btn sm" onClick={() => back()} data-testid="drill-back">{dir === 'rtl' ? '→' : '←'} {T('back')}</button>
          <ol>
            {levels.map((lv, i) => (
              <li key={i}>{i < levels.length - 1
                ? <button type="button" className="linklike" onClick={() => back(i)}>{crumb(lv)}</button>
                : <b aria-current="page">{crumb(lv)}</b>}</li>
            ))}
          </ol>
          <span className="hint">{T('drillDepth', { n: levels.length - 1 })}</span>
        </nav>
      )}
      <div className="vbar">
        {title && !compact && !narrow && levels.length === 1 && <b style={{ marginInlineEnd: 6 }}>{title}</b>}
        {renderItems(inBar)}
        {inMenu.length > 0 && (
          <span className="vmore-wrap">
            <button type="button" className="btn sm icon vmore" aria-label={T('more')} title={T('more')} aria-expanded={menu} onClick={() => setMenu(v => !v)}><span aria-hidden="true">⋯</span></button>
            {menu && <div className="vmenu" role="group" aria-label={T('more')}>{renderItems(inMenu)}</div>}
          </span>
        )}
        {xmenu && (
          <span className="vmore-wrap vexp">
            <div className="vmenu" role="group" aria-label={T('exportOptions')} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label title={T('optPdfUaHint')}><input type="checkbox" checked={xopt.pdfua} onChange={e => setX('pdfua', e.target.checked)} data-testid="opt-pdfua" /> {T('optPdfUa')}</label>
              <label><input type="checkbox" checked={xopt.pdfa} onChange={e => setX('pdfa', e.target.checked)} data-testid="opt-pdfa" /> {T('optPdfA')}</label>
              <label><input type="checkbox" checked={xopt.formulas} onChange={e => setX('formulas', e.target.checked)} data-testid="opt-formulas" /> {T('optFormulas')}</label>
              <label>{T('optHtml')}{' '}
                <select className="select" value={xopt.html} onChange={e => setX('html', e.target.value)} data-testid="opt-html">
                  <option value="interactive">{T('optHtmlInteractive')}</option>
                  <option value="tables">{T('optHtmlTables')}</option>
                  <option value="static">{T('optHtmlStatic')}</option>
                </select>
              </label>
            </div>
          </span>
        )}
      </div>
      <div className="vbody" style={paramsOnTop ? { gridTemplateColumns: '1fr', gridTemplateRows: 'auto 1fr' } : { gridTemplateColumns: side && !narrow ? '240px 1fr' : '1fr' }}>
        {side === 'params' && sheet(T('parameters'), (
          <form className={`vparams${paramsOnTop ? ' top' : ''}`} style={paramsOnTop ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
            onSubmit={(e) => { e.preventDefault(); const st = { toggles: {}, sort: {} }; setState(st); run(params, st); if (narrow) setPanel(null); }}>
            <h3>{T('parameters')}</h3>
            {(definition.parameters || []).filter(p => !p.hidden).map(p => (
              <div className="field" key={p.name}>
                <span>{p.prompt || p.name}{p.required ? ' *' : ''}</span>
                <ParamInput p={p} value={params[p.name]} options={options[p.name]} invalid={status.missing?.includes(p.name)} T={T} name={`${uid}-${p.name}`}
                  onChange={(v) => setParams(s => ({ ...s, [p.name]: v }))} />
              </div>
            ))}
            <div className="vparams-go">
              <button className="btn primary" type="submit">{T('viewReport')}</button>
              {live && <span className="hint">{T('ux_liveHint')}</span>}
            </div>
          </form>
        ))}
        {side === 'map' && sheet(T('documentMap'), (
          <nav className="vside" aria-label={T('documentMap')}>
            <h3>{T('documentMap')}</h3>
            {bookmarks.map((b, i) => <button key={i} style={{ paddingInlineStart: 6 + (b.level || 0) * 12 }} onClick={() => { scrollToPoint(b.page, b.y); if (narrow) setPanel(null); }}>{b.label} <span className="hint">p.{b.page}</span></button>)}
          </nav>
        ))}
        {side === 'matches' && sheet(T('matches'), (
          <nav className="vside vmatches" aria-label={T('matches')}>
            <h3>{T('matchCount', { n: hits.length })}</h3>
            {!hits.length && <span className="hint">{T('noMatches')}</span>}
            {hits.slice(0, 500).map((h, i) => (
              <button key={i} aria-current={i === hitIdx ? 'true' : undefined} onClick={() => { setHitIdx(i); scrollToPoint(h.page + 1, h.y); if (narrow) setPanel(null); }}>
                <span className="hint">{T('pageShort', { n: h.page + 1 })}</span> {h.text}
              </button>
            ))}
          </nav>
        ))}
        <div className="vpages" ref={scroller} role="document" aria-label={definition.name || T('ux_a11yReport')} onScroll={onScroll} onClick={onClick} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {status.state === 'error' && <div className="vmsg error" role="alert"><b>{T('didNotRun')}</b><br />{status.message}</div>}
          {!model && status.state === 'running' && <div className="vmsg">{T('runningReport')}</div>}
          {model?.warnings?.length > 0 && (
            <details className="warnings" open={hasErrorCells || undefined} data-testid="viewer-warnings"><summary>{T('warnings', { n: model.warnings.length })}</summary>
              <ul>{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          )}
          {model && !single && (
            <div className="vfrozen" style={{ width: (model.pages[frozen?.page]?.width ?? model.width) * scale }}>
              {frozen && model.pages[frozen.page] && <Frozen page={model.pages[frozen.page]} region={frozen.region} w={model.pages[frozen.page].width ?? model.width} h={model.pages[frozen.page].height ?? model.height} scale={scale} />}
            </div>
          )}
          {shown.map(i => <Page key={i} index={i} total={total} T={T} page={model.pages[i]} w={model.pages[i].width ?? model.width} h={model.pages[i].height ?? model.height} scale={scale} hits={hitsByPage.get(i)} near={single || Math.abs(i - (current - 1)) <= WINDOW} />)}
        </div>
      </div>
    </div>
  );
}
