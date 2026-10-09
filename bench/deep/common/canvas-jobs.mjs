// The create jobs, written once over a small drawing surface that each low-level library provides (pdf-lib, PDFKit,
// jsPDF, @reportwright/pdf): the same drawing operations for all of them. The same code exists in each language's
// harness (python/canvas_jobs.py, java Jobs.java, ...). Coordinates: points from the top-left; y is the top of a line.
//   const cv = await open(out, { fonts: ['r', 'b'], title })   fonts: keys of spec.fonts
//   await cv.page() (a streaming writer ends the previous page there); cv.text(s, x, yTop, size, font, { rtl }) cv.width(s, size, font) cv.rect(x, y, w, h, '#hex')
//   cv.hline(x1, x2, y, width, '#hex') await cv.image(file) -> img; cv.draw(img, x, y, w, h); await cv.end()
import { spec, fx, money, groupsOf } from './data.mjs';

const P = spec.page, R = spec.report;
const BOTTOM = P.h - P.margin - P.footer;

export async function plain(open, { pool, pages }, out) {
  const s = spec.plain, cv = await open(out, { fonts: ['r'], title: 'Plain' });
  for (let p = 0; p < pages; p++) {
    await cv.page();
    for (let k = 0; k < s.linesPerPage; k++) cv.text(pool[(p * s.linesPerPage + k) % pool.length], s.x, s.y + k * s.leading, s.size, 'r');
  }
  await cv.end();
}

/** The page plan: which header, group header, row and total goes on which page. Known before drawing, so "of M" is too. */
export function plan(rows) {
  const pages = [];
  let cur, y;
  const newPage = () => { pages.push((cur = [])); y = P.margin + R.headH; };
  const need = (h) => { if (y + h > BOTTOM) newPage(); };
  newPage();
  const groups = groupsOf(rows);
  let count = 0, sum = 0;
  for (const g of groups) {
    need(R.groupH + R.rowH);
    cur.push({ k: 'G', y, g }); y += R.groupH;
    for (const r of g.rows) { need(R.rowH); cur.push({ k: 'R', y, r }); y += R.rowH; }
    need(R.rowH); cur.push({ k: 'S', y, label: 'Region total', count: g.count, sum: g.sum }); y += R.rowH;
    count += g.count; sum += g.sum;
  }
  need(R.rowH); cur.push({ k: 'S', y, label: 'Grand total', count, sum });
  return pages;
}

function cells(cv, y, h, vals, bold) {
  let x = P.margin;
  const base = y + (h - R.size) / 2;
  R.cols.forEach((c, i) => {
    const v = vals[i];
    if (v) cv.text(v, c.right ? x + c.w - 2 - cv.width(v, R.size, bold ? 'b' : 'r') : x + 2, base, R.size, bold ? 'b' : 'r');
    x += c.w;
  });
}

export async function report(open, { rows }, out) {
  const cv = await open(out, { fonts: ['r', 'b'], title: 'Ledger' });
  const pages = plan(rows), W = R.cols.reduce((s, c) => s + c.w, 0);
  for (let i = 0; i < pages.length; i++) {
    const ops = pages[i];
    await cv.page();
    cv.rect(P.margin, P.margin, W, R.headH, R.headBg);
    cells(cv, P.margin, R.headH, R.cols.map(c => c.label), true);
    for (const o of ops) {
      if (o.k === 'G') { cv.rect(P.margin, o.y, W, R.groupH, R.groupBg); cv.text(`Region ${o.g.region}`, P.margin + 2, o.y + 3.5, R.size, 'b'); }
      else if (o.k === 'R') {
        const r = o.r;
        cells(cv, o.y, R.rowH, [String(r.id), r.account, r.region, r.type, r.date, money(r.amount), r.reference], false);
        cv.hline(P.margin, P.margin + W, o.y + R.rowH, 0.5, R.rule);
      } else cells(cv, o.y, R.rowH, [o.label, '', String(o.count), '', '', money(o.sum), ''], true);
    }
    const f = R.footerText.replace('{n}', i + 1).replace('{m}', pages.length);
    cv.text(f, P.margin + W - cv.width(f, R.footerSize, 'r'), BOTTOM + 4, R.footerSize, 'r');
  }
  await cv.end();
  return { note: `${pages.length} pages` };
}

export async function invoice(open, _ctx, out, o = {}) {
  const I = spec.invoice, T = I.table, cv = await open(out, { fonts: ['r', 'b'], title: 'Invoice', ...o });
  await cv.page();
  for (const t of I.texts) {
    const f = t.bold ? 'b' : 'r';
    cv.text(t.text, t.right ? t.x + t.w - cv.width(t.text, t.size, f) : t.x, t.y, t.size, f);
  }
  const logo = await cv.image(fx(I.logo.file));
  cv.draw(logo, I.logo.x, I.logo.y, I.logo.w, I.logo.h);
  const W = T.cols.reduce((s, c) => s + c.w, 0);
  const row = (y, vals, bold) => {
    let x = T.x;
    T.cols.forEach((c, i) => {
      const v = vals[i], f = bold ? 'b' : 'r';
      if (v) cv.text(v, c.right ? x + c.w - 2 - cv.width(v, T.size, f) : x + 2, y + 5, T.size, f);
      x += c.w;
    });
  };
  let y = T.y;
  cv.rect(T.x, y, W, T.rowH, R.headBg); row(y, T.cols.map(c => c.label), true); y += T.rowH;
  for (const r of T.rows) { row(y, r, false); cv.hline(T.x, T.x + W, y + T.rowH, 0.5, R.rule); y += T.rowH; }
  T.totals.forEach(([l, v], i) => { row(y, ['', '', l, v], i === 2); y += T.rowH; });
  await cv.end();
}

export async function pdfa(open, ctx, out) { return invoice(open, ctx, out, { pdfa: true }); }

export async function unicode(open, _ctx, out) {
  const U = spec.unicode, cv = await open(out, { fonts: U.lines.map(l => l.font), title: 'Unicode' });
  await cv.page();
  for (const l of U.lines) cv.text(l.text, l.x, l.y, U.size, l.font, { rtl: !!l.rtl });
  await cv.end();
}

export async function images(open, _ctx, out) {
  const I = spec.images, cv = await open(out, { fonts: [], title: 'Images' });
  for (const f of [I.png, I.jpeg]) {
    await cv.page();
    const img = await cv.image(fx(f));
    cv.draw(img, I.x, I.y, I.w, I.w * img.height / img.width);
  }
  await cv.end();
}
