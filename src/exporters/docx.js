// @ts-check
// Page model → Word (.docx), for people who edit the result. Text becomes paragraphs in reading order and
// tables become Word tables (the engine tags table cell text with its table, row and column), with the header
// row repeating on each Word page. A text box's background and borders become the paragraph's shading and borders,
// a cell's become the cell's. Charts, pictures, maps, barcodes, shapes and in-cell visuals (sparklines, data bars)
// become pictures: an SVG with a PNG fallback (Word 2016+ draws the SVG, older Word and other readers the PNG), or the
// picture's own PNG/JPEG. Written by hand with fflate (WordprocessingML is small), no Word library.
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { visualLines, isJustified, needsTableData } from './regions.js';
import { withDeadline } from './deadline.js';
import { figures, figurePicture, boxOf, figureSvg, rasterize, cellVisuals, boxDecor, hexOrNull, altOf } from './figures.js';

const TW = 20; // twips per point
const EMU = 12700; // EMU per point
const XML_CHUNK = 4 * 1024 * 1024; // chars of document XML per zip write: a 500k-row report is far past V8's string limit in one piece
/** The string cut into pieces of at most about max chars, each ending at a '>' (a tag boundary), so their join is s. */
export function slices(s, max) {
  const out = [];
  let i = 0;
  while (s.length - i > max) {
    const j = s.indexOf('>', i + max);
    if (j < 0) break;
    out.push(s.slice(i, j + 1));
    i = j + 1;
  }
  out.push(s.slice(i));
  return out;
}
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
export function alignOf(it) {
  if (isJustified(it)) return 'both'; // Word's justify
  const c = it.clip;
  if (!c || !it.lines.length) return 'left';
  const l = it.lines[0];
  const left = l.x - c.x, right = c.x + c.w - (l.x + (l.w || 0));
  if (Math.abs(left - right) < 2 && left > 4) return 'center';
  return right < left - 2 ? 'right' : 'left';
}

/** One border edge in WordprocessingML (w:top, w:left …). */
const edge = (tag, o, space = 0) => {
  const color = hexOrNull(o.stroke);
  if (!color) return '';
  const val = !o.dash ? 'single' : o.dash[0] <= 1.5 ? 'dotted' : 'dashed';
  return `<w:${tag} w:val="${val}" w:sz="${Math.max(2, Math.min(96, Math.round((o.strokeWidth || 1) * 8)))}" w:space="${space}" w:color="${color}"/>`;
};
const pBorders = (d) => {
  if (!d || !Object.keys(d.sides).length) return '';
  const s = d.sides;
  return `<w:pBdr>${s.top ? edge('top', s.top, 1) : ''}${s.left ? edge('left', s.left, 4) : ''}${s.bottom ? edge('bottom', s.bottom, 1) : ''}${s.right ? edge('right', s.right, 4) : ''}</w:pBdr>`;
};
const shading = (fill) => (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '');

const textOf = (it) => visualLines(it).join(' ');
/** A heading item (headingLevel, tagged by the engine) is a Heading 1..6 paragraph: the outline and the navigation pane. */
const headingStyle = (it) => (it.tag?.h >= 1 ? `<w:pStyle w:val="Heading${Math.min(6, Math.round(it.tag.h))}"/>` : '');
const para = (it, indentPt, decor) => `<w:p><w:pPr>${headingStyle(it)}${pBorders(decor)}${shading(decor?.fill)}<w:spacing w:before="0" w:after="${Math.round((it.size || 9) * 4)}"/>${indentPt > 0 ? `<w:ind w:left="${Math.round(indentPt * TW)}"/>` : ''}<w:jc w:val="${alignOf(it)}"/></w:pPr><w:r>${rPr(it)}<w:t xml:space="preserve">${esc(textOf(it))}</w:t></w:r></w:p>`;

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
  return `<w:p><w:pPr>${headingStyle(items[0])}<w:spacing w:before="0" w:after="${Math.round((items[0].size || 9) * 4)}"/>${indentPt > 0 ? `<w:ind w:left="${Math.round(indentPt * TW)}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`;
}

/** The border most cell sides of a table draw (the table-wide border), or null when most sides have none. */
function commonEdge(decors) {
  const count = new Map();
  let sides = 0;
  for (const d of decors) for (const s of ['top', 'right', 'bottom', 'left']) {
    sides++;
    const o = d?.sides[s];
    if (!o) continue;
    const k = edge('x', o);
    const e = count.get(k) || { n: 0, o };
    e.n++; count.set(k, e);
  }
  // a side drawn once between two cells counts for one of them: a full grid is about half the sides
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n * 2.5 >= sides ? best.o : null;
}

/**
 * One Word table from the tagged cell text of one table on one page.
 * @param {any[]} cells text items, each with cell and its decor
 * @param {Map<string, string>} pics `${row}|${col}` → a picture run (in-cell visuals)
 */
function table(cells, indentPt, pics) {
  const cols = cells[0].cell.cols;
  const rows = new Map();
  for (const it of cells) {
    const r = rows.get(it.cell.row) || rows.set(it.cell.row, { id: it.cell.row, kind: it.cell.kind, y: it.lines[0]?.y ?? 0, byCol: new Map() }).get(it.cell.row);
    r.byCol.set(it.cell.col, it);
  }
  const common = commonEdge(cells.map(c => c.decor));
  const tblB = common ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => edge(s, common)).join('') : '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';
  const cellB = (d) => {
    if (!d) return '';
    const s = d.sides;
    const x = (s.top ? edge('top', s.top) : '') + (s.left ? edge('left', s.left) : '') + (s.bottom ? edge('bottom', s.bottom) : '') + (s.right ? edge('right', s.right) : '');
    return x ? `<w:tcBorders>${x}</w:tcBorders>` : '';
  };
  const grid = cols.map(w => `<w:gridCol w:w="${Math.round(w * TW)}"/>`).join('');
  const vm = new Map(); // col → { left, span }: a cell merged down (rowSpan) still covering rows below
  const out = [...rows.values()].sort((a, b) => a.y - b.y).map((r) => {
    const tcs = [];
    for (let c = 0; c < cols.length;) {
      const down = vm.get(c);
      if (down && !r.byCol.has(c)) {
        const w = cols.slice(c, c + down.span).reduce((s, x) => s + x, 0);
        tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${Math.round(w * TW)}" w:type="dxa"/>${down.span > 1 ? `<w:gridSpan w:val="${down.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`);
        if (--down.left <= 0) vm.delete(c);
        c += down.span;
        continue;
      }
      const it = r.byCol.get(c);
      const rs = Math.max(1, it?.cell.rowSpan || 1);
      if (rs > 1) vm.set(c, { left: rs - 1, span: Math.max(1, it.cell.span || 1) });
      const span = Math.max(1, it?.cell.span || 1);
      const w = cols.slice(c, c + span).reduce((s, x) => s + x, 0);
      const bg = it?.cell.bg && /^#?[0-9a-f]{6}$/i.test(it.cell.bg) ? hex(it.cell.bg) : it?.decor?.fill || null;
      const pic = pics.get(`${r.id}|${c}`) || '';
      const text = it ? `<w:r>${rPr(it)}<w:t xml:space="preserve">${esc(textOf(it))}</w:t></w:r>` : '';
      const p = it || pic ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${it ? alignOf(it) : 'left'}"/></w:pPr>${pic}${text}</w:p>` : '<w:p/>';
      tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${Math.round(w * TW)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}${cellB(it?.decor)}${shading(bg)}</w:tcPr>${p}</w:tc>`);
      c += span;
    }
    return `<w:tr>${r.kind === 'header' ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs.join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${indentPt > 0 ? `<w:tblInd w:w="${Math.round(indentPt * TW)}" w:type="dxa"/>` : ''}<w:tblBorders>${tblB}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${out}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
}

/** Text boxes side by side as one row of a borderless table: a column per box, a spacer column for each gap. */
function layoutRow(row, margin) {
  const cols = [], cells = [];
  let x = row[0].it.clip.x;
  for (const r of row) {
    const c = r.it.clip;
    if (c.x - x > 0.5) { cols.push(c.x - x); cells.push('<w:tc><w:tcPr><w:tcW w:w="' + Math.round((c.x - x) * TW) + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>'); }
    cols.push(c.w);
    const d = r.decor;
    const bdr = d && Object.keys(d.sides).length ? `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map(sd => (d.sides[sd] ? edge(sd, d.sides[sd]) : '')).join('')}</w:tcBorders>` : '';
    cells.push(`<w:tc><w:tcPr><w:tcW w:w="${Math.round(c.w * TW)}" w:type="dxa"/>${bdr}${shading(d?.fill)}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${alignOf(r.it)}"/></w:pPr><w:r>${rPr(r.it)}<w:t xml:space="preserve">${esc(textOf(r.it))}</w:t></w:r></w:p></w:tc>`);
    x = c.x + c.w;
  }
  const ind = row[0].it.clip.x - margin;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${Math.abs(ind) > 0.5 ? `<w:tblInd w:w="${Math.round(ind * TW)}" w:type="dxa"/>` : ''}<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${cols.map(w => `<w:gridCol w:w="${Math.round(w * TW)}"/>`).join('')}</w:tblGrid><w:tr>${cells.join('')}</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="40"/><w:rPr><w:sz w:val="4"/></w:rPr></w:pPr></w:p>`;
}

/**
 * @param {any} model render() output
 * @param {{ title?: string, author?: string, lang?: string, fontStore?: any, fetchImage?: (src: string) => Promise<Uint8Array|null>,
 *   rasterize?: (svg: string, w: number, h: number, scale: number) => Promise<Uint8Array|null>, figures?: boolean, xmlChunk?: number }} [opt]
 *   xmlChunk: the document XML is written to the zip in pieces of about this many chars (default 4M; tests lower it)
 *   fontStore: text in pictures as outlines (else the reader's fallback font); fetchImage: pictures by URL;
 *   rasterize: the PNG fallback of a picture (default: a canvas in a browser, sharp in Node); figures: false leaves them out.
 * @returns {Promise<Uint8Array>}
 */
export function exportDocx(model, opt = {}) {
  return withDeadline(docxOf(model, opt), /** @type {any} */ (opt).timeoutMs);
}
/** @type {typeof exportDocx} */
async function docxOf(model, opt) {
  needsTableData(model, 'Word');
  // the left and right page margins of the Word document; content keeps its place (indents are from the report's x)
  const margin = 18;
  /** @type {{ name: string, bytes: Uint8Array, rid: string }[]} */
  const media = [];
  let docPr = 0;
  const addMedia = (bytes, ext) => { const rid = `rIdm${media.length + 1}`; media.push({ name: `image${media.length + 1}.${ext}`, bytes, rid }); return rid; };
  /** a picture as an inline drawing run */
  const pictureRun = (pic, alt) => {
    const main = pic.png ? addMedia(pic.png, 'png') : pic.jpeg ? addMedia(pic.jpeg, 'jpeg') : pic.svg ? addMedia(strToU8(pic.svg), 'svg') : null;
    if (!main) return '';
    const svg = pic.png && pic.svg ? addMedia(strToU8(pic.svg), 'svg') : null;
    const id = ++docPr, cx = Math.max(1, Math.round(pic.w * EMU)), cy = Math.max(1, Math.round(pic.h * EMU));
    const name = `Picture ${id}`, descr = alt ? ` descr="${esc(alt)}"` : '';
    const ext = svg ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svg}"/></a:ext></a:extLst>` : '';
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}"${descr}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"${descr}/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${main}">${ext}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const picOpt = { fontStore: opt.fontStore, fetchImage: opt.fetchImage, rasterize: opt.rasterize };

  const body = [];
  for (const pg of model.pages) {
    const all = pg.items.flatMap(i => (i.t === 'field' ? i.draw : [i]));
    const figs = opt.figures === false ? [] : figures(all);
    const used = new Set();
    for (const f of figs) for (let k = f.at; k <= f.last; k++) used.add(k);
    // blocks in reading order: a free text box, a whole table (all its cells on this page), a row of pictures
    const blocks = [];
    const tables = new Map();
    const paras = new Map(); // rich text: one block per paragraph of one box
    all.forEach((it, i) => {
      if (used.has(i) || it.t !== 'text' || !it.lines?.length) return;
      if (it.rich) {
        const key = `${it.rich.id}\u0001${it.rich.p}`;
        let b = paras.get(key);
        if (!b) { b = { kind: 'rich', y: it.lines[0].y, x: it.lines[0].x, items: [] }; paras.set(key, b); blocks.push(b); }
        b.items.push(it);
        b.y = Math.min(b.y, it.lines[0].y);
        b.x = Math.min(b.x, it.lines[0].x);
      } else if (it.cell) {
        const key = it.cell.table;
        if (!tables.has(key)) { const b = { kind: 'table', key, y: it.lines[0].y, x: it.clip?.x ?? it.lines[0].x, cells: [] }; tables.set(key, b); blocks.push(b); }
        const b = tables.get(key);
        b.cells.push({ ...it, decor: boxDecor(all, i) });
        b.y = Math.min(b.y, it.lines[0].y);
        b.x = Math.min(b.x, it.clip?.x ?? it.lines[0].x);
      } else blocks.push({ kind: 'text', y: it.lines[0].y, x: it.lines[0].x, it, decor: boxDecor(all, i) });
    });
    const visuals = opt.figures === false ? new Map() : cellVisuals(all, used, tables);
    // a box shape behind text boxes (a KPI tile, a banner) becomes the shading and border of their cells, not a picture
    const frames = figs.filter(f => f.tag.k === 'shape' && f.items.length === 1 && f.items[0].t === 'rect');
    for (const b of blocks) {
      const c = b.kind === 'text' && b.it.clip;
      const fr = c && frames.find(f => { const r = f.items[0]; return c.x >= r.x - 0.5 && c.y >= r.y - 0.5 && c.x + c.w <= r.x + r.w + 0.5 && c.y + c.h <= r.y + r.h + 0.5; });
      if (!fr) continue;
      const r = fr.items[0];
      fr.used = true;
      b.decor = { fill: b.decor?.fill || hexOrNull(r.fill), sides: Object.keys(b.decor?.sides || {}).length ? b.decor.sides : {} };
    }
    for (const f of figs) if (!f.used) blocks.push({ kind: 'fig', y: f.box.y, x: f.box.x, fig: f });
    blocks.sort((a, b) => a.y - b.y || a.x - b.x);
    let xml = '';
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.kind === 'fig') {
        // pictures side by side (a row of charts) share one paragraph; a stretched space keeps the gap between them
        const row = [b];
        while (blocks[bi + 1]?.kind === 'fig' && Math.abs(blocks[bi + 1].y - b.y) < 4) row.push(blocks[++bi]);
        row.sort((p, q) => p.x - q.x);
        let runs = '', right = null;
        for (const r of row) {
          const pic = await figurePicture(r.fig, picOpt);
          if (right != null && pic.x > right) runs += `<w:r><w:rPr><w:spacing w:val="${Math.min(31680, Math.max(0, Math.round((pic.x - right - 3) * TW)))}"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>`;
          runs += pictureRun(pic, altOf(r.fig.tag));
          right = pic.x + pic.w;
        }
        const first = row[0];
        xml += `<w:p><w:pPr><w:spacing w:before="0" w:after="80"/>${Math.abs(first.x - margin) > 0.5 ? `<w:ind w:left="${Math.round(Math.max(-margin, first.x - margin) * TW)}"/>` : ''}</w:pPr>${runs}</w:p>`; // into the margin when the report's is narrower
      } else if (b.kind === 'table') {
        const pics = new Map();
        for (const [k, v] of visuals.get(b.key) || []) {
          if (!v.box) continue;
          const svg = figureSvg({ items: v.items, box: v.box }, opt.fontStore);
          pics.set(k, pictureRun({ svg, png: await rasterize(svg, v.box.w, v.box.h, picOpt), w: v.box.w, h: v.box.h }, 'Chart in a table cell'));
        }
        xml += table(b.cells, b.x - margin, pics);
      } else if (b.kind === 'rich') xml += richPara(b.items, b.x - margin);
      else {
        // text boxes side by side (a row of tiles, a label and its value): one row of a borderless layout table
        const row = [b];
        const top = (t) => t.it.clip?.y ?? t.y - t.it.size;
        while (blocks[bi + 1]?.kind === 'text' && Math.abs(top(blocks[bi + 1]) - top(b)) < 3 && blocks[bi + 1].it.clip && b.it.clip) row.push(blocks[++bi]);
        row.sort((p, q) => p.it.clip.x - q.it.clip.x);
        const apart = row.every((r, k) => k === 0 || r.it.clip.x >= row[k - 1].it.clip.x + row[k - 1].it.clip.w - 0.5);
        if (row.length > 1 && apart) xml += layoutRow(row, margin);
        else for (const r of row) xml += para(r.it, (r.it.clip?.x ?? r.x) - margin, r.decor);
      }
    }
    body.push(xml);
  }
  // pages of one size share a Word section; a page of another size (a body section) starts a new one
  const M = margin * TW, V = 36 * TW;
  const sectPr = (pg) => {
    const W = Math.round((pg.width ?? model.width) * TW), H = Math.round((pg.height ?? model.height) * TW);
    return `<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${V}" w:right="${M}" w:bottom="${V}" w:left="${M}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  };
  const sizeOf = (pg) => `${pg.width ?? model.width}x${pg.height ?? model.height}`;
  const zipOut = [];
  const zip = new Zip((err, data) => { if (err) throw err; zipOut.push(data); });
  const put = (name, bytes) => { const e = new ZipDeflate(name, { level: 6 }); zip.add(e); e.push(bytes, true); };
  // the document XML is kept as pieces (body[i] is one page's XML; the pieces are never joined into one string)
  const parts = [];
  const max = opt.xmlChunk || XML_CHUNK;
  let buf = ''; // pieces are joined up to max chars: many tiny pushes to the deflater compress worse
  const write = (str) => {
    for (const p of slices(str, max)) { if (buf.length + p.length > max) { parts.push(buf); buf = ''; } buf += p; }
  };
  write(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>`);
  model.pages.forEach((pg, i) => {
    write(body[i]);
    const next = model.pages[i + 1];
    if (!next) return;
    // the section break carries the size of the pages before it
    // a new page by "page break before" on a one-point paragraph: a page that already ends at the bottom gets no blank page after it
    write(sizeOf(next) !== sizeOf(pg) ? `<w:p><w:pPr>${sectPr(pg)}</w:pPr></w:p>` : '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>');
  });
  const last = model.pages[model.pages.length - 1] || {};
  write(`${sectPr(last)}</w:body></w:document>`);
  parts.push(buf);
  // the document language: opt.lang, else the report's locale (the engine's default when it has none)
  const lang = `<w:lang w:val="${esc(opt.lang || model.locale || 'en-US')}"/>`;
  // Heading 1..6 (built-in names, so Word's navigation pane and outline use them); the look stays the direct formatting
  const headings = [28, 24, 22, 20, 18, 18].map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('');
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:cs="Inter"/><w:sz w:val="18"/>${lang}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${headings}</w:styles>`;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opt.title || model.name || 'Report')}</dc:title>${opt.author ? `<dc:creator>${esc(opt.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  put('[Content_Types].xml', strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`));
  put('_rels/.rels', strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`));
  put('word/_rels/document.xml.rels', strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`));
  const doc = new ZipDeflate('word/document.xml', { level: 6 });
  zip.add(doc);
  for (const p of parts) doc.push(strToU8(p), false);
  doc.push(new Uint8Array(0), true);
  put('word/styles.xml', strToU8(styles));
  put('docProps/core.xml', strToU8(core));
  for (const m of media) put(`word/media/${m.name}`, m.bytes);
  zip.end();
  const total = zipOut.reduce((n, c) => n + c.length, 0), bytes = new Uint8Array(total);
  let at = 0;
  for (const c of zipOut) { bytes.set(c, at); at += c.length; }
  return bytes;
}
