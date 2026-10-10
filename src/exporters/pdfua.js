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
import { PDFName, PDFNumber, PDFHexString, PDFDict, PDFArray, PDFString } from '../engine/pdflib.js'; // set once exportPdf has loaded pdf-lib
import { node, plan, endPage, regular } from './pdfstreamtags.js';

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

