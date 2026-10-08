// @ts-check
/**
 * A flowing report's pages one window at a time (docs/research/STREAMING-1M.md §6): the table's rows come from the
 * source in order (stream.js planStream: read, typed, filtered, sorted, a batch at a time), and render() lays out a
 * window of them at once. Of each window's pages all but the last are final: they are handed out, and the rows from
 * the last page on start the next window. The table's header repeats at the top of a continued page, so a window that
 * starts there lays out the same page. Only one window's rows and pages are held, so memory does not grow with the rows.
 *
 * The shape (else { why }, and the caller renders the whole model): one table with row-local expressions (planStream's
 * Excel shape), no groups, no RowNumber in its rows, declared fields, one data set, page bands and the table header
 * without Fields or aggregates, and body items only above or below the table. Footer totals (Sum/Count/Avg/Min/Max of
 * a row expression, CountRows()) are folded as the rows pass and drawn in the last window. "Page N of M": with M in
 * the page bands, a first pass counts the pages (the source is read twice).
 */
import { render, baseContext, resolveParameters } from './index.js';
import { planStream } from './stream.js';
import { makeLoader, resolveReuse } from './reuse.js';
import { compile, evaluate, aggregator, FOLDS, isDynamic, streamable } from './expr/evaluate.js';
import { resolvePage } from './units.js';

const WINDOW = 1000; // rows laid out at once (a window grows when its rows do not fill two pages)
const OK_TYPES = new Set(['textbox', 'line', 'shape']);

/**
 * @param {any} def0 @param {any} opts render() options, and maxRows/sorter/sqlRows as planStream takes them;
 *   window: rows per window (tests)
 * @returns {Promise<{ why: string } | { why?: undefined, pages: () => AsyncGenerator<any>, info: { width: number, height: number, bookmarks: any[], headings: any[], warnings: string[], pages: number } }>}
 */
export async function planPaged(def0, opts = {}) {
  const no = (why) => ({ why });
  if (!def0 || typeof def0 !== 'object' || Array.isArray(def0)) return no('not a definition');
  const { def, parts } = await resolveReuse(def0, makeLoader(opts.loadReport, new Map()), () => {}, opts.reportId ? [opts.reportId] : [], { items: 0 });
  if (parts) return no('report parts');
  const plan = await planStream(def, { ...opts, format: 'xlsx' });
  if (plan.why !== undefined) return no(plan.why);
  if ((def.dataSets || []).length !== 1) return no('more than one data set');
  const ds = def.dataSets[0];
  if (!ds.fields?.length) return no('undeclared fields');
  if (opts.firstPages || opts.exportData || opts.dataOnly) return no('first pages or table data');
  const sec = def.sections || {};
  const body = Array.isArray(sec.body) ? sec.body[0] : sec.body;
  const items = body.items || [];
  const table = items.find(it => it.type === 'table');
  if (table.groups?.length) return no('groups');
  if (/RowNumber\s*\(/i.test(JSON.stringify(table.detail || []))) return no('RowNumber in the rows');
  if (Number(table.pageBreakEvery) > 0 || table.printAtBottom) return no('table paging options');
  if (/Fields\s*[.!]/i.test(JSON.stringify(table.header || []))) return no('fields in the table header');
  const page = resolvePage(def.page);
  if (page.pageless || (table.columns || []).reduce((s, c) => s + (Number(c.width) || 0), 0) > page.bodyWidth - table.x + 1) return no('pageless, or wider than the page');
  const tTop = Number(table.y) || 0, tBottom = tTop + (Number(table.h) || 0);
  const others = items.filter(it => it !== table);
  if (others.some(it => !OK_TYPES.has(it.type) || it.items?.length || (it.y + (it.h || 0) > tTop && it.y < tBottom))) return no('items beside the table');
  // page bands and the body's other items: no aggregates or fields (they would see one window's rows)
  const bandItems = [...(sec.pageHeader?.items || []), ...(sec.pageFooter?.items || [])];
  const scan = (v, d = 0) => {
    if (typeof v === 'string') return !isDynamic(v) || (streamable(v) && !/Fields\s*[.!]/i.test(v));
    if (!v || typeof v !== 'object' || d > 12) return true;
    return Object.values(v).every(x => scan(x, d + 1));
  };
  if (![...bandItems, ...others].every(it => scan(it) && (OK_TYPES.has(it.type)))) return no('page bands');
  if (/"(borderRadius|radius|image|backgroundImage)"/.test(JSON.stringify([bandItems, others, table]))) return no('rounded or picture styles');
  const totals = /TotalPages/.test(JSON.stringify(bandItems));

  // footer totals, folded over every row: the last window draws these values
  const params = resolveParameters(def, opts.parameters || {}, /** @type {any} */ ({ now: opts.now, timeZone: def.timeZone || opts.timeZone, locale: def.locale }));
  const fctx = /** @type {any} */ (baseContext(def, { params, now: opts.now || new Date(), timeZone: def.timeZone || opts.timeZone, fnCount: { n: 0 }, clock: null }));
  const folds = [];
  for (const row of table.footer || []) for (const cell of row.cells || []) {
    const v = cell?.value;
    if (typeof v !== 'string' || !v.startsWith('=')) continue;
    const ast = compile(v.slice(1));
    const fn = ast?.type === 'call' && !ast.obj ? ast.name.toLowerCase() : '';
    if (fn === 'countrows' || FOLDS.has(fn)) folds.push({ cell, fn, ast: ast.args[0] });
    else return no('footer expressions');
  }

  const size = Math.max(50, Number(opts.window) || WINDOW);
  const strip = (/** @type {any[]} */ fields) => fields.map(({ expr, path, ...f }) => f);
  /** the definition for one window: its rows given, the table alone after the first, the footer and what follows last */
  const windowDef = (/** @type {boolean} */ first, /** @type {boolean} */ last, /** @type {any[]} */ done) => {
    const t = { ...table, sort: undefined, filters: undefined };
    if (!last) delete t.footer;
    else if (folds.length) t.footer = table.footer.map(r => ({ ...r, cells: (r.cells || []).map(c => { const f = done.find(x => x.cell === c); return f ? { ...c, value: f.value } : c; }) }));
    let its;
    if (first) its = items.filter(it => it === table || it.y < tTop || last).map(it => (it === table ? t : it));
    else {
      t.y = 0; delete t.bookmark;
      if (table.repeatHeader === false) delete t.header;
      its = [t, ...(last ? others.filter(it => it.y >= tBottom).map(it => ({ ...it, y: it.y - tTop })) : [])];
    }
    return {
      ...def,
      dataSources: [{ name: '__rows', type: 'json', data: { rows: [] } }],
      dataSets: [{ ...ds, source: '__rows', path: '$.rows', fields: strip(ds.fields), filters: undefined, sort: undefined }],
      sections: { ...sec, body: { ...body, items: its } },
    };
  };

  const info = { width: page.width, height: page.height, bookmarks: /** @type {any[]} */ ([]), headings: /** @type {any[]} */ ([]), warnings: /** @type {string[]} */ ([]), pages: 0 };
  /**
   * One pass over the rows: each final page in order. bounds (from a first pass): where each page starts (the row's
   * index, -1 for a page that starts inside a row), so the windows end on page breaks and nothing is laid out twice;
   * without it a window lays out a page more than it keeps, and the next window starts with that page's rows. starts:
   * filled with where each page starts, for a later pass.
   * @param {number|null} total @param {number[]|null} bounds @param {number[]} [starts]
   */
  async function* pass(total, bounds, starts) {
    const src = /** @type {any} */ (plan).records()[Symbol.asyncIterator]();
    let ahead = /** @type {any} */ (null), ended = false;
    const next = async () => { if (ahead) { const a = ahead; ahead = null; return a; } const r = await src.next(); if (r.done) ended = true; return r; };
    const acc = folds.map(f => (f.fn === 'countrows' ? { n: 0 } : { agg: aggregator(f.fn, fctx), err: null }));
    const fold = (r) => {
      fctx.fields = r;
      folds.forEach((f, i) => { const a = acc[i]; if (a.n != null) a.n++; else if (!a.err) { try { a.agg.add(evaluate(f.ast, fctx)); } catch (e) { a.err = e; } } });
    };
    const read = async (win, upTo) => { while (win.length < upTo && !ended) { const r = await next(); if (!r.done) { win.push(r.value); fold(r.value); } } };
    // pages per window when the bounds are known: about `size` rows each
    const per = bounds ? Math.max(1, Math.round(bounds.length * size / Math.max(1, bounds.rows))) : 0;
    let carry = /** @type {any[]} */ ([]), want = size, off = 0, base = 0, first = true;
    for (;;) {
      const win = carry;
      let end = -1; // bounds: the page this window stops before (a page that starts on a row of its own)
      if (bounds) {
        for (let k = Math.min(bounds.length - 1, off + per); k > off && end < 0; k--) if (bounds[k] >= 0) end = k;
        for (let k = off + per + 1; k < bounds.length && end < 0; k++) if (bounds[k] >= 0) end = k;
        await read(win, end < 0 ? Infinity : bounds[end] - base);
      } else await read(win, want);
      if (!ended && !(bounds && end >= 0)) { const r = await next(); if (r.done) ended = true; else ahead = r; } // is there more?
      const last = bounds ? end < 0 : ended;
      if (bounds && last && !ended) await read(win, Infinity);
      const done = last ? folds.map((f, i) => ({ cell: f.cell, value: acc[i].n ?? (acc[i].err ? '#Error' : acc[i].agg.value()) })) : [];
      const model = await render(windowDef(first, last, done), { ...opts, sources: { __rows: { rows: win } }, pageWindow: { offset: off, total, final: last } });
      for (const w of model.warnings) if (!info.warnings.includes(w) && info.warnings.length < 200) info.warnings.push(w);
      const pg = model.pages;
      let keep = pg.length;
      if (bounds) {
        // the data changed between the passes (a live source): the page count would be wrong, so stop
        if (keep !== (last ? bounds.length : end) - off) throw Object.assign(new Error('The data changed while the PDF was written (its pages were counted first). Export it again.'), { status: 409 });
      } else if (!last) {
        keep = 0;
        for (let k = pg.length - 1; k >= 1; k--) if (pg[k].firstRow != null && pg[k].rowHead) { keep = k; break; }
        if (!keep) { want = win.length * 2; carry = win; continue; } // the rows fill less than two pages: a bigger window
      }
      for (let k = 0; k < keep; k++) {
        const p = pg[k];
        starts?.push(p.firstRow != null && p.rowHead ? base + p.firstRow - 1 : -1);
        delete p.firstRow; delete p.rowHead;
        yield p;
        pg[k] = null;
      }
      const isKept = (b) => b.page <= off + keep;
      if (!starts) { for (const b of model.bookmarks) if (isKept(b)) info.bookmarks.push(b); for (const b of model.headings) if (isKept(b)) info.headings.push(b); }
      off += keep;
      if (last) { if (starts) /** @type {any} */ (starts).rows = base + win.length; break; }
      if (bounds) { base = bounds[end]; carry = []; }
      else { const cut = pg[keep].firstRow - 1; base += cut; carry = win.slice(cut); }
      want = size; first = false;
    }
    info.pages = off;
  }
  return {
    info,
    async *pages() {
      if (!totals) { yield* pass(null, null); return; }
      // "of M": a first pass counts the pages and notes where each starts (nothing is drawn); the second lays out
      // exactly those pages, window by window
      const starts = /** @type {number[]} */ ([]);
      for await (const p of pass(null, null, starts)) void p;
      yield* pass(starts.length, starts);
    },
  };
}
