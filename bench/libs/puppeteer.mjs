// Puppeteer: HTML + CSS printed by headless Chrome. One browser per process, launched in setup() (counted in the load
// time, not the render time); a new page per document, as a server that keeps a browser running does. The fonts are
// @font-face data URLs of the same Inter files; the header row is a <thead> (Chrome repeats it on every page); "Page N
// of M" is a CSS @page margin box (counter(page), counter(pages); Chrome 131+), so it uses the document's font.
// Groups and subtotals come from groupsOf(). No PDF/A option; --ua passes tagged: true (Puppeteer's default is also on).
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { FONT, PAGE, COLS, INV_COLS, FONT_SIZE, ROW_H, INVOICE, BODY_W, money, groupsOf, grandTotal } from '../data.mjs';

export const name = 'puppeteer';
let browser, css;
export async function setup() {
  // --no-sandbox: a throwaway CI VM (Ubuntu's AppArmor blocks Chrome's user-namespace sandbox on GitHub's runners)
  browser = await puppeteer.launch({ args: process.platform === 'linux' ? ['--no-sandbox'] : [], protocolTimeout: 24 * 3600e3 });
  const face = (f, w) => `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(f).toString('base64')}) format("truetype")}`;
  css = face(FONT.regular, 400) + face(FONT.bold, 700) + `
@page{size:A4;margin:${PAGE.margin}pt ${PAGE.margin}pt ${PAGE.margin + PAGE.footer}pt ${PAGE.margin}pt;
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt Inter;vertical-align:top;padding-top:4pt}}
*{box-sizing:border-box}
body{margin:0;font:${FONT_SIZE}pt/1.1 Inter}
table{width:${BODY_W}pt;border-collapse:collapse;table-layout:fixed}
th,td{padding:0 2pt;white-space:nowrap;overflow:hidden;text-align:left;font-weight:400}
thead th{background:#eef2f7;height:16pt;font-weight:700}
td{height:${ROW_H}pt;border-bottom:.5pt solid #e5e7eb}
tr{break-inside:avoid}
.r{text-align:right}
.g td{background:#dbeafe;font-weight:700;height:16pt;border:0}
.t td{font-weight:700;border:0}`;
}
export async function teardown() { await browser.close(); }

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const colgroup = (cols) => `<colgroup>${cols.map(c => `<col style="width:${c.width}pt">`).join('')}</colgroup>`;
const pagesIn = (file) => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length || null;

async function print(html, out, o, title) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${html}</body></html>`, { waitUntil: 'load', timeout: 0 });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, timeout: 0, ...(o.ua ? { tagged: true } : {}) });
  await page.close();
}

export async function invoice(out, o = {}) {
  const I = INVOICE;
  const lines = (a, right) => a.map(l => `<div style="height:12pt${right ? ';text-align:right' : ''}">${esc(l)}</div>`).join('');
  const html = `
<div style="display:flex;justify-content:space-between;height:26pt;font:700 18pt Inter"><div>${esc(I.seller.name)}</div><div>INVOICE</div></div>
<div style="display:flex;justify-content:space-between;height:70pt"><div>${lines(I.seller.lines)}</div><div>${lines([`Invoice no ${I.number}`, `Date ${I.date}`, `Due ${I.due}`], true)}</div></div>
<div style="font-weight:700;height:14pt">Bill to</div><div style="font-weight:700;font-size:10pt;height:14pt">${esc(I.buyer.name)}</div>
<div style="height:72pt">${lines(I.buyer.lines)}</div>
<table>${colgroup(INV_COLS)}<thead><tr>${INV_COLS.map(c => `<th${c.right ? ' class="r"' : ''} style="height:18pt">${c.label}</th>`).join('')}</tr></thead><tbody>
${I.items.map(it => `<tr>${INV_COLS.map(c => `<td${c.right ? ' class="r"' : ''} style="height:18pt">${esc(it[c.key])}</td>`).join('')}</tr>`).join('')}
${[['Subtotal', I.subtotal], ['VAT 20%', I.tax], ['Total', I.total]].map(([l, v], i) => `<tr class="${i === 2 ? 't' : ''}"><td style="border:0;height:18pt"></td><td style="border:0"></td><td class="r" style="border:0">${l}</td><td class="r" style="border:0">${v}</td></tr>`).join('')}
</tbody></table>
<p style="margin:24pt 0 0">${esc(I.note)}</p>`;
  await print(html, out, o, 'Invoice');
  return { pages: pagesIn(out) };
}

export async function table(rows, out, o = {}) {
  const groups = groupsOf(rows);
  const parts = [`<table>${colgroup(COLS)}<thead><tr>${COLS.map(c => `<th${c.right ? ' class="r"' : ''}>${c.label}</th>`).join('')}</tr></thead><tbody>`];
  const total = (label, g) => `<tr class="t"><td colspan="2">${label}</td><td>${g.count}</td><td></td><td></td><td class="r">${money(g.sum)}</td><td></td></tr>`;
  for (const g of groups) {
    parts.push(`<tr class="g"><td colspan="7">Region ${esc(g.region)}</td></tr>`);
    for (const x of g.rows) parts.push(`<tr><td>${x.id}</td><td>${esc(x.account)}</td><td>${esc(x.region)}</td><td>${esc(x.type)}</td><td>${x.date}</td><td class="r">${money(x.amount)}</td><td>${esc(x.reference)}</td></tr>`);
    parts.push(total('Region total', g));
  }
  parts.push(total('Grand total', grandTotal(groups)), '</tbody></table>');
  await print(parts.join(''), out, o, 'Ledger');
  return { pages: pagesIn(out) };
}
