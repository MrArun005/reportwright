// @ts-check
/**
 * Streaming table data (docs/research/STREAMING-1M.md §4–5): the rows of a report's one table, read from its source a
 * batch at a time, filtered, sorted and grouped (through a sorter that may spill to disk), and handed out as the same
 * region rows ({ kind, level, cells }) a dataOnly render puts in model.regions, one at a time. The data CSV and the
 * Excel export write them as they come, so memory does not grow with the rows.
 *
 * planStream(def, opts) says whether a report can stream: one table in the body, row-local expressions (Fields,
 * Parameters, Globals, functions of the row), row filters, sorts and groups. Anything else (aggregates in detail rows,
 * Lookup, nested data sets, TopN filters, matrices, lists, subreports) returns { why } and the caller renders the
 * page model as before. Group and table footers may hold Sum/Count/Avg/Min/Max(row expression) and CountRows(): they are
 * folded as rows pass (aggregator), the same values the model computes.
 */
import { validate } from './schema/validate.js';
import { makeLoader, resolveReuse, resolveTheme, flattenNamed } from './reuse.js';
import { layerFilter } from './layout.js';
import { resolvePage } from './units.js';
import { baseContext, resolveParameters, ReportError } from './index.js';
import { validTimeZone, isoDate } from './expr/format.js';
import { BASE_STYLE, resolveStyle } from './style.js';
import { evalValue, evaluate, streamable, streamableAst, FOLDS, aggregator, compile, groupKeyText, isDynamic, functionTable } from './expr/evaluate.js';
import { coerce, detectFields, jsonPath, jsonPathRows, rowFilter, SET_OPS, sortKeys, compareKeys, parseCsv, sourceResponse, csvChar } from './data/index.js';
import { jsonRows, csvRows } from './data/stream.js';
import { textOf, roundFor } from './items/index.js';
import { rowCells } from './items/cells.js';
import { cmpKey } from './items/pivot.js';

/** Items that may sit beside the table: they put nothing in the data CSV (images: nothing in the CSV either). */
const BESIDE = { csv: new Set(['textbox', 'line', 'shape', 'image']), xlsx: new Set(['textbox', 'line', 'shape']) };
const SOURCES = new Set(['json', 'csv', 'rest', 'sql']);

/**
 * An in-memory sorter (the browser, the CLI): the server passes one that spills runs to disk (server/spill.js).
 * @param {(a: any, b: any) => number} cmp
 */
export function memorySorter(cmp) {
  let a = [];
  return {
    push(r) { a.push(r); },
    async *drain() { const all = a; a = []; all.sort(cmp); for (let i = 0; i < all.length; i++) { yield all[i]; all[i] = null; } },
    async close() { a = []; },
  };
}

/** A string value that holds an expression must be row-local. */
const okValue = (v, o) => typeof v !== 'string' || !isDynamic(v) || streamable(v, o);
/** Every expression in a style (any depth) is row-local. */
const okStyle = (st, d = 0) => !st || typeof st !== 'object' || d > 8 || Object.values(st).every(v => (v && typeof v === 'object' ? okStyle(v, d + 1) : okValue(v)));
const isHidden = (h) => !(h == null || h === false || h === '');

/** A footer cell folded as rows pass: Sum/Count/Avg/Min/Max of a row expression, or CountRows(). */
function foldOf(v) {
  if (typeof v !== 'string' || !v.startsWith('=')) return null;
  let ast;
  try { ast = compile(v.slice(1)); } catch { return null; }
  if (!ast || ast.type !== 'call' || ast.obj) return null;
  const fn = ast.name.toLowerCase();
  if (fn === 'countrows' && !ast.args.length) return { fn };
  if (!FOLDS.has(fn) || ast.args.length !== 1 || !streamableAst(ast.args[0])) return null;
  return { fn, ast: ast.args[0] };
}

/**
 * @param {any} def0 the report definition
 * @param {{ format: 'csv'|'xlsx', parameters?: object, timeZone?: string, now?: Date, state?: any, loadReport?: (id: string) => Promise<any>,
 *   reportId?: string, fetch?: typeof fetch, baseUrl?: string, sql?: (src: any, p: any) => Promise<object[]>,
 *   sqlRows?: (src: any, p: any) => AsyncIterable<object[]>, sources?: Record<string, any>, sorter?: (cmp: (a: any, b: any) => number) => any,
 *   deadline?: number, timeoutMs?: number, maxRows?: number, maxJsonRowBytes?: number, maxJsonWholeBytes?: number }} opts
 * @returns {Promise<{ why: string } | { why?: undefined, name: string, columns: number[], title: string, timeZone: string|null, locale: string|null, currency: string|null, warnings: string[], rows: () => AsyncGenerator<any>, stats: { rows: number } }>}
 */
export async function planStream(def0, opts) {
  const no = (why) => ({ why });
  if (!def0 || typeof def0 !== 'object' || Array.isArray(def0)) return no('not a definition');
  const warnings = [];
  const warn = (msg) => { if (warnings.length < 200 && !warnings.includes(msg)) warnings.push(msg); };
  const getReport = makeLoader(opts.loadReport, new Map());
  const { def, parts } = await resolveReuse(def0, getReport, warn, opts.reportId ? [opts.reportId] : [], { items: 0 });
  if (parts) return no('report parts');
  const v = validate(def);
  if (v.errors.some(e => !v.exprErrors.includes(e))) return no('the definition has errors');
  const fmt = opts.format;
  const state = opts.state || {};
  if (state.toggles && Object.keys(state.toggles).length) return no('toggled items');

  // ---- the body: one table, and only items that put nothing in this format beside it
  const sec = def.sections || {};
  const bodies = Array.isArray(sec.body) ? sec.body : [sec.body || {}];
  if (bodies.length !== 1 || bodies[0].page || Number(bodies[0].columns?.count) > 1) return no('body sections or columns');
  const layerOff = layerFilter(def.layers, opts.state?.target || 'export');
  const items = (bodies[0].items || []).filter(it => it && !(layerOff && layerOff(it)));
  const tables = items.filter(it => it.type === 'table');
  if (tables.length !== 1) return no('not exactly one table');
  if (items.some(it => it.type !== 'table' && (!BESIDE[fmt].has(it.type) || (Array.isArray(it.items) && it.items.length)))) return no('other data items in the body');
  if (fmt === 'xlsx') {
    // the page bands' pictures go on the workbook's Charts sheet (exporters/xlsx.js): those reports take the model path
    const pics = (list) => (list || []).some(it => !it || !BESIDE.xlsx.has(it.type) || pics(it.items));
    if (pics(sec.pageHeader?.items) || pics(sec.pageFooter?.items) || pics(bodies[0].pageHeader?.items) || pics(bodies[0].pageFooter?.items)) return no('pictures in the page bands');
  }
  const item = tables[0];
  if (item.__body || !item.dataSet || isHidden(item.hidden) || item.overflowTo) return no('table shape');
  if (state.sort?.[item.name]) return no('interactive sort');
  const named = flattenNamed(def.styles?.named, warn);
  if (!okStyle(def.styles?.base) || !Object.values(named || {}).every(st => okStyle(st)) || !okStyle(item.style)) return no('style expressions');
  const groups = item.groups || [];
  for (const g of groups) if (g.parent || g.sortBy || (g.collapsible && g.initiallyCollapsed) || g.expandLevels != null || !okValue(g.expr)) return no('group shape');
  const okRow = (row, { rowNumber = false, folds = false } = {}) => {
    if (!row || isHidden(row.hidden) && row.hidden !== true) return false;
    if (!okStyle(row.style)) return false;
    return (Array.isArray(row.cells) ? row.cells : []).every(c => !c || (!c.item && !(Number(c.rowSpan) > 1) && !('raw' in c) && okStyle(c.style)
      && (okValue(c.value, { rowNumber }) || (folds && foldOf(c.value)))));
  };
  if (!(item.detail || []).every(r => okRow(r, { rowNumber: true }))) return no('detail expressions');
  if (!(item.header || []).every(r => okRow(r))) return no('header expressions');
  const bands = fmt === 'xlsx';
  if (bands) {
    if (!(item.footer || []).every(r => okRow(r, { folds: true }))) return no('footer expressions');
    for (const g of groups) if (!(g.header || []).every(r => okRow(r)) || !(g.footer || []).every(r => okRow(r, { folds: true }))) return no('group band expressions');
  }
  for (const f of item.filters || []) if (SET_OPS.has(String(f.op || '').toLowerCase()) || !okValue(f.expr) || !okValue(f.value) || !okValue(f.value2)) return no('table filters');
  for (const s of item.sort || []) if (!okValue(s.by)) return no('table sort');

  // ---- its data set and source
  const ds = (def.dataSets || []).find(d => d.name === item.dataSet);
  if (!ds || ds.relation || (def.dataSets || []).some(d => d.relation?.parent === ds.name)) return no('nested data sets');
  const src = (def.dataSources || []).find(s => s.name === ds.source);
  const given = opts.sources && Object.hasOwn(opts.sources, ds.source);
  if (!given && (!src || !SOURCES.has(src.type))) return no(`source type ${src?.type}`);
  if (!given && src.type === 'csv' && ds.path && ds.path !== '$') return no('a path into CSV rows');
  for (const fd of ds.fields || []) if (fd.expr && !okValue(fd.expr)) return no('calculated fields');
  for (const f of ds.filters || []) if (SET_OPS.has(String(f.op || '').toLowerCase()) || !okValue(f.expr) || !okValue(f.value) || !okValue(f.value2)) return no('data set filters');
  for (const s of ds.sort || []) if (!okValue(s.by)) return no('data set sort');

  // ---- the render's context, as render() builds it
  const t0 = Date.now();
  let timeZone = def.timeZone || opts.timeZone;
  if (timeZone && !validTimeZone(timeZone)) { warn(`The time zone "${String(timeZone).slice(0, 60)}" is not known, so dates show in the server's zone.`); timeZone = undefined; }
  const params = resolveParameters(def, opts.parameters || {}, /** @type {any} */ ({ now: opts.now, timeZone, locale: def.locale }));
  const deadline = opts.deadline ?? (Number(opts.timeoutMs) > 0 ? t0 + Number(opts.timeoutMs) : null);
  const clock = deadline ? { until: deadline, n: 0, over: false } : null;
  const overTime = () => {
    if (clock && (clock.over || Date.now() > clock.until)) throw new ReportError(`The report ran longer than ${Math.round(Number(opts.timeoutMs || deadline - t0) / 100) / 10} s, the time limit on this server. Filter the data, or avoid aggregates over the whole data set in every row.`, { status: 504, timeout: true });
  };
  const baseCtx = /** @type {any} */ (baseContext(def, { params, now: opts.now || new Date(), timeZone, fnCount: { n: 0 }, clock }));
  baseCtx.theme = await resolveTheme(def, baseCtx, getReport, warn);
  const base = { ...BASE_STYLE, ...(def.styles?.base || {}) };

  // ---- the table's columns, as the layout sizes them (a table wider than the page with overflow "shrink" is narrowed)
  const page = resolvePage(def.page);
  let cols = item.columns || [];
  const room = page.bodyWidth - item.x;
  const designedW = cols.reduce((s, c) => s + (Number(c.width) || 0), 0);
  if (designedW > room + 1 && item.overflow === 'shrink' && room > 0) { const k = room / designedW; cols = cols.map(c => ({ ...c, width: (Number(c.width) || 0) * k })); }
  const colX = [];
  let acc = item.x;
  for (const c of cols) { colX.push(acc); acc += c.width; }
  const colIdx = colX.map(x => colX.indexOf(x));
  const ncols = cols.length;
  const lc = { warn };
  const fl = baseCtx.bandRows === 'first-last';
  const setCtx = { ...baseCtx, ...(ds.caseSensitive != null ? { caseSensitive: ds.caseSensitive === true } : {}) };
  const tctx = { ...baseCtx };
  const cellsAt = new WeakMap();
  const at = (row) => { let a = cellsAt.get(row); if (!a) cellsAt.set(row, a = rowCells(row.cells, ncols).at); return a; };

  /** One region row, as layRow (items/index.js) records it. fold: (row, ci) → { v } for a folded footer cell, else null. */
  const regionRow = (row, ctx, kind, level, fold) => {
    if (row.hidden === true) return null;
    const rst = resolveStyle([base, named?.[item.styleName], item.style, named?.[row.styleName], row.style], ctx);
    const cells = [];
    const a = at(row);
    for (let ci = 0; ci < ncols; ci++) {
      const cell = a[ci];
      if (!cell) continue;
      const span = Math.max(1, Math.min(cell.colSpan || 1, ncols - ci));
      const st = resolveStyle([rst, named?.[cell.styleName], cell.style], ctx);
      let v;
      try { const f = fold && fold(row, ci); v = f ? f.v : evalValue(cell.value ?? '', ctx); } catch (e) { warn(`${item.name || 'Table'} cell: ${e.message}`); v = '#Error'; }
      const plain = textOf(v, st, ctx, lc);
      cells.push({ col: Math.round((colX[ci] - item.x) * 100), value: v instanceof Date || typeof v === 'boolean' ? v : typeof v === 'number' ? roundFor(v, st.format) : plain, format: st.format || null, bold: st.fontWeight === 'bold' || Number(st.fontWeight) >= 600, span, colIndex: colIdx[ci] });
    }
    return { kind, level, cells };
  };

  // ---- rows from the source, typed as buildDataSets types them
  const maxRows = opts.maxRows ?? Infinity;
  const stats = { rows: 0 };
  const day = (x) => (x instanceof Date ? isoDate(x) : x);
  async function* raw() {
    if (given) { yield* inBatches(listAt(opts.sources?.[ds.source], ds.path)); return; }
    try {
      if (src.type === 'json') yield* inBatches(listAt(typeof src.data === 'string' ? JSON.parse(src.data) : src.data, ds.path));
      else if (src.type === 'csv' && src.data) yield* inBatches(parseCsv(src.data, src));
      else if (src.type === 'csv') {
        const res = await sourceResponse(src, { params, globals: {}, dataSets: {}, fields: null, functions: functionTable(def) }, opts);
        if (src.headerRow === false) yield* inBatches(parseCsv(await res.text(), src)); // the width of every row first: read whole
        else yield* csvRows(res.body ?? await res.text(), src, csvChar, opts.maxJsonRowBytes);
      } else if (src.type === 'rest') {
        const res = await sourceResponse(src, { params, globals: {}, dataSets: {}, fields: null, functions: functionTable(def) }, opts);
        yield* jsonRows(res.body ?? await res.text(), ds.path, { maxElementBytes: opts.maxJsonRowBytes ?? 8 * 1048576, maxWholeBytes: opts.maxJsonWholeBytes });
      } else { // sql
        const p = Object.fromEntries(Object.entries(params || {}).map(([k, x]) => [k, Array.isArray(x) ? x.map(day) : day(x)]));
        if (opts.sqlRows) yield* opts.sqlRows(src, p);
        else if (opts.sql) yield* inBatches(await opts.sql(src, p));
        else throw new Error('SQL runs on the server');
      }
    } catch (e) {
      if (e instanceof ReportError) throw e;
      throw Object.assign(new Error(`Data source "${src.name}": ${e.message}`), { status: e.status });
    }
  }
  const plainOf = (fields) => fields.filter(fd => !fd.expr);
  /** Typed rows that pass the data set's and the table's row filters, in source order, in batches. */
  async function* typed() {
    let fields = ds.fields && ds.fields.length ? ds.fields : null;
    let head = fields ? null : [];
    const bad = new Map();
    const optFor = (fd) => ({ locale: ds.locale || baseCtx.locale, timeZone: baseCtx.timeZone, bad: (x) => { const b = bad.get(fd.name); if (b) b.n++; else bad.set(fd.name, { n: 1, v: x, type: fd.type }); } });
    let plain, calc, fopts, cc;
    const failed = new Set();
    const dsRun = (ds.filters || []), tRun = (item.filters || []);
    const dc = { ...setCtx }, tc = { ...tctx };
    const build = (list) => {
      const out = [];
      for (const r of list) {
        if (++stats.rows > maxRows) throw Object.assign(new Error(`The data has more than ${maxRows.toLocaleString('en-US')} rows, the most a streaming export reads (PW_STREAM_MAX_ROWS). Filter it.`), { status: 413 });
        if ((stats.rows & 255) === 0) overTime();
        const o = {};
        for (const fd of plain) o[fd.name] = coerce(fd.path ? jsonPath(r, fd.path) : r?.[fd.name], fd.type, fopts.get(fd));
        if (calc.length) {
          cc.fields = o;
          for (const fd of calc) {
            if (failed.has(fd.name)) { o[fd.name] = null; continue; }
            try { o[fd.name] = coerce(evalValue(fd.expr, cc), fd.type, fopts.get(fd)); } catch (e) { failed.add(fd.name); o[fd.name] = null; warn(`Data set "${ds.name}", field "${fd.name}": ${e.message}`); }
          }
        }
        dc.fields = o;
        if (dsRun.length && !dsRun.every(f => rowFilter(f, dc))) continue;
        tc.fields = o;
        if (tRun.length && !tRun.every(f => rowFilter(f, tc))) continue;
        out.push(o);
      }
      return out;
    };
    const ready = (fs) => {
      fields = fs; plain = plainOf(fs); calc = fs.filter(fd => fd.expr);
      fopts = new Map(fs.map(fd => [fd, optFor(fd)]));
      cc = { ...baseCtx, dataSets: {}, fields: null };
    };
    if (fields) ready(fields);
    for await (const batch of raw()) {
      if (head) { // no declared fields: guessed from the first 50 rows, as buildDataSets does
        for (const r of batch) head.push(r);
        if (head.length < 50) continue;
        ready(detectFields(head, { dates: ds.detectDates !== false }));
        const h = head; head = null;
        yield build(h);
        continue;
      }
      yield build(batch);
    }
    if (head) { ready(detectFields(head, { dates: ds.detectDates !== false })); yield build(head); }
    for (const [f, b] of bad) warn(`Data set "${ds.name}", field "${f}": ${b.n} value${b.n > 1 ? 's do' : ' does'} not read as ${b.type === 'date' ? 'a date' : 'a number'} (for example "${String(b.v).slice(0, 40)}"), so ${b.n > 1 ? 'they are' : 'it is'} blank.`);
  }

  // ---- order: the table's sort, then the data set's (stable), then the groups (first seen, or by key)
  const tSort = item.sort || [], dSort = ds.sort || [];
  const sorted = tSort.length || dSort.length;
  const sorter = opts.sorter || memorySorter;
  /** Rows in the table's order (after its sort), one at a time. */
  async function* inOrder() {
    if (!sorted) { for await (const b of typed()) for (const r of b) yield r; return; }
    const kc = { ...tctx }, dkc = { ...setCtx };
    const s = sorter((a, b) => (tSort.length && compareKeys(a.t, b.t, tSort, tctx)) || (dSort.length && compareKeys(a.d, b.d, dSort, setCtx)) || a.s - b.s);
    try {
      let seq = 0;
      for await (const b of typed()) for (const r of b) {
        kc.fields = r; dkc.fields = r;
        await s.push({ t: tSort.length ? sortKeys(tSort, kc) : null, d: dSort.length ? sortKeys(dSort, dkc) : null, s: seq++, r });
      }
      for await (const x of s.drain()) yield x.r;
    } finally { await s.close(); }
  }
  /** Rows in display order, each with its group path ([ordinal, key] per level). */
  async function* displayOrder() {
    if (!groups.length) { for await (const r of inOrder()) yield { r, g: null }; return; }
    const gc = { ...tctx };
    const paths = groups.map(() => new Map()); // per level: path text → [ordinal, the first row's key]
    let ord = 0;
    const s = sorter((a, b) => {
      for (let l = 0; l < groups.length; l++) {
        const x = a.g[l], y = b.g[l];
        if (x[0] === y[0]) continue;
        const dir = groups[l].sort === 'desc' ? -1 : groups[l].sort === 'asc' ? 1 : 0;
        if (dir) { const c = cmpKey(x[1], y[1], tctx) * dir; if (c) return c; }
        return x[0] - y[0];
      }
      return a.s - b.s;
    });
    try {
      let seq = 0;
      for await (const r of inOrder()) {
        gc.fields = r;
        let path = '';
        const g = [];
        for (let l = 0; l < groups.length; l++) {
          let key;
          try { key = evalValue(groups[l].expr, gc); } catch (e) { warn(`${item.name} group: ${e.message}`); key = '#Error'; }
          path += `\u0000${groupKeyText(key, tctx)}`;
          let p = paths[l].get(path);
          if (!p) { if (ord > 1e6) throw Object.assign(new Error('More than a million groups: too many to stream.'), { fallBack: true }); paths[l].set(path, p = [ord++, key]); }
          g.push(p);
        }
        await s.push({ g, s: seq++, r });
      }
      for (const m of paths) m.clear();
      for await (const x of s.drain()) yield x;
    } finally { await s.close(); }
  }

  // ---- footer folds: one set of running aggregates per open scope (each group level, and the table)
  const foldCells = (rows) => {
    const out = [];
    for (const row of rows || []) { const a = at(row); for (let ci = 0; ci < ncols; ci++) { const f = a[ci] && foldOf(a[ci].value); if (f) out.push({ row, ci, ...f }); } }
    return out;
  };
  const scopeFolds = bands ? [...groups.map(g => foldCells(g.footer)), foldCells(item.footer)] : groups.map(() => []).concat([[]]);
  const openScope = (l) => new Map(scopeFolds[l].map(f => [f, f.fn === 'countrows' ? { n: 0 } : { agg: aggregator(f.fn, tctx), err: null }]));
  const foldFrom = (sc) => (row, ci) => {
    for (const [f, a] of sc) {
      if (f.row !== row || f.ci !== ci) continue;
      if (a.n != null) return { v: a.n };
      if (a.err) throw a.err;
      return { v: a.agg.value() };
    }
    return null;
  };

  async function* rows() {
    overTime();
    const L = groups.length;
    const tableScope = openScope(L);
    const scopes = new Array(L).fill(null); // per level: { fold scope, first row, last row, ord }
    const dctx = { ...tctx, rowNumber: 0 };
    let headerDone = false, rowNo = 0, first = null, last = null;
    const header = function* (f) {
      const hctx = { ...tctx, fields: f };
      for (const r of item.header || []) { const x = regionRow(r, hctx, 'header', 0); if (x) yield x; }
    };
    const closeTo = function* (l) { // close levels l..L-1, innermost first
      for (let k = L - 1; k >= l; k--) {
        const s = scopes[k];
        if (!s) continue;
        if (bands) { const fctx = { ...tctx, fields: fl ? s.last : s.first }; for (const r of groups[k].footer || []) { const x = regionRow(r, fctx, 'groupFooter', k, foldFrom(s.folds)); if (x) yield x; } }
        scopes[k] = null;
      }
    };
    for await (const { r, g } of displayOrder()) {
      if (!headerDone) { headerDone = true; first = r; yield* header(r); }
      if (g) {
        let l = 0;
        while (l < L && scopes[l] && scopes[l].ord === g[l][0]) l++;
        if (l < L) {
          yield* closeTo(l);
          for (let k = l; k < L; k++) {
            scopes[k] = { ord: g[k][0], first: r, last: r, folds: openScope(k) };
            if (bands) { const hctx = { ...tctx, fields: r, groupKey: g[k][1] }; for (const hr of groups[k].header || []) { const x = regionRow(hr, hctx, 'groupHeader', k); if (x) yield x; } }
          }
        }
        for (const s of scopes) s.last = r;
      }
      rowNo++; last = r;
      if ((rowNo & 255) === 0) overTime();
      dctx.fields = r; dctx.rowNumber = rowNo;
      if (bands) for (const sc of [...scopes.map(s => s?.folds), tableScope]) {
        if (!sc) continue;
        for (const [f, a] of sc) {
          if (a.n != null) { a.n++; continue; }
          if (a.err) continue;
          try { a.agg.add(evaluate(f.ast, dctx)); } catch (e) { a.err = e; }
        }
      }
      for (const dr of item.detail || []) { const x = regionRow(dr, dctx, 'detail', L); if (x) yield x; }
    }
    if (!headerDone) yield* header(null);
    yield* closeTo(0);
    if (bands) { const fctx = { ...tctx, fields: fl ? last : first }; for (const r of item.footer || []) { const x = regionRow(r, fctx, 'footer', 0, foldFrom(tableScope)); if (x) yield x; } }
    overTime();
  }

  return { name: item.name, columns: cols.map(c => c.width), title: def.name || '', timeZone: timeZone || null, locale: def.locale || null, currency: def.currency || null, warnings, rows, stats };
}

/** The rows at a data set's path in a value held in memory (inline JSON, pushed data). */
function listAt(raw, path) {
  let { rows } = jsonPathRows(raw, path || '$');
  if (rows == null) rows = [];
  return Array.isArray(rows) ? rows : [rows];
}
function* inBatches(list, n = 1000) { for (let i = 0; i < list.length; i += n) yield list.slice(i, i + n); }
