// @ts-check
/**
 * Pagewright engine.
 * render(definition, options) → page model.
 * No React, no DOM. Runs in a Web Worker and in Node.
 */
import { resolvePage } from './units.js';
import { FontStore, ALL_FONT_KEYS } from './text/fonts.js';
import { TextMeasurer } from './text/measure.js';
import { loadSources, buildDataSets, coerce } from './data/index.js';
import { evalValue, evaluate } from './expr/evaluate.js';
import { isoDate } from './expr/format.js';
import { BASE_STYLE } from './style.js';
import { ITEMS } from './items/index.js';
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
  const params = resolveParameters(def, opts.parameters || {});

  const store = opts.fontStore || new FontStore(/** @type {any} */ (opts.loadFont));
  await store.load(ALL_FONT_KEYS);
  const m = new TextMeasurer(store);

  const now = opts.now || new Date();
  const baseCtx = {
    params, globals: { ExecutionTime: now, ReportName: def.name || '', PageNumber: 1, TotalPages: 1 },
    dataSets: {}, fields: null, locale: def.locale || 'en-IN', currency: def.currency || 'INR',
  };
  const sources = opts.sources || await loadSources(def, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId });
  const dataSets = buildDataSets(def, sources, baseCtx);
  baseCtx.dataSets = dataSets;
  const defaultDs = def.dataSets?.[0]?.name;

  const sec = def.sections || {};
  const header = sec.pageHeader?.height ? sec.pageHeader : null;
  const footer = sec.pageFooter?.height ? sec.pageFooter : null;
  const headerH = header?.height || 0;
  const footerH = footer?.height || 0;
  const contentH = page.height - page.margins.top - page.margins.bottom - headerH - footerH;
  if (contentH < 24) throw new ReportError('The page header and footer leave no room for the body. Make them shorter or the margins smaller.');

  const base = { ...BASE_STYLE, ...(def.styles?.base || {}) };
  let idSeq = 0;
  const regions = [];
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
    };
    return lc;
  };

  /* ---------------- body: layout + push-down ---------------- */
  const lc = makeLc(baseCtx.globals, false);

  // Subreports: one pass collects what to load, then each child renders its body with its own data.
  if (hasType(sec.body?.items, 'subreport')) {
    if (!opts.loadReport) lc.subreports = null;
    else {
      const depth = opts.depth || 0;
      if (depth > 3) throw new ReportError('Subreports are nested more than 3 levels deep');
      const requests = new Map();
      layoutItems(sec.body?.items || [], { ...lc, regions: [], warn: () => {}, subreports: { mode: 'collect', requests } });
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
          const r = await render(child, { ...opts, reportId: rq.report, budget, parameters: rq.params, bodyOnly: true, depth: depth + 1, chain: [...(opts.chain || []), def.name, rq.report], bodyWidth: page.bodyWidth, state: {} });
          results.set(key, r);
          for (const w of r.warnings) warn(`Subreport ${rq.report}: ${w}`);
        } catch (e) { results.set(key, { error: e.message }); }
      }
      lc.subreports = { mode: 'use', results };
    }
  }
  // Multi-column body: the strip fills column slots left to right, then the next page.
  const colCount = Math.max(1, Math.min(6, Number(sec.body?.columns?.count) || 1));
  const colGap = Number(sec.body?.columns?.gap ?? 18);
  const colW = (page.bodyWidth - colGap * (colCount - 1)) / colCount;
  lc.bodyWidth = colCount > 1 ? colW : lc.bodyWidth;

  /** Lay out the body and assemble pages. A table of contents needs a second pass. */
  const assemble = (tocEntries) => {
    regions.length = 0;
    lc.toc = tocEntries;
    const body = layoutItems(sec.body?.items || [], lc);
    if (opts.bodyOnly) return { body };
    // one page that grows: page breaks have nothing to break
    if (page.pageless) for (const u of body.units) { u.breakBefore = false; u.breakAfter = false; }
    const slices = paginate(body.units, body.tables, contentH, warn);
    let pageH = page.height;
    if (page.pageless) {
      if (slices.length === 1) pageH = Math.max(page.minHeight, page.margins.top + headerH + slices[0].bottom - slices[0].top + footerH + page.margins.bottom);
      else warn(`This pageless report is taller than 200 inches, the largest PDF page, so it is split into ${slices.length} pages.`);
    }
    const total = Math.ceil(slices.length / colCount);
    const ml = page.margins.left, mt = page.margins.top;
    const bodyTop = mt + headerH;
    const bookmarks = [];
    const pages = [];
    for (let k = 0; k < total; k++) {
      const items = [];
      const globals = { ...baseCtx.globals, PageNumber: k + 1, TotalPages: total };
      const plc = makeLc(globals, true);
      const band = (section, y0, first, last) => {
        if (!section) return;
        if (first && section.printOnFirstPage === false) return;
        if (last && section.printOnLastPage === false) return;
        const r = layoutItems(section.items || [], plc);
        for (const u of r.units) items.push(...shiftItems(u.items, ml, y0 + u.top));
      };
      band(header, mt, k === 0, k === total - 1);
      for (let c = 0; c < colCount; c++) {
        const p = slices[k * colCount + c];
        if (!p) break;
        const cx = ml + c * (colW + colGap);
        for (const t of p.repeat) items.push(...shiftItems(t.headerItems, cx, bodyTop));
        for (const u of p.units) {
          // Only items under a continued table move down by its repeated header.
          let off = 0;
          for (const t of p.repeat) if (u.x0 < t.x1 - EPS && t.x0 < u.x1 - EPS) off = Math.max(off, t.headerHeight);
          items.push(...shiftItems(u.items, cx, bodyTop + off + (u.top - p.top)));
        }
      }
      band(footer, pageH - page.margins.bottom - footerH, k === 0, k === total - 1);
      const kept = [];
      for (const it of items) {
        if (it.t === 'bookmark') bookmarks.push({ label: it.label, page: k + 1, y: it.y, level: it.level || 0 });
        else kept.push(it);
      }
      pages.push({ items: kept });
    }
    return { pages, bookmarks, height: pageH };
  };

  let result = assemble([]);
  if (opts.bodyOnly) return { units: result.body.units, tables: result.body.tables, height: result.body.height, regions, warnings };
  if (hasType(sec.body?.items, 'toc')) {
    // The table of contents changes the page count, which changes its own numbers: repeat until stable.
    for (let pass = 0; pass < 3; pass++) {
      const entries = result.bookmarks.map(b => ({ label: b.label, level: b.level, page: b.page }));
      const next = assemble(entries);
      const same = JSON.stringify(next.bookmarks.map(b => b.page)) === JSON.stringify(result.bookmarks.map(b => b.page));
      result = next;
      if (same && pass > 0) break;
    }
  }
  const { pages, bookmarks, height } = result;

  return {
    width: page.width, height, pages, warnings, bookmarks, regions, name: def.name || '',
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
      const href = String(evalValue(a.url ?? '', ctx) ?? '');
      if (!/^(https?:|mailto:|\/)/i.test(href)) return null;
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
  const sets = (def.dataSets || []).filter(d => need.has(d.name));
  const srcNames = new Set(sets.map(d => d.source));
  const sub = { ...def, dataSources: (def.dataSources || []).filter(s => srcNames.has(s.name)), dataSets: sets };
  const sources = opts.sources || await loadSources(sub, { params, fetch: opts.fetch, baseUrl: opts.baseUrl, sql: opts.sql, reportId: opts.reportId });
  const ctx = { params, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null };
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
  const ctx = { params: {}, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null };
  for (const p of def.parameters || []) {
    let val = given[p.name];
    if ((val == null || val === '') && p.default != null && p.default !== '') {
      try { val = evalValue(p.default, ctx); } catch { val = null; }
    }
    if (p.multi) {
      let list = Array.isArray(val) ? val : val == null || val === '' ? [] : String(val).split(',').map(x => x.trim()).filter(Boolean);
      val = list.map(x => coerce(x, p.type || 'string'));
      if (p.required && !val.length) missing.push(p.name);
    } else {
      val = val === '' && p.type !== 'string' ? null : coerce(val, p.type || 'string');
      if (p.required && (val == null || val === '')) missing.push(p.name);
    }
    out[p.name] = val;
    ctx.params[p.name] = val;
  }
  if (missing.length && !lenient) throw new ReportError(`Enter a value for: ${missing.join(', ')}`, { missingParameters: missing });
  return out;
}

export { FontStore, TextMeasurer, ITEMS };
