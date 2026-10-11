// The 0.12.1 retest, streaming tickets: N23 (encrypt/prepare + sqlRows), N24 (misspelled options), N25 (sqlRows batches),
// N28 (spill.dir).
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, exportPdf, exportPdfStream } from '../../packages/engine/entry.js';
import { spillSorter } from '../../src/exporters/spill.js';
import { fontStore } from '../helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b9s-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const now = new Date('2026-01-02T03:04:05Z');
const def = () => ({
  $schema: 'reportwright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select id, g from t' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }, { name: 'g', type: 'string' }] }],
  sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 100 }, { width: 100 }],
    header: [{ height: 14, cells: [{ value: 'Id' }, { value: 'G' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.g' }] }] }] } },
});
const batch = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, g: `G${i}` }));
const base = { fonts: fontStore, subset: false, now };
const sink = () => { const chunks = []; return { chunks, write: (b) => { chunks.push(Buffer.from(b)); } }; };
const text = (s) => Buffer.concat(s.chunks).toString('latin1');

describe('N23: encrypt / prepare with sqlRows', () => {
  it('encrypt + sqlRows renders (whole model) and the file is encrypted', async () => {
    const s = sink();
    const r = await exportPdfStream(def(), { ...base, sqlRows: async function* () { yield batch(5); }, encrypt: { userPassword: 'x' } }, s);
    expect(r.streamed).toBe(false);
    expect(r.why).toBe('encrypted');
    expect(text(s)).toContain('/Encrypt');
  });
});

describe('N24: misspelled options', () => {
  it('exportPdfStream throws for a typo of encrypt (a dropped password must not pass silently)', async () => {
    await expect(exportPdfStream(def(), { ...base, sqlRows: async function* () { yield batch(2); }, encrpyt: { userPassword: 'x' } }, sink()))
      .rejects.toThrow(/Unknown option "encrpyt".*Did you mean "encrypt"\?/);
  });
  it('exportPdfStream warns for another unknown key, with a suggestion', async () => {
    const r = await exportPdfStream(def(), { ...base, sqlRows: async function* () { yield batch(2); }, windw: 10, zzzzzz: 1 }, sink());
    expect(r.warnings.some(w => /Unknown option "windw".*Did you mean "window"\?/.test(w))).toBe(true);
    expect(r.warnings.some(w => /Unknown option "zzzzzz"/.test(w) && !/Did you mean/.test(w))).toBe(true);
  });
  it('render warns in the model; exportPdf calls onWarning', async () => {
    const m = await render(def(), { fontStore, now, sql: async () => batch(2), paremeters: {} });
    expect(m.warnings.some(w => /Unknown option "paremeters".*Did you mean "parameters"\?/.test(w))).toBe(true);
    const seen = [];
    await exportPdf(m, { fonts: fontStore, subset: false, titel: 'x', onWarning: (w) => seen.push(w) });
    expect(seen.some(w => /Unknown option "titel".*"title"/.test(w))).toBe(true);
    await expect(exportPdf(m, { fonts: fontStore, subset: false, encrpyt: {} })).rejects.toThrow(/Did you mean "encrypt"/);
  });
  it('known options give no warning', async () => {
    const r = await exportPdfStream(def(), { ...base, sqlRows: async function* () { yield batch(2); }, window: 10, spill: false }, sink());
    expect(r.warnings.filter(w => /Unknown option/.test(w))).toEqual([]);
  });
});

describe('N25: sqlRows batches', () => {
  it('a single row (not a batch) says what to yield', async () => {
    const e = await exportPdfStream(def(), { ...base, sqlRows: async function* () { yield { id: 1, region: 'x' }; } }, sink()).catch(x => x);
    expect(e.message).toMatch(/sqlRows must yield arrays of rows \(got an object with keys id, region\)/);
  });
  it('a sync iterable of batches is accepted', async () => {
    const r = await exportPdfStream(def(), { ...base, sqlRows: () => [batch(3), batch(2)] }, sink());
    expect(r.streamed).toBe(true);
  });
});

describe('N28: spill.dir', () => {
  it('a missing folder says so', async () => {
    const bad = path.join(tmp, 'nope', 'x');
    await expect(exportPdfStream(def(), { ...base, sqlRows: async function* () { yield batch(2); }, spill: { dir: bad } }, sink()))
      .rejects.toThrow(`spill.dir "${bad}" does not exist or is not writable`);
    expect(() => spillSorter({ dir: bad })).toThrow(/does not exist or is not writable/);
  });
});

describe('CLI-HINT: pw render --base on a private address', () => {
  it('names --allow-internal, not the allowHosts option', async () => {
    const { spawnSync } = await import('node:child_process');
    const f = path.join(tmp, 'r.pw.json');
    const d = def();
    d.dataSources = [{ name: 's', type: 'rest', url: '/rows' }];
    fs.writeFileSync(f, JSON.stringify(d));
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '../../bin/pw.mjs'), 'render', f, '--base', 'http://127.0.0.1:9', '-f', 'json', '-o', '-'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/private or local address/);
    expect(r.stderr + r.stdout).toMatch(/--allow-internal/);
    expect(r.stderr + r.stdout).not.toMatch(/allowHosts/);
  });
});
