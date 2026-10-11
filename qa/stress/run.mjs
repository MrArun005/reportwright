// qa-stress: engine stress checks, in process (no server). One shard per argument group:
//   QA_TIER=quick|full node --expose-gc qa/stress/run.mjs stream nonstream nesting samples scripts fonts images leak parallel
// Every check appends a row via lib.mjs (PASS/FAIL/WARN/SKIP with the evidence); a crash is a FAIL row, never a lost check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { render } from '../../src/engine/index.js';
import { FONT_FAMILIES } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore } from '../../tests/helpers.js';
import { sampleStress } from '../../src/sample/stress.js';
import { sampleHard } from '../../src/sample/hard.js';
import { sampleTorture } from '../../src/sample/torture.js';
import { record, check, sh, rssSampler, QA_DIR, TIER } from './lib.mjs';

const ROOT = path.join(import.meta.dirname, '..', '..');
const FULL = TIER === 'full';
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
const OUT = path.join(QA_DIR, 'pdf');
fs.mkdirSync(OUT, { recursive: true });
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const pageTexts = (file) => sh('pdftotext', ['-layout', file, '-']).split('\f');
const npages = (file) => Number(sh('qpdf', ['--show-npages', file]).trim());
const qpdfOk = (file) => { try { sh('qpdf', ['--check', file]); return true; } catch (e) { return /operation succeeded with warnings/.test(String(e.stdout)) ; } };

/** A flowing table over json rows with "Page N of M" in the footer: the shape planPaged streams. */
const tableDef = (rows, extra = {}) => ({
  $schema: 'reportwright/report@1', name: 'QA stress', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'R', source: 's', path: '$.rows' }],
  sections: {
    pageHeader: { height: 20, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 300, h: 14, value: 'QA stress' }] },
    body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 520, h: 36, dataSet: 'R', repeatHeader: true,
      columns: [{ width: 80 }, { width: 120 }, { width: 120 }, { width: 100 }, { width: 100 }],
      header: [{ height: 18, style: { fontWeight: 'bold' }, cells: [{ value: '#' }, { value: 'City' }, { value: 'Product' }, { value: 'Month' }, { value: 'Amount' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.city' }, { value: '=Fields.product' }, { value: '=Fields.month' }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
      ...extra.table }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 4, w: 300, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});

/** Every page present and its footer says "Page i of M" with M the real page count. */
function pagesCheck(file, pages) {
  const n = npages(file);
  const texts = pageTexts(file);
  const bad = [];
  for (let i = 0; i < n && bad.length < 5; i++) if (!new RegExp(`Page\\s+${i + 1}\\s+of\\s+${n}\\b`).test(texts[i] || '')) bad.push(i + 1);
  return { n, bad, ok: n === pages && !bad.length && qpdfOk(file) };
}

async function streamCase(name, rowsN, opts = {}) {
  const rows = sampleStress(Math.min(rowsN, 200000)).rows;
  // sampleStress caps at 200k: past that, the same rows again with new numbers (deterministic, no 1M generator in memory twice)
  for (let i = rows.length; i < rowsN; i++) rows.push({ ...rows[i % 200000], n: i + 1 });
  if (global.gc) global.gc();
  const file = path.join(OUT, `${name}.pdf`);
  const m = rssSampler();
  const base = m.now();
  const t0 = performance.now();
  const r = await exportPdfStream(tableDef(rows), { fontStore, subset, ...opts }, fs.createWriteStream(file));
  await new Promise(ok => setTimeout(ok, 50));
  const ms = Math.round(performance.now() - t0), peak = m.stop();
  return { r, ms, peak, base: Math.round(base), file };
}

const checks = {
  async stream() {
    const N = FULL ? 1_000_000 : 100_000;
    const cmd = `exportPdfStream(table of ${N.toLocaleString('en')} rows, Page N of M footer)`;
    await check(`stream ${N} rows`, cmd, 'streamed; peak RSS above base < 300 MB (STREAMING-1M.md §5 target); every page present; Page i of M correct', async () => {
      const { r, ms, peak, base, file } = await streamCase('stream', N);
      const p = pagesCheck(file, r.pages);
      const over = peak - base;
      const ok = r.streamed && p.ok && over < 300;
      record({ check: `stream ${N} rows`, command: cmd, expected: 'streamed, +RSS < 300 MB, all pages, Page i of M', ms, mb: peak,
        actual: `streamed=${r.streamed} pages=${r.pages} qpdf pages=${p.n} bad footers=${p.bad.join(',') || 'none'} time=${sec(ms)} peakRSS=${peak} MB (base ${base}, +${over})${r.why ? ' why=' + r.why : ''}`, result: ok ? 'PASS' : 'FAIL' });
    });
  },
  async nonstream() {
    const N = FULL ? 100_000 : 20_000;
    const cmd = `render() + exportPdf() (whole model) of ${N.toLocaleString('en')} rows`;
    await check(`non-streamed ${N} rows`, cmd, 'renders, page count matches, Page i of M correct', async () => {
      const rows = sampleStress(N).rows;
      const m = rssSampler();
      const t0 = performance.now();
      const model = await render(tableDef(rows), { fontStore });
      const bytes = await exportPdf(model, fontStore, { subset });
      const ms = Math.round(performance.now() - t0), peak = m.stop();
      const file = path.join(OUT, 'nonstream.pdf');
      fs.writeFileSync(file, bytes);
      const p = pagesCheck(file, model.pages.length);
      record({ check: `non-streamed ${N} rows`, command: cmd, expected: 'all pages, Page i of M', ms, mb: peak,
        actual: `pages=${model.pages.length} qpdf=${p.n} bad footers=${p.bad.join(',') || 'none'} time=${sec(ms)} peakRSS=${peak} MB warnings=${model.warnings.length}`, result: p.ok ? 'PASS' : 'FAIL' });
    });
  },
  async nesting() {
    const cmd = 'table with 10 nested groups; subreport → subreport → subreport → subreport';
    await check('deep nesting', cmd, '10 group levels each print their key; 4-deep subreport chain prints the innermost text', async () => {
      const rows = Array.from({ length: FULL ? 4096 : 1024 }, (_, i) => Object.fromEntries([...Array(10)].map((_, k) => [`g${k}`, `L${k}-${(i >> k) & 1}`]).concat([['v', i]])));
      const groups = [...Array(10)].map((_, k) => ({ name: `G${k}`, expr: `=Fields.g${k}`, header: [{ height: 12, cells: [{ value: `=Fields.g${k}` }, { value: '=Sum(Fields.v)' }] }], footer: [] }));
      const leaf = (id, inner) => ({ $schema: 'reportwright/report@1', name: id, page: { size: 'A4', margins: [36, 36, 36, 36] },
        sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 14, value: `inside ${id}` },
          ...(inner ? [{ type: 'subreport', name: 'S', x: 0, y: 20, w: 400, h: 100, report: inner }] : [])] } } });
      const subs = { s1: leaf('s1', 's2'), s2: leaf('s2', 's3'), s3: leaf('s3', 's4'), s4: leaf('s4') };
      const def = tableDef(rows, { table: { columns: [{ width: 260 }, { width: 260 }], header: [], groups, detail: [{ height: 12, cells: [{ value: '=Fields.v' }, { value: '' }] }] } });
      def.sections.body.items.push({ type: 'subreport', name: 'Sub', x: 0, y: 60, w: 500, h: 100, report: 's1' });
      const t0 = performance.now();
      const model = await render(def, { fontStore, loadReport: async (id) => subs[id] });
      const file = path.join(OUT, 'nesting.pdf');
      fs.writeFileSync(file, await exportPdf(model, fontStore, { subset }));
      const text = pageTexts(file).join('\n');
      const missing = [...[...Array(10)].map((_, k) => `L${k}-1`), 'inside s1', 'inside s4'].filter(s => !text.includes(s));
      record({ check: 'deep nesting', command: cmd, expected: 'L0-1…L9-1 and "inside s1".."inside s4" in the text', ms: Math.round(performance.now() - t0),
        actual: `pages=${model.pages.length} missing=${missing.join(',') || 'none'} warnings=${model.warnings.slice(0, 3).join(' / ') || 'none'}`, result: missing.length ? 'FAIL' : 'PASS' });
    });
  },
  async samples() {
    // the sample endpoints as the app serves them, from the same generators (src/sample), on a local port
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const m = u.pathname.match(/^\/api\/sample\/(hard|torture|stress\/(\d+))$/);
      if (!m) { res.statusCode = 404; return res.end('{}'); }
      const data = m[1] === 'hard' ? sampleHard(Math.min(200000, Number(u.searchParams.get('rows')) || 3000)) : m[1] === 'torture' ? sampleTorture() : sampleStress(Math.min(200000, Number(m[2])));
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
    }).listen(0, '127.0.0.1');
    await new Promise(ok => srv.once('listening', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const cases = [['stress-test', []], ['torture-test', []], ['stress-ledger', []], ['stress-scale', ['-p', `rows=${FULL ? 100000 : 5000}`]]];
    for (const [id, extra] of cases) {
      const out = path.join(OUT, `${id}.pdf`);
      const args = ['bin/pw.mjs', 'render', `reports/${id}.pw.json`, ...extra, '--base', base, '--allow-internal', '-o', out];
      const cmd = `/usr/bin/time -v node ${args.join(' ').replace(base, '$SAMPLE')}`;
      await check(id, cmd, 'exit 0, qpdf --check clean, ≥1 page', async () => {
        const t0 = performance.now();
        // async: the sample server answers on this process's event loop
        const { spawn } = await import('node:child_process');
        const p = spawn('/usr/bin/time', ['-v', 'node', ...args], { cwd: ROOT });
        let err = '';
        p.stderr.on('data', d => { err += d; });
        const code = await new Promise(ok => p.on('close', ok));
        const ms = Math.round(performance.now() - t0);
        const rss = Math.round(Number(err.match(/Maximum resident set size \(kbytes\): (\d+)/)?.[1] || 0) / 1024);
        const pw = (err.match(/pw: .*/) || [err.slice(-300)])[0];
        const n = code === 0 ? npages(out) : 0;
        record({ check: id, command: cmd, expected: 'exit 0, qpdf clean, ≥1 page', ms, mb: rss,
          actual: `exit=${code} ${pw} qpdf pages=${n} time=${sec(ms)} peakRSS=${rss} MB`, result: code === 0 && n >= 1 && qpdfOk(out) ? 'PASS' : 'FAIL' });
      });
    }
    srv.close();
  },
  async scripts() {
    const S = { Latin: 'Ŝćŗïpţ Ünïcödé façade naïve', CJK: '漢字テスト한국어中文', Devanagari: 'हिन्दी परीक्षण', Arabic: 'مرحبا بالعالم', Hebrew: 'שלום עולם', Emoji: '👍🏽🎉👨‍👩‍👧', Combining: 'é ä ñ', Tamil: 'தமிழ் சோதனை', Thai: 'ภาษาไทย' };
    const cmd = 'render() + exportPdf() of one textbox per script; pdftotext -raw';
    await check('every script', cmd, 'each string extractable from the PDF (NFC-compared; emoji SKIP-free)', async () => {
      const items = Object.entries(S).map(([k, v], i) => ({ type: 'textbox', name: `t${i}`, x: 0, y: i * 24, w: 500, h: 20, value: `${k}: ${v}`, style: { fontSize: 12 } }));
      const def = { $schema: 'reportwright/report@1', name: 'Scripts', page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { items } } };
      const model = await render(def, { fontStore });
      const file = path.join(OUT, 'scripts.pdf');
      fs.writeFileSync(file, await exportPdf(model, fontStore, { subset }));
      const text = sh('pdftotext', ['-raw', file, '-']).normalize('NFC').replace(/\s+/g, ' ');
      for (const [k, v] of Object.entries(S)) {
        const want = v.normalize('NFC');
        const words = want.split(' ');
        const ok = text.includes(want) || words.every(w => text.includes(w));
        const reversed = !ok && words.every(w => text.includes([...w].reverse().join('')));
        record({ check: `script ${k}`, command: cmd, expected: `"${want}" in pdftotext output`,
          actual: ok ? 'found' : `${reversed ? 'found only reversed (visual order) ' : 'not found; '}line: ${(text.match(new RegExp(`${k}: [^A-Z]{0,60}`)) || ['(no line)'])[0]} | warnings: ${model.warnings.filter(w => /font|glyph|box/i.test(w)).slice(0, 2).join(' / ') || 'none'}`,
          result: ok ? 'PASS' : 'FAIL' });
      }
    });
  },
  async fonts() {
    const faces = Object.values(FONT_FAMILIES).flat();
    const cmd = `render() + exportPdf() with one textbox per bundled face (${faces.length}); pdffonts`;
    await check('every font', cmd, `${faces.length} faces in pdffonts (the brief asks 50; the engine bundles ${faces.length})`, async () => {
      const sample = (f) => /Arabic/.test(f.family) ? 'مرحبا' : /Hebrew/.test(f.family) ? 'שלום' : /Devanagari/.test(f.family) ? 'नमस्ते' : /Thai/.test(f.family) ? 'สวัสดี' : /Lao/.test(f.family) ? 'ສະບາຍດີ' : /Khmer/.test(f.family) ? 'សួស្តី' : /Myanmar/.test(f.family) ? 'မင်္ဂလာပါ' : /Tamil/.test(f.family) ? 'வணக்கம்' : /Bengali/.test(f.family) ? 'নমস্কার' : /Telugu/.test(f.family) ? 'నమస్కారం' : /Kannada/.test(f.family) ? 'ನಮಸ್ಕಾರ' : /Gujarati/.test(f.family) ? 'નમસ્તે' : /JP/.test(f.family) ? 'こんにちは' : /KR/.test(f.family) ? '안녕하세요' : /SC/.test(f.family) ? '你好' : /Emoji/.test(f.family) ? '🎉' : /Symbol/.test(f.family) ? 'αβγ' : /Zapf/.test(f.family) ? '✓✔' : `${f.key} Hello`;
      const items = faces.map((f, i) => ({ type: 'textbox', name: `f${i}`, x: (i % 2) * 260, y: Math.floor(i / 2) * 16, w: 250, h: 14, value: sample(f), style: { fontFamily: f.family, fontWeight: f.weight >= 600 ? 'bold' : 'normal', fontStyle: f.style, fontSize: 9 } }));
      const model = await render({ $schema: 'reportwright/report@1', name: 'Fonts', page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { items } } }, { fontStore });
      const file = path.join(OUT, 'fonts.pdf');
      fs.writeFileSync(file, await exportPdf(model, fontStore, { subset }));
      const listed = sh('pdffonts', [file]).split('\n').slice(2).filter(Boolean).length;
      record({ check: 'every font', command: cmd, expected: `pdffonts lists ${faces.length} fonts`, actual: `pdffonts lists ${listed}; warnings: ${model.warnings.slice(0, 3).join(' / ') || 'none'}`, result: listed >= faces.length ? 'PASS' : 'FAIL' });
      // Latin in every family: a face without Latin should fall back (to Inter), never draw boxes
      const latin = faces.map((f, i) => ({ ...items[i], value: `Latin ${f.key}` }));
      const m2 = await render({ $schema: 'reportwright/report@1', name: 'Fonts latin', page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { items: latin } } }, { fontStore });
      const boxes = m2.warnings.filter(w => /show as boxes/i.test(w));
      record({ check: 'Latin text in every family falls back', command: 'render() of "Latin <face>" in each family', expected: 'no "show as boxes" warning', actual: boxes.join(' / ').slice(0, 300) || 'none', result: boxes.length ? 'WARN' : 'PASS' });
    });
  },
  async images() {
    const big = path.join(OUT, 'big.jpg'), alpha = path.join(OUT, 'alpha.png');
    sh('convert', ['-size', '6000x4000', 'gradient:navy-orange', '-attenuate', '0.3', '+noise', 'Gaussian', '-quality', '90', big]);
    sh('convert', ['-size', '3000x2000', 'gradient:red-blue', '-alpha', 'set', '-channel', 'A', '-fx', 'i/w', alpha]);
    for (const [name, f, mime] of [['24 MP JPEG', big, 'jpeg'], ['6 MP alpha PNG', alpha, 'png']]) {
      const cmd = `image item, data URI of ${path.basename(f)} (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`;
      await check(name, cmd, 'renders; qpdf clean; pdfimages lists it at full size; alpha PNG has an smask', async () => {
        const m = rssSampler();
        const t0 = performance.now();
        const src = `data:image/${mime};base64,${fs.readFileSync(f).toString('base64')}`;
        const model = await render({ $schema: 'reportwright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { items: [{ type: 'image', name: 'I', x: 0, y: 0, w: 520, h: 350, src, fit: 'contain' }] } } }, { fontStore });
        const out = path.join(OUT, `${name.replace(/\W+/g, '-')}.pdf`);
        fs.writeFileSync(out, await exportPdf(model, fontStore, { subset }));
        const ms = Math.round(performance.now() - t0), peak = m.stop();
        const list = sh('pdfimages', ['-list', out]);
        const full = /\b6000\s+4000\b/.test(list) || /\b3000\s+2000\b/.test(list);
        const smask = name.includes('PNG') ? /smask/.test(list) : true;
        record({ check: name, command: cmd, expected: 'full-size image embedded, smask for alpha', ms, mb: peak,
          actual: `time=${sec(ms)} peakRSS=${peak} MB pdf=${(fs.statSync(out).size / 1048576).toFixed(1)} MB images: ${list.split('\n').slice(2, 4).join(' ; ').replace(/\s+/g, ' ')} warnings=${model.warnings.slice(0, 2).join(' / ') || 'none'}`,
          result: full && smask && qpdfOk(out) ? 'PASS' : 'FAIL' });
      });
    }
  },
  async leak() {
    const N = FULL ? 10_000 : 2_000, WARM = 300, BOUND = 64;
    const cmd = `node --expose-gc: render()+exportPdf() of one 20-row invoice ×${N} in one process`;
    await check('leak', cmd, `RSS growth after ${WARM} warm-up renders < ${BOUND} MB`, async () => {
      const def = tableDef(sampleStress(20).rows);
      const one = async () => exportPdf(await render(def, { fontStore }), fontStore, { subset });
      for (let i = 0; i < WARM; i++) await one();
      global.gc?.(); global.gc?.();
      const r0 = process.memoryUsage.rss() / 1048576, h0 = process.memoryUsage().heapUsed / 1048576;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) { await one(); if (i % 500 === 0) global.gc?.(); }
      global.gc?.(); global.gc?.();
      const r1 = process.memoryUsage.rss() / 1048576, h1 = process.memoryUsage().heapUsed / 1048576;
      const ms = Math.round(performance.now() - t0);
      // basis for 64 MB: SERVER-LOAD.md's 5-minute soak held RSS within ~40 MB; 64 MB over N renders is < 7 KB a render at 10k
      record({ check: `leak ×${N}`, command: cmd, expected: `RSS growth < ${BOUND} MB (basis: SERVER-LOAD.md soak ±40 MB)`, ms, mb: Math.round(r1),
        actual: `RSS ${Math.round(r0)}→${Math.round(r1)} MB (+${Math.round(r1 - r0)}), heap ${Math.round(h0)}→${Math.round(h1)} MB, ${(ms / N).toFixed(1)} ms/render`, result: r1 - r0 < BOUND ? 'PASS' : 'FAIL' });
    });
  },
  async parallel() {
    const N = FULL ? 200_000 : 50_000;
    const cmd = `exportPdfStream ${N} rows, parallel 'auto' vs off, ${os.availableParallelism()} cores`;
    await check('parallel auto vs off', cmd, "'auto' not slower than off, same pages (known issue: may be slower)", async () => {
      const off = await streamCase('par-off', N);
      const auto = await streamCase('par-auto', N, { parallel: 'auto' });
      const same = off.r.pages === auto.r.pages;
      record({ check: 'parallel auto vs off', command: cmd, expected: "'auto' ≤ off time, same page count", ms: auto.ms, mb: auto.peak,
        actual: `off ${sec(off.ms)} ${off.peak} MB, auto ${sec(auto.ms)} ${auto.peak} MB (×${(off.ms / auto.ms).toFixed(2)} speed-up), pages ${off.r.pages}/${auto.r.pages}`,
        result: !same ? 'FAIL' : auto.ms <= off.ms ? 'PASS' : 'WARN' });
    });
  },
};

for (const name of process.argv.slice(2)) {
  if (!checks[name]) { record({ check: name, command: 'qa/stress/run.mjs', expected: 'a known check', actual: 'unknown check', result: 'FAIL' }); continue; }
  console.log(`== ${name} (${TIER})`);
  await checks[name]();
}
process.exit(0); // worker threads (parallel) and the subsetter must not keep the shard alive
