// Our two products: node harness.mjs <@reportwright/engine|@reportwright/pdf> <job> <size> <outdir>.
// The engine gets JSON report definitions (its documented use: groups, aggregates and "Page N of M" are declared, and
// large reports go through exportPdfStream). @reportwright/pdf draws the create jobs through common/canvas-jobs.mjs,
// the same operations the other low-level writers get, and does the read, edit and sign jobs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../common/frame.mjs';
import { spec, fx } from '../common/data.mjs';

const ver = (p) => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', p, 'package.json'), 'utf8')).version; // some packages do not export ./package.json
const P = spec.page, R = spec.report, BODY_W = P.w - 2 * P.margin;
const font = (k) => fx(spec.fonts[k]);

// ---------------------------------------------------------------- @reportwright/engine
async function engine() {
  const { render, exportPdf, exportPdfStream, FontStore, fontFile } = await import('@reportwright/engine');
  // the shared fixture fonts first (Inter, Noto Devanagari/Arabic/SC), then the faces @reportwright/fonts ships
  const pkgFonts = path.dirname(fileURLToPath(import.meta.resolve('@reportwright/fonts/public/fonts/Inter-Regular.ttf')));
  const fonts = new FontStore(async (key) => {
    const name = fontFile(key), mine = fx(path.join('fonts', name));
    return fs.promises.readFile(fs.existsSync(mine) ? mine : path.join(pkgFonts, name));
  });
  const page = { size: 'A4', margins: [P.margin, P.margin, P.margin, P.margin] };
  const tb = (x, y, w, h, value, style = {}) => ({ type: 'textbox', name: `T${x}_${y}_${String(value).length}`, x, y, w, h, value, style: { fontSize: 9, ...style } });
  const dataUri = (f) => `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}`;
  const doc = (name, body, extra = {}) => ({ $schema: 'pagewright/report@1', name, locale: 'en-US', page, ...extra, sections: { body: { items: body } } });
  const whole = async (def, out, o = {}) => {
    const model = await render(def, { fontStore: fonts });
    fs.writeFileSync(out, await exportPdf(model, { fonts, title: def.name, ...(o.pdfa ? { pdfa: true } : {}) }));
  };
  const invoice = async (_c, out, o = {}) => {
    const I = spec.invoice, T = I.table, M = P.margin;
    const items = I.texts.map(t => tb(t.x - M, t.y - M, t.w, t.size + 4, t.text, { fontSize: t.size, ...(t.bold ? { fontWeight: 'bold' } : {}), ...(t.right ? { textAlign: 'right' } : {}) }));
    items.push({ type: 'image', name: 'Logo', x: I.logo.x - M, y: I.logo.y - M, w: I.logo.w, h: I.logo.h, src: dataUri(fx(I.logo.file)), fit: 'fill' });
    const c = (v, col, bold) => ({ value: v, style: { ...(col.right ? { textAlign: 'right' } : {}), ...(bold ? { fontWeight: 'bold' } : {}) } });
    items.push({ type: 'table', name: 'Items', dataSet: 'Items', x: T.x - M, y: T.y - M, w: BODY_W, h: T.rowH * (T.rows.length + 4), columns: T.cols.map(col => ({ width: col.w })),
      header: [{ height: T.rowH, style: { fontWeight: 'bold', backgroundColor: R.headBg, fontSize: T.size }, cells: T.cols.map(col => c(col.label, col)) }],
      detail: [{ height: T.rowH, style: { borderBottom: `0.5 solid ${R.rule}`, fontSize: T.size }, cells: T.cols.map((col, i) => c(`=Fields.c${i}`, col)) }],
      footer: T.totals.map(([l, v], i) => ({ height: T.rowH, style: { fontSize: T.size }, cells: [null, null, c(l, T.cols[2], i === 2), c(v, T.cols[3], i === 2)] })) });
    await whole(doc('Invoice', items, {
      dataSources: [{ name: 'inv', type: 'json', data: T.rows.map(r => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))) }],
      dataSets: [{ name: 'Items', source: 'inv', fields: T.cols.map((_, i) => ({ name: `c${i}`, type: 'string' })) }] }), out, o);
  };
  const stream = async (def, out, rows) => {
    const sink = fs.createWriteStream(out);
    const r = await exportPdfStream(def, { fonts, title: def.name, presorted: true, maxRows: Math.max(rows, 5_000_000), timeoutMs: 24 * 3600e3 }, sink);
    await new Promise((ok, fail) => sink.end((e) => (e ? fail(e) : ok())));
    return { note: r.streamed ? `streamed, ${r.pages} pages` : `written whole: ${r.why}` };
  };
  return {
    version: `${ver('@reportwright/engine')} (fonts ${ver('@reportwright/fonts')})`,
    invoice,
    pdfa: (c, out) => invoice(c, out, { pdfa: true }),
    async plain({ pool, pages }, out) {
      const s = spec.plain, data = [];
      for (let p = 0; p < pages; p++) for (let k = 0; k < s.linesPerPage; k++) data.push({ p, t: pool[(p * s.linesPerPage + k) % pool.length] });
      return stream(doc('Plain', [{ type: 'table', name: 'Lines', dataSet: 'L', x: 0, y: 0, w: BODY_W, h: s.leading, widowControl: false, columns: [{ width: BODY_W }],
        groups: [{ name: 'Page', expr: '=Fields.p', pageBreak: 'between' }],
        detail: [{ height: s.leading, style: { fontSize: s.size, padding: 0, lineHeight: 1 }, cells: [{ value: '=Fields.t' }] }] }], {
        dataSources: [{ name: 'src', type: 'json', data }], dataSets: [{ name: 'L', source: 'src', fields: [{ name: 'p', type: 'number' }, { name: 't', type: 'string' }] }] }), out, data.length);
    },
    async report({ rows }, out) {
      const total = (label) => [{ height: R.rowH, style: { fontWeight: 'bold', fontSize: R.size }, cells: [{ value: label, colSpan: 2 }, null, { value: '=CountRows()' }, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, null] }];
      const def = doc('Ledger', [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: BODY_W, h: 40, repeatHeader: true, columns: R.cols.map(c => ({ width: c.w })),
        header: [{ height: R.headH, style: { fontWeight: 'bold', backgroundColor: R.headBg, fontSize: R.size }, cells: R.cols.map(c => ({ value: c.label, style: c.right ? { textAlign: 'right' } : {} })) }],
        detail: [{ height: R.rowH, style: { borderBottom: `0.5 solid ${R.rule}`, fontSize: R.size }, cells: R.cols.map(c => ({ value: `=Fields.${c.key}`, style: c.key === 'amount' ? { format: 'N2', textAlign: 'right' } : {} })) }],
        footer: total('Grand total'),
        groups: [{ name: 'Region', expr: '=Fields.region',
          header: [{ height: R.groupH, style: { fontWeight: 'bold', backgroundColor: R.groupBg, fontSize: R.size }, cells: [{ value: '="Region " & Fields.region', colSpan: 7 }, null, null, null, null, null, null] }],
          footer: total('Region total') }] }], {
        dataSources: [{ name: 'db', type: 'json', data: rows }],
        dataSets: [{ name: 'Tx', source: 'db', fields: R.cols.map(c => ({ name: c.key, type: c.key === 'id' || c.key === 'amount' ? 'number' : 'string' })) }] });
      def.sections.pageFooter = { height: P.footer, items: [tb(0, 4, BODY_W, 12, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { fontSize: R.footerSize, textAlign: 'right' })] };
      return stream(def, out, rows.length);
    },
    async unicode(_c, out) {
      const U = spec.unicode;
      await whole(doc('Unicode', U.lines.map(l => tb(l.x - P.margin, l.y - P.margin, BODY_W - (l.x - P.margin), U.size * 1.6, l.text, { fontSize: U.size, ...(l.rtl ? { textAlign: 'left' } : {}) }))), out);
    },
    async images(_c, out) {
      const I = spec.images, h = I.w * 2 / 3;
      await whole(doc('Images', [I.png, I.jpeg].map((f, i) => ({ type: 'image', name: `Img${i}`, x: I.x - P.margin, y: i === 0 ? I.y - P.margin : h + 4, w: I.w, h, src: dataUri(fx(f)), fit: 'fill', ...(i === 0 ? { pageBreakAfter: true } : {}) }))), out);
    },
  };
}

// ---------------------------------------------------------------- @reportwright/pdf
async function rwpdf() {
  const { createPdf, loadPdf, mergePdfs, nodeSigner } = await import('@reportwright/pdf');
  const hb = await import('harfbuzzjs');
  const shaper = (bytes) => { // the adapter from the package README (examples/harfbuzz-shaper.mjs)
    const f = new hb.Font(new hb.Face(new hb.Blob(bytes)));
    return (text, _font, { direction, kerning }) => {
      const buf = new hb.Buffer();
      buf.addText(text);
      buf.guessSegmentProperties();
      buf.setDirection(direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
      hb.shape(f, buf, kerning ? [] : [new hb.Feature('kern', 0)]);
      const pos = buf.getGlyphPositions();
      return buf.getGlyphInfos().map((g, i) => ({ g: g.codepoint, cl: g.cluster, ax: pos[i].xAdvance, dx: pos[i].xOffset, dy: pos[i].yOffset }));
    };
  };
  const COMPLEX = new Set(['hi', 'ar']);
  const canvas = async (out, o) => {
    const pdf = createPdf(fs.createWriteStream(out), { title: o.title, ...(o.pdfa ? { pdfa: true } : {}) });
    const f = {};
    for (const k of o.fonts) { const b = fs.readFileSync(font(k)); f[k] = await pdf.embedFont(b, COMPLEX.has(k) ? { shaper: shaper(b) } : {}); }
    let pg;
    return {
      async page() { if (pg) await pg.end(); pg = pdf.addPage({ width: P.w, height: P.h }); },
      text(s, x, y, size, k, { rtl } = {}) { pg.text(s, { x, y: y + 0.8 * size - f[k].ascent * size, font: f[k], size, ...(rtl ? { direction: 'rtl' } : {}) }); },
      width: (s, size, k) => f[k].widthOfText(s, size),
      rect(x, y, w, h, c) { pg.rect(x, y, w, h, { fill: c }); },
      hline(x1, x2, y, w, c) { pg.line(x1, y, x2, y, { color: c, width: w }); },
      image: async (file) => pdf.embedImage(fs.readFileSync(file)),
      draw(img, x, y, w, h) { pg.image(img, { x, y, width: w, height: h }); },
      async end() { if (pg) await pg.end(); await pdf.end(); },
    };
  };
  const load = async (f, o) => loadPdf(fs.readFileSync(f), o);
  return {
    version: `${ver('@reportwright/pdf')} (harfbuzzjs ${ver('harfbuzzjs')})`, canvas,
    extract: async (f) => (await load(f)).extractText(),
    async merge(files, out) { fs.writeFileSync(out, (await mergePdfs(await Promise.all(files.map(f => load(f))))).bytes); },
    async split(file, dir) {
      const d = await load(file);
      for (let i = 0; i < d.pageCount; i++) fs.writeFileSync(path.join(dir, `p-${String(i + 1).padStart(4, '0')}.pdf`), (await d.fork().reorder([i]).save()).bytes);
    },
    async encrypt(file, out, pw) { fs.writeFileSync(out, (await (await load(file)).save({ encrypt: { userPassword: pw.user, ownerPassword: pw.owner, algorithm: 'aes-256' } })).bytes); },
    async metadata(file, out, title) { const d = await load(file); d.setInfo({ title }); fs.writeFileSync(out, (await d.saveIncremental()).bytes); },
    async form(file, out, v) { fs.writeFileSync(out, (await (await load(file)).fill({ name: v.name, amount: v.amount, approved: v.approved }).flatten().save()).bytes); },
    async sign(file, out, c) {
      const signer = nodeSigner({ key: fs.readFileSync(c.key, 'utf8'), certs: fs.readFileSync(c.cert, 'utf8') });
      fs.writeFileSync(out, (await (await load(file)).saveIncremental({ sign: { field: spec.edit.signField, signer } })).bytes);
    },
  };
}

await main({ '@reportwright/engine': engine, '@reportwright/pdf': rwpdf });
