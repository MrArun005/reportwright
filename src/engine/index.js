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
import { shiftItems } from './items/paint.js';
import { paginate } from './paginate/index.js';
import { layoutItems } from './layout.js';
import { validate } from './schema/validate.js';

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
 * }} opts
 *   reportId: the saved report, whose SQL sources the server runs for a browser render.
 *   sql: runs SQL sources directly (server renders).
 */
export async function render(def, opts = {}) {
  const t0 = Date.now();
  const v = validate(def);
  if (v.errors.length) throw new ReportError(v.errors[0], { errors: v.errors });
  /** @type {string[]} */
  const warnings = [...v.warnings];
  const warn = (msg) => { if (warnings.length < 200 && !warnings.includes(msg)) warnings.push(msg); };

  const page = resolvePage(def.page);
  if (['pageHeader', 'body', 'pageFooter'].some(k => hasType(k === 'body' && Array.isArray(def.sections?.body) ? def.sections.body.flatMap(b => b.items || []) : def.sections?.[k]?.items, 'barcode'))) await loadBarcodes();
  const params = resolveParameters(def, opts.parameters || {});

  const store = opts.fontStore || new FontStore(/** @type {any} */ (opts.loadFont));
  await store.load(ALL_FONT_KEYS);
  let m = new TextMeasurer(store);

  const now = opts.now || new Date();
  const fnCount = opts.fnCount || { n: 0 }; // report function calls, for this render and its subreports
  const baseCtx = {
    params, globals: { ExecutionTime: now, ReportName: def.name || '', PageNumber: 1, TotalPages: 1 },
    dataSets: {}, fields: null, locale: def.locale || 'en-IN', currency: def.currency || 'INR', functions: functionTable(def, fnCount),
  };
  const sources = opts.sources || await loadSources(def, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId });
  const dataSets = buildDataSets(def, sources, baseCtx);
  baseCtx.dataSets = dataSets;
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
  let imageBudget = { seen: new Set(), bytes: 0 }; // 50 MB of images per render, each distinct image once
  const makeLc = (globals, fixed) => {
    const lc = {
      m, base, dataSets, warn, fixed, maxUnitHeight: contentH, state: opts.state || {}, regions,
      named: def.styles?.named || {},
      nextId: () => ++idSeq,
      layoutItems: (items, l, o) => layoutItems(items, l, o),
      linkFor: (it, ctx, rect) => linkFor(it, ctx, rect, warn),
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
    imageBudget = { seen: new Set(), bytes: 0 };
    if (!opts.fnCount) fnCount.n = 0; // each layout pass (fonts, TOC) gets the full budget
    const lc = makeLc(baseCtx.globals, false);
    // opts.firstPages: lay out only enough rows for that many pages (a fast first look; the full render follows).
    // 8 pt is the smallest sensible row, so this budget always fills the pages asked for. Not with a table of contents.
    lc.rowBudget = firstPages > 0 && !opts.bodyOnly && !hasType(allBody, 'toc') ? { left: Math.ceil((firstPages * contentH) / 8), cut: false } : null;
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
            const r = await render(child, { ...opts, reportId: rq.report, budget, fnCount, parameters: rq.params, bodyOnly: true, depth: depth + 1, chain: [...(opts.chain || []), def.name, rq.report], bodyWidth: page.bodyWidth, state: {} });
            results.set(key, r);
            for (const w of r.warnings) warn(`Subreport ${rq.report}: ${w}`);
          } catch (e) { results.set(key, { error: e.message }); }
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
      // each body section: laid out and paginated with its own page
      const parts = [];
      for (let bi = 0; bi < bodies.length; bi++) {
        const g = geos[bi];
        const blc = bi === 0 && !bodies[0].page ? lc : { ...lc, bodyWidth: g.bodyWidth, maxUnitHeight: g.cH };
        const body = layoutItems(bodies[bi].items || [], blc);
        if (opts.bodyOnly) return { body };
        // one page that grows: page breaks have nothing to break
        if (g.pg.pageless) for (const u of body.units) { u.breakBefore = false; u.breakAfter = false; }
        const slices = paginate(body.units, body.tables, g.cH, warn);
        parts.push({ body, slices, g });
        if (lc.rowBudget?.cut) break;
      }
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
          for (const u of r.units) items.push(...shiftItems(u.items, ml, y0 + u.top));
        };
        band(header, mt, n === 0, n === total - 1);
        const frozen = []; // table headers on this page and where each table ends: viewers keep them in view while scrolling
        for (let c = 0; c < colCount; c++) {
          const p = slices[k * colCount + c];
          if (!p) break;
          const cx = ml + c * (colW + colGap);
          for (const t of p.repeat) items.push(...shiftItems(t.headerItems, cx, bodyTop));
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
            if (u.cont && u.top <= p.top + EPS) items.push(...shiftItems(u.cont, cx, bodyTop + off));
            items.push(...shiftItems(u.items, cx, bodyTop + off + (u.top - p.top)));
          }
        }
        band(footer, ph - pg.margins.bottom - footerH, n === 0, n === total - 1);
        const kept = [];
        for (const it of items) {
          if (it.t === 'bookmark') (it.heading ? headings : bookmarks).push({ label: it.label, page: n + 1, y: it.y, level: it.level || 0 });
          else kept.push(it);
        }
        const out = frozen.length ? { items: kept, frozen } : { items: kept };
        // a section with another page size: the page carries its own
        if (pg.width !== first.width || ph !== pageH) { out.width = pg.width; out.height = ph; }
        pages.push(out);
      });
      return { pages, bookmarks, headings, height: pageH, width: first.width };
  };

  let result = assemble([]);
  if (opts.bodyOnly) return result;
  if (hasType(allBody, 'toc')) {
    // The table of contents changes the page count, which changes its own numbers: repeat until stable.
    for (let pass = 0; pass < 3; pass++) {
      const entries = [...result.bookmarks.map(b => ({ label: b.label, level: b.level, page: b.page })), ...result.headings.map(b => ({ label: b.label, level: b.level, page: b.page, y: b.y, heading: true }))];
      const next = assemble(entries);
      const at = (r) => JSON.stringify([r.bookmarks.map(b => b.page), r.headings.map(b => [b.page, b.y])]);
      const same = at(next) === at(result);
      result = next;
      if (same && pass > 0) break;
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
  if (m.noGlyph.size) warn(`No font has these characters, so they show as boxes: ${[...m.noGlyph].slice(0, 20).join(' ')}. Upload a font that has them and use it for this text.`);
  if (opts.bodyOnly) return { units: result.body.units, tables: result.body.tables, height: result.body.height, regions, warnings };
  const { pages, bookmarks, height } = result;
  for (const pg of pages) finishText(pg.items, m);
  // background images (a style, painted without the layout context) may name an embedded image
  for (const pg of pages) {
    pg.items = pg.items.filter(it => {
      if (it.t !== 'image' || !String(it.src).startsWith('embedded:')) return true;
      it.src = resolveImageSrc(it.src, 'Background image', { images: def.images || {}, budget: imageBudget, warn });
      return !!it.src;
    });
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
function linkFor(it, ctx, rect, warn) {
  let tip;
  if (it?.tooltip) { try { const t = evalValue(it.tooltip, ctx); if (t != null && t !== '') tip = String(t); } catch (e) { warn(`${it.name || 'Tooltip'}: ${e.message}`); } }
  const l = linkAction(it, ctx, rect, warn);
  if (l) return tip ? { ...l, tip } : l;
  return tip ? { t: 'link', ...rect, action: null, tip } : null; // a tooltip without an action
}

function linkAction(it, ctx, rect, warn) {
  const a = it?.action;
  if (!a || !a.type || a.type === 'none') return null;
  try {
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
