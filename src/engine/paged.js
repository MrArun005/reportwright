// @ts-check
/**
 * A flowing report's pages one window at a time (docs/research/STREAMING-1M.md §6): the table's rows come from the
 * source in order (stream.js planStream: read, typed, filtered, sorted, grouped, a batch at a time), and render() lays
 * out a window of them at once. Of each window's pages all but the last are final: they are handed out, and the rows
 * from the last page on start the next window, which starts where that page started: the table's header (and a group's,
 * where it repeats) at the top, the row numbers, the group it continues and the report's first row carried over
 * (render's pageWindow). Only one window's rows and pages are held, so memory does not grow with the rows.
 *
 * The shape (else { why }, and the caller renders the whole model): one table with row-local expressions and groups
 * (planStream's Excel shape: RowNumber() in the rows; group and table footers with Sum/Count/Avg/Min/Max of a row
 * expression or CountRows()), declared fields, one data set, page bands without aggregates, and body items only above
 * or below the table. Footer totals are folded as the rows pass: a group's reach its footer through a field of its rows
 * (=First(Fields.__g…)), the table's are drawn in the last window. "Page N of M": with M in the page bands, a first
 * pass counts the pages and notes where each starts (the source is read twice; nothing is drawn in it).
 */
import { render, baseContext, resolveParameters, ReportError } from './index.js';
import { planStream } from './stream.js';
import { makeLoader, resolveReuse } from './reuse.js';
import { compile, evaluate, aggregator, FOLDS, isDynamic, streamable, OVER_TIME } from './expr/evaluate.js';
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
  if (opts.firstPages || opts.dataOnly) return no('first pages or table data');
  const sec = def.sections || {};
  const body = Array.isArray(sec.body) ? sec.body[0] : sec.body;
  const items = body.items || [];
  const table = items.find(it => it.type === 'table');
  const groups = table.groups || [];
  if (groups.some(g => g.newSection || g.adjacent)) return no('group sections');
  const page = resolvePage(def.page);
  if (page.pageless || (table.columns || []).reduce((s, c) => s + (Number(c.width) || 0), 0) > page.bodyWidth - table.x + 1) return no('pageless, or wider than the page');
  const tTop = Number(table.y) || 0, tBottom = tTop + (Number(table.h) || 0);
  const others = items.filter(it => it !== table);
  if (others.some(it => !OK_TYPES.has(it.type) || it.items?.length || (it.y + (it.h || 0) > tTop && it.y < tBottom))) return no('items beside the table');
  // page bands and the body's other items: no aggregates (they would see one window's rows)
  const bandItems = [...(sec.pageHeader?.items || []), ...(sec.pageFooter?.items || [])];
  const scan = (v, d = 0) => {
    if (typeof v === 'string') return !isDynamic(v) || streamable(v); // Fields: the report's first row (pageWindow.first)
    if (!v || typeof v !== 'object' || d > 12) return true;
    return Object.values(v).every(x => scan(x, d + 1));
  };
  if (![...bandItems, ...others].every(it => scan(it) && (OK_TYPES.has(it.type)))) return no('page bands');
  // Fields outside the rows read the data set's first row: the window gives it the first row it shows, the same one
  // unless the table filters, sorts or orders its groups
  if ((table.sort?.length || table.filters?.length || groups.some(g => g.sort)) && /Fields\s*[.!]/i.test(JSON.stringify([bandItems, others, table.header || []]))) return no('fields outside the rows of a re-ordered table');
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

  // group footer totals: folded per group as the rows pass, handed to the footer as a field of the group's rows
  const gfolds = groups.map(() => /** @type {any[]} */ ([]));
  const gtable = { ...table, groups: groups.map((g, l) => ({ ...g, footer: (g.footer || []).map(r => ({ ...r, cells: (r.cells || []).map(c => {
    const v = c?.value;
    if (typeof v !== 'string' || !v.startsWith('=')) return c;
    const ast = compile(v.slice(1));
    const fn = ast?.type === 'call' && !ast.obj ? ast.name.toLowerCase() : '';
    if (fn !== 'countrows' && !FOLDS.has(fn)) return c; // row-local: the group's first (or last) row, as before
    const name = `__g${l}_${gfolds[l].length}`;
    gfolds[l].push({ name, fn, ast: ast.args[0] });
    return { ...c, value: `=First(Fields.${name})` };
  }) })) })) };
  const gfields = gfolds.flat().map(f => ({ name: f.name }));

  const size = Math.max(50, Number(opts.window) || WINDOW);
  const strip = (/** @type {any[]} */ fields) => fields.map(({ expr, path, ...f }) => f);
  /** the definition for one window: its rows given, the table alone after the first, the footer and what follows last */
  const windowDef = (/** @type {boolean} */ first, /** @type {boolean} */ last, /** @type {any[]} */ done) => {
    const t = { ...gtable, sort: undefined, filters: undefined };
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
      dataSets: [{ ...ds, source: '__rows', path: '$.rows', fields: [...strip(ds.fields), ...gfields], filters: undefined, sort: undefined }],
      sections: { ...sec, body: { ...body, items: its } },
    };
  };

  const info = { width: page.width, height: page.height, bookmarks: /** @type {any[]} */ ([]), headings: /** @type {any[]} */ ([]), warnings: /** @type {string[]} */ ([]), pages: 0 };
  const L = groups.length;
  const newAcc = (/** @type {any[]} */ fs) => fs.map(f => (f.fn === 'countrows' ? { n: 0 } : { agg: aggregator(f.fn, fctx), err: null }));
  const value = (/** @type {any} */ a) => a.n ?? (a.err ? '#Error' : a.agg.value());
  const addTo = (/** @type {any[]} */ fs, /** @type {any[]} */ acc, r) => {
    fctx.fields = r;
    fs.forEach((f, i) => { const a = acc[i]; if (a.n != null) a.n++; else if (!a.err) { try { a.agg.add(evaluate(f.ast, fctx)); } catch (e) { a.err = e; } } });
  };
  /** the rows in display order, each with its group instances (__i: { first, acc } per level) */
  async function* rowsOf() {
    if (!L) { for await (const r of /** @type {any} */ (plan).records()) yield r; return; }
    for await (const { r, g } of /** @type {any} */ (plan).grouped()) { r.__g = g; yield r; }
  }
  /**
   * May a window start at page p? At a row's first piece whose groups all go on from the row before, or at a group's
   * header whose outer groups go on (the window then draws the headers a page there draws).
   * @param {any} p @param {any[]} win @param {number} base
   */
  const startsAt = (p, win, base) => {
    if (p.firstRow == null || !p.rowHead) return false;
    if (!L) return true;
    const w = p.firstRow - 1 - base;
    if (w < 1) return false;
    const h = p.headLevel ?? L;
    for (let l = 0; l < h; l++) if (win[w].__i[l] !== win[w - 1].__i[l]) return false;
    return true;
  };
  /**
   * One pass over the rows: each final page in order. bounds (from a first pass): where each page starts (the row's
   * index, -1 where no window may start), so each window keeps exactly the pages up to a known break (it lays out one
   * more, which is dropped) and the drawing is checked against the count. starts: filled with where each page starts.
   * @param {number|null} total @param {number[]|null} bounds @param {number[]} [starts]
   */
  async function* pass(total, bounds, starts, o = /** @type {{ run?: (job: any) => Promise<any>, parallel?: number }} */ ({})) {
    const src = rowsOf()[Symbol.asyncIterator]();
    let ahead = /** @type {any} */ (null), ended = false;
    const next = async () => { if (ahead) { const a = ahead; ahead = null; return a; } const r = await src.next(); if (r.done) ended = true; return r; };
    const acc = newAcc(folds);
    /** @type {any[]} */
    const open = new Array(L).fill(null); // the group instance open at each level: { ord, first, acc }
    let win = /** @type {any[]} */ ([]);
    /** close levels l… (innermost first): their totals go to their rows in this window */
    const close = (l) => {
      for (let k = L - 1; k >= l; k--) {
        const o = open[k];
        if (!o) continue;
        const vals = gfolds[k].map((f, i) => [f.name, value(o.acc[i])]);
        for (let j = win.length - 1; j >= 0 && win[j].__i[k] === o; j--) for (const [n, v] of vals) win[j][n] = v;
        open[k] = null;
      }
    };
    /** a row read: its totals folded, its groups opened (and the ones it leaves closed) */
    let seen = 0; // rows taken (the next one's index)
    const take = (r) => {
      addTo(folds, acc, r);
      if (L) {
        let l = 0;
        while (l < L && open[l] && open[l].ord === r.__g[l][0]) l++;
        close(l);
        for (let k = l; k < L; k++) open[k] = { ord: r.__g[k][0], first: r, at: seen, acc: newAcc(gfolds[k]) };
        r.__i = open.slice();
        delete r.__g;
        for (let k = 0; k < L; k++) addTo(gfolds[k], open[k].acc, r);
      }
      seen++;
    };
    const read = async (upTo) => {
      while (win.length < upTo && !ended) { const r = await next(); if (!r.done) { take(r.value); win.push(r.value); } }
      if (ended) close(0);
    };
    // pages per window when the bounds are known: about `size` rows each
    const per = bounds ? Math.max(1, Math.round(bounds.length * size / Math.max(1, /** @type {any} */ (bounds).rows))) : 0;
    // the rows a window lays out past the pages it keeps: two pages of the most rows a page holds
    let reach = 0;
    if (bounds) { let prev = -1; for (const b of bounds) if (b >= 0) { if (prev >= 0) reach = Math.max(reach, b - prev); prev = b; } reach = 2 * reach + 2; }
    let want = size, off = 0, base = 0, first = true, first0 = null, cont = /** @type {any[]} */ ([]), wn = 0;
    if (bounds) {
      // the pages are known: each window is a job (laid out here, or by o.run elsewhere: parallel.js), o.parallel at a
      // time, their pages handed out in order
      const local = async (/** @type {any} */ job) => {
        const m = await render(job.def, { ...opts, exportData: !!(opts.exportData || opts.tagged), sources: { __rows: { rows: job.rows } }, pageWindow: job.pageWindow });
        return { pages: m.pages, count: m.pages.length, nextFirst: m.pages[job.keep]?.firstRow, bookmarks: m.bookmarks, headings: m.headings, warnings: m.warnings };
      };
      const run = o.run || local, at = o.run ? 2 * Math.max(1, Number(o.parallel) || 1) : 1; // two jobs a worker: one waits while one runs
      const queue = /** @type {any[]} */ ([]);
      const handOut = function* (/** @type {any} */ job, /** @type {any} */ r) {
        // the data changed between the passes (a live source): the page count would be wrong, so stop
        if (job.last ? r.count !== job.keep : !(r.count > job.keep && r.nextFirst - 1 === job.expect)) throw Object.assign(new Error('The data changed while the PDF was written (its pages were counted first). Export it again.'), { status: 409 });
        for (const w of r.warnings) if (!info.warnings.includes(w) && info.warnings.length < 200) info.warnings.push(w);
        for (let k = 0; k < job.keep; k++) {
          const p = r.pages[k];
          delete p.firstRow; delete p.rowHead; delete p.headLevel;
          p.win = job.wn; // the window it came from: row ids are a window's own (pdfstreamtags.js)
          yield p;
          r.pages[k] = null;
        }
        const isKept = (b) => b.page <= job.off + job.keep;
        for (const b of r.bookmarks) if (isKept(b)) info.bookmarks.push(b);
        for (const b of r.headings) if (isKept(b)) info.headings.push(b);
      };
      for (;;) {
        let end = -1; // the page this window stops before
        for (let k = Math.min(bounds.length - 1, off + per); k > off && end < 0; k--) if (bounds[k] >= 0) end = k;
        for (let k = off + per + 1; k < bounds.length && end < 0; k++) if (bounds[k] >= 0) end = k;
        // rows past the kept pages (laid out, dropped), so their end is laid out as the whole report lays it out: a
        // footer that keeps with its rows, a lone row moved, a group kept together reach back no further than these
        let e2 = -1;
        for (let k = end + 1; end >= 0 && k < bounds.length && e2 < 0; k++) if (bounds[k] >= 0 && bounds[k] - bounds[end] >= reach) e2 = k;
        // fewer rows than that left: this window is the last (laid out with the footer, as the count was: a footer that
        // keeps with its rows may move the last rows to a page of their own)
        if (e2 < 0) end = -1;
        await read(end < 0 ? Infinity : bounds[e2] - base);
        if (!ended) { const r = await next(); if (r.done) { ended = true; close(0); } else ahead = r; }
        first0 ??= win[0] ?? null;
        const last = end < 0, keep = last ? bounds.length - off : end - off;
        const done = last ? folds.map((f, i) => ({ cell: f.cell, value: value(acc[i]) })) : [];
        const job = { wn: ++wn, keep, last, off, expect: last ? null : bounds[end], rows: win, def: windowDef(first, last, done),
          pageWindow: { offset: off, total, final: last, first: first0, rowOffset: base, cont } };
        const res = run(job);
        res.catch(() => {}); // awaited (and thrown) in its turn
        queue.push({ job, res });
        if (queue.length >= at) { const q = queue.shift(); yield* handOut(q.job, await q.res); }
        off += keep;
        if (last) break;
        const cut = bounds[end] - base;
        cont = [];
        for (let l = 0; l < L; l++) cont.push(win[cut].__i[l] === win[cut - 1].__i[l] && (l === 0 || cont[l - 1]) ? { first: win[cut].__i[l].first, before: base + cut - win[cut].__i[l].at } : null);
        base = bounds[end]; win = win.slice(cut); first = false;
      }
      while (queue.length) { const q = queue.shift(); yield* handOut(q.job, await q.res); }
      info.pages = off;
      return;
    }
    for (;;) {
      await read(want);
      if (!ended) { const r = await next(); if (r.done) { ended = true; close(0); } else ahead = r; } // is there more?
      first0 ??= win[0] ?? null;
      const last = ended;
      const done = last ? folds.map((f, i) => ({ cell: f.cell, value: value(acc[i]) })) : [];
      wn++;
      // tagged: the cell tags an accessible PDF builds its tables from (exportData)
      const model = await render(windowDef(first, last, done), { ...opts, exportData: !!(opts.exportData || opts.tagged), sources: { __rows: { rows: win } },
        pageWindow: { offset: off, total, final: last, first: first0, rowOffset: base, cont } });
      for (const w of model.warnings) if (!info.warnings.includes(w) && info.warnings.length < 200) info.warnings.push(w);
      const pg = model.pages;
      let keep = pg.length;
      if (!last) {
        keep = 0;
        // the last two pages are laid out again by the next window: the window's end (cut rows, the footers of groups it
        // cuts short) reaches back one page at most
        let most = 0, prev = -1; // the most rows a page of this window holds
        for (const p of pg) if (p.firstRow != null) { if (prev >= 0) most = Math.max(most, p.firstRow - prev); prev = p.firstRow; }
        most = Math.max(most, base + win.length + 1 - prev);
        for (let k = pg.length - 2; k >= 1; k--) if (startsAt(pg[k], win, base) && base + win.length - (pg[k].firstRow - 1) >= 2 * most + 2) { keep = k; break; }
        if (!keep) { want = win.length * 2; continue; } // no page to start the next window at yet: a bigger window
      }
      for (let k = 0; k < keep; k++) {
        const p = pg[k];
        starts?.push(startsAt(p, win, base) ? p.firstRow - 1 : -1);
        delete p.firstRow; delete p.rowHead; delete p.headLevel;
        p.win = wn; // the window it came from: row ids are a window's own (pdfstreamtags.js)
        yield p;
        pg[k] = null;
      }
      const isKept = (b) => b.page <= off + keep;
      if (!starts) { for (const b of model.bookmarks) if (isKept(b)) info.bookmarks.push(b); for (const b of model.headings) if (isKept(b)) info.headings.push(b); }
      off += keep;
      if (last) { if (starts) /** @type {any} */ (starts).rows = base + win.length; break; }
      const cut = pg[keep].firstRow - 1 - base;
      // the groups the next window's first row goes on with (from the row before it), at each level
      cont = [];
      for (let l = 0; l < L; l++) cont.push(win[cut].__i[l] === win[cut - 1].__i[l] && (l === 0 || cont[l - 1]) ? { first: win[cut].__i[l].first, before: base + cut - win[cut].__i[l].at } : null);
      base += cut; win = win.slice(cut);
      want = size; first = false;
    }
    info.pages = off;
  }
  /** the time limit as render() reports it (504), also where an expression of the rows' order or filter met it */
  const limit = (/** @type {any} */ e) => (e?.message === OVER_TIME ? new ReportError(`The report ran longer than ${Math.round(Number(opts.timeoutMs) / 100) / 10} s, the time limit on this server.`, { status: 504, timeout: true }) : e);
  return {
    info,
    /**
     * The final pages in order. o.run: lays out (and may paint) a window elsewhere, o.parallel at a time (parallel.js);
     * it needs the pages counted first, so a report without "of M" gets the counting pass too.
     * @param {{ run?: (job: any) => Promise<any>, parallel?: number }} [o]
     */
    async *pages(o = {}) {
      try {
        if (opts.deadline && Date.now() > opts.deadline) throw new Error(OVER_TIME);
        if (!totals && !o.run) { yield* pass(null, null); return; }
        // "of M": a first pass counts the pages and notes where each starts (nothing is drawn); the second lays out
        // exactly those pages, window by window
        const starts = /** @type {number[]} */ ([]);
        for await (const p of pass(null, null, starts)) void p;
        yield* pass(totals ? starts.length : null, starts, undefined, o);
      } catch (e) { throw limit(e); }
    },
  };
}
