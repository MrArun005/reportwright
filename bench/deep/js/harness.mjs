// JavaScript contestants: node harness.mjs <lib> <job> <size> <outdir> (common/frame.mjs has the contract).
// Each library is imported only when it is the one asked for, so a cold start pays for that library alone.
// Low-level writers (pdf-lib, PDFKit, jsPDF) draw through common/canvas-jobs.mjs: the same operations for each.
// pdfmake and @react-pdf/renderer lay out their own document definitions; Puppeteer prints fixtures/html/*.html.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { main } from '../common/frame.mjs';
import { spec, fx, money, groupsOf } from '../common/data.mjs';

const require = createRequire(import.meta.url);
const ver = (p) => JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules', p, 'package.json'), 'utf8')).version; // some packages do not export ./package.json
const P = spec.page, R = spec.report;
const font = (k) => fx(spec.fonts[k]);
const rgb01 = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// ---------------------------------------------------------------- pdf-lib
async function pdflib() {
  const { PDFDocument, rgb } = await import('pdf-lib');
  globalThis.regeneratorRuntime ??= require('regenerator-runtime'); // @pdf-lib/fontkit's complex-script shaper expects the global
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const col = (h) => rgb(...rgb01(h));
  const canvas = async (out, o) => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle(o.title);
    const f = {};
    for (const k of o.fonts) f[k] = await doc.embedFont(fs.readFileSync(font(k)), { subset: true });
    let pg;
    return {
      page() { pg = doc.addPage([P.w, P.h]); },
      text(s, x, y, size, k) { pg.drawText(s, { x, y: P.h - y - 0.8 * size, size, font: f[k] }); },
      width: (s, size, k) => f[k].widthOfTextAtSize(s, size),
      rect(x, y, w, h, c) { pg.drawRectangle({ x, y: P.h - y - h, width: w, height: h, color: col(c) }); },
      hline(x1, x2, y, w, c) { pg.drawLine({ start: { x: x1, y: P.h - y }, end: { x: x2, y: P.h - y }, thickness: w, color: col(c) }); },
      image: async (file) => (file.endsWith('.png') ? doc.embedPng(fs.readFileSync(file)) : doc.embedJpg(fs.readFileSync(file))),
      draw(img, x, y, w, h) { pg.drawImage(img, { x, y: P.h - y - h, width: w, height: h }); },
      async end() { fs.writeFileSync(out, await doc.save()); },
    };
  };
  const load = (f) => PDFDocument.load(fs.readFileSync(f), { ignoreEncryption: true });
  return {
    version: ver('pdf-lib'), canvas,
    async parse(f) { const d = await load(f); for (const p of d.getPages()) p.getSize(); await d.save(); },
    async merge(files, out) {
      const d = await PDFDocument.create();
      for (const f of files) { const s = await load(f); for (const p of await d.copyPages(s, s.getPageIndices())) d.addPage(p); }
      fs.writeFileSync(out, await d.save());
    },
    async split(file, dir) {
      const s = await load(file);
      for (const i of s.getPageIndices()) {
        const d = await PDFDocument.create();
        d.addPage((await d.copyPages(s, [i]))[0]);
        fs.writeFileSync(path.join(dir, `p-${String(i + 1).padStart(4, '0')}.pdf`), await d.save());
      }
    },
    async form(file, out, v) {
      const d = await load(file), form = d.getForm();
      form.getTextField('name').setText(v.name);
      form.getTextField('amount').setText(v.amount);
      if (v.approved) form.getCheckBox('approved').check();
      form.flatten();
      fs.writeFileSync(out, await d.save());
    },
  };
}

// ---------------------------------------------------------------- PDFKit (streams to the file as pages end)
async function pdfkit() {
  const PDFDocument = (await import('pdfkit')).default;
  const canvas = async (out, o) => {
    const doc = new PDFDocument({ size: [P.w, P.h], margin: 0, autoFirstPage: false, info: { Title: o.title },
      ...(o.pdfa ? { subset: 'PDF/A-2b', pdfVersion: '1.7' } : {}) });
    const done = new Promise((ok, fail) => doc.pipe(fs.createWriteStream(out)).on('finish', ok).on('error', fail));
    for (const k of o.fonts) doc.registerFont(k, font(k));
    return {
      page() { doc.addPage({ size: [P.w, P.h], margin: 0 }); },
      text(s, x, y, size, k) { doc.font(k).fontSize(size).fillColor('black').text(s, x, y + 0.8 * size, { lineBreak: false, baseline: 'alphabetic' }); },
      width: (s, size, k) => doc.font(k).fontSize(size).widthOfString(s),
      rect(x, y, w, h, c) { doc.rect(x, y, w, h).fill(c); },
      hline(x1, x2, y, w, c) { doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(c).stroke(); },
      image: async (file) => doc.openImage(file),
      draw(img, x, y, w, h) { doc.image(img, x, y, { width: w, height: h }); },
      async end() { doc.end(); await done; },
    };
  };
  return { version: ver('pdfkit'), canvas };
}

// ---------------------------------------------------------------- jsPDF
async function jspdf() {
  const { jsPDF } = await import('jspdf');
  const canvas = async (out, o) => {
    const doc = new jsPDF({ unit: 'pt', format: [P.w, P.h], compress: true });
    doc.setProperties({ title: o.title });
    for (const k of o.fonts) { doc.addFileToVFS(`${k}.ttf`, fs.readFileSync(font(k)).toString('base64')); doc.addFont(`${k}.ttf`, k, 'normal'); }
    let first = true;
    const use = (k, size) => { doc.setFont(k, 'normal'); doc.setFontSize(size); };
    return {
      page() { if (first) first = false; else doc.addPage([P.w, P.h]); },
      text(s, x, y, size, k) { use(k, size); doc.text(s, x, y + 0.8 * size); },
      width: (s, size, k) => { use(k, size); return doc.getTextWidth(s); },
      rect(x, y, w, h, c) { doc.setFillColor(c); doc.rect(x, y, w, h, 'F'); },
      hline(x1, x2, y, w, c) { doc.setDrawColor(c); doc.setLineWidth(w); doc.line(x1, y, x2, y); },
      image: async (file) => { const data = `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`; return { data, fmt: file.endsWith('.png') ? 'PNG' : 'JPEG', ...doc.getImageProperties(data) }; },
      draw(img, x, y, w, h) { doc.addImage(img.data, img.fmt, x, y, w, h, undefined, 'FAST'); },
      async end() { fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer'))); },
    };
  };
  return { version: ver('jspdf'), canvas };
}

// ---------------------------------------------------------------- pdfmake (document definition, its own layout)
async function pdfmake() {
  const pm = (await import('pdfmake')).default;
  const fonts = Object.fromEntries(Object.keys(spec.fonts).filter(k => k !== 'b').map(k => [k, { normal: font(k), bold: k === 'r' ? font('b') : font(k), italics: font(k), bolditalics: font(k) }]));
  pm.setFonts(fonts);
  pm.setUrlAccessPolicy(() => false);
  pm.setLocalAccessPolicy((p) => p.startsWith(fx('fonts')));
  const write = (dd, out, title) => pm.createPdf({ pageSize: { width: P.w, height: P.h }, info: { title }, defaultStyle: { font: 'r', fontSize: 9, lineHeight: 1 }, ...dd }).write(out);
  const dataUrl = (f) => `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}`;
  const abs = (text, x, y, extra = {}) => ({ text, absolutePosition: { x, y }, ...extra });
  const invoice = async (_c, out, o = {}) => {
    const I = spec.invoice, T = I.table;
    const content = I.texts.map(t => t.right
      ? { columns: [{ width: '*', text: '' }, { width: t.w, text: t.text, alignment: 'right', fontSize: t.size, bold: t.bold }], absolutePosition: { x: t.x - (P.w - 2 * P.margin - t.w), y: t.y } }
      : abs(t.text, t.x, t.y, { fontSize: t.size, bold: t.bold }));
    content.push({ image: dataUrl(fx(I.logo.file)), width: I.logo.w, height: I.logo.h, absolutePosition: { x: I.logo.x, y: I.logo.y } });
    const cell = (v, c, bold) => ({ text: v, alignment: c.right ? 'right' : 'left', bold, margin: [0, 3, 0, 2] });
    content.push({ absolutePosition: { x: T.x, y: T.y }, layout: { hLineWidth: (i) => (i > 1 && i <= T.rows.length + 1 ? 0.5 : 0), vLineWidth: () => 0, hLineColor: () => R.rule, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 0, paddingBottom: () => 0 },
      table: { widths: T.cols.map(c => c.w - 4), heights: T.rowH, body: [
        T.cols.map(c => ({ ...cell(c.label, c, true), fillColor: R.headBg })),
        ...T.rows.map(r => r.map((v, i) => cell(v, T.cols[i]))),
        ...T.totals.map(([l, v], i) => ['', '', cell(l, T.cols[2], i === 2), cell(v, T.cols[3], i === 2)]),
      ] } });
    await write({ pageMargins: [P.margin, P.margin, P.margin, P.margin], content, ...(o.pdfa ? { subset: 'PDF/A-2b', version: '1.7' } : {}) }, out, 'Invoice');
  };
  return {
    version: ver('pdfmake'), invoice,
    pdfa: (c, out) => invoice(c, out, { pdfa: true }),
    async plain({ pool, pages }, out) {
      const s = spec.plain, content = [];
      // each line at its spec position, as the canvas writers draw it (a flowed line's height depends on the font's metrics)
      for (let p = 0; p < pages; p++) {
        if (p) content.push({ text: '', pageBreak: 'before' });
        for (let k = 0; k < s.linesPerPage; k++) content.push(abs(pool[(p * s.linesPerPage + k) % pool.length], s.x, s.y + k * s.leading, { fontSize: s.size }));
      }
      await write({ pageMargins: [s.x, s.y, s.x, 0], content }, out, 'Plain');
    },
    async report({ rows }, out) {
      const groups = groupsOf(rows);
      const total = (label, g) => [{ text: label, bold: true, colSpan: 2 }, '', { text: String(g.count), bold: true }, '', '', { text: money(g.sum), bold: true, alignment: 'right' }, ''];
      const body = [R.cols.map(c => ({ text: c.label, bold: true, fillColor: R.headBg, alignment: c.right ? 'right' : 'left' }))];
      let count = 0, sum = 0;
      for (const g of groups) {
        body.push([{ text: `Region ${g.region}`, bold: true, fillColor: R.groupBg, colSpan: 7 }, '', '', '', '', '', '']);
        for (const x of g.rows) body.push([String(x.id), x.account, x.region, x.type, x.date, { text: money(x.amount), alignment: 'right' }, x.reference]);
        body.push(total('Region total', g));
        count += g.count; sum += g.sum;
      }
      body.push(total('Grand total', { count, sum }));
      await write({ pageMargins: [P.margin, P.margin, P.margin, P.margin + P.footer],
        footer: (n, m) => ({ text: `Page ${n} of ${m}`, alignment: 'right', fontSize: R.footerSize, margin: [P.margin, 4, P.margin, 0] }),
        content: [{ table: { headerRows: 1, widths: R.cols.map(c => c.w - 4), body }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => R.rule, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 1 } }] }, out, 'Ledger');
    },
    async unicode(_c, out) {
      const U = spec.unicode;
      await write({ pageMargins: [0, 0, 0, 0], content: U.lines.map(l => abs(l.text, l.x, l.y, { font: l.font, fontSize: U.size })) }, out, 'Unicode');
    },
    async images(_c, out) {
      const I = spec.images;
      await write({ pageMargins: [I.x, I.y, I.x, I.y], content: [
        { image: dataUrl(fx(I.png)), width: I.w, pageBreak: 'after' }, { image: dataUrl(fx(I.jpeg)), width: I.w }] }, out, 'Images');
    },
  };
}

// ---------------------------------------------------------------- @react-pdf/renderer
async function reactpdf() {
  const React = (await import('react')).default;
  const { Document, Page, View, Text, Image, Font, renderToFile } = await import('@react-pdf/renderer');
  const h = React.createElement;
  Font.register({ family: 'r', fonts: [{ src: font('r') }, { src: font('b'), fontWeight: 'bold' }] });
  for (const k of ['hi', 'ar', 'cjk']) Font.register({ family: k, src: font(k) });
  Font.registerHyphenationCallback((w) => [w]);
  const A = (x, y, extra = {}) => ({ position: 'absolute', left: x, top: y, ...extra });
  const page = (style, ...kids) => h(Page, { size: [P.w, P.h], style: { fontFamily: 'r', fontSize: 9, ...style } }, ...kids);
  const save = (out, title, ...pages) => renderToFile(h(Document, { title }, ...pages), out);
  const cellStyle = (w, right, bold) => ({ width: w, paddingHorizontal: 2, textAlign: right ? 'right' : 'left', ...(bold ? { fontWeight: 'bold' } : {}) });
  const row = (height, cells, extra = {}, props = {}) => h(View, { wrap: false, style: { flexDirection: 'row', alignItems: 'center', height, borderBottomWidth: 0.5, borderBottomColor: R.rule, ...extra }, ...props }, ...cells);
  const txt = (s, w, right, bold) => h(Text, { style: cellStyle(w, right, bold) }, s);
  return {
    version: ver('@react-pdf/renderer'),
    async plain({ pool, pages }, out) {
      const s = spec.plain, ps = [];
      for (let p = 0; p < pages; p++)
        ps.push(page({}, ...Array.from({ length: s.linesPerPage }, (_, k) => h(Text, { key: k, style: A(s.x, s.y + k * s.leading, { fontSize: s.size }) }, pool[(p * s.linesPerPage + k) % pool.length]))));
      await save(out, 'Plain', ...ps);
    },
    async report({ rows }, out) {
      const groups = groupsOf(rows);
      const cells = (vals, bold) => R.cols.map((c, i) => txt(vals[i], c.w, c.right, bold));
      const total = (label, g, key) => row(R.rowH, cells([label, '', String(g.count), '', '', money(g.sum), ''], true), { borderBottomWidth: 0 }, { key });
      const body = [];
      let count = 0, sum = 0;
      for (const g of groups) {
        body.push(row(R.groupH, [txt(`Region ${g.region}`, 523, false, true)], { backgroundColor: R.groupBg, borderBottomWidth: 0 }, { key: `g${g.region}`, minPresenceAhead: R.rowH }));
        for (const x of g.rows) body.push(row(R.rowH, cells([String(x.id), x.account, x.region, x.type, x.date, money(x.amount), x.reference]), {}, { key: x.id }));
        body.push(total('Region total', g, `t${g.region}`));
        count += g.count; sum += g.sum;
      }
      body.push(total('Grand total', { count, sum }, 'grand'));
      await save(out, 'Ledger', h(Page, { size: [P.w, P.h], wrap: true, style: { fontFamily: 'r', fontSize: R.size, paddingTop: P.margin, paddingLeft: P.margin, paddingRight: P.margin, paddingBottom: P.margin + P.footer } },
        row(R.headH, cells(R.cols.map(c => c.label), true), { backgroundColor: R.headBg, borderBottomWidth: 0 }, { fixed: true }),
        ...body,
        h(Text, { fixed: true, style: { position: 'absolute', left: P.margin, right: P.margin, bottom: P.margin, fontSize: R.footerSize, textAlign: 'right' },
          render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` })));
    },
    async invoice(_c, out) {
      const I = spec.invoice, T = I.table;
      const kids = I.texts.map((t, i) => h(Text, { key: i, style: A(t.x, t.y, { fontSize: t.size, ...(t.bold ? { fontWeight: 'bold' } : {}), ...(t.right ? { width: t.w, textAlign: 'right' } : {}) }) }, t.text));
      kids.push(h(Image, { src: { data: fs.readFileSync(fx(I.logo.file)), format: 'png' }, style: A(I.logo.x, I.logo.y, { width: I.logo.w, height: I.logo.h }) }));
      kids.push(h(View, { style: A(T.x, T.y) },
        row(T.rowH, T.cols.map(c => txt(c.label, c.w, c.right, true)), { backgroundColor: R.headBg, borderBottomWidth: 0 }),
        ...T.rows.map(r => row(T.rowH, r.map((v, i) => txt(v, T.cols[i].w, T.cols[i].right)))),
        ...T.totals.map(([l, v], i) => row(T.rowH, [txt('', T.cols[0].w), txt('', T.cols[1].w), txt(l, T.cols[2].w, true, i === 2), txt(v, T.cols[3].w, true, i === 2)], { borderBottomWidth: 0 }))));
      await save(out, 'Invoice', page({}, ...kids));
    },
    async unicode(_c, out) {
      const U = spec.unicode;
      await save(out, 'Unicode', page({}, ...U.lines.map((l, i) => h(Text, { key: i, style: A(l.x, l.y, { fontFamily: l.font, fontSize: U.size }) }, l.text))));
    },
    async images(_c, out) {
      const I = spec.images;
      await save(out, 'Images', ...[I.png, I.jpeg].map(f => page({}, h(Image, { src: { data: fs.readFileSync(fx(f)), format: f.endsWith('.png') ? 'png' : 'jpg' }, style: A(I.x, I.y, { width: I.w }) }))));
    },
  };
}

// ---------------------------------------------------------------- pdf.js (read only)
async function pdfjs() {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const extract = async (f) => {
    const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(f)), password: '', isEvalSupported: false, verbosity: 0 }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    await doc.destroy();
    return out.join('\n');
  };
  return { version: ver('pdfjs-dist'), extract };
}

// ---------------------------------------------------------------- Puppeteer (headless Chrome prints the shared HTML)
async function puppeteer() {
  const pp = (await import('puppeteer')).default;
  let browser;
  const print = async (name, out) => {
    browser ??= await pp.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '--allow-file-access-from-files'] : [], protocolTimeout: 24 * 3600e3 });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(fx(path.join(spec.html.dir, name))).href, { waitUntil: 'load', timeout: 0 });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, timeout: 0 });
    await page.close();
  };
  return {
    version: async () => { const b = await pp.launch({ args: ['--no-sandbox'] }); const v = await b.version(); await b.close(); return `${ver('puppeteer')} (${v})`; },
    plain: ({ pages }, out) => print(`plain-${pages}.html`, out),
    report: ({ rows }, out) => print(`report-${rows.length}.html`, out),
    invoice: (_c, out) => print('invoice.html', out),
    unicode: (_c, out) => print('unicode.html', out),
    images: (_c, out) => print('images.html', out),
    close: async () => browser?.close(),
  };
}

await main({ 'pdf-lib': pdflib, pdfkit, jspdf, pdfmake, '@react-pdf/renderer': reactpdf, 'pdfjs-dist': pdfjs, puppeteer });
