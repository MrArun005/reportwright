// @ts-check
// Page model → Word (.docx), for people who edit the result. Text becomes paragraphs in reading order and
// tables become Word tables (the engine tags table cell text with its table, row and column), with the header
// row repeating on each Word page. Charts, images and shapes are left out: use PDF for an exact copy.
// Written by hand with fflate (WordprocessingML is small), no Word library.
import { zipSync, strToU8 } from 'fflate';
import { visualLines, isJustified } from './regions.js';

const TW = 20; // twips per point
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? m[1].toUpperCase() : '000000'; };

/** Run properties from a page-model text item. */
function rPr(it) {
  const f = String(it.font || '');
  const family = /mono/i.test(f) ? 'JetBrains Mono' : f.split('-')[0] || 'Inter';
  const deco = String(it.deco || '');
  // element order follows the schema: rFonts, b, i, strike, color, sz, u
  // rich text superscript and subscript: Word shrinks them itself, so give it the size of the line
  const script = it.rich?.s ? `<w:vertAlign w:val="${it.rich.s === 'sup' ? 'superscript' : 'subscript'}"/>` : '';
  const size = it.rich?.s ? it.rich.z : it.size;
  return `<w:rPr><w:rFonts w:ascii="${esc(family)}" w:hAnsi="${esc(family)}" w:cs="${esc(family)}"/>${/bold/i.test(f) ? '<w:b/>' : ''}${/italic/i.test(f) ? '<w:i/>' : ''}${deco.includes('line-through') ? '<w:strike/>' : ''}<w:color w:val="${hex(it.color)}"/><w:sz w:val="${Math.round((size || 9) * 2)}"/>${deco.includes('underline') ? '<w:u w:val="single"/>' : ''}${script}</w:rPr>`;
}

/** Left, right or centre, from where the lines sit in their box. */
function alignOf(it) {
  if (isJustified(it)) return 'both'; // Word's justify
  const c = it.clip;
  if (!c || !it.lines.length) return 'left';
  const l = it.lines[0];
  const left = l.x - c.x, right = c.x + c.w - (l.x + (l.w || 0));
  if (Math.abs(left - right) < 2 && left > 4) return 'center';
  return right < left - 2 ? 'right' : 'left';
}

const textOf = (it) => visualLines(it).join(' ');
const para = (it, indentPt) => `<w:p><w:pPr><w:spacing w:before="0" w:after="${Math.round((it.size || 9) * 4)}"/>${indentPt > 0 ? `<w:ind w:left="${Math.round(indentPt * TW)}"/>` : ''}<w:jc w:val="${alignOf(it)}"/></w:pPr><w:r>${rPr(it)}<w:t xml:space="preserve">${esc(textOf(it))}</w:t></w:r></w:p>`;

/** One paragraph of rich text: its fragments as runs, a <br> as a Word break, a wrapped line as a space. */
function richPara(items, indentPt) {
  items.sort((a, b) => a.rich.l - b.rich.l || a.lines[0].x - b.lines[0].x);
  let runs = '', line = items[0].rich.l, prev = '';
  for (const it of items) {
    if (it.rich.l !== line) {
      if (it.rich.br) runs += '<w:r><w:br/></w:r>';
      else if (prev && !prev.endsWith(' ')) runs += `<w:r>${rPr(it)}<w:t xml:space="preserve"> </w:t></w:r>`;
      line = it.rich.l;
    }
    prev = it.lines[0].text;
    runs += `<w:r>${rPr(it)}<w:t xml:space="preserve">${esc(prev)}</w:t></w:r>`;
  }
  const jc = { center: 'center', right: 'right' }[items[0].rich.a] || 'left';
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${Math.round((items[0].size || 9) * 4)}"/>${indentPt > 0 ? `<w:ind w:left="${Math.round(indentPt * TW)}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`;
}

const BORDER = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders>';

/** One Word table from the tagged cell text of one table on one page. */
function table(cells, indentPt) {
  const cols = cells[0].cell.cols;
  const rows = new Map();
  for (const it of cells) {
    const r = rows.get(it.cell.row) || rows.set(it.cell.row, { kind: it.cell.kind, y: it.lines[0].y, byCol: new Map() }).get(it.cell.row);
    r.byCol.set(it.cell.col, it);
  }
  const grid = cols.map(w => `<w:gridCol w:w="${Math.round(w * TW)}"/>`).join('');
  const out = [...rows.values()].sort((a, b) => a.y - b.y).map((r) => {
    const tcs = [];
    for (let c = 0; c < cols.length;) {
      const it = r.byCol.get(c);
      const span = Math.max(1, it?.cell.span || 1);
      const w = cols.slice(c, c + span).reduce((s, x) => s + x, 0);
      const bg = it?.cell.bg && /^#?[0-9a-f]{6}$/i.test(it.cell.bg) ? hex(it.cell.bg) : r.kind === 'header' ? 'F1F5F9' : null;
      const shade = bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : '';
      const p = it ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${alignOf(it)}"/></w:pPr><w:r>${rPr(it)}<w:t xml:space="preserve">${esc(textOf(it))}</w:t></w:r></w:p>` : '<w:p/>';
      tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${Math.round(w * TW)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${shade}</w:tcPr>${p}</w:tc>`);
      c += span;
    }
    return `<w:tr>${r.kind === 'header' ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs.join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${indentPt > 0 ? `<w:tblInd w:w="${Math.round(indentPt * TW)}" w:type="dxa"/>` : ''}${BORDER}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${out}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
}

/**
 * @param {any} model render() output
 * @param {{ title?: string, author?: string }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export async function exportDocx(model, opt = {}) {
  const margin = 36;
  const body = model.pages.map((pg) => {
    const texts = pg.items.flatMap(i => (i.t === 'field' ? i.draw : [i])).filter(i => i.t === 'text' && i.lines?.length);
    // blocks in reading order: a free text box, or a whole table (all its cells on this page)
    const blocks = [];
    const tables = new Map();
    const paras = new Map(); // rich text: one block per paragraph of one box
    for (const it of texts) {
      if (it.rich) {
        const key = `${it.rich.id}\u0001${it.rich.p}`;
        let b = paras.get(key);
        if (!b) { b = { kind: 'rich', y: it.lines[0].y, x: it.lines[0].x, items: [] }; paras.set(key, b); blocks.push(b); }
        b.items.push(it);
        b.y = Math.min(b.y, it.lines[0].y);
        b.x = Math.min(b.x, it.lines[0].x);
      } else if (it.cell) {
        const key = it.cell.table;
        if (!tables.has(key)) { const b = { kind: 'table', y: it.lines[0].y, x: it.clip?.x ?? it.lines[0].x, cells: [] }; tables.set(key, b); blocks.push(b); }
        const b = tables.get(key);
        b.cells.push(it);
        b.y = Math.min(b.y, it.lines[0].y);
        b.x = Math.min(b.x, it.clip?.x ?? it.lines[0].x);
      } else blocks.push({ kind: 'text', y: it.lines[0].y, x: it.lines[0].x, it });
    }
    blocks.sort((a, b) => a.y - b.y || a.x - b.x);
    return blocks.map(b => (b.kind === 'table' ? table(b.cells, b.x - margin) : b.kind === 'rich' ? richPara(b.items, b.x - margin) : para(b.it, (b.it.clip?.x ?? b.x) - margin))).join('');
  }).join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

  const W = Math.round(model.width * TW), H = Math.round(model.height * TW), M = margin * TW;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M}" w:left="${M}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:cs="Inter"/><w:sz w:val="18"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opt.title || model.name || 'Report')}</dc:title>${opt.author ? `<dc:creator>${esc(opt.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(core),
  }, { level: 6 });
}
