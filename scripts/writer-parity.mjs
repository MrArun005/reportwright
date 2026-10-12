// The 0.14 release gate for the PDF writer: every report of the corpus exported with the old writer (pdfWriter:
// 'legacy') and with @reportwright/pdf (the default), then compared. Bytes may differ; all of these must hold:
//   1. tier 1, exact (scripts/parity-tiers.mjs): every word and its box per page (pdftotext -bbox, to 0.01 pt), and
//      the structure tree (types, order, /Alt /ActualText /Lang, attributes, table structure); never loosened
//   2. the drawing commands, exact once canonicalised (colours, line widths, dashes, the font of each text op)
//   pixels: tier 2 (150 dpi grey, scripts/parity-tolerance.json), tier 3 when it fails (600 dpi colour, every pixel)
//   3. valid: qpdf --check on the new file; veraPDF on the PDF/A and PDF/UA files (when installed)
//   4. the same features: fonts (embedded, subset), links, outline, structure tree, form fields, attachments,
//      metadata, page labels (counted with qpdf --json)
//   5. deterministic: the new writer gives the same bytes twice
// Corpus: the repository's reports (reports/*.pw.json that render without a server), the streaming ledgers of the
// tests (plain, PDF/A, tagged, parallel) and, given with --corpus, an external corpus module exporting CORPUS.
// --baseline pdflib (Phase B): the old side is the same writer with PW_FORCE_PDFLIB=1, so every report takes today's
// pdf-lib whole-model path; the new side is the default. A report the new side still sends to pdf-lib gives the same
// bytes ("pdf-lib (same bytes)"). Encrypted files are read with their user password (a case's `password`), are not
// deterministic (a random key) and must not show their Info, URIs or Lang in plain text; signed files (opts.sign) are
// signed with a throwaway .p12 through src/server/sign.js and checked with pdfsig. A case's `accept` names an
// owner-decided pixel or drawing difference ({ pixels, drawing: reason }), printed instead of failing; tier 1 takes no exceptions.
// Usage: node scripts/writer-parity.mjs [--baseline legacy|pdflib] [--corpus path/to/corpus.mjs] [--only id,id] [--keep dir]   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { exportPdfStream } from '../src/exporters/pdfstream.js';
import { createSubsetter } from '../src/exporters/subset.js';
import { exactChecks, pixelVerdict, checkRenderer } from './parity-tiers.mjs';

const root = path.join(import.meta.dirname, '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const only = arg('--only')?.split(',');
const baseline = arg('--baseline') || 'legacy';
if (baseline !== 'legacy' && baseline !== 'pdflib') { console.error('--baseline is legacy or pdflib'); process.exit(2); }
const has = (cmd, a = ['-v']) => spawnSync(cmd, a).status === 0;
const VERAPDF = has('verapdf', ['--version']);
try { checkRenderer(); } catch (e) { console.error(String(/** @type {any} */ (e).message)); process.exit(2); }
for (const t of ['pdftoppm', 'pdftotext', 'qpdf']) if (!has(t, t === 'qpdf' ? ['--version'] : ['-v'])) { console.error(`${t} is needed`); process.exit(2); }
// pdfsig checks the signed cases; poppler builds it only with NSS3 (a missing one fails those rows, named, below)
if (!has('pdfsig', ['-v'])) console.error('pdfsig is not installed: the signed cases fail (poppler needs -DENABLE_NSS3=ON to build it)');

const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const ICC = fs.readFileSync(path.join(root, 'public/icc/sRGB-v2-magic.icc'));
const now = new Date('2026-07-01T12:00:00Z');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

/** Owner-decided pixel differences of the repository's reports (none). Tier 1 takes no exceptions. */
const REPO_ACCEPT = {};
/** Owner-accepted re-baselines of tier 1 text (Arun, 2026-10-11): the old writer's word was wrong, the new one is correct. */
const REPO_REBASE = { 'stress-test': [{ from: 'Z̷贷̛a贷l贷g贷o̷', to: 'Z̷̡̛a̡l̡g̡o̷' }] };
/** @type {{ id: string, kind: 'pdf'|'stream', def: any, opts?: any, accept?: any, rebase?: { from: string, to: string }[] }[]} */
const cases = [];
for (const f of fs.readdirSync(path.join(root, 'reports')).filter(f => f.endsWith('.pw.json')).sort()) {
  cases.push({ id: `repo/${f.replace('.pw.json', '')}`, kind: 'pdf', accept: REPO_ACCEPT[f.replace('.pw.json', '')], rebase: REPO_REBASE[f.replace('.pw.json', '')], def: JSON.parse(fs.readFileSync(path.join(root, 'reports', f), 'utf8')) });
  // and tagged (PDF/UA-1, B4): pdfua.js's tree for every repository report, through @reportwright/pdf
  cases.push({ id: `repo-ua/${f.replace('.pw.json', '')}`, kind: 'pdf', opts: { tagged: { lang: 'en' } }, accept: REPO_ACCEPT[f.replace('.pw.json', '')], rebase: REPO_REBASE[f.replace('.pw.json', '')], def: JSON.parse(fs.readFileSync(path.join(root, 'reports', f), 'utf8')) });
}
// the streaming ledger of tests/engine/pdfstream-paged.test.js, in each streamed form
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, region: ['North', 'South', 'East', 'West'][i % 4], amount: Math.round(((i * 7919) % 200000 - 100000) * 1.37) / 100, ref: i % 37 ? `REF-${i * 31}` : `Reversal of an earlier transfer between linked accounts, batch ${i}` }));
const ledger = (n) => ({
  $schema: 'reportwright/report@1', name: 'Ledger', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows: rows(n) } }], dataSets: [{ name: 'Tx', source: 's', path: '$.rows' }],
  sections: {
    pageHeader: { height: 24, items: [{ type: 'textbox', x: 0, y: 0, w: 300, h: 18, value: 'Transactions ledger', bookmark: 'Ledger', style: { fontWeight: 'bold', fontSize: 12 } }] },
    body: { items: [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: 523, h: 40, columns: [{ width: 60 }, { width: 80 }, { width: 100 }, { width: 283 }],
      header: [{ height: 16, style: { backgroundColor: '#eef2f7', fontWeight: 'bold' }, cells: ['Id', 'Region', 'Amount', 'Reference'].map(value => ({ value })) }],
      detail: [{ height: 14, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [{ value: '=Fields.id' }, { value: '=Fields.region' }, { value: '=Fields.amount', style: { format: 'N2', textAlign: 'right' } }, { value: '=Fields.ref', action: { type: 'url', href: '="https://example.com/tx/" & Fields.id' } }] }] }] },
    pageFooter: { height: 16, items: [{ type: 'textbox', x: 323, y: 2, w: 200, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', style: { textAlign: 'right', fontSize: 7 } }] },
  },
});
cases.push({ id: 'stream/ledger-2000', kind: 'stream', def: ledger(2000) });
cases.push({ id: 'stream/ledger-2000-parallel', kind: 'stream', def: ledger(2000), opts: { parallel: 2 } });
cases.push({ id: 'stream/ledger-500-pdfa', kind: 'stream', def: ledger(500), opts: { pdfa: { icc: ICC } } });
cases.push({ id: 'stream/ledger-500-tagged', kind: 'stream', def: ledger(500), opts: { tagged: { lang: 'en' }, title: 'Ledger' } });
cases.push({ id: 'stream/ledger-500-pdfa-tagged', kind: 'stream', def: ledger(500), opts: { pdfa: { icc: ICC }, tagged: { lang: 'en' }, title: 'Ledger' } });
if (arg('--corpus')) {
  const { CORPUS } = await import(path.resolve(/** @type {string} */ (arg('--corpus'))));
  for (const c of CORPUS) cases.push({ ...c, id: `corpus/${c.id}`, kind: 'pdf' });
}

// the sample data the app serves at /api/sample/* (the repository's reports read it), stress capped at 2,000 rows (a small laptop)
const S = { ...(await import('../src/sample/loans.js')), ...(await import('../src/sample/sales.js')), ...(await import('../src/sample/stress.js')), ...(await import('../src/sample/hard.js')), ...(await import('../src/sample/torture.js')) };
/** @param {any} input */
async function sampleFetch(input) {
  const u = new URL(String(input?.url ?? input)), p = u.pathname.split('/').slice(3), q = u.searchParams;
  const data = p[0] === 'loans' ? (p[1] ? S.sampleLoan(decodeURIComponent(p[1])) : S.listSampleAccounts()) : p[0] === 'sales' ? S.sampleSales(p[1])
    : p[0] === 'stress' ? S.sampleStress(Math.min(2000, Number(p[1]) || 2000)) : p[0] === 'torture' ? S.sampleTorture()
      : p[0] === 'hard' ? (q.get('account') ? S.hardForAccount(S.sampleHard(Math.min(2000, Number(q.get('rows')) || 2000)), q.get('account')) : S.sampleHard(Math.min(2000, Number(q.get('rows')) || 2000))) : null;
  return data ? Response.json(data) : new Response('not found', { status: 404 });
}

/** a throwaway signing certificate for opts.sign cases (PW_SIGN_P12), made once */
let p12File = '';
async function signer() {
  if (!p12File) {
    const forge = (await import('node-forge')).default;
    const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2026-01-01'); cert.validity.notAfter = new Date('2036-01-01');
    const name = [{ name: 'commonName', value: 'Parity Gate' }];
    cert.setSubject(name); cert.setIssuer(name); cert.sign(keys.privateKey, forge.md.sha256.create());
    p12File = path.join(tmp, 'gate.p12');
    fs.writeFileSync(p12File, Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'gate', { algorithm: '3des' })).getBytes(), 'binary'));
    process.env.PW_SIGN_P12 = p12File; process.env.PW_SIGN_PASSWORD = 'gate';
  }
  return (await import('../src/server/sign.js')).pdfSigner({ name: 'Parity' });
}

/** @param {any} c @param {'legacy'|'pdf'|'pdflib'} writer pdflib: the default writer with PW_FORCE_PDFLIB=1 */
async function make(c, writer) {
  if (writer === 'pdflib') process.env.PW_FORCE_PDFLIB = '1';
  try { return await make1(c, writer === 'pdflib' ? 'pdf' : writer); } finally { delete process.env.PW_FORCE_PDFLIB; }
}
/** @param {any} c @param {'legacy'|'pdf'} writer */
async function make1(c, writer) {
  const { sign, ...copts } = c.opts || {};
  const s = sign ? await signer() : null;
  const old = !!process.env.PW_FORCE_PDFLIB || writer === 'legacy';
  const opts = { fontStore, subset, now, creationDate: now, title: c.def.name, id: '0123456789abcdef0123456789abcdef', pdfWriter: writer, baseUrl: 'https://sample.test', fetch: sampleFetch, ...copts, ...(s ? (old ? { prepare: s.prepare, save: s.save } : { sign: s.options }) : {}) };
  if (c.kind === 'stream') {
    const parts = [];
    const r = await exportPdfStream(c.def, opts, { write: async (/** @type {Uint8Array} */ u8) => { parts.push(Buffer.from(u8)); } });
    return { bytes: Buffer.concat(parts), streamed: r.streamed };
  }
  const { pdfWriter, ...ropts } = opts;
  const model = await render(c.def, { ...ropts, ...(ropts.tagged ? { exportData: true } : {}) });
  const bytes = await exportPdf(model, fontStore, opts);
  // signed: today's way on the baseline (pdf-lib's placeholder, then @signpdf), the sign option on the new side
  return { bytes: Buffer.from(s && old ? await s.sign(bytes) : bytes), streamed: false };
}

let n = 0;
const file = (b) => { const f = path.join(tmp, `${++n}.pdf`); fs.writeFileSync(f, b); return f; };
/** a tool's run: a tool that is not installed throws its name (the case then fails with it), never a null stdout */
const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`${cmd} could not run (${r.error.code}): install it on this machine`);
  return r;
};
/** the open file's user password, for the tools (encrypted cases) */
let pw = '';
const upw = () => (pw ? ['-upw', pw] : []);
const pages = (f) => Number(run('qpdf', [...(pw ? [`--password=${pw}`] : []), '--show-npages', f]).stdout.toString().trim());
/** what the file holds (qpdf's JSON of its objects) */
function features(f) {
  const j = JSON.parse(run('qpdf', [...(pw ? [`--password=${pw}`] : []), '--json=2', '--json-key=qpdf', f]).stdout.toString());
  const objs = Object.values(j.qpdf[1]).map((/** @type {any} */ o) => o.value ?? o.stream?.dict).filter(Boolean);
  const count = (pred) => objs.filter(pred).length;
  const cat = objs.find((/** @type {any} */ o) => o['/Type'] === '/Catalog') || {};
  const deref = (/** @type {any} */ v) => (typeof v === 'string' && / 0 R$/.test(v) ? (j.qpdf[1][`obj:${v}`]?.value ?? v) : v);
  // where the page numbering restarts (the page labels' starts)
  const labels = deref(cat['/PageLabels']);
  const starts = labels ? (deref(labels['/Nums']) || []).filter((/** @type {any} */ _, /** @type {number} */ i) => i % 2 === 0).join(',') : null;
  const fonts = run('pdffonts', [...upw(), f]).stdout.toString().split('\n').slice(2).filter(Boolean);
  return {
    fonts: fonts.length, embedded: fonts.filter(l => /\syes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.test(l)).length,
    subset: fonts.filter(l => /^[A-Z]{6}\+/.test(l)).length,
    links: count((/** @type {any} */ o) => o['/Subtype'] === '/Link'), outline: count((/** @type {any} */ o) => o['/Title'] !== undefined && o['/Parent'] !== undefined),
    structElems: count((/** @type {any} */ o) => o['/Type'] === '/StructElem' || (o['/S'] !== undefined && o['/P'] !== undefined)),
    fields: count((/** @type {any} */ o) => o['/FT'] !== undefined), images: count((/** @type {any} */ o) => o['/Subtype'] === '/Image') - count((/** @type {any} */ o) => o['/SMask'] !== undefined && o['/SMask'] !== '/None'), // drawn pictures (an alpha channel's soft mask is part of its picture) attachments: count((/** @type {any} */ o) => o['/Type'] === '/Filespec'),
    // encrypted: what qpdf says it allows (and that it decrypts), the method included
    encryption: !/not encrypted/.test(run('qpdf', ['--show-encryption', ...(pw ? [`--password=${pw}`] : []), f]).stdout.toString()) ? run('qpdf', [...(pw ? [`--password=${pw}`] : []), '--show-encryption', f]).stdout.toString().split('\n').filter(l => /^(R =|P =|User password|extract|print|modify|stream encryption|string encryption|file encryption)/i.test(l.trim())).map(l => l.trim()).join('; ') : null,
    metadata: !!cat['/Metadata'], pageLabels: starts, outputIntent: !!cat['/OutputIntents'], lang: cat['/Lang'] ?? null,
  };
}

const table = [];
/** cases decided by tier 3 */
const tier3 = [];
for (const c of cases) {
  if (only && !only.some(o => c.id.includes(o))) continue;
  pw = c.password || '';
  const row = { report: c.id, path: '', pages: 0, text: '', tree: '', drawing: '', pixels: '', valid: '', features: '', deterministic: '', size: '' };
  try {
    const old = await make(c, baseline), neu = await make(c, 'pdf'), again = await make(c, 'pdf');
    const fo = file(old.bytes), fn = file(neu.bytes);
    // which writer made the new file: @reportwright/pdf's (and the engine's) header has the binary comment %âãÏÓ, pdf-lib's not
    const viaPdfLib = (/** @type {Buffer} */ b) => !b.subarray(0, 16).toString('latin1').includes('âãÏÓ');
    row.path = old.bytes.equals(neu.bytes) ? 'pdf-lib (same bytes)' : baseline === 'pdflib' && viaPdfLib(neu.bytes) ? 'pdf-lib (random bytes)' : c.kind === 'stream' ? 'streamed' : 'new writer';
    const np = pages(fn), op = pages(fo);
    row.pages = np;
    // tier 1 (exact, never loosened) and the exact drawing commands
    const ex = exactChecks(fo, fn, pw, c.rebase);
    row.text = ex.words ? `FAIL ${ex.words}` : 'ok';
    row.tree = ex.tree ? `FAIL ${ex.tree}` : 'ok';
    row.drawing = !ex.drawing ? 'ok' : c.accept?.drawing ? `accepted (${ex.drawing}): ${c.accept.drawing}` : `FAIL ${ex.drawing}`;
    // tiers 2 and 3; an owner-decided pixel difference (accept.pixels) is printed instead of failing
    const px = pixelVerdict(fo, fn, pw);
    if (px.tier === 3) tier3.push(`${c.id}: ${px.ok ? 'pass' : c.accept?.pixels ? 'fail, owner-accepted' : 'FAIL'} — ${px.detail}`);
    row.pixels = px.ok ? px.detail : c.accept?.pixels && np === op ? `accepted (${px.detail}): ${c.accept.pixels}` : `FAIL ${px.detail}`;
    const q = run('qpdf', [...(pw ? [`--password=${pw}`] : []), '--check', fn]);
    let valid = q.status === 0 ? 'qpdf ok' : `FAIL qpdf: ${q.stdout.toString().split('\n').find(l => /error|warning/i.test(l)) || q.status}`;
    if ((c.opts?.pdfa || c.opts?.tagged) && VERAPDF) {
      // PDF/A+UA: both profiles
      for (const flavour of c.opts.pdfa ? (c.opts.tagged ? ['2a', 'ua1'] : ['2b']) : ['ua1']) {
        const v = run('verapdf', ['--format', 'text', '--flavour', flavour, fn]).stdout.toString();
        valid += /^PASS /m.test(v) ? `, veraPDF ${flavour} ok` : `, FAIL veraPDF ${flavour}`;
      }
    }
    if (c.opts?.encrypt) {
      // nothing readable in the raw file: the title, the links' URIs, the language
      const raw = neu.bytes.toString('latin1');
      const leaks = [c.def.name, 'https://', '/Lang (en'].filter(t => raw.includes(t));
      valid += leaks.length ? `, FAIL plaintext ${leaks.join(', ')}` : ', no plaintext';
    }
    if (c.opts?.sign) {
      const v = run('pdfsig', [fn]).stdout.toString();
      valid += /Signature Validation: Signature is Valid/.test(v) && /Total document signed/.test(v) ? ', pdfsig ok (whole file)' : ', FAIL pdfsig';
    }
    row.valid = valid;
    const a = features(fo), b = features(fn);
    const diff = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    row.features = diff.length ? `FAIL ${diff.map(k => `${k} ${JSON.stringify(a[k])}→${JSON.stringify(b[k])}`).join('; ')}` : `ok (${Object.entries(b).filter(([, v]) => v && v !== 0).map(([k, v]) => (v === true ? k : `${k} ${v}`)).join(', ')})`;
    // encrypted: a random key and IVs; signed: the signing time
    row.deterministic = neu.bytes.equals(again.bytes) ? 'ok' : c.opts?.encrypt ? 'n/a (random key)' : c.opts?.sign ? 'n/a (signing time)' : 'FAIL';
    row.size = `${old.bytes.length} → ${neu.bytes.length}`;
    // --keep dir: a failing report's two files, to look at
    if (arg('--keep') && Object.values(row).some(v => typeof v === 'string' && v.includes('FAIL'))) { const k = /** @type {string} */ (arg('--keep')), b = c.id.replace(/\W+/g, '_'); fs.mkdirSync(k, { recursive: true }); fs.copyFileSync(fo, path.join(k, `${b}.old.pdf`)); fs.copyFileSync(fn, path.join(k, `${b}.new.pdf`)); }
    fs.rmSync(fo); fs.rmSync(fn);
  } catch (e) {
    // a report that cannot be made is 'not rendered' (a data source down); a check that fails on the made files (pdftoppm on a full disk) fails the row
    const m = String(/** @type {any} */ (e)?.message || e);
    if (row.path) row.valid = `FAIL ${m.slice(0, 120)}`; else row.path = `not rendered: ${m.slice(0, 80)}`;
  }
  table.push(row);
  console.error(`${row.report}: ${row.path} words ${row.text} tree ${row.tree} drawing ${row.drawing} pixels ${row.pixels} ${row.valid} ${row.deterministic}`);
}
console.log('| report | path | pages | tier 1 words | tier 1 tree | drawing | pixels (tiers 2/3) | valid | features | deterministic | bytes old → new |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of table) console.log(`| ${Object.values(r).join(' | ')} |`);
// the count and the list are the same rows: every row with a FAIL cell
const bad = table.filter(r => Object.values(r).some(v => typeof v === 'string' && v.includes('FAIL')));
const failed = bad.length;
const went = table.filter(r => r.path === 'new writer' || r.path === 'streamed');
console.log(`\n${table.length} reports, ${went.length} through @reportwright/pdf, ${table.filter(r => r.path.startsWith('pdf-lib')).length} still on pdf-lib, ${table.filter(r => r.path.startsWith('not rendered')).length} not rendered; ${failed} failing.`);
if (tier3.length) console.log(`\nCases that reached tier 3 (600 dpi):\n${tier3.join('\n')}`);
if (failed) console.log(`FAIL rows (${failed}): ${bad.map(r => r.report).join(', ')}`);
process.exit(failed ? 1 : 0);
