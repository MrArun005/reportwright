// @ts-check
/**
 * The structure tree of a streamed, tagged PDF (PDF/UA-1, and PDF/A-2a with it): pdfua.js's tree for the shapes that
 * stream (engine/paged.js), written as the pages are. Document > P / H1–H6 (text boxes), Table > TR > TH/TD (the table's
 * header rows TH with Scope Column the first time, an artifact where they repeat; empty cells as empty TD; spans as
 * ColSpan), Link > OBJR inside the element whose text it covers; page header and footer, borders and boxes artifacts.
 * Each page's rows (TR, TD), its parent-tree array and its links' elements are written when the page ends; what stays
 * is one number per row (the Table's kids) and two per page and link (the parent tree), written at the end.
 */

/**
 * @param {any} w the PDF writer (pdfstream.js createPdfStream)
 */
export function createStreamTagger(w) {
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

  const el = (S, parent, attrs) => { const e = { ref: w.reserve(), S, parent, mcid: /** @type {number[]} */ ([]), kids: /** @type {any[]} */ ([]), attrs }; els.push(e); return e; };
  const mark = (e) => { const m = mcids.length; mcids.push(e.ref); e.mcid.push(m); return `/${e.S} <</MCID ${m}>> BDC\n`; };

  return {
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
      if (!r) { r = { ref: w.reserve(), kind: c.kind, cells: new Map() }; rows.set(rk, r); addRow(r.ref); }
      let cell = r.cells.get(c.col);
      if (!cell) {
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
        await w.objectAt(r.ref, `<< /Type /StructElem /S /TR /P ${/** @type {any} */ (table).ref} 0 R /K [${kids.map(k => `${k} 0 R`).join(' ')}] >>`);
      }
      if (rows.size && [...rows.values()].some(r => r.kind === 'header')) headerDone = true;
      for (const e of els) {
        const K = [...e.mcid.map(String), ...e.kids].join(' ');
        const A = e.attrs ? ` /A << ${Object.entries(e.attrs).map(([k, v]) => `/${k} ${v}`).join(' ')} >>` : '';
        const P = e.parent === docRef ? docRef : e.parent;
        await w.objectAt(e.ref, `<< /Type /StructElem /S /${e.S} /P ${P} 0 R${e.mcid.length || e.S === 'Link' ? ` /Pg ${pageRef} 0 R` : ''} /K [${K}]${A} >>`);
      }
      let extra = '';
      if (mcids.length) {
        const arr = await w.object(`[${mcids.map(r => `${r} 0 R`).join(' ')}]`);
        num(key, arr);
        extra += ` /StructParents ${key++}`;
      }
      if (links) extra += ' /Tabs /S';
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

/** a link over a text's box (pdfua.js's test) */
function overlaps(t, l) {
  const c = t.clip || { x: t.lines[0].x, y: t.lines[0].y - t.size, w: t.lines[0].w || 0, h: t.size * 1.3 };
  return l.x < c.x + c.w && c.x < l.x + l.w && l.y < c.y + c.h && c.y < l.y + l.h;
}
