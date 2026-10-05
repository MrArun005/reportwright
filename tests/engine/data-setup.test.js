// Data setup in the designer (ROADMAP weeks 2–3): response explorer, SQL connections, SQL preview.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rowArrays, bestRows } from '../../src/designer/explore.js';
import { jsonPath, loadSources } from '../../src/engine/data/index.js';
import { listConnections, testConnection } from '../../src/server/sql.js';

const RESPONSE = {
  meta: { page: 1, tags: ['a', 'b'] },
  data: {
    customer: { name: 'Asha', addresses: [{ city: 'Pune' }] },
    orders: [
      { id: 1, total: 10, lines: [{ sku: 'x', qty: 1 }, { sku: 'y', qty: 2 }] },
      { id: 2, total: 20, lines: [{ sku: 'z', qty: 3 }] },
    ],
  },
};

describe('response explorer', () => {
  it('finds every array of rows with a path the data set can use', () => {
    const found = rowArrays(RESPONSE);
    const byPath = Object.fromEntries(found.map(a => [a.path, a]));
    expect(Object.keys(byPath).sort()).toEqual(['$.data.customer.addresses', '$.data.orders', '$.data.orders[*].lines[*]', '$.meta.tags']);
    expect(byPath['$.data.orders']).toMatchObject({ rows: 2, objects: true, fields: ['id', 'total'] });
    expect(byPath['$.data.orders[*].lines[*]']).toMatchObject({ rows: 3, objects: true, fields: ['sku', 'qty'] });
    expect(byPath['$.meta.tags']).toMatchObject({ objects: false });
    for (const a of found) expect(jsonPath(RESPONSE, a.path)).toHaveLength(a.rows); // every path really returns those rows
  });

  it('suggests the shallowest array of objects (then the biggest), and $ for a plain list', () => {
    expect(bestRows(RESPONSE).path).toBe('$.data.orders');
    expect(bestRows([{ a: 1 }, { a: 2 }]).path).toBe('$');
    expect(bestRows({ x: 1 })).toBe(null);
  });

  it('names with odd characters use bracket paths', () => {
    const found = rowArrays({ 'line items': [{ a: 1 }] });
    expect(found[0].path).toBe("$['line items']");
    expect(jsonPath({ 'line items': [{ a: 1 }] }, found[0].path)).toHaveLength(1);
  });
});

describe('SQL connections for the designer', () => {
  let dir, db;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sqlc-'));
    db = path.join(dir, 'x.db');
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const d = new DatabaseSync(db); d.exec('create table t (a int)'); d.close();
    process.env.PW_DB_MAIN = `sqlite:${db}`;
    process.env.PW_DB_BROKEN = 'sqlite:/nope/missing.db';
  });
  afterAll(() => { delete process.env.PW_DB_MAIN; delete process.env.PW_DB_BROKEN; fs.rmSync(dir, { recursive: true, force: true }); });

  it('lists names and kinds, never the URLs', () => {
    const list = listConnections();
    expect(list).toEqual(expect.arrayContaining([{ name: 'main', kind: 'sqlite', procs: [] }, { name: 'broken', kind: 'sqlite', procs: [] }]));
    expect(JSON.stringify(list)).not.toContain(db);
  });

  it('tests a connection', async () => {
    const ok = await testConnection('main');
    expect(ok.ok).toBe(true);
    expect(typeof ok.ms).toBe('number');
    const bad = await testConnection('broken');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
    expect(bad.error).not.toContain('/nope/missing.db');
  });

  it('the designer previews unsaved SQL through the ad-hoc route', async () => {
    const calls = [];
    const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ rows: [{ a: 1 }] })); };
    const def = { dataSources: [{ name: 's', type: 'sql', connection: 'main', query: 'select a from t where a = @x' }] };
    const out = await loadSources(def, { params: { x: 1 }, fetch: f, baseUrl: 'http://h', sqlPreview: true });
    expect(out.s).toEqual([{ a: 1 }]);
    expect(calls[0].body).toEqual({ connection: 'main', query: 'select a from t where a = @x', params: { x: 1 } });
  });
});
