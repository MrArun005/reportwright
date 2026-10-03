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
import { evalValue } from './expr/evaluate.js';
import { BASE_STYLE } from './style.js';
import { ITEMS } from './items/index.js';
import { shiftItems } from './items/paint.js';
import { paginate } from './paginate/index.js';
import { validate } from './schema/validate.js';

export class ReportError extends Error {
  /** @param {string} msg @param {object} [extra] */
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); this.name = 'ReportError'; }
}

const EPS = 0.01;

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
 * }} opts
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
  const sources = opts.sources || await loadSources(def, { params, fetch: opts.fetch, baseUrl: opts.baseUrl });
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
  const makeLc = (globals, fixed) => ({
    m, base, dataSets, warn, fixed, maxUnitHeight: contentH,
    ctxFor: (item) => {
      const ds = item.dataSet || defaultDs;
      const rows = (ds && dataSets[ds]) || [];
      return { ...baseCtx, globals, fields: rows[0] || null, aggRows: rows };
    },
  });

  /* ---------------- body: layout + push-down ---------------- */
  const lc = makeLc(baseCtx.globals, false);
  const bodyItems = [...(sec.body?.items || [])].sort((a, b) => a.y - b.y || a.x - b.x);
  const laid = bodyItems.map((it, idx) => {
    const spec = ITEMS[it.type];
    if (!spec) { warn(`Unknown item type "${it.type}"`); return { it, res: { height: 0, units: [] }, idx }; }
    return { it, res: spec.layout(it, lc), idx };
  });
  const shift = new Array(laid.length).fill(0);
  const units = [], tables = [];
  laid.forEach((L, i) => {
    const it = L.it;
    let s = 0;
    for (let j = 0; j < i; j++) {
      const J = laid[j].it;
      const overlapX = J.x < it.x + Math.max(it.w, 1) - EPS && it.x < J.x + Math.max(J.w, 1) - EPS;
      if (overlapX && J.y + J.h <= it.y + EPS) {
        let delta = laid[j].res.height - J.h;
        if (delta < 0 && !(J.canShrink || laid[j].res.units.length === 0)) delta = 0;
        s = Math.max(s, shift[j] + delta);
      }
    }
    shift[i] = s;
    const top = it.y + s;
    L.res.units.forEach((u, k) => units.push({ ...u, top: top + u.top, tableId: L.res.table ? i : undefined, breakBefore: k === 0 && !!it.pageBreakBefore }));
    if (L.res.table) tables.push({ id: i, top, bottom: top + L.res.height, ...L.res.table });
  });
  units.sort((a, b) => a.top - b.top);

  const slices = paginate(units, tables, contentH, warn);
  const total = slices.length;

  /* ---------------- pages ---------------- */
  const ml = page.margins.left, mt = page.margins.top;
  const bodyTop = mt + headerH;
  const pages = slices.map((p, k) => {
    const items = [];
    const globals = { ...baseCtx.globals, PageNumber: k + 1, TotalPages: total };
    const plc = makeLc(globals, true);
    const band = (section, y0, first, last) => {
      if (!section) return;
      if (first && section.printOnFirstPage === false) return;
      if (last && section.printOnLastPage === false) return;
      for (const it of section.items || []) {
        const spec = ITEMS[it.type];
        if (!spec) continue;
        const r = spec.layout(it, plc);
        for (const u of r.units) items.push(...shiftItems(u.items, ml, y0 + it.y + u.top));
      }
    };
    band(header, mt, k === 0, k === total - 1);
    for (const t of p.repeat) items.push(...shiftItems(t.headerItems, ml, bodyTop));
    for (const u of p.units) items.push(...shiftItems(u.items, ml, bodyTop + p.offset + (u.top - p.top)));
    band(footer, page.height - page.margins.bottom - footerH, k === 0, k === total - 1);
    return { items };
  });

  return {
    width: page.width, height: page.height, pages, warnings,
    stats: { ms: Date.now() - t0, pages: pages.length, rows: Object.fromEntries(Object.entries(dataSets).map(([k, r]) => [k, r.length])) },
  };
}

/** Defaults, types and required checks for report parameters. */
export function resolveParameters(def, given) {
  const out = {}, missing = [];
  const ctx = { params: {}, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null };
  for (const p of def.parameters || []) {
    let val = given[p.name];
    if ((val == null || val === '') && p.default != null && p.default !== '') {
      try { val = evalValue(p.default, ctx); } catch { val = null; }
    }
    val = val === '' && p.type !== 'string' ? null : coerce(val, p.type || 'string');
    if (p.required && (val == null || val === '')) missing.push(p.name);
    out[p.name] = val;
    ctx.params[p.name] = val;
  }
  if (missing.length) throw new ReportError(`Enter a value for: ${missing.join(', ')}`, { missingParameters: missing });
  return out;
}

export { FontStore, TextMeasurer, ITEMS };
