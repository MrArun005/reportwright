// R2 A-4: report saves take their own report's lock, not one lock for every permission: 50 saves at once all land.
import { it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r2a4-'));
const cwd = process.cwd();
const keep = { ...process.env };
let PUT;
beforeAll(async () => {
  process.chdir(dir);
  for (const k of ['PW_AUTH', 'PW_STORAGE', 'PW_BASIC_AUTH']) delete process.env[k];
  process.env.NODE_ENV = 'development';
  ({ PUT } = await import('../../app/api/reports/[id]/route.js'));
});
afterAll(() => { process.chdir(cwd); for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(dir, { recursive: true, force: true }); });

const def = (name) => ({ $schema: 'pagewright/report@1', name, sections: { body: { items: [] } } });
const save = (id, name) => PUT(new Request(`http://127.0.0.1/api/reports/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '*' }, body: JSON.stringify(def(name)) }), { params: Promise.resolve({ id }) });

it('50 concurrent saves of different reports and 20 of one report: all 200, on file storage', async () => {
  const t0 = Date.now();
  const many = await Promise.all(Array.from({ length: 50 }, (_, i) => save(`r-${i}`, `R ${i}`)));
  const one = await Promise.all(Array.from({ length: 20 }, (_, i) => save('same', `Same ${i}`)));
  expect(many.map(r => r.status).filter(s => s !== 200)).toEqual([]);
  expect(one.map(r => r.status).filter(s => s !== 200)).toEqual([]);
  expect(Date.now() - t0).toBeLessThan(15000); // the old global lock gave up with 503 at 15 s
  const { readReport } = await import('../../src/server/reports.js');
  expect((await readReport('same')).name).toMatch(/^Same \d+$/);
}, 60000);
