// @ts-check
/**
 * ReportWright engine.
 * render(definition, options) → page model.
 * No React, no DOM. Runs in a Web Worker and in Node.
 */
import { resolvePage } from './units.js';
import { FontStore, CORE_FONT_KEY, PRELOAD_KEYS, fontsFor, fontsForDef, familyOf, fontCss, embeddedFace, SHAPER, OPTIONAL_KEYS } from './text/fonts.js';
import { safeUrl } from './url.js';
import { TextMeasurer, finishText } from './text/measure.js';
import { loadSources, buildDataSets, coerce } from './data/index.js';
import { evalValue, evaluate, functionTable } from './expr/evaluate.js';
import { isoDate, validTimeZone } from './expr/format.js';
import { BASE_STYLE } from './style.js';
import { resolveImageSrc } from './image.js';
import { ITEMS } from './items/index.js';
import { loadBarcodes } from './items/barcode.js';
import { placeItems, shiftItems } from './items/paint.js';
import { paginate } from './paginate/index.js';
import { layoutItems } from './layout.js';
import { validate } from './schema/validate.js';
import { makeLoader, resolveReuse, resolveTheme, flattenNamed, REUSE_LIMITS, isSubreportId } from './reuse.js';
import { layerFilter } from './layout.js';

/** The data fetch options of a render: the SSRF guard's (data/guard.js) and the time and size limits. */
const fetchOpts = (o, deadline = o.deadline) => ({ unsafeFetch: !!o.unsafeFetch, allowHosts: o.allowHosts, fetchTimeoutMs: o.fetchTimeoutMs, maxFetchBytes: o.maxFetchBytes, deadline });

export class ReportError extends Error {
  /** @param {string} msg @param {object} [extra] */
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); this.name = 'ReportError'; }
}

const EPS = 0.01;
const MAX_SUBREPORTS = 2000; // per render, all nesting levels together
export const BAND_ITEMS = 250000; // page header and footer items drawn per render, all pages and body sections together

/**
 * Options for render(). All optional.
 * @typedef {object} RenderOptions
 * @property {{ layoutPasses?: number }} [stats] filled in: how many times the report was laid out (tests, the bench)
 * @property {Record<string, any>} [parameters] values of the report's parameters, by name (invariant form: 1234.5, 2026-03-05)
 * @property {import('./text/fonts.js').FontStore} [fontStore] the fonts; share one across renders (a new one loads them again)
 * @property {boolean} [lazyFonts] the viewer: load only the core face up front; the other bundled faces when the layout first needs one
 * @property {(key: string) => Promise<ArrayBuffer|Uint8Array>} [loadFont] loads a font the store does not have
 * @property {typeof fetch} [fetch] fetch for data sources (default: the SSRF-guarded fetch, see unsafeFetch)
 * @property {string} [baseUrl] the origin relative data URLs resolve against
 * @property {Record<string, any>} [sources] data sources already loaded, by name (skips loading them)
 * @property {Date} [now] the render's clock: ExecutionTime and =Today() defaults (default: the current time)
 * @property {string} [reportId] the saved report being rendered; the server runs its SQL sources for a browser render
 * @property {(src: any, params: Record<string, any>) => Promise<object[]>} [sql] runs SQL sources directly (server renders)
 * @property {(id: string) => Promise<any>} [loadReport] loads a saved report by id: subreports, masters, part libraries, stylesheets, themes
 * @property {number} [timeoutMs] stop with a ReportError (status 504) when the render runs longer; subreports share it
 * @property {number} [deadline] the same limit as an absolute time (ms since the epoch)
 * @property {(sources: Record<string, any>) => void} [onSources] receives the loaded sources (the worker's first pages hand them to the full render)
 * @property {boolean} [exportData] keep the table data (model.regions) and cell tags that Excel, CSV, Word, interactive HTML and accessible PDF rebuild tables from
 * @property {boolean} [dataOnly] the table data only (model.regions; pages is empty): no layout, for the data CSV
 * @property {boolean} [unsafeFetch] turn off the SSRF guard (data/guard.js): public http(s) hosts only by default
 * @property {string[]} [allowHosts] private hosts the guard may reach
 * @property {number} [fetchTimeoutMs] time limit per data fetch (default 30 s)
 * @property {number} [maxFetchBytes] size limit per data fetch, decoded (default 64 MB)
 * @property {number} [firstPages] lay out only enough rows for this many pages: a fast first look, not the final render
 * @property {'screen'|'print'|'export'} [target] which layers draw (default export)
 * @property {Record<string, any>} [state] the viewer's interactive state: sorts, toggles, selections
 * @property {string} [timeZone] the zone dates show in, when the report sets none
 * @property {number|false} [largeReportRows] the engine package's render() warns once (model.warnings, and the console once
 *   per process) when a data set has more rows than this, pointing at exportPdfStream (default 100000; 0 or false: no warning)
 * @property {any} [bodyWidth] internal (subreports): the width the child body is laid out to
 * @property {number} [depth] internal (subreports): nesting level, at most 3
 * @property {{ used: number }} [budget] internal (subreports): subreports rendered so far, all levels together
 * @property {string[]} [chain] internal (subreports): the reports this render sits inside, so one that reaches itself is skipped
 * @property {boolean} [bodyOnly] internal (subreports): the body alone, no pages
 * @property {Map<string, any>} [reportCache] internal: reports loaded for this render and its subreports
 * @property {{ items: number }} [reuseBudget] internal: items drawn through report parts so far
 * @property {{ n: number }} [fnCount] internal: report function calls so far
 * @property {any} [imageBudget] internal: the images drawn so far, shared with subreports
 * @property {{ offset: number, total?: number|null, final: boolean, first?: any, rowOffset?: number, cont?: ({ first: any }|null)[] }} [pageWindow]
 *   internal (paged.js): these pages are a window of a longer report: numbered from offset + 1 of total ('…' when not known
 *   yet); final: the window holds the report's last page; first: the report's first row; rowOffset: the rows before this
 *   window; cont: per group level, the group the window's first row continues (its first row), or null
 */
/**
 * The text a render may draw: the definition's own and the string values of the data rows (and one level of nested
 * objects). ponytail: the first 50,000 rows of each data set; text further down in a script not seen before still
 * gets its font, by the layout's second pass.
 * @param {any} def @param {Record<string, any[]>} dataSets
 */
function* textsOf(def, dataSets) {
  yield JSON.stringify(def);
  for (const rows of Object.values(dataSets)) {
    const n = Math.min(rows.length, 50000);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      if (!r || typeof r !== 'object') { yield r; continue; }
      for (const k in r) { const v = r[k]; if (typeof v === 'string') yield v; else if (v && typeof v === 'object') for (const x of Object.values(v)) yield x; }
    }
  }
}

/** The start of the warning for CJK text without the optional CJK fonts (the viewer opens its warnings for it). */
import { NO_CJK_FONTS } from './notices.js';
export { NO_CJK_FONTS };

/**
 * Render a report definition to a page model (pages, regions), the input of every exporter. Throws ReportError for a
 * definition that cannot render at all; everything else is a warning in the model.
 * @param {any} def0 the report definition (pagewright/report@1), or a saved report's JSON
 * @param {RenderOptions} [opts]
 * @returns {Promise<any>} the page model
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
  const checkOnly = new Set(v.checkOnly); // the render says these itself where it meets them
  /** @type {string[]} */
  const warnings = [...new Set([...v.warnings, ...[...cellErrors].filter(e => !checkOnly.has(e)).slice(0, 100), ...reuseWarnings])].slice(0, 200); // once each (validate and the render can say the same); warn() keeps it at 200
  // clip: the warning says content is cut off (past the page edge, under the page bottom): the viewer shows those
  const clips = new Set();
  /** @type {(msg: string, clip?: boolean) => void} */
  const warn = (msg, clip) => { if (warnings.length < 200 && !warnings.includes(msg)) warnings.push(msg); if (clip) clips.add(msg); };
  const clipped = () => warnings.filter(w => clips.has(w)); // only the warnings of the last layout pass

  const page = resolvePage(def.page);
  if (['pageHeader', 'body', 'pageFooter'].some(k => hasType(k === 'body' && Array.isArray(def.sections?.body) ? def.sections.body.flatMap(b => [...(b?.items || []), ...(b?.pageHeader?.items || []), ...(b?.pageFooter?.items || [])]) : def.sections?.[k]?.items, 'barcode'))) await loadBarcodes();
  let timeZone = def.timeZone || opts.timeZone;
  if (timeZone && !validTimeZone(timeZone)) { warn(`The time zone "${String(timeZone).slice(0, 60)}" is not known, so dates show in the server's zone.`); timeZone = undefined; }
  const params = resolveParameters(def, opts.parameters || {}, { now: opts.now, timeZone, locale: def.locale });

  /** font names the report asks for that are not available (N39): never swapped without a warning @type {Set<string>} */
  const unknownFonts = new Set();
  const store = opts.fontStore || new FontStore(/** @type {any} */ (opts.loadFont));
  // the bundled Latin faces and the faces the definition names load now, in parallel and each on its own (a face that fails
  // falls back, with a warning). A CJK or emoji face loads in a later pass, only when text needs it (the optional fonts).
  await store.load([...new Set([CORE_FONT_KEY, ...(opts.lazyFonts ? [] : PRELOAD_KEYS), ...fontsForDef(def, unknownFonts)])]); // lazyFonts (the viewer): the other bundled faces load when the layout first needs one
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
  const baseCtx = baseContext(def, { params, now, timeZone, fnCount, clock });
  // Theme.* in expressions: a theme report (maybe picked by a parameter), the report's own theme, or the default
  baseCtx.theme = await resolveTheme(def, baseCtx, getReport, warn);
  // where this render goes: layers can be for the screen, print or export only (the viewer says which; else export)
  const target = opts.target || opts.state?.target || 'export';
  const layerOff = layerFilter(def.layers, target);
  const named = flattenNamed(def.styles?.named, warn);
  const sources = opts.sources || await loadSources(def, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId, ...fetchOpts(opts, deadline) });
  opts.onSources?.(sources); // the worker's first-pages render hands its data to the full render that follows
  const dataSets = buildDataSets(def, sources, { ...baseCtx, warn });
  baseCtx.dataSets = dataSets;
  overTime();
  const defaultDs = def.dataSets?.[0]?.name;
  // the fonts the report's text and data need (a fallback face per script, the shaper), before the layout: one found
  // missing during the layout lays everything out again (below), a whole extra pass for data in Hindi or Arabic
  await store.load(fontsFor(textsOf(def, dataSets)));
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
  const tablesSeen = { n: 0 }; // tables laid out, counted without their data (model.hasTables)
  // 50 MB of images per render, each distinct image once: subreports share their parent's, and every layout pass
  // the same one (an image is counted once, so a second pass adds nothing)
  const imageBudget = opts.imageBudget || { seen: new Set(), bytes: 0 };
  const makeLc = (globals, fixed) => {
    const lc = {
      m, base, dataSets, warn, fixed, maxUnitHeight: contentH, state: opts.state || {}, tablesSeen, regions: opts.exportData || opts.dataOnly ? regions : null, dataOnly: !!opts.dataOnly, // exportData: true: table data and cell tags (Excel, CSV, Word, HTML, accessible PDF)
      named, parts, layerOff,
      nextId: () => ++idSeq,
      // the time limit, read every 256 rows of tables and lists (expr/evaluate.js counts evaluations the same way)
      tick: clock ? () => { if (clock.over || ((++clock.n & 255) === 0 && Date.now() > clock.until)) { clock.over = true; overTime(); } } : null,
      layoutItems: (items, l, o) => layoutItems(items, l, o),
      linkFor: (it, ctx, rect) => linkFor(it, ctx, rect, warn, opts.state),
      ctxFor: (item) => {
        const ds = item.dataSet || defaultDs;
        const rows = (ds && dataSets[ds]) || [];
        // a window of a longer report (paged.js): Fields outside the rows read the report's first row, not the window's
        return { ...baseCtx, globals, fields: (opts.pageWindow?.first && ds === defaultDs ? opts.pageWindow.first : rows[0]) || null, aggRows: rows };
      },
      subreports: null,
      bodyWidth: opts.bodyWidth ?? page.bodyWidth,
      images: def.images || {}, imageBudget,
      cellItems: { left: 100000 }, // rows of items inside table cells, for the whole render (items/index.js)
      win: opts.pageWindow || null, // paged.js: units carry their row number (dataRow, rowHead), rows and groups continue
    };
    return lc;
  };

  /* ---------------- body: layout + push-down ---------------- */
  const firstPages = Number(opts.firstPages) || 0;
  let cutRows = () => false;
  let layoutPasses = 0; // for opts.stats (tests and the bench): how many times the report was laid out
  const layoutAll = async () => {
    layoutPasses++;
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
            const id = subreportId(rq.report, baseCtx);
            if ((opts.chain || []).includes(id)) throw new Error('it includes itself');
            if (!defs.has(id)) defs.set(id, await opts.loadReport(id));
            const child = defs.get(id);
            const r = await render(child, { ...opts, dataOnly: false, target, onSources: undefined, deadline: deadline ?? undefined, reportId: id, budget, fnCount, imageBudget, parameters: rq.params, bodyOnly: true, depth: depth + 1, chain: [...(opts.chain || []), def.name, id], bodyWidth: page.bodyWidth, state: {} });
            results.set(key, r);
            for (const w of r.warnings) warn(`Subreport ${rq.report}: ${w}`, r.clipped?.includes(w));
          } catch (e) { if (e.timeout) throw e; results.set(key, { error: e.message }); }
        }
        lc.subreports = { mode: 'use', results };
      }
    }
    /** One body section's page geometry. Multi-column body: the strip fills column slots left to right, then the next page. */
    const geometry = (b, bi) => {
      const pg = bi === 0 && !b.page ? page : resolvePage({ ...(def.page || {}), ...(b.page || {}) });
      // a body section may have its own page header and footer (hidden: none), like an SSRS/ActiveReports report section
      const hdr = sectionBand(b.pageHeader, header), ftr = sectionBand(b.pageFooter, footer);
      const hH = hdr?.height || 0, fH = ftr?.height || 0;
      const cH = pg.height - pg.margins.top - pg.margins.bottom - hH - fH;
      if (cH < 24) throw new ReportError(`Body section ${bi + 1}: the page header and footer leave no room for the body.`);
      const colCount = Math.max(1, Math.min(6, Number(b.columns?.count) || 1));
      const colGap = Number(b.columns?.gap ?? 18);
      const colW = (pg.bodyWidth - colGap * (colCount - 1)) / colCount;
      return { pg, cH, colCount, colGap, colW, hdr, ftr, hH, fH, own: { h: hdr !== header, f: ftr !== footer }, bodyWidth: colCount > 1 ? colW : (bi === 0 && !b.page ? lc.bodyWidth : pg.bodyWidth) };
    };
    const geos = bodies.map(geometry);
    lc.bodyWidth = geos[0].bodyWidth;
    // N9: an item past the body's right edge is cut off by the page (a table continues on pages of its own instead)
    const edge = (items, dx, W, depth) => {
      if (!Array.isArray(items) || depth > 32) return;
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const right = dx + (Number(it.x) || 0) + (Number(it.w) || 0);
        if (it.type !== 'table' && it.type !== 'matrix' && right > W + 1) warn(`${it.name || it.type}: it reaches ${Math.round(right)}pt, past the ${Math.round(W)}pt the page has for the body, so the part past the edge is not printed`, true);
        else edge(it.items, dx + (Number(it.x) || 0), W, depth + 1);
      }
    };
    if (!page.pageless) bodies.forEach((b, i) => edge(b.items, 0, geos[i].bodyWidth, 0));

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
        const blc = bi === 0 && !bodies[0].page && g.cH === contentH ? lc : { ...lc, bodyWidth: g.bodyWidth, maxUnitHeight: g.cH };
        // a section whose last overflow placeholder still has rows is laid out again, page after page
        for (let rep = 0; ; rep++) {
          overflow.more = null; overflow.repeat = rep > 0; overflow.head = null;
          const body = layoutItems(bodies[bi].items || [], blc);
          if (opts.bodyOnly) return { body };
          if (opts.dataOnly) continue sections; // the table data (regions) only: no pages
          // one page that grows: page breaks have nothing to break
          if (g.pg.pageless) for (const u of body.units) { u.breakBefore = false; u.breakAfter = false; }
          const slices = paginate(body.units, body.tables, g.cH, warn);
          parts.push({ body, slices, g });
          if (lc.rowBudget?.cut) break sections;
          if (!overflow.more) break;
          if (rep + 1 >= REUSE_LIMITS.repeats) { warn(`${overflow.more}: the rows need more than ${REUSE_LIMITS.repeats} continuation pages; the rest are left out.`); overflow.pending.clear(); break; }
        }
      }
      if (opts.dataOnly) return null;
      if (!lc.rowBudget?.cut) for (const p of overflow.pending.values()) warn(`${p.table}: ${p.units.length} rows did not fit its frame and there is no overflow placeholder "${p.to}" after it.`);
      // the page list: [part, index of the page in its part]
      const list = [];
      for (const part of parts) { const nk = Math.ceil(part.slices.length / part.g.colCount); for (let k = 0; k < nk; k++) list.push({ part, k, last: k === nk - 1 }); }
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
        if (sl.length === 1) pageH = Math.max(first.minHeight, first.margins.top + parts[0].g.hH + sl[0].bottom - sl[0].top + parts[0].g.fH + first.margins.bottom);
        else warn(`This pageless report is taller than 200 inches, the largest PDF page, so it is split into ${sl.length} pages.`);
      }
      const bandCache = new Map(); // band → { paged, units }: per pass (the measurer changes between passes)
      const bandWork = { left: BAND_ITEMS };
      const bookmarks = [];
      const headings = []; // text boxes with headingLevel: for a table of contents only, not the PDF outline
      const pages = [];
      list.forEach(({ part, k, last }, n) => {
        const { body, slices, g } = part;
        const { pg, colCount, colW, colGap, cH } = g;
        const ph = parts.length === 1 ? pageH : pg.height;
        const ml = pg.margins.left, mt = pg.margins.top;
        const bodyTop = mt + g.hH;
        const items = [];
        const cut = lc.rowBudget?.cut;
        // pageWindow (paged.js): these pages are a window of a longer report, from page offset + 1, of total pages
        const win = opts.pageWindow, off = win ? win.offset : 0, all = win ? win.total ?? '…' : null;
        const globals = { ...baseCtx.globals, PageNumber: n - secStart[n] + 1 + (secStart[n] ? 0 : off), TotalPages: cut ? '…' : all ?? secLen.get(secStart[n]), OverallPageNumber: n + 1 + off, OverallTotalPages: cut ? '…' : all ?? total };
        const isFirst = n + off === 0, isLast = n === total - 1 && (!win || win.final);
        const plc = makeLc(globals, true);
        const band = (section, y0, isFirst, isLast) => {
          if (!section) return;
          if (isFirst && section.printOnFirstPage === false) return;
          if (isLast && section.printOnLastPage === false) return;
          const capped = () => warn(`The page headers and footers would draw more than ${BAND_ITEMS.toLocaleString('en-US')} items in this report; they are left out of the later pages. Make them lighter, or the report shorter.`);
          if (bandWork.left <= 0) { capped(); return; }
          plc.tick?.(); // the time limit, per band per page
          // a band that does not read Globals (page numbers) is laid out once and copied onto each page
          let c = bandCache.get(section);
          if (!c) bandCache.set(section, c = { paged: pagedBand(section, def.functions), units: null });
          const r = c.units ? { units: c.units } : layoutItems(section.items || [], plc);
          if (!c.units) for (const u of r.units) for (const d of u.items) d.art = 1; // page header and footer: an artifact in a tagged PDF
          if (!c.paged) c.units = r.units;
          let n = 0;
          for (const u of r.units) n += u.items.length;
          // one budget for the page header and footer items of the whole render: many pages × heavy bands are capped
          if ((bandWork.left -= n) < 0) { capped(); return; }
          for (const u of r.units) if (c.paged) placeItems(u.items, ml, y0 + u.top, items); else for (const it of shiftItems(u.items, ml, y0 + u.top)) items.push(it);
        };
        // a section's own band: first and last are the section's pages; the shared one: the report's
        band(g.hdr, mt, g.own.h ? k === 0 : isFirst, g.own.h ? last : isLast);
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
        band(g.ftr, ph - pg.margins.bottom - g.fH, g.own.f ? k === 0 : isFirst, g.own.f ? last : isLast);
        let j = 0; // bookmarks leave the page's items (compacted in place: a page holds hundreds of items)
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.t === 'bookmark') (it.heading ? headings : bookmarks).push({ label: it.label, page: n + 1 + off, y: it.y, level: it.level || 0, ...(secStart[n] ? { shown: n - secStart[n] + 1 } : {}) });
          else items[j++] = it;
        }
        items.length = j;
        const out = frozen.length ? { items, frozen } : { items };
        if (win) { // where this page starts: a row's first piece, or a group's header (headLevel), else not at a row
          const u = slices[k * colCount]?.units[0];
          if (u?.dataRow != null) { out.firstRow = u.dataRow; out.rowHead = !!u.rowHead; if (u.headLevel != null) out.headLevel = u.headLevel; }
        }
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
            // the number printed on that page: a section that restarts its numbering (newSection) restarts the TOC's too
            const f = found[it.tocPage], ln = it.lines[0], num = String(f.shown ?? f.page);
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
      return { pages, bookmarks, headings, pageStarts: [...new Set(secStart)].filter(i => i > 0), height: pageH, width: first.width };
  };
  const tocOf = (r, pending) => [...r.bookmarks.map(b => ({ label: b.label, level: b.level, page: pending ? '…' : b.page })), ...r.headings.map(b => ({ label: b.label, level: b.level, page: pending ? '…' : b.page, y: pending ? undefined : b.y, heading: true }))];

  let result = assemble([]);
  if (opts.bodyOnly || opts.dataOnly) return result;
  if (hasToc) {
    // first pages: the entries are known now, their page numbers when the full render ends ("…" until then)
    // a report that fits in those pages gets the full passes below: its first look is the final one (the worker
    // sends a render that cut nothing as the result), so it must carry the page numbers and the entries' pages
    if (firstPages > 0) {
      lc.rowBudget = budget();
      const part = assemble(tocOf(result, true));
      if (lc.rowBudget.cut) return part;
      lc.rowBudget = null;
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
  if (opts.stats) opts.stats.layoutPasses = layoutPasses;
  // the optional CJK and emoji faces are not installed by default: their missing glyphs have their own warning (NO_CJK_FONTS)
  for (const k of store.failed) if (k !== SHAPER && !OPTIONAL_KEYS.includes(k)) warn(`The font "${k}" did not load, so its text is drawn in a bundled face instead.`);
  for (const f of [...unknownFonts, ...m.unknownFonts]) warn(`Font "${f}" is not available; using ${familyOf(f).family}.`);
  /** @type {Map<string, { sub: string, chars: Set<string> }>} */
  const lacking = new Map(); // a standard font's family → the characters its encoding lacks (WinAnsi has no Ł or →)
  for (const [k, chars] of m.substituted) {
    const f = fontCss(k).family, l = lacking.get(f) || { sub: fontCss(embeddedFace(k)).family, chars: new Set() };
    for (const c of chars) l.chars.add(c);
    lacking.set(f, l);
  }
  for (const [f, l] of lacking) warn(`Font "${f}" can't show "${[...l.chars].slice(0, 20).join('')}"; used ${l.sub} for them.`);
  if (m.unshaped) warn('The text shaper (harfbuzz.wasm) did not load, so Arabic, Hebrew, Indic and Thai text is not shaped (letters unjoined, marks misplaced). A font loader must map each key with fontFile(key).');
  if (m.noGlyph.size) {
    // Chinese, Japanese, Korean and emoji fonts are optional (about 40 MB): say how to add them
    const cjk = [...m.noGlyph].some(c => /[\u1100-\u11ff\u2600-\u27bf\u2b00-\u2bff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]|[\u{1f000}-\u{1faff}]/u.test(c));
    const list = [...m.noGlyph].slice(0, 20).join(' ');
    warn(cjk ? `${NO_CJK_FONTS}. Until then these characters show as boxes: ${list}.`
      : `No font has these characters, so they show as boxes: ${list}. Upload a font that has them and use it for this text.`);
  }
  if (opts.bodyOnly) return { units: result.body.units, tables: result.body.tables, height: result.body.height, regions, warnings, clipped: clipped() };
  // dataOnly: the tables' data (the data CSV) without text layout or pages
  if (opts.dataOnly) return { pages: [], regions, warnings, name: def.name || '', timeZone: timeZone || null, locale: def.locale || null, currency: def.currency || null, dataOnly: true,
    stats: { ms: Date.now() - t0, pages: 0, rows: Object.fromEntries(Object.entries(dataSets).map(([k, r]) => [k, r.length])) } };
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
    width: result.width ?? page.width, height, pages, warnings, clipped: clipped(), bookmarks, headings: result.headings || [], pageStarts: result.pageStarts || [], regions: opts.exportData ? regions : null, hasTables: tablesSeen.n > 0, name: def.name || '', partial: cutRows(),
    timeZone: timeZone || null, // the zone dates were shown in (exports write their dates on that clock)
    locale: def.locale || null, // exports format numbers the report's way (Excel: Indian lakh grouping)
    currency: def.currency || null, // Excel's currency symbol (else the locale's, as the page)
    stats: { ms: Date.now() - t0, pages: pages.length, rows: Object.fromEntries(Object.entries(dataSets).map(([k, r]) => [k, r.length])) },
  };
}

/**
 * The evaluation context every expression of a render starts from (render, and the streaming exports in stream.js).
 * @param {any} def @param {{ params: any, now: Date, timeZone?: string, fnCount: { n: number }, clock: any }} o
 */
/** A subreport's report id: an expression is evaluated first, then the id must pass the server's id rule. Only then
 *  does loadReport see it, so "../" or a parameter's value cannot name a file or a report outside the saved ones. */
function subreportId(raw, ctx) {
  const id = typeof raw === 'string' && raw.startsWith('=') ? evalValue(raw, ctx) : raw;
  if (!isSubreportId(id)) throw new Error(`"${String(id).slice(0, 80)}" is not a report id`);
  return id;
}

export function baseContext(def, { params, now, timeZone, fnCount, clock }) {
  return {
    params, globals: { ExecutionTime: now, ReportName: def.name || '', PageNumber: 1, TotalPages: 1 },
    dataSets: {}, fields: null, locale: def.locale, currency: def.currency, nonFinite: def.nonFinite, grouping: def.grouping, // neither set: en-US numbers, no currency symbol (expr/format.js)
    nullPropagation: def.nullPropagation === true, // Nothing: VB semantics unless the report asks for SQL nulls (expr/evaluate.js)
    // + - * and Sum on decimal values (SSRS Decimal: 0.1 + 0.2 = 0.3) unless the report asks for IEEE doubles, as Java and JavaScript compute (imported JasperReports and BIRT reports)
    doubles: def.arithmetic === 'double',
    bandRows: def.bandRows, // "first-last": table headers read the first data row, footers the last (imported BIRT reports; items/index.js)
    // dates on the wall clock of the report's time zone, else the render's (the server passes the viewer's), else the host's
    timeZone: timeZone || undefined, caseSensitive: def.caseSensitive === true, // text order and grouping (expr/evaluate.js sortCompare)
    nullOrder: def.nullOrder, // "low": nulls sort as the smallest value (imported JasperReports and BIRT reports)
    collation: def.collation, // "ordinal" (BIRT) or "java" (JasperReports): text order as the source engine compares
    naturalSort: def.naturalSort === true, // "9" before "10" in text (default: text order, as SSRS)
    functions: functionTable(def, fnCount), clock,
    aggCache: new WeakMap(), // aggregate results for this render (expr/evaluate.js)
    fmtMemo: new Map(), // formatted dates for this render (expr/format.js)
  };
}

/** A body section's page header or footer: its own band (an object; hidden or no height: none), else the shared one. */
function sectionBand(own, shared) {
  if (!own || typeof own !== 'object' || Array.isArray(own)) return shared;
  return own.hidden || !(Number(own.height) > 0) ? null : own;
}

/** True when a band reads Globals (page numbers…) directly or through a report function: it is laid out on every page. */
function pagedBand(section, functions) {
  return /globals/i.test(JSON.stringify(section.items || [])) || (functions != null && /globals/i.test(JSON.stringify(functions)));
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
      for (const [k, v] of Object.entries(a.params || {})) { const x = evalValue(v, ctx); params[k] = x instanceof Date ? isoDate(x, ctx.timeZone) : x == null ? '' : x; }
      return { t: 'link', ...rect, action: { type: 'params', params, toggle: a.toggle !== false } };
    }
    if (a.type === 'url') {
      const href = safeUrl(String(evalValue(a.url ?? '', ctx) ?? ''));
      if (!href) return null;
      return { t: 'link', ...rect, action: { type: 'url', href } };
    }
    if (a.type === 'report') {
      const params = {};
      for (const [k, v] of Object.entries(a.params || {})) { const x = evalValue(v, ctx); params[k] = x instanceof Date ? isoDate(x, ctx.timeZone) : x; }
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
  const sources = opts.sources || await loadSources(sub, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId, ...fetchOpts(opts) });
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
    // the fixed options ("All", say) stay first, then the fetched ones, each value once
    const fixed = out[p.name] || [], have = new Set(fixed.map(o => o.value));
    out[p.name] = [...fixed, ...list.filter(o => !have.has(o.value))];
  }
  return out;
}

/**
 * A multi-value parameter given as one text ("North,South" in a URL): split at commas, but a comma inside one of the
 * parameter's own values stays ("Smith, John" when that is an option), and "\\," is a comma in a value.
 * @param {string} s @param {any[]} [options]
 */
function splitMulti(s, options) {
  const known = new Set((Array.isArray(options) ? options : []).map(o => String(typeof o === 'object' && o ? o.value : o)));
  if (known.has(s.trim())) return [s.trim()];
  const parts = s.split(/(?<!\\),/).map(x => x.replace(/\\,/g, ','));
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    // the longest run of parts that is an option, else the part alone
    let j = parts.length;
    for (; j > i + 1; j--) if (known.has(parts.slice(i, j).join(',').trim())) break;
    out.push(parts.slice(i, j).join(',').trim());
    i = j - 1;
  }
  return out.filter(Boolean);
}

/**
 * Defaults, types and required checks for report parameters.
 * @param {any} def @param {Record<string, any>} given the values the caller passed, by name
 * @param {{ lenient?: boolean, now?: Date, timeZone?: string, locale?: string }} [o] lenient: a missing required value is not an error (the option lists); now, timeZone, locale: for defaults such as =Today()
 * @returns {Record<string, any>}
 */
export function resolveParameters(def, given, o = {}) {
  const { lenient = false, now, timeZone, locale } = o;
  const out = {}, missing = [];
  // defaults such as =Today() read the render's clock (opts.now) and zone
  const ctx = { params: {}, globals: { ExecutionTime: now || new Date() }, dataSets: {}, fields: null, functions: functionTable(def), timeZone, locale };
  const copt = { timeZone }; // parameter values arrive in the invariant form (1234.5, 2026-03-05), whatever the locale
  for (const p of def.parameters || []) {
    let val = given[p.name];
    // nullable: an explicit null is a value, so the default does not replace it
    const chosenNull = val === null && p.nullable && !p.multi && Object.hasOwn(given, p.name);
    if (!chosenNull && (val == null || val === '') && p.default != null && p.default !== '') {
      try { val = evalValue(p.default, ctx); } catch { val = null; }
    }
    if (p.multi) {
      let list = Array.isArray(val) ? val : val == null || val === '' ? [] : splitMulti(String(val), p.options);
      val = list.map(x => coerce(x, p.type || 'string', copt));
      if (p.required && !val.length) missing.push(p.name);
    } else {
      // a blank is a value only for allowBlank (text); a nullable parameter reads it as null
      if (val === '' && (p.type !== 'string' || (p.nullable && !p.allowBlank))) val = null;
      else val = coerce(val, p.type || 'string', copt);
      if (p.required && ((val == null && !p.nullable) || (val === '' && !p.allowBlank))) missing.push(p.name);
    }
    out[p.name] = val;
    ctx.params[p.name] = val;
  }
  if (missing.length && !lenient) throw new ReportError(`Enter a value for: ${missing.join(', ')}`, { missingParameters: missing });
  return out;
}

export { FontStore, TextMeasurer, ITEMS, finishText };
