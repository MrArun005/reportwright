// @ts-check
/**
 * Pagewright engine.
 * render(definition, options) → page model.
 * No React, no DOM. Runs in a Web Worker and in Node.
 */
import { resolvePage } from './units.js';
import { FontStore, ALL_FONT_KEYS } from './text/fonts.js';
import { safeUrl } from './url.js';
import { TextMeasurer, finishText } from './text/measure.js';
import { loadSources, buildDataSets, coerce } from './data/index.js';
import { evalValue, evaluate, functionTable } from './expr/evaluate.js';
import { isoDate } from './expr/format.js';
import { BASE_STYLE } from './style.js';
import { resolveImageSrc } from './image.js';
import { ITEMS } from './items/index.js';
import { loadBarcodes } from './items/barcode.js';
import { placeItems } from './items/paint.js';
import { paginate } from './paginate/index.js';
import { layoutItems } from './layout.js';
import { validate } from './schema/validate.js';
import { makeLoader, resolveReuse, resolveTheme, flattenNamed, REUSE_LIMITS } from './reuse.js';
import { layerFilter } from './layout.js';

export class ReportError extends Error {
  /** @param {string} msg @param {object} [extra] */
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); this.name = 'ReportError'; }
}

const EPS = 0.01;
const MAX_SUBREPORTS = 2000; // per render, all nesting levels together

/**
 * @param {any} def report definition
 * @param {{
 *   parameters?: Record<string, any>,
 *   fontStore?: FontStore,
 *   loadFont?: (key: string) => Promise<ArrayBuffer|Uint8Array>,
 *   fetch?: typeof fetch,
 *   baseUrl?: string,
 *   sources?: Record<string, any>,
 *   now?: Date,
 *   reportId?: string,
 *   sql?: (src: any, params: Record<string, any>) => Promise<object[]>,
 *   timeoutMs?: number,
 *   onSources?: (sources: Record<string, any>) => void,
 *   deadline?: number,
 * }} opts
 *   reportId: the saved report, whose SQL sources the server runs for a browser render.
 *   sql: runs SQL sources directly (server renders).
 *   timeoutMs: stop with a ReportError (status 504) when the render runs longer; subreports share the deadline.
 */
export async function render(def0, opts = {}) {
  const t0 = Date.now();
  // masters, stylesheets and part libraries: other saved reports, each loaded once for this render and its subreports
  const reuseWarnings = [];
  const getReport = makeLoader(opts.loadReport, opts.reportCache || (opts.reportCache = new Map()));
  let def = def0, parts = null;
  if (def0 && typeof def0 === 'object' && !Array.isArray(def0)) {
    // one item budget for report parts across this render and its subreports (opts is passed on to them)
    ({ def, parts } = await resolveReuse(def0, getReport, (m) => { if (!reuseWarnings.includes(m)) reuseWarnings.push(m); }, opts.reportId ? [opts.reportId] : [], opts.reuseBudget || (opts.reuseBudget = { items: 0 })));
  }
  const v = validate(def);
  // an expression that does not parse stops only its own item or cell (#Error there, a warning here)
  const cellErrors = new Set(v.exprErrors);
  const fatal = v.errors.filter(e => !cellErrors.has(e));
  if (fatal.length) throw new ReportError(fatal[0], { errors: v.errors });
  /** @type {string[]} */
  const warnings = [...v.warnings, ...[...cellErrors].slice(0, 100), ...reuseWarnings].slice(0, 200); // warn() keeps it at 200
  const warn = (msg) => { if (warnings.length < 200 && !warnings.includes(msg)) warnings.push(msg); };

  const page = resolvePage(def.page);
  if (['pageHeader', 'body', 'pageFooter'].some(k => hasType(k === 'body' && Array.isArray(def.sections?.body) ? def.sections.body.flatMap(b => b.items || []) : def.sections?.[k]?.items, 'barcode'))) await loadBarcodes();
  const params = resolveParameters(def, opts.parameters || {});

  const store = opts.fontStore || new FontStore(/** @type {any} */ (opts.loadFont));
  await store.load(ALL_FONT_KEYS);
  let m = new TextMeasurer(store);

  // the time limit: an absolute deadline, the same for this render and its subreports
  const deadline = opts.deadline ?? (Number(opts.timeoutMs) > 0 ? t0 + Number(opts.timeoutMs) : null);
  const clock = deadline ? { until: deadline, n: 0, over: false } : null;
  const overTime = () => {
    if (clock && (clock.over || Date.now() > clock.until)) {
      throw new ReportError(`The report ran longer than ${Math.round(Number(opts.timeoutMs || deadline - t0) / 100) / 10} s, the time limit on this server. Filter the data, or avoid aggregates over the whole data set in every row.`, { status: 504, timeout: true });
    }
  };
  const now = opts.now || new Date();
  const fnCount = opts.fnCount || { n: 0 }; // report function calls, for this render and its subreports
  const baseCtx = {
    params, globals: { ExecutionTime: now, ReportName: def.name || '', PageNumber: 1, TotalPages: 1 },
    dataSets: {}, fields: null, locale: def.locale, currency: def.currency, // neither set: en-US numbers, no currency symbol (expr/format.js)
    functions: functionTable(def, fnCount), clock,
    aggCache: new WeakMap(), // aggregate results for this render (expr/evaluate.js)
    fmtMemo: new Map(), // formatted dates for this render (expr/format.js)
  };
  // Theme.* in expressions: a theme report (maybe picked by a parameter), the report's own theme, or the default
  baseCtx.theme = await resolveTheme(def, baseCtx, getReport, warn);
  // where this render goes: layers can be for the screen, print or export only (the viewer says which; else export)
  const target = opts.target || opts.state?.target || 'export';
  const layerOff = layerFilter(def.layers, target);
  const named = flattenNamed(def.styles?.named, warn);
  const sources = opts.sources || await loadSources(def, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId });
  opts.onSources?.(sources); // the worker's first-pages render hands its data to the full render that follows
  const dataSets = buildDataSets(def, sources, { ...baseCtx, warn });
  baseCtx.dataSets = dataSets;
  overTime();
  const defaultDs = def.dataSets?.[0]?.name;
  const kept = warnings.length; // a second layout pass starts from here

  const sec = def.sections || {};
  // sections.body: one body, or an array of body sections each with its own page (spec §3.8)
  const bodies = Array.isArray(sec.body) ? (sec.body.length ? sec.body : [{}]) : [sec.body || {}];
  const allBody = bodies.flatMap(b => b.items || []);
  const header = sec.pageHeader?.height ? sec.pageHeader : null;
  const footer = sec.pageFooter?.height ? sec.pageFooter : null;
  const headerH = header?.height || 0;
  const footerH = footer?.height || 0;
  const contentH = page.height - page.margins.top - page.margins.bottom - headerH - footerH;
  if (contentH < 24) throw new ReportError('The page header and footer leave no room for the body. Make them shorter or the margins smaller.');

  const base = { ...BASE_STYLE, ...(def.styles?.base || {}) };
  let idSeq = 0;
  const regions = [];
  // 50 MB of images per render, each distinct image once: subreports share their parent's, and every layout pass
  // the same one (an image is counted once, so a second pass adds nothing)
  const imageBudget = opts.imageBudget || { seen: new Set(), bytes: 0 };
  const makeLc = (globals, fixed) => {
    const lc = {
      m, base, dataSets, warn, fixed, maxUnitHeight: contentH, state: opts.state || {}, regions,
      named, parts, layerOff,
      nextId: () => ++idSeq,
      // the time limit, read every 256 rows of tables and lists (expr/evaluate.js counts evaluations the same way)
      tick: clock ? () => { if (clock.over || ((++clock.n & 255) === 0 && Date.now() > clock.until)) { clock.over = true; overTime(); } } : null,
      layoutItems: (items, l, o) => layoutItems(items, l, o),
      linkFor: (it, ctx, rect) => linkFor(it, ctx, rect, warn, opts.state),
      ctxFor: (item) => {
        const ds = item.dataSet || defaultDs;
        const rows = (ds && dataSets[ds]) || [];
        return { ...baseCtx, globals, fields: rows[0] || null, aggRows: rows };
      },
      subreports: null,
      bodyWidth: opts.bodyWidth ?? page.bodyWidth,
      images: def.images || {}, imageBudget,
      cellItems: { left: 100000 }, // rows of items inside table cells, for the whole render (items/index.js)
    };
    return lc;
  };

  /* ---------------- body: layout + push-down ---------------- */
  const firstPages = Number(opts.firstPages) || 0;
  let cutRows = () => false;
  const layoutAll = async () => {
    warnings.length = kept;
    idSeq = 0;
    if (!opts.fnCount) fnCount.n = 0; // each layout pass (fonts, TOC) gets the full budget
    const lc = makeLc(baseCtx.globals, false);
    // opts.firstPages: lay out only enough rows for that many pages (a fast first look; the full render follows).
    // 8 pt is the smallest sensible row, so this budget always fills the pages asked for. Not with a table of contents.
    // With a table of contents the budget starts after a full pass that finds its entries (below).
    const budget = () => ({ left: Math.ceil((firstPages * contentH) / 8), cut: false });
    const hasToc = hasType(allBody, 'toc');
    lc.rowBudget = firstPages > 0 && !opts.bodyOnly && !hasToc ? budget() : null;
    cutRows = () => !!lc.rowBudget?.cut;

    // Subreports: one pass collects what to load, then each child renders its body with its own data.
    if (hasType(allBody, 'subreport')) {
      if (!opts.loadReport) lc.subreports = null;
      else {
        const depth = opts.depth || 0;
        if (depth > 3) throw new ReportError('Subreports are nested more than 3 levels deep');
        const requests = new Map();
        layoutItems(allBody, { ...lc, regions: [], warn: () => {}, subreports: { mode: 'collect', requests } });
        // one budget for the whole render, all levels: a subreport per row of a big table would otherwise multiply
        const budget = opts.budget || { used: 0 };
        if (budget.used + requests.size > MAX_SUBREPORTS) throw new ReportError(`This report would render more than ${MAX_SUBREPORTS} subreports. Filter the data, or show the rows in a table.`);
        budget.used += requests.size;
        const results = new Map();
        const defs = new Map();
        for (const [key, rq] of requests) {
          try {
            if ((opts.chain || []).includes(rq.report)) throw new Error('it includes itself');
            if (!defs.has(rq.report)) defs.set(rq.report, await opts.loadReport(rq.report));
            const child = defs.get(rq.report);
            const r = await render(child, { ...opts, target, onSources: undefined, deadline: deadline ?? undefined, reportId: rq.report, budget, fnCount, imageBudget, parameters: rq.params, bodyOnly: true, depth: depth + 1, chain: [...(opts.chain || []), def.name, rq.report], bodyWidth: page.bodyWidth, state: {} });
            results.set(key, r);
            for (const w of r.warnings) warn(`Subreport ${rq.report}: ${w}`);
          } catch (e) { if (e.timeout) throw e; results.set(key, { error: e.message }); }
        }
        lc.subreports = { mode: 'use', results };
      }
    }
    /** One body section's page geometry. Multi-column body: the strip fills column slots left to right, then the next page. */
    const geometry = (b, bi) => {
      const pg = bi === 0 && !b.page ? page : resolvePage({ ...(def.page || {}), ...(b.page || {}) });
      const cH = pg.height - pg.margins.top - pg.margins.bottom - headerH - footerH;
      if (cH < 24) throw new ReportError(`Body section ${bi + 1}: the page header and footer leave no room for the body.`);
      const colCount = Math.max(1, Math.min(6, Number(b.columns?.count) || 1));
      const colGap = Number(b.columns?.gap ?? 18);
      const colW = (pg.bodyWidth - colGap * (colCount - 1)) / colCount;
      return { pg, cH, colCount, colGap, colW, bodyWidth: colCount > 1 ? colW : (bi === 0 && !b.page ? lc.bodyWidth : pg.bodyWidth) };
    };
    const geos = bodies.map(geometry);
    lc.bodyWidth = geos[0].bodyWidth;

    /** Lay out the body and assemble pages. A table of contents needs a second pass. */
    const assemble = (tocEntries) => {
      regions.length = 0;
      lc.toc = tocEntries;
      // rows a fixed table frame hands on to overflow placeholders (items/index.js): name → rows still to show
      const overflow = lc.overflow = { pending: new Map(), more: null, repeat: false, head: null };
      // each body section: laid out and paginated with its own page
      const parts = [];
      sections: for (let bi = 0; bi < bodies.length; bi++) {
        const g = geos[bi];
        const blc = bi === 0 && !bodies[0].page ? lc : { ...lc, bodyWidth: g.bodyWidth, maxUnitHeight: g.cH };
        // a section whose last overflow placeholder still has rows is laid out again, page after page
        for (let rep = 0; ; rep++) {
          overflow.more = null; overflow.repeat = rep > 0; overflow.head = null;
          const body = layoutItems(bodies[bi].items || [], blc);
          if (opts.bodyOnly) return { body };
          // one page that grows: page breaks have nothing to break
          if (g.pg.pageless) for (const u of body.units) { u.breakBefore = false; u.breakAfter = false; }
          const slices = paginate(body.units, body.tables, g.cH, warn);
          parts.push({ body, slices, g });
          if (lc.rowBudget?.cut) break sections;
          if (!overflow.more) break;
          if (rep + 1 >= REUSE_LIMITS.repeats) { warn(`${overflow.more}: the rows need more than ${REUSE_LIMITS.repeats} continuation pages; the rest are left out.`); overflow.pending.clear(); break; }
        }
      }
      if (!lc.rowBudget?.cut) for (const p of overflow.pending.values()) warn(`${p.table}: ${p.units.length} rows did not fit its frame and there is no overflow placeholder "${p.to}" after it.`);
      // the page list: [part, index of the page in its part]
      const list = [];
      for (const part of parts) for (let k = 0; k < Math.ceil(part.slices.length / part.g.colCount); k++) list.push({ part, k });
      if (lc.rowBudget?.cut) list.length = Math.min(list.length, firstPages);
      const total = list.length;
      // numbering sections: a page where a newSection group or list row starts opens one (the first page always does)
      const secStart = new Array(total).fill(0);
      list.forEach((e, i) => {
        if (i === 0) return;
        const p = e.part.slices[e.k * e.part.g.colCount];
        e.part.starts ||= new Set(e.part.body.units.filter(u => u.sectionStart).map(u => Math.round(u.top * 100)));
        secStart[i] = e.part.starts.has(Math.round(p.top * 100)) ? i : secStart[i - 1];
      });
      const secLen = new Map();
      for (const st of secStart) secLen.set(st, (secLen.get(st) || 0) + 1);
      const first = parts[0].g.pg;
      let pageH = first.height;
      if (first.pageless && parts.length === 1) {
        const sl = parts[0].slices;
        if (sl.length === 1) pageH = Math.max(first.minHeight, first.margins.top + headerH + sl[0].bottom - sl[0].top + footerH + first.margins.bottom);
        else warn(`This pageless report is taller than 200 inches, the largest PDF page, so it is split into ${sl.length} pages.`);
      }
      const bookmarks = [];
      const headings = []; // text boxes with headingLevel: for a table of contents only, not the PDF outline
      const pages = [];
      list.forEach(({ part, k }, n) => {
        const { body, slices, g } = part;
        const { pg, colCount, colW, colGap, cH } = g;
        const ph = parts.length === 1 ? pageH : pg.height;
        const ml = pg.margins.left, mt = pg.margins.top;
        const bodyTop = mt + headerH;
        const items = [];
        const cut = lc.rowBudget?.cut;
        const globals = { ...baseCtx.globals, PageNumber: n - secStart[n] + 1, TotalPages: cut ? '…' : secLen.get(secStart[n]), OverallPageNumber: n + 1, OverallTotalPages: cut ? '…' : total };
        const plc = makeLc(globals, true);
        const band = (section, y0, isFirst, isLast) => {
          if (!section) return;
          if (isFirst && section.printOnFirstPage === false) return;
          if (isLast && section.printOnLastPage === false) return;
          const r = layoutItems(section.items || [], plc);
          for (const u of r.units) for (const d of u.items) d.art = 1; // page header and footer: an artifact in a tagged PDF
          for (const u of r.units) placeItems(u.items, ml, y0 + u.top, items);
        };
        band(header, mt, n === 0, n === total - 1);
        const frozen = []; // table headers on this page and where each table ends: viewers keep them in view while scrolling
        for (let c = 0; c < colCount; c++) {
          const p = slices[k * colCount + c];
          if (!p) break;
          const cx = ml + c * (colW + colGap);
          for (const t of p.repeat) placeItems(t.headerItems, cx, bodyTop, items);
          for (const t of body.tables) {
            if (!(t.top < p.bottom - EPS && t.bottom > p.top + EPS)) continue;
            const cont = p.repeat.includes(t);
            let off = 0; // a table below a continued one moves down by that table's repeated header
            if (!cont) for (const r of p.repeat) if (t.x0 < r.x1 - EPS && r.x0 < t.x1 - EPS) off = Math.max(off, r.headerHeight);
            const y = cont ? bodyTop : bodyTop + off + t.top - p.top;
            frozen.push({ x: cx + t.x0, y, w: t.x1 - t.x0, h: t.headerHeight, end: bodyTop + (cont ? t.headerHeight : off) + Math.min(t.bottom, p.bottom) - p.top });
          }
          for (const u of p.units) {
            // Only items under a continued table move down by its repeated header.
            let off = 0;
            for (const t of p.repeat) if (u.x0 < t.x1 - EPS && t.x0 < u.x1 - EPS) off = Math.max(off, t.headerHeight);
            // a footer printed at the bottom of the page (it is the last thing on its page)
            if (u.atBottom) off += Math.max(0, cH - off - (p.bottom - p.top));
            // the text of a merged cell, again at the top of a page its rows continue on
            if (u.cont && u.top <= p.top + EPS) placeItems(u.cont, cx, bodyTop + off, items);
            placeItems(u.items, cx, bodyTop + off + (u.top - p.top), items);
          }
        }
        band(footer, ph - pg.margins.bottom - footerH, n === 0, n === total - 1);
        let j = 0; // bookmarks leave the page's items (compacted in place: a page holds hundreds of items)
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.t === 'bookmark') (it.heading ? headings : bookmarks).push({ label: it.label, page: n + 1, y: it.y, level: it.level || 0 });
          else items[j++] = it;
        }
        items.length = j;
        const out = frozen.length ? { items, frozen } : { items };
        // a section with another page size: the page carries its own
        if (pg.width !== first.width || ph !== pageH) { out.width = pg.width; out.height = ph; }
        pages.push(out);
      });
      // A table of contents: its entries' page numbers are the ones this pass found. Its height does not depend on
      // them (one line per entry, room for 4 digits), so they are filled in here rather than in another pass.
      const found = [...bookmarks, ...headings];
      if (tocEntries.length && !lc.rowBudget?.cut && found.length === tocEntries.length && found.every((f, i) => f.label === tocEntries[i].label)) {
        for (const pg of pages) {
          const shift = new Map();
          for (const it of pg.items) {
            if (it.tocPage == null) continue;
            const f = found[it.tocPage], ln = it.lines[0], num = String(f.page);
            const nw = m.width(num, it.font, it.size);
            shift.set(it.tocPage, ln.w - nw);
            ln.x += ln.w - nw; ln.w = nw; ln.text = num;
          }
          for (const it of pg.items) {
            if (it.tocDots != null) it.x2 += shift.get(it.tocDots) || 0;
            if (it.tocLink != null && it.action.page != null) { it.action.page = found[it.tocLink].page; it.action.y = found[it.tocLink].y; }
          }
        }
      }
      for (const pg of pages) for (const it of pg.items) if (it.tocPage != null || it.tocDots != null || it.tocLink != null) { delete it.tocPage; delete it.tocDots; delete it.tocLink; }
      return { pages, bookmarks, headings, height: pageH, width: first.width };
  };
  const tocOf = (r, pending) => [...r.bookmarks.map(b => ({ label: b.label, level: b.level, page: pending ? '…' : b.page })), ...r.headings.map(b => ({ label: b.label, level: b.level, page: pending ? '…' : b.page, y: pending ? undefined : b.y, heading: true }))];

  let result = assemble([]);
  if (opts.bodyOnly) return result;
  if (hasToc) {
    // first pages: the entries are known now, their page numbers when the full render ends ("…" until then)
    if (firstPages > 0) {
      lc.rowBudget = budget();
      return assemble(tocOf(result, true));
    }
    // The table of contents moves what follows it; its numbers are filled in by the pass that lays it out (above).
    // Another pass only when that pass found different entries.
    for (let pass = 0; pass < 3; pass++) {
      const entries = tocOf(result, false);
      result = assemble(entries);
      const found = [...result.bookmarks, ...result.headings];
      if (found.length === entries.length && found.every((f, i) => f.label === entries[i].label)) break;
    }
  }
  return result;
  };

  // Text may need fonts that are not loaded yet (a fallback for Hindi, an uploaded font) or the shaper:
  // load them and lay out again. A font that does not load falls back to Inter, so this ends.
  let result = await layoutAll();
  for (let pass = 0; m.missing.size && pass < 3; pass++) {
    await store.load([...m.missing]);
    m = new TextMeasurer(store);
    result = await layoutAll();
  }
  overTime();
  if (m.noGlyph.size) warn(`No font has these characters, so they show as boxes: ${[...m.noGlyph].slice(0, 20).join(' ')}. Upload a font that has them and use it for this text.`);
  if (opts.bodyOnly) return { units: result.body.units, tables: result.body.tables, height: result.body.height, regions, warnings };
  const { pages, bookmarks, height } = result;
  for (const pg of pages) finishText(pg.items, m);
  // Every image on every page passes the caps here, whatever drew it: background images (a style, painted
  // without the layout context, maybe from a field or an embedded name) and subreports' images included.
  // Images already counted are in imageBudget.seen, so they are not counted twice.
  // A form field's background is in its `draw` items, which the SVG, HTML and viewer draw: check those too.
  const keepItem = (it) => {
    if (it.t === 'field') { it.draw = it.draw.filter(keepItem); return true; }
    if (it.t !== 'image') return true;
    it.src = resolveImageSrc(it.src, 'Background image', { images: def.images || {}, budget: imageBudget, warn });
    return !!it.src;
  };
  for (const pg of pages) { // in place: the page arrays are this render's own
    let j = 0;
    for (const it of pg.items) if (keepItem(it)) pg.items[j++] = it;
    pg.items.length = j;
  }

  return {
    width: result.width ?? page.width, height, pages, warnings, bookmarks, regions, name: def.name || '', partial: cutRows(),
    stats: { ms: Date.now() - t0, pages: pages.length, rows: Object.fromEntries(Object.entries(dataSets).map(([k, r]) => [k, r.length])) },
  };
}

function hasType(items, type) {
  return (items || []).some(i => i.type === type || hasType(i.items, type));
}

/** Hyperlink, drill-through or bookmark jump for an item or a cell. */
function linkFor(it, ctx, rect, warn, state) {
  let tip;
  if (it?.tooltip) { try { const t = evalValue(it.tooltip, ctx); if (t != null && t !== '') tip = String(t); } catch (e) { warn(`${it.name || 'Tooltip'}: ${e.message}`); } }
  const l = linkAction(it, ctx, rect, warn, state);
  if (l) return tip ? { ...l, tip } : l;
  return tip ? { t: 'link', ...rect, action: null, tip } : null; // a tooltip without an action
}

function linkAction(it, ctx, rect, warn, state) {
  const a = it?.action;
  if (!a || !a.type || a.type === 'none') return null;
  try {
    if (a.type === 'toggleItem') {
      // show or hide another item (by name): the viewer flips state.toggles['item:<name>'] and renders again
      const key = `item:${String(a.target || '')}`;
      return a.target ? { t: 'link', ...rect, action: { type: 'toggle', key, open: !!state?.toggles?.[key] } } : null;
    }
    if (a.type === 'params') {
      // Set report parameters and run the report again (cross-filtering). toggle: a second click on the same value clears it.
      const params = {};
      for (const [k, v] of Object.entries(a.params || {})) { const x = evalValue(v, ctx); params[k] = x instanceof Date ? isoDate(x) : x == null ? '' : x; }
      return { t: 'link', ...rect, action: { type: 'params', params, toggle: a.toggle !== false } };
    }
    if (a.type === 'url') {
      const href = safeUrl(String(evalValue(a.url ?? '', ctx) ?? ''));
      if (!href) return null;
      return { t: 'link', ...rect, action: { type: 'url', href } };
    }
    if (a.type === 'report') {
      const params = {};
      for (const [k, v] of Object.entries(a.params || {})) { const x = evalValue(v, ctx); params[k] = x instanceof Date ? isoDate(x) : x; }
      return { t: 'link', ...rect, action: { type: 'drill', report: String(evalValue(a.report, ctx)), params } };
    }
    if (a.type === 'bookmark') return { t: 'link', ...rect, action: { type: 'bookmark', target: String(evalValue(a.target, ctx)) } };
  } catch (e) { warn(`${it.name || 'Link'}: ${e.message}`); }
  return null;
}

/**
 * Options for parameters that list values from a data set (cascading parameters:
 * the data set may filter on other parameters).
 * @returns {Promise<Record<string, {value: any, label: string}[]>>}
 */
export async function parameterOptions(def, given = {}, opts = {}) {
  const out = {};
  const dyn = (def.parameters || []).filter(p => p.optionsFrom?.dataSet);
  for (const p of def.parameters || []) if (Array.isArray(p.options)) out[p.name] = p.options.map(o => (typeof o === 'object' ? { value: o.value, label: String(o.label ?? o.value) } : { value: o, label: String(o) }));
  if (!dyn.length) return out;
  const params = resolveParameters(def, given, { lenient: true });
  const need = new Set(dyn.map(p => p.optionsFrom.dataSet));
  // nested data sets need their parents (declared above them, so one backwards pass finds them all)
  for (const d of [...(def.dataSets || [])].reverse()) if (need.has(d.name) && d.relation?.parent) need.add(d.relation.parent);
  const sets = (def.dataSets || []).filter(d => need.has(d.name));
  const srcNames = new Set(sets.map(d => d.source));
  const sub = { ...def, dataSources: (def.dataSources || []).filter(s => srcNames.has(s.name)), dataSets: sets };
  const sources = opts.sources || await loadSources(sub, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId });
  const ctx = { params, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null, functions: functionTable(def) };
  const built = buildDataSets(sub, sources, ctx);
  for (const p of dyn) {
    const rows = built[p.optionsFrom.dataSet] || [];
    const seen = new Set(), list = [];
    const c = { ...ctx, dataSets: built };
    for (const r of rows) {
      c.fields = r;
      const v = evalValue(p.optionsFrom.value || '', c);
      const k = v instanceof Date ? v.getTime() : v;
      if (v == null || seen.has(k)) continue;
      seen.add(k);
      list.push({ value: v instanceof Date ? isoDate(v) : v, label: String(p.optionsFrom.label ? evalValue(p.optionsFrom.label, c) : v) });
    }
    out[p.name] = list;
  }
  return out;
}

/** Defaults, types and required checks for report parameters. */
export function resolveParameters(def, given, { lenient = false } = {}) {
  const out = {}, missing = [];
  const ctx = { params: {}, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null, functions: functionTable(def) };
  for (const p of def.parameters || []) {
    let val = given[p.name];
    // nullable: an explicit null is a value, so the default does not replace it
    const chosenNull = val === null && p.nullable && !p.multi && Object.hasOwn(given, p.name);
    if (!chosenNull && (val == null || val === '') && p.default != null && p.default !== '') {
      try { val = evalValue(p.default, ctx); } catch { val = null; }
    }
    if (p.multi) {
      let list = Array.isArray(val) ? val : val == null || val === '' ? [] : String(val).split(',').map(x => x.trim()).filter(Boolean);
      val = list.map(x => coerce(x, p.type || 'string'));
      if (p.required && !val.length) missing.push(p.name);
    } else {
      // a blank is a value only for allowBlank (text); a nullable parameter reads it as null
      if (val === '' && (p.type !== 'string' || (p.nullable && !p.allowBlank))) val = null;
      else val = coerce(val, p.type || 'string');
      if (p.required && ((val == null && !p.nullable) || (val === '' && !p.allowBlank))) missing.push(p.name);
    }
    out[p.name] = val;
    ctx.params[p.name] = val;
  }
  if (missing.length && !lenient) throw new ReportError(`Enter a value for: ${missing.join(', ')}`, { missingParameters: missing });
  return out;
}

export { FontStore, TextMeasurer, ITEMS, finishText };
