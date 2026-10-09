// Run by hostile-reader-review.test.js in its own process (a time limit and --max-old-space-size): an input that can
// exhaust the heap kills the process, which no in-process test survives. argv[2] names the case; it prints one JSON
// line { code, ms, text? } (code: 'OK' or the PdfReadError code).
import { deflateSync } from 'node:zlib';
import { loadPdf } from '../../packages/pdf/src/index.js';

/** a PDF of numbered objects: { n: text | { dict, data } } */
function build(objs) {
  const parts = []; let pos = 0;
  const push = (s) => { const b = typeof s === 'string' ? Buffer.from(s, 'latin1') : Buffer.from(s); parts.push(b); pos += b.length; };
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
  const offs = {};
  const nums = Object.keys(objs).map(Number).sort((a, b) => a - b);
  for (const n of nums) {
    offs[n] = pos; const o = objs[n];
    if (typeof o === 'string') push(`${n} 0 obj\n${o}\nendobj\n`);
    else { push(`${n} 0 obj\n${o.dict.replace(/>>\s*$/, `/Length ${o.data.length} >>`)}\nstream\n`); push(o.data); push('\nendstream\nendobj\n'); }
  }
  const max = Math.max(...nums), xat = pos;
  let x = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) x += offs[i] != null ? `${String(offs[i]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  push(`${x}trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xat}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}
const doc = (page, content, more) => build({
  1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R ${page} >>`,
  4: { dict: '<< >>', data: Buffer.from(content) }, ...more,
});
const cmap = (body) => ({ dict: '<< /Filter /FlateDecode >>', data: deflateSync(Buffer.from(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <00> <FF> endcodespacerange\n${body} endcmap end end`)) });

const CASES = {
  // R1: a bfrange over 65,536 codes with a 20,000-byte destination: 1.3 GB of strings from an 831-byte file
  'cmap-long-dst': () => [doc('/Resources << /Font << /F1 5 0 R >> >>', 'BT /F1 12 Tf 10 10 Td (A) Tj ET', {
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>', 6: cmap(`1 beginbfrange <0000> <FFFF> <${'4e01'.repeat(10000)}> endbfrange`),
  }), { timeoutMs: 5000 }],
  // R1: destinations short enough to pass, but 65,536 × 64 code units: past the characters one CMap may hold
  'cmap-chars': () => [doc('/Resources << /Font << /F1 5 0 R >> >>', 'BT /F1 12 Tf 10 10 Td (A) Tj ET', {
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>', 6: cmap(`1 beginbfrange <0000> <FFFF> <${'4e01'.repeat(64)}> endbfrange`),
  }), {}],
  // R1: 200 fonts, each CMap just under the per-CMap cap: past what one extraction may hold
  'cmap-many-fonts': () => {
    const more = {}, fonts = [];
    let content = 'BT 10 10 Td ';
    for (let i = 0; i < 200; i++) {
      more[5 + 2 * i] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${6 + 2 * i} 0 R >>`;
      more[6 + 2 * i] = cmap(`1 beginbfrange <0000> <FFFF> <${'4e01'.repeat(60)}> endbfrange`);
      fonts.push(`/F${i} ${5 + 2 * i} 0 R`); content += `/F${i} 12 Tf (A) Tj `;
    }
    return [doc(`/Resources << /Font << ${fonts.join(' ')} >> >>`, `${content}ET`, more), {}];
  },
  // R2: /W [0 65535 500] 20,000 times (240 KB): 65,536 Map.set each, none a budget step (30 s, timeoutMs 1000 ignored)
  'w-ranges': () => [type0(`/W [${'0 65535 500 '.repeat(20000)}]`), { timeoutMs: 1000 }],
  // R2: /W [0 7 0 R …] where 7 is an array of 60,000 widths, 2,000 times
  'w-arrays': () => [type0(`/W [${'0 7 0 R '.repeat(2000)}]`, { 7: `[${'500 '.repeat(60000)}]` }), { timeoutMs: 1000 }],
  // R2 (the audit): a /Kids array of 20,000 page-tree nodes, each with that same /Kids: every kid pushed again at
  // every level (400 M entries)
  'page-tree-shared-kids': () => {
    const L = 20000, more = { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids 3 0 R /Count 1 >>' };
    more[3] = `[${Array.from({ length: L }, (_, i) => `${4 + i} 0 R`).join(' ')}]`;
    for (let i = 0; i < L; i++) more[4 + i] = '<< /Type /Pages /Kids 3 0 R >>';
    return [build(more), { timeoutMs: 10000 }];
  },
};
function type0(w, more = {}) {
  return doc('/Resources << /Font << /F1 5 0 R >> >>', 'BT /F1 12 Tf 10 10 Td <0041> Tj ET', {
    5: '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] >>',
    6: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X ${w} >>`, ...more,
  });
}

const [bytes, o] = CASES[process.argv[2]]();
const t = Date.now();
let r;
try { const d = await loadPdf(bytes, o); const text = d.page(0).extractText(); r = { code: 'OK', text: text.slice(0, 200) }; } catch (e) { r = { code: e.code ?? e.name, message: String(e.message).slice(0, 300) }; }
console.log(JSON.stringify({ ...r, ms: Date.now() - t }));
