// The definition upgrade (engine/schema/upgrade.js) runs only on a report its reader may open: a report someone may
// not view answers exactly as one that does not exist, whatever it holds (a newer $schema, broken JSON).
import { it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r2or-'));
const keep = { ...process.env };
let perms, store, renderTo;
const bob = { kind: 'user', email: 'bob@x.test', role: 'designer', groups: [] };
beforeAll(async () => {
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r2-or-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}`, PW_RENDER_WORKERS: '0' });
  ({ store } = await import('../../src/server/storage/index.js'));
  perms = await import('../../src/server/perms.js');
  ({ renderTo } = await import('../../src/server/renderer.js'));
  const users = await import('../../src/server/users.js');
  await users.createUser({ email: 'bob@x.test', role: 'designer', password: 'a long password 1' });
  for (const [id, text] of [['newerx', JSON.stringify({ $schema: 'reportwright/report@9', name: 'Payroll 2027' })], ['broken', '{not json']]) {
    await store().put('reports', id, text);
    await store().put('reportacl', id, JSON.stringify({ id, folder: null, inherit: false, grants: [] })); // bob may not view
  }
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(tmp, { recursive: true, force: true }); });

const outcome = (p) => p.then(() => 'ok', (e) => `${e.status} ${e.message}`);

it('reading a forbidden report answers as a missing one, whatever it holds', async () => {
  const missing = await outcome(perms.readReportFor(bob, 'nope'));
  expect(missing).toBe('404 Report not found');
  expect(await outcome(perms.readReportFor(bob, 'newerx'))).toBe(missing);
  expect(await outcome(perms.readReportFor(bob, 'broken'))).toBe(missing);
  expect(await outcome(perms.readRunnable(bob, 'newerx'))).toBe(missing);
});

it('a definition referencing a forbidden report renders exactly as one referencing a missing id', async () => {
  const def = (ref) => ({ $schema: 'reportwright/report@1', name: 'Mine', sections: { body: { items: [{ type: 'subreport', name: 'S', x: 0, y: 0, w: 300, h: 40, report: ref }] } } });
  const view = async (ref) => { const m = (await renderTo(def(ref), { format: 'json', principal: bob })).model; return JSON.stringify({ w: m.warnings.map(w => String(w).replaceAll(ref, 'X')), p: JSON.stringify(m.pages).replaceAll(ref, 'X').replace(/\\?"w\\?":[\d.]+/g, 'w') }); }; // a text's width follows its letters
  const missing = await view('nopexx');
  expect(await view('newerx')).toBe(missing);
  expect(await view('broken')).toBe(missing);
  expect(missing).not.toMatch(/2027|newer ReportWright|JSON/);
});
