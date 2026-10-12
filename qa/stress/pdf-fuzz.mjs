// qa-security: hostile and fuzzed PDFs into the reader (@reportwright/pdf loadPdf, then mergePdfs: what a merged batch
// does with stored PDFs). Each input runs in its own child with a 512 MB heap and a 10 s limit:
//   PASS  the reader loaded it or refused it with an Error (exit 0 or 3)
//   FAIL  a crash (signal, out of memory, any other exit) or a hang (killed at 10 s)
//   node qa/stress/pdf-fuzz.mjs            (parent; QA_TIER=full → 2,000 mutations, else 300)
//   node qa/stress/pdf-fuzz.mjs one <file> (child)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

if (process.argv[2] === 'one') {
  const { loadPdf, mergePdfs } = await import('@reportwright/pdf');
  try {
    const doc = await loadPdf(new Uint8Array(fs.readFileSync(process.argv[3])));
    await mergePdfs([doc]);
    process.exit(0);
  } catch (e) {
    if (e instanceof Error && !(e instanceof RangeError && /call stack/i.test(e.message))) process.exit(3);
    console.error(String(e?.stack || e)); process.exit(4); // a stack overflow or a non-Error throw counts as a crash
  }
}

const { record, QA_DIR, TIER } = await import('./lib.mjs');
const { render } = await import('../../src/engine/index.js');
const { exportPdf } = await import('../../src/exporters/pdf.js');
const { fontStore } = await import('../../tests/helpers.js');
const DIR = path.join(QA_DIR, 'fuzz');
fs.mkdirSync(DIR, { recursive: true });

const seed = Buffer.from(await exportPdf(await render({ $schema: 'reportwright/report@1', name: 'Seed', page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 14, value: 'seed ✓ हिन्दी' }, { type: 'shape', name: 'S', x: 0, y: 30, w: 100, h: 40 }] } } }, { fontStore }), fontStore, { title: 'seed' }));

const obj = (body) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1');
const bomb = zlib.deflateSync(Buffer.alloc(256 * 1048576), { level: 9 }); // 256 MB of zeros in ~256 KB
const hostile = {
  empty: Buffer.alloc(0),
  'header only': Buffer.from('%PDF-1.7\n'),
  'truncated half': seed.subarray(0, seed.length >> 1),
  'no xref, no trailer': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj'),
  'startxref past the end': obj('1 0 obj << /Type /Catalog >> endobj\nstartxref\n999999999'),
  'xref /Prev loop': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer << /Size 3 /Root 1 0 R /Prev 116 >>\nstartxref\n116'),
  'Pages /Kids cycle': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Pages /Kids [2 0 R] /Count 1 /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>'),
  'self-referencing /Parent page': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [2 0 R] /Count 999999 >> endobj\ntrailer << /Root 1 0 R >>'),
  'nested arrays ×200k': obj(`1 0 obj ${'['.repeat(200000)}${']'.repeat(200000)} endobj\ntrailer << /Root 1 0 R >>`),
  'nested dicts ×100k': obj(`1 0 obj ${'<< /A '.repeat(100000)}1${' >>'.repeat(100000)} endobj\ntrailer << /Root 1 0 R >>`),
  '/Length 2^31': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Length 2147483647 >>\nstream\nabc\nendstream\nendobj\ntrailer << /Root 1 0 R >>'),
  'negative /Count and /Size': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count -5 >> endobj\ntrailer << /Size -1 /Root 1 0 R >>'),
  'ObjStm /N 1e9': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /ObjStm /N 1000000000 /First 0 /Length 3 >>\nstream\n1 0\nendstream\nendobj\ntrailer << /Root 1 0 R >>'),
  'deflate bomb content (256 MB)': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >> endobj\n', 'latin1'),
    Buffer.from(`4 0 obj << /Length ${bomb.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), bomb, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]),
  'huge name and string': obj(`1 0 obj << /${'A'.repeat(5_000_000)} (${'x'.repeat(5_000_000)}) >> endobj\ntrailer << /Root 1 0 R >>`),
  'encrypted with bogus /Encrypt': obj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R /Encrypt << /Filter /Standard /V 99 /R 99 /O <00> /U <00> /P -1 >> >>'),
  'xref 1e9 entries': obj('xref\n0 1000000000\n0000000000 65535 f \ntrailer << /Size 1000000000 >>\nstartxref\n10'),
};
let rnd = 20261011;
const r = () => (rnd = (rnd * 1103515245 + 12345) >>> 0) / 4294967296;
const N = TIER === 'full' ? 2000 : 300;
const cases = Object.entries(hostile).map(([k, b]) => [`hostile: ${k}`, b]);
for (let i = 0; i < N; i++) {
  const b = Buffer.from(seed);
  const kind = i % 4;
  if (kind === 0) for (let k = 0; k < 1 + Math.floor(r() * 20); k++) b[Math.floor(r() * b.length)] = Math.floor(r() * 256); // byte flips
  if (kind === 1) { const at = Math.floor(r() * b.length); cases.push([`mutation ${i} (cut at ${at})`, b.subarray(0, at)]); continue; }
  if (kind === 2) { const s = b.toString('latin1').replace(/\d+/g, (m) => (r() < 0.05 ? String(Math.floor(r() * 2 ** 31) * (r() < 0.3 ? -1 : 1)) : m)); cases.push([`mutation ${i} (numbers)`, Buffer.from(s, 'latin1')]); continue; }
  if (kind === 3) { const a = Math.floor(r() * b.length), c = Math.floor(r() * b.length); cases.push([`mutation ${i} (splice)`, Buffer.concat([b.subarray(0, a), b.subarray(c)])]); continue; }
  cases.push([`mutation ${i} (flips)`, b]);
}

const runOne = ([name, bytes], i) => new Promise((ok) => {
  const f = path.join(DIR, `case-${i}.pdf`);
  fs.writeFileSync(f, bytes);
  const t0 = performance.now();
  const p = spawn(process.execPath, ['--max-old-space-size=512', import.meta.filename, 'one', f], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { if (err.length < 2000) err += d; });
  const t = setTimeout(() => p.kill('SIGKILL'), 10_000);
  p.on('close', (code, sig) => { clearTimeout(t); ok({ name, i, code, sig, ms: Math.round(performance.now() - t0), err, bytes: bytes.length }); });
});
const results = [];
let next = 0;
await Promise.all(Array.from({ length: os.availableParallelism() }, async () => { while (next < cases.length) { const k = next++; results.push(await runOne(cases[k], k)); } }));
const bad = results.filter(x => !(x.code === 0 || x.code === 3));
const cmd = `node qa/stress/pdf-fuzz.mjs (${cases.length} inputs, 512 MB heap, 10 s each)`;
for (const x of results.filter(x => x.name.startsWith('hostile'))) {
  const ok = x.code === 0 || x.code === 3;
  record({ check: `reader ${x.name}`, command: 'loadPdf + mergePdfs in a child (512 MB, 10 s)', expected: 'loads or refuses with an Error; no crash, no hang', ms: x.ms,
    actual: ok ? `${x.code === 0 ? 'loaded' : 'refused'} in ${x.ms} ms` : `${x.sig === 'SIGKILL' ? 'HANG (killed at 10 s)' : `crash exit=${x.code} sig=${x.sig}`} ${x.err.split('\n').find(l => /Error|heap|Abort/i.test(l)) || ''}`, result: ok ? 'PASS' : 'FAIL' });
}
const mut = results.filter(x => x.name.startsWith('mutation'));
const mbad = mut.filter(x => !(x.code === 0 || x.code === 3));
const slow = Math.max(...mut.map(x => x.ms));
record({ check: `reader ${mut.length} mutations of a valid PDF`, command: cmd, expected: 'no crash, no hang (each < 10 s)', ms: slow,
  actual: `${mut.filter(x => x.code === 0).length} loaded, ${mut.filter(x => x.code === 3).length} refused, ${mbad.length} crashed/hung; slowest ${slow} ms${mbad.length ? `; first: ${mbad.slice(0, 3).map(x => `${x.name} exit=${x.code} sig=${x.sig} ${x.err.split('\n').find(l => /Error|heap/i.test(l)) || ''}`).join(' / ')}` : ''}`,
  result: mbad.length ? 'FAIL' : 'PASS' });
fs.writeFileSync(path.join(QA_DIR, 'fuzz-failures.json'), JSON.stringify(bad.map(({ name, code, sig, ms, err }) => ({ name, code, sig, ms, err })), null, 2));
process.exit(0);
