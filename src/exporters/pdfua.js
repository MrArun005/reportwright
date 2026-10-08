// @ts-check
// Tagged PDF (PDF/UA-1): the structure tree that the accessible PDF export adds. pdf.js asks for each page item
// what it is (tagger.open) and wraps its drawing in marked content: a structure element's MCID, or an artifact
// (page header and footer, backgrounds, borders, decoration). Then tagger.finish writes the tree, the parent tree,
// MarkInfo, the language, the title shown, and the PDF/UA identifier.
//
// Structure, from the page model (the engine's export tags, layout.js and index.js, and table cell tags):
//   Document > H1–H6 (a heading level, or a bookmark at the text), P (text boxes, rich text paragraphs),
//   L > LI > Lbl + LBody (rich text lists), Table > TR > TH/TD (header rows TH with Scope Column; spans as ColSpan/RowSpan;
//   one Table across pages, its repeated header an artifact), Figure with Alt (charts, pictures, maps, barcodes,
//   visuals; a shape or line only when it has alt text, else decoration), Link > OBJR, Form > OBJR.
// Reading order: the page model's order (the order the engine lays items out: by position, column by column).
// Checked with veraPDF's PDF/UA-1 profile (tests/engine/export-pdfua.test.js).
import { PDFName, PDFNumber, PDFHexString, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { figures, altOf, cellVisuals } from './figures.js';
import { visualLines } from './regions.js';

const MARKER = /^\s*(?:[•◦▪▫‣·○●■□–—-]|\d{1,4}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,6}[.)])\s*$/;

/**
 * @param {any} model
 * @param {import('pdf-lib').PDFDocument} doc
 */
export function createTagger(model, doc) {
  const ctx = doc.context;
  const root = node('Document');
  /** per page: item index → { el?: node, art?: string } */
  const plans = model.pages.map((pg, pi) => { const p = plan(model, pg, pi, root); endPage(root); return p; });
  const mcids = model.pages.map(() => []); // per page: MCID → node
  const annots = []; // { ref, el, pi }

  return {
    /**
     * Marked content around item ii of page pi: the operator that opens it, or null (nothing is drawn for it).
     * @returns {string|null}
     */
    open(pi, ii, it) {
      if (it.t === 'link' || it.t === 'field' || it.t === 'bookmark') return null;
      const p = plans[pi].get(ii);
      if (!p?.el) return p?.art === 'Pagination' ? '/Artifact <</Type /Pagination>> BDC\n' : '/Artifact BMC\n';
      const mcid = mcids[pi].length;
      mcids[pi].push(p.el);
      p.el.kids.push({ mcid, pi });
      return `/${p.el.S === 'Document' ? 'P' : p.el.S} <</MCID ${mcid}>> BDC\n`;
    },
    /** A link annotation of item ii (or a field's widget): its structure element; returns its StructParent key. */
    annot(pi, ii, ref, kind) {
      const p = plans[pi].get(ii);
      if (p?.link) { p.link.kids.push({ objr: ref, pi }); annots.push({ ref, el: p.link, pi }); return; } // a contents entry: its one Link holds the text, the number and this
      const el = node(kind === 'field' ? 'Form' : 'Link');
      // the Link goes into the element of the text it covers when there is one (a P, a TD), else at the end
      (p?.near || root).kids.push(el);
      el.parent = p?.near || root;
      el.kids.push({ objr: ref, pi });
      annots.push({ ref, el, pi });
    },
    finish({ lang = 'en', title = 'Report' } = {}) {
      const pages = doc.getPages();
      const refOf = new Map();
      const all = [];
      for (const t of root.tables?.values() || []) regular(t);
      const walk = (n) => { refOf.set(n, ctx.nextRef()); all.push(n); for (const k of n.kids) if (k.S) { k.parent ||= n; walk(k); } };
      walk(root);
      const nums = [];
      let key = 0;
      pages.forEach((pg, pi) => {
        if (!mcids[pi].length) return;
        pg.node.set(PDFName.of('StructParents'), PDFNumber.of(key));
        nums.push(PDFNumber.of(key++), ctx.obj(mcids[pi].map(n => refOf.get(n))));
      });
      for (const a of annots) {
        const d = ctx.lookup(a.ref);
        if (d instanceof PDFDict) d.set(PDFName.of('StructParent'), PDFNumber.of(key));
        nums.push(PDFNumber.of(key++), refOf.get(a.el));
        // the order of the annotations in tab follows the structure
        pages[a.pi]?.node.set(PDFName.of('Tabs'), PDFName.of('S'));
      }
      const treeRef = ctx.nextRef();
      for (const n of all) {
        const pgOf = n.kids.find(k => k.mcid != null)?.pi;
        const K = n.kids.map(k => {
          if (k.S) return refOf.get(k);
          if (k.objr) return ctx.obj({ Type: 'OBJR', Obj: k.objr, Pg: pages[k.pi].ref });
          return k.pi === pgOf ? PDFNumber.of(k.mcid) : ctx.obj({ Type: 'MCR', Pg: pages[k.pi].ref, MCID: k.mcid });
        });
        const d = ctx.obj({ Type: 'StructElem', S: n.S, P: n === root ? treeRef : refOf.get(n.parent || root), K: K });
        if (pgOf != null) d.set(PDFName.of('Pg'), pages[pgOf].ref);
        if (n.alt != null) d.set(PDFName.of('Alt'), PDFHexString.fromText(n.alt));
        if (n.attrs) d.set(PDFName.of('A'), ctx.obj(n.attrs));
        ctx.assign(refOf.get(n), d);
      }
      ctx.assign(treeRef, ctx.obj({ Type: 'StructTreeRoot', K: refOf.get(root), ParentTree: ctx.obj({ Nums: nums }), ParentTreeNextKey: key }));
      const cat = doc.catalog;
      cat.set(PDFName.of('StructTreeRoot'), treeRef);
      cat.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
      cat.set(PDFName.of('Lang'), PDFString.of(String(lang).replace(/[^A-Za-z0-9-]/g, '') || 'en'));
      cat.set(PDFName.of('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }));
      doc.setTitle(title, { showInWindowTitleBar: true });
    },
  };
}

/** A structure element. */
function node(S, extra = {}) { return /** @type {any} */ ({ S, kids: [], ...extra }); }

/**
 * What each item of a page is: Map(item index → { el } | { art } ), and for links the element they sit in ({ near }).
 * Elements are added to the tree in reading order as they are first met.
 */
function plan(model, pg, pi, root) {
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
function endPage(root) {
  for (const t of root.tables?.values() || []) for (const r of t.rows.values()) if (r.kind === 'header') r.done = true;
}

/**
 * A regular table for screen readers: each row's cells in column order, and an empty TD where a row has no cell
 * (an empty cell draws no text, so the page model has nothing for it); cells merged across or down count as covered.
 */
function regular(t) {
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
