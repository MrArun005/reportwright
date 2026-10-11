// @ts-check
/**
 * The structure tree of a streamed, tagged PDF (PDF/UA-1, and PDF/A-2a with it): pdfua.js's tree for the shapes that
 * stream (engine/paged.js), written as the pages are. Document > P / H1–H6 (text boxes), Table > TR > TH/TD (the table's
 * header rows TH with Scope Column the first time, an artifact where they repeat; empty cells as empty TD; spans as
 * ColSpan), Link > OBJR inside the element whose text it covers; page header and footer, borders and boxes artifacts.
 * Each page's rows (TR, TD), its parent-tree array and its links' elements are written when the page ends; what stays
 * is one number per row (the Table's kids) and two per page and link (the parent tree), written at the end.
 * A cell's element is a few dozen bytes in an object stream (no /Type, which is optional; /A << /O /Table >> as pdfua.js): a
 * million-row table has some 8 million of them, the most of the file's objects.
 */
import { figures, altOf, cellVisuals } from './figures.js';
import { visualLines } from './regions.js';

const MARKER = /^\s*(?:[•◦▪▫‣·○●■□–—-]|\d{1,4}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,6}[.)])\s*$/;

/**
 * @param {any} w the PDF writer (pdfstream.js createPdfStream)
 * @param {{ maxElements?: number }} [o] maxElements: past it the export stops (413)
 */
export function createStreamTagger(w, { maxElements = Infinity } = {}) {
  let count = 0; // structure elements made
  const made = () => {
    if (++count > maxElements) throw Object.assign(new Error(`The tagged PDF has more than ${maxElements.toLocaleString('en-US')} structure elements (tagged.maxElements). Filter the data, or export it untagged.`), { status: 413 });
  };
  const rootRef = w.reserve(), docRef = w.reserve();
  /** Document's kids: elements in reading order ({ ref }) */
  const docKids = [];
  let table = /** @type {null | { ref: number, cols: number, rows: Int32Array, n: number }} */ (null);
  let headerDone = false;
  /** the parent tree: key → array or element (numbers) */
  let nums = new Int32Array(1024), nn = 0, key = 0;
  const num = (k, ref) => { if (nn + 2 > nums.length) { const b = new Int32Array(nums.length * 2); b.set(nums); nums = b; } nums[nn++] = k; nums[nn++] = ref; };
  const addRow = (ref) => { const t = /** @type {any} */ (table); if (t.n === t.rows.length) { const b = new Int32Array(t.n * 2); b.set(t.rows); t.rows = b; } t.rows[t.n++] = ref; };

  // the page being drawn
  let mcids = /** @type {number[]} */ ([]); // MCID → element ref
  let rows = new Map(); // row key → { ref, kind, cells: Map(col → cell) }
  let els = /** @type {any[]} */ ([]); // elements of this page to write: { ref, S, parent, mcid: [], kids: [], attrs }
  let last = /** @type {any} */ (null); // the last text's element and box (links go into it)
  let links = false, win = 0;

  const el = (S, parent, attrs) => { made(); const e = { ref: w.reserve(), S, parent, mcid: /** @type {number[]} */ ([]), kids: /** @type {any[]} */ ([]), attrs }; els.push(e); return e; };
  const mark = (e) => { const m = mcids.length; mcids.push(e.ref); e.mcid.push(m); return `/${e.S} <</MCID ${m}>> BDC\n`; };

  return {
    /** structure elements so far */
    get count() { return count; },
    /** elements of the page being drawn, held until it ends */
    get held() { return els.length + rows.size + mcids.length; },
    /** a new page (window: the paged window it came from; row ids are its own) @param {number} window */
    page(window) { mcids = []; rows = new Map(); els = []; last = null; links = false; win = window; },
    /**
     * The marked content that opens item it: a structure element's MCID, or an artifact; null for a link.
     * @param {any} it
     */
    open(it) {
      if (it.t === 'link' || it.t === 'bookmark') return null;
      if (it.art) return '/Artifact <</Type /Pagination>> BDC\n';
      if (it.t !== 'text' || !it.lines?.some(l => String(l.text).trim())) return '/Artifact BMC\n';
      const c = it.cell;
      if (!c) {
        const h = it.tag?.h ? Math.min(6, Math.max(1, it.tag.h)) : 0;
        const e = el(h ? `H${h}` : 'P', docRef);
        docKids.push(e.ref);
        last = { e, it };
        return mark(e);
      }
      if (c.kind === 'header' && headerDone) return '/Artifact <</Type /Pagination>> BDC\n'; // the header again on a later page
      if (!table) { table = { ref: w.reserve(), cols: c.cols.length, rows: new Int32Array(4096), n: 0 }; docKids.push(table.ref); }
      const rk = `${win}:${c.row}`;
      let r = rows.get(rk);
      if (!r) { made(); r = { ref: w.reserve(), kind: c.kind, cells: new Map() }; rows.set(rk, r); addRow(r.ref); }
      let cell = r.cells.get(c.col);
      if (!cell) {
        // every cell has /A << /O /Table >>, as pdfua.js writes it (the parity gate compares the structure tree exactly)
        const attrs = { O: '/Table', ...(c.kind === 'header' ? { Scope: '/Column' } : {}), ...(c.span > 1 ? { ColSpan: c.span } : {}) };
        cell = el(c.kind === 'header' ? 'TH' : 'TD', r.ref, attrs);
        r.cells.set(c.col, cell);
      }
      last = { e: cell, it };
      return mark(cell);
    },
    /**
     * A link annotation of the page: its Link element (in the element of the text it covers, else the Document).
     * @returns {number} the annotation's StructParent
     * @param {any} it @param {number} annot the annotation's object number
     */
    link(it, annot) {
      const near = last && overlaps(last.it, it) ? last.e : null;
      const e = el('Link', near ? near.ref : docRef);
      e.kids.push(`<< /Type /OBJR /Obj ${annot} 0 R >>`);
      (near ? near.kids : docKids).push(near ? `${e.ref} 0 R` : e.ref);
      links = true;
      num(key, e.ref);
      return key++;
    },
    /**
     * The page is drawn: its elements and parent-tree array are written. @returns {Promise<string>} the page's entries
     * @param {number} pageRef
     */
    async end(pageRef) {
      // rows in column order, an empty cell where a row has none (a regular table for screen readers)
      for (const r of rows.values()) {
        const kids = [];
        for (let col = 0; col < /** @type {any} */ (table).cols;) {
          let cell = r.cells.get(col);
          if (!cell) { cell = el(r.kind === 'header' ? 'TH' : 'TD', r.ref, r.kind === 'header' ? { O: '/Table', Scope: '/Column' } : { O: '/Table' }); }
          kids.push(cell.ref);
          col += Math.max(1, cell.attrs?.ColSpan || 1);
        }
        for (const [col, cell] of r.cells) if (!kids.includes(cell.ref)) { void col; kids.push(cell.ref); }
        await w.objectAt(r.ref, `<< /S /TR /P ${/** @type {any} */ (table).ref} 0 R /K [${kids.map(k => `${k} 0 R`).join(' ')}] >>`);
      }
      if (rows.size && [...rows.values()].some(r => r.kind === 'header')) headerDone = true;
      for (const e of els) {
        const K = [...e.mcid.map(String), ...e.kids].join(' ');
        const A = e.attrs ? ` /A << ${Object.entries(e.attrs).map(([k, v]) => `/${k} ${v}`).join(' ')} >>` : '';
        const P = e.parent === docRef ? docRef : e.parent;
        await w.objectAt(e.ref, `<< /S /${e.S} /P ${P} 0 R${e.mcid.length || e.S === 'Link' ? ` /Pg ${pageRef} 0 R` : ''} /K [${K}]${A} >>`);
      }
      let extra = '';
      if (mcids.length) {
        const arr = await w.object(`[${mcids.map(r => `${r} 0 R`).join(' ')}]`);
        num(key, arr);
        extra += ` /StructParents ${key++}`;
      }
      if (links) extra += ' /Tabs /S';
      mcids = []; rows = new Map(); els = []; last = null; // nothing of the page stays (N44)
      return extra;
    },
    /**
     * The tree's top: Table, Document, the parent tree, the root. @returns {Promise<string>} the catalog's entries
     * @param {{ lang?: string }} o
     */
    async finish({ lang = 'en' } = {}) {
      const t = table;
      if (t) await w.bigObject(t.ref, `<< /Type /StructElem /S /Table /P ${docRef} 0 R /K [`, refs(t.rows, t.n), '] >>');
      await w.objectAt(docRef, `<< /Type /StructElem /S /Document /P ${rootRef} 0 R /K [${docKids.map(k => (typeof k === 'string' ? k : `${k} 0 R`)).join(' ')}] >>`);
      const pt = w.reserve();
      await w.bigObject(pt, '<< /Nums [', pairs(nums, nn), '] >>');
      await w.objectAt(rootRef, `<< /Type /StructTreeRoot /K ${docRef} 0 R /ParentTree ${pt} 0 R /ParentTreeNextKey ${key} >>`);
      return ` /StructTreeRoot ${rootRef} 0 R /MarkInfo << /Marked true >> /Lang (${String(lang).replace(/[^A-Za-z0-9-]/g, '') || 'en'}) /ViewerPreferences << /DisplayDocTitle true >>`;
    },
  };
}

/** "n 0 R" for each number, a few thousand at a time @param {Int32Array} a @param {number} n */
function* refs(a, n) { for (let i = 0; i < n; i += 4096) { let s = ''; for (let j = i; j < Math.min(n, i + 4096); j++) s += `${a[j]} 0 R `; yield s; } }
/** the parent tree's key, value pairs @param {Int32Array} a @param {number} n */
function* pairs(a, n) { for (let i = 0; i < n; i += 4096) { let s = ''; for (let j = i; j < Math.min(n, i + 4096); j += 2) s += `${a[j]} ${a[j + 1]} 0 R `; yield s; } }


// ---- the whole model's tree (pdfua.js's, ported for writePagedPdf; pdfua.js's pdf-lib tagger uses it too) ----

/** A structure element. */
export function node(S, extra = {}) { return /** @type {any} */ ({ S, kids: [], ...extra }); }

/**
 * What each item of a page is: Map(item index → { el } | { art } ), and for links the element they sit in ({ near }).
 * Elements are added to the tree in reading order as they are first met.
 */
export function plan(model, pg, pi, root) {
  const items = pg.items;
  /** @type {Map<number, any>} */
  const out = new Map();
  const H = pg.height ?? model.height;
  // figures: one Figure per tagged chart, picture, map, barcode or visual; a shape or line without alt is decoration
  const figAt = new Map();
  for (const f of figures(items)) {
    const deco = (f.tag.k === 'shape' || f.tag.k === 'line') && !f.tag.alt;
    for (let k = f.at; k <= f.last; k++) figAt.set(k, deco ? 'deco' : f);
  }
  // headings from bookmarks: the text item at the bookmark's place that starts with its label
  const marks = (model.bookmarks || []).filter(b => b.page === pi + 1);
  const headingOf = (it) => {
    if (it.tag?.h) return Math.min(6, Math.max(1, it.tag.h));
    if (!marks.length || !it.clip) return 0;
    const txt = visualLines(it).join(' ').trim();
    const b = marks.find(m => Math.abs(m.y - it.clip.y) < 1 && txt && String(m.label).trim().startsWith(txt.slice(0, 40)));
    return b ? Math.min(6, (Number(b.level) || 0) + 1) : 0;
  };
  // tables: one Table across pages (the state lives on the root), rows by row id, cells by column
  const tables = (root.tables ||= new Map());
  const rich = new Map();
  let list = null, listId = null;
  const figEls = new Map();
  // in-cell visuals (sparklines, data bars, icons): a Figure in their cell
  const cellsByTable = new Map();
  for (const it of items) if (it.t === 'text' && it.cell && !it.art) (cellsByTable.get(it.cell.table) || cellsByTable.set(it.cell.table, { cells: [] }).get(it.cell.table)).cells.push(it);
  const visAt = new Map();
  const taken = new Set([...figAt.keys()]);
  const index = new Map(items.map((it, i) => [it, i]));
  for (const [tkey, m] of cellVisuals(items, taken, cellsByTable)) {
    const proto = cellsByTable.get(tkey).cells[0].cell;
    for (const [rc, v] of m) {
      const [row, col] = rc.split('|');
      const rowCell = cellsByTable.get(tkey).cells.find(c => String(c.cell.row) === row)?.cell;
      const vis = { cell: { ...proto, row: rowCell ? rowCell.row : row, col: Number(col), kind: rowCell?.kind || 'detail', span: 1, rowSpan: 1 } };
      for (const it of v.items) visAt.set(index.get(it), { vis, box: v.box, kind: v.items.some(x => x.t === 'path') ? 'sparkline' : 'databar' });
    }
  }
  const add = (el) => { root.kids.push(el); el.parent = root; return el; };
  let lastText = null;
  // a table of contents: TOC > TOCI > Reference > Link, one per entry; the entry's text, its number and its link annotation
  // are all inside that Link. A TOC runs on across pages; a new one starts when entry numbers start over.
  const tocLink = (e) => {
    const toc = (root.toc ||= { el: null, last: -1, entries: new Map() });
    if (!toc.el || e < toc.last) { toc.el = add(node('TOC')); toc.entries = new Map(); }
    toc.last = Math.max(toc.last, e);
    let link = toc.entries.get(e);
    if (!link) {
      const toci = node('TOCI'), ref = node('Reference'); link = node('Link');
      toci.parent = toc.el; toc.el.kids.push(toci);
      ref.parent = toci; toci.kids.push(ref);
      link.parent = ref; ref.kids.push(link);
      toc.entries.set(e, link);
    }
    return link;
  };
  items.forEach((it, i) => {
    if (it.t === 'bookmark') return;
    if (it.tocEntry != null && (it.t === 'text' || it.t === 'link') && !it.art) {
      const link = tocLink(it.tocEntry);
      out.set(i, it.t === 'link' ? { link } : { el: link });
      return;
    }
    if (it.tocTitle && it.t === 'text' && it.lines?.length) { out.set(i, { el: add(node('H1')) }); return; }
    if (it.t === 'link' || it.t === 'field') { out.set(i, { near: lastText && overlaps(lastText.it, it) ? lastText.el : null }); return; }
    const f = figAt.get(i);
    if (f === 'deco') { out.set(i, { art: 'Layout' }); return; }
    if (it.art) { out.set(i, { art: 'Pagination' }); return; }
    const vis = visAt.get(i);
    if (vis) {
      let el = figEls.get(vis.vis);
      if (!el) {
        const td = cellEl(tables, root, vis.vis, add);
        if (td.art) { out.set(i, { art: 'Layout' }); return; }
        const b = vis.box;
        el = node('Figure', { alt: 'Chart in a table cell', attrs: { O: 'Layout', BBox: [r2(b.x), r2(H - b.y - b.h), r2(b.x + b.w), r2(H - b.y)] } });
        el.parent = td; td.kids.push(el);
        figEls.set(vis.vis, el);
      }
      out.set(i, { el });
      return;
    }
    if (f) {
      let el = figEls.get(f);
      if (!el) {
        const b = f.box;
        el = add(node('Figure', { alt: altOf(f.tag), attrs: { O: 'Layout', BBox: [r2(b.x), r2(H - b.y - b.h), r2(b.x + b.w), r2(H - b.y)] } }));
        figEls.set(f, el);
      }
      out.set(i, { el });
      return;
    }
    if (it.t !== 'text' || !it.lines?.length || !visualLines(it).join('').trim()) { out.set(i, { art: 'Layout' }); return; }
    let el;
    if (it.cell) el = cellEl(tables, root, it, add);
    else if (it.rich) {
      const key = `${it.rich.id}\u0001${it.rich.p}`;
      el = rich.get(key);
      if (!el) {
        const marker = MARKER.test(it.lines[0].text);
        if (marker) {
          if (listId !== it.rich.id || !list) { list = add(node('L')); listId = it.rich.id; }
          const li = node('LI');
          li.parent = list; list.kids.push(li);
          const lbl = node('Lbl'); lbl.parent = li; li.kids.push(lbl);
          const body = node('LBody'); body.parent = li; li.kids.push(body);
          rich.set(key, body);
          out.set(i, { el: lbl });
          lastText = { it, el: body };
          return;
        }
        list = null;
        const h = headingOf(it);
        el = add(node(h ? `H${h}` : 'P'));
        rich.set(key, el);
      }
    } else {
      const h = headingOf(it);
      el = add(node(h ? `H${h}` : 'P'));
    }
    if (el.art) { out.set(i, { art: 'Pagination' }); return; }
    out.set(i, { el });
    lastText = { it, el };
  });
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
/** a link over a text's box */
function overlaps(t, l) {
  const c = t.clip || { x: t.lines[0].x, y: t.lines[0].y - t.size, w: t.lines[0].w || 0, h: t.size * 1.3 };
  return l.x < c.x + c.w && c.x < l.x + l.w && l.y < c.y + c.h && c.y < l.y + l.h;
}

/**
 * The TH or TD element of a table cell's text. One Table per table name, continued on the next page; a header row
 * seen before (repeated at the top of a page) is an artifact.
 */
function cellEl(tables, root, it, add) {
  const c = it.cell;
  let t = tables.get(c.table);
  if (!t || t.closed) {
    t = { el: add(node('Table')), rows: new Map(), cols: c.cols.length };
    tables.set(c.table, t);
    // another table started: earlier tables are done (a table repeated in a list starts again)
    for (const [k, o] of tables) if (k !== c.table) o.closed = true;
  }
  let r = t.rows.get(c.row);
  if (!r) {
    r = { el: node('TR'), cells: new Map(), kind: c.kind };
    r.el.parent = t.el; t.el.kids.push(r.el);
    t.rows.set(c.row, r);
  } else if (c.kind === 'header' && r.done) return { art: true };
  let cell = r.cells.get(c.col);
  if (!cell) {
    const attrs = { O: 'Table' };
    if (c.kind === 'header') attrs.Scope = 'Column';
    if (c.span > 1) attrs.ColSpan = c.span;
    if (c.rowSpan > 1) attrs.RowSpan = c.rowSpan;
    cell = node(c.kind === 'header' ? 'TH' : 'TD', { attrs });
    cell.parent = r.el; r.el.kids.push(cell);
    r.cells.set(c.col, cell);
  }
  r.pageSeen = true;
  return cell;
}

/** Mark header rows met so far as done: a later page repeating them makes artifacts. Call at a page's end. */
export function endPage(root) {
  for (const t of root.tables?.values() || []) for (const r of t.rows.values()) if (r.kind === 'header') r.done = true;
}

/**
 * A regular table for screen readers: each row's cells in column order, and an empty TD where a row has no cell
 * (an empty cell draws no text, so the page model has nothing for it); cells merged across or down count as covered.
 */
export function regular(t) {
  const down = new Map(); // col → rows still covered by a cell above
  for (const r of t.rows.values()) {
    const kids = [];
    for (let c = 0; c < t.cols;) {
      const left = down.get(c);
      if (left) { if (left.n <= 1) down.delete(c); else left.n--; c += left.span; continue; }
      let cell = r.cells.get(c);
      if (!cell) { cell = node(r.kind === 'header' ? 'TH' : 'TD', { attrs: r.kind === 'header' ? { O: 'Table', Scope: 'Column' } : undefined }); cell.parent = r.el; }
      const span = Math.max(1, cell.attrs?.ColSpan || 1), rs = Math.max(1, cell.attrs?.RowSpan || 1);
      if (rs > 1) down.set(c, { n: rs - 1, span });
      kids.push(cell);
      c += span;
    }
    // a cell the grid could not place (under a merged cell, past the last column) is kept, after the others
    const placed = new Set(kids);
    const rest = [...r.cells.entries()].sort((x, y) => x[0] - y[0]).map(e => e[1]).filter(k => !placed.has(k));
    r.el.kids = [...kids, ...rest, ...r.el.kids.filter(k => !k.S || (k.S !== 'TD' && k.S !== 'TH'))];
  }
}

const hexText = (s) => `<FEFF${[...String(s)].map(ch => { const c = /** @type {number} */ (ch.codePointAt(0)); return c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c]; }).flat().map(u => u.toString(16).toUpperCase().padStart(4, '0')).join('')}>`;
/** an attribute value as pdf-lib's ctx.obj writes it: a string a name, numbers and arrays as they are @param {any} v @returns {string} */
const attr = (v) => (Array.isArray(v) ? `[${v.map(attr).join(' ')}]` : typeof v === 'string' ? `/${v}` : String(v));

/**
 * The structure tree of a whole page model (exportPdf through writePagedPdf, B4): pdfua.js's tree element for element
 * (plan: figures with Alt, artifacts for shapes and rules, tables, lists, TOC, Link and Form), written with the stream
 * writer. The same parent-tree keys as pdfua.js's: pages with marked content first, then form fields in drawing order,
 * then links in page order (pdf-lib's path adds its links after the pages); its Link elements join the tree in that
 * order too, at the end.
 * @param {any} w the PDF writer @param {any} model
 */
export function createModelTagger(w, model) {
  const root = node('Document');
  const plans = model.pages.map((/** @type {any} */ pg, /** @type {number} */ pi) => { const p = plan(model, pg, pi, root); endPage(root); return p; });
  const marked = (/** @type {any} */ it, /** @type {number} */ pi, /** @type {number} */ ii) => it.t !== 'link' && it.t !== 'field' && it.t !== 'bookmark' && !!plans[pi].get(ii)?.el;
  let P = 0;
  const pageKey = model.pages.map((/** @type {any} */ pg, /** @type {number} */ pi) => (pg.items.some((/** @type {any} */ it, /** @type {number} */ ii) => marked(it, pi, ii)) ? P++ : -1));
  const F = model.pages.reduce((/** @type {number} */ n, /** @type {any} */ pg) => n + pg.items.filter((/** @type {any} */ i) => i.t === 'field').length, 0);
  let nf = 0, nl = 0, pi = -1, annotsHere = false;
  /** per page: MCID → node */
  const mcids = model.pages.map(() => /** @type {any[]} */ ([]));
  /** links, added to the tree at the end: { ref, pi, ii } */
  const links = [];
  /** the parent tree's annotation entries, in key order: { key, el } */
  const annots = [];
  return {
    get count() { return 0; },
    page() { pi++; annotsHere = false; },
    /** @param {any} it @param {number} ii */
    open(it, ii) {
      if (it.t === 'link' || it.t === 'field' || it.t === 'bookmark') return null;
      const p = plans[pi].get(ii);
      if (!p?.el) return p?.art === 'Pagination' ? '/Artifact <</Type /Pagination>> BDC\n' : '/Artifact BMC\n';
      const mcid = mcids[pi].length;
      mcids[pi].push(p.el);
      p.el.kids.push({ mcid, pi });
      return `/${p.el.S === 'Document' ? 'P' : p.el.S} <</MCID ${mcid}>> BDC\n`;
    },
    /** a link annotation: its StructParent (its element joins the tree at the end) @param {any} it @param {number} ref @param {number} ii */
    link(it, ref, ii) {
      links.push({ ref, pi, ii });
      annotsHere = true;
      return P + F + nl++;
    },
    /** a form field's widget: its StructParent, and where its object number goes once made @param {number} ii */
    field(ii) {
      const p = plans[pi].get(ii), el = node('Form'), at = pi;
      (p?.near || root).kids.push(el);
      el.parent = p?.near || root;
      const key = P + nf++;
      annots[key - P] = { key, el };
      annotsHere = true;
      return { key, made: (/** @type {number} */ ref) => el.kids.push({ objr: ref, pi: at }) };
    },
    /** @param {number} pageRef @returns {Promise<string>} */
    async end(pageRef) {
      void pageRef;
      return `${pageKey[pi] >= 0 ? ` /StructParents ${pageKey[pi]}` : ''}${annotsHere ? ' /Tabs /S' : ''}`;
    },
    /** @param {{ lang?: string }} o */
    async finish({ lang = 'en' } = {}) {
      for (const l of links) {
        const p = plans[l.pi].get(l.ii);
        if (p?.link) { p.link.kids.push({ objr: l.ref, pi: l.pi }); annots.push({ el: p.link }); continue; }
        const el = node('Link');
        (p?.near || root).kids.push(el);
        el.parent = p?.near || root;
        el.kids.push({ objr: l.ref, pi: l.pi });
        annots.push({ el });
      }
      for (const t of root.tables?.values() || []) regular(t);
      const refOf = new Map(), all = /** @type {any[]} */ ([]);
      const walk = (/** @type {any} */ n) => { refOf.set(n, w.reserve()); all.push(n); for (const k of n.kids) if (k.S) { k.parent ||= n; walk(k); } };
      walk(root);
      const treeRef = w.reserve();
      const pg = (/** @type {number} */ i) => `${w.pageRef(i)} 0 R`;
      for (const n of all) {
        const pgOf = n.kids.find((/** @type {any} */ k) => k.mcid != null)?.pi;
        const K = n.kids.map((/** @type {any} */ k) => (k.S ? `${refOf.get(k)} 0 R` : k.objr ? `<< /Type /OBJR /Obj ${k.objr} 0 R /Pg ${pg(k.pi)} >>` : k.pi === pgOf ? String(k.mcid) : `<< /Type /MCR /Pg ${pg(k.pi)} /MCID ${k.mcid} >>`));
        await w.objectAt(refOf.get(n), `<< /Type /StructElem /S /${n.S} /P ${n === root ? treeRef : refOf.get(n.parent || root)} 0 R /K [${K.join(' ')}]${pgOf != null ? ` /Pg ${pg(pgOf)}` : ''}${n.alt != null ? ` /Alt ${hexText(n.alt)}` : ''}${n.attrs ? ` /A << ${Object.entries(n.attrs).map(([k, v]) => `/${k} ${attr(v)}`).join(' ')} >>` : ''} >>`);
      }
      const nums = [];
      let key = 0;
      mcids.forEach((m, i) => { if (m.length) nums.push(`${key++} [${m.map(n => `${refOf.get(n)} 0 R`).join(' ')}]`); });
      for (const a of annots) nums.push(`${key++} ${refOf.get(a.el)} 0 R`);
      await w.objectAt(treeRef, `<< /Type /StructTreeRoot /K ${refOf.get(root)} 0 R /ParentTree << /Nums [${nums.join(' ')}] >> /ParentTreeNextKey ${key} >>`);
      return ` /StructTreeRoot ${treeRef} 0 R /MarkInfo << /Marked true >> /Lang (${String(lang).replace(/[^A-Za-z0-9-]/g, '') || 'en'}) /ViewerPreferences << /DisplayDocTitle true >>`;
    },
  };
}
