// R2 item 7: the server half of the visual SQL builder: a connection's tables, columns and keys (read-only, capped),
// and a structured query written as one SELECT per dialect with every value bound.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sqlb-'));
const keep = { ...process.env };
let schemaOf, buildSql, runSql;
beforeAll(async () => {
  const f = path.join(tmp, 'shop.db');
  const db = new DatabaseSync(f);
  db.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, region TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), amount REAL, placed TEXT);
    INSERT INTO customers VALUES (1, 'Ann', 'East'), (2, 'Bob', 'West'), (3, 'Cy', 'East');
    INSERT INTO orders VALUES (1, 1, 10, '2026-01-01'), (2, 1, 15, '2026-02-01'), (3, 2, 7, '2026-01-05'), (4, 3, 30, '2026-03-01');`);
  db.close();
  process.env.PW_DB_SHOP = `sqlite:${f}`;
  ({ schemaOf, buildSql } = await import('../../src/server/sql/schema.js'));
  ({ runSql } = await import('../../src/server/sql.js'));
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(tmp, { recursive: true, force: true }); });

const spec = {
  connection: 'shop',
  tables: [{ name: 'customers', alias: 'c' }],
  joins: [{ type: 'inner', table: 'orders', alias: 'o', on: [{ left: 'c.id', right: 'o.customer_id' }] }],
  columns: [{ column: 'c.region' }, { column: 'o.amount', agg: 'sum', as: 'total' }, { column: 'o.id', agg: 'count', as: 'orders' }],
  filters: [{ column: 'o.placed', op: '>=', value: '2026-01-02' }, { column: 'c.name', op: 'in', values: ['Ann', 'Cy', "x' OR 1=1 --"] }],
  sort: [{ column: 'total', dir: 'desc' }],
  limit: 10,
};

describe('SQL builder', () => {
  it('reads tables, columns, keys and relations through the read-only path', async () => {
    const s = await schemaOf('shop');
    expect(s.dialect).toBe('sqlite');
    expect(s.tables.map(t => t.name)).toEqual(['customers', 'orders']);
    expect(s.tables[1].columns).toContainEqual({ name: 'customer_id', type: 'integer', key: false });
    expect(s.tables[0].columns[0]).toEqual({ name: 'id', type: 'integer', key: true });
    expect(s.relations).toEqual([{ from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' } }]);
    await expect(schemaOf('nope')).rejects.toMatchObject({ status: 400 });
  });

  it('writes one SELECT with bound values, and it runs as a SQL source', async () => {
    const { sql, parameters } = buildSql(spec, 'sqlite');
    expect(sql).toBe('SELECT "c"."region", SUM("o"."amount") AS "total", COUNT("o"."id") AS "orders"\nFROM "customers" "c"\nINNER JOIN "orders" "o" ON "c"."id" = "o"."customer_id"\nWHERE "o"."placed" >= @pw_1\n  AND "c"."name" IN (@pw_2, @pw_3, @pw_4)\nGROUP BY "c"."region"\nORDER BY "total" DESC\nLIMIT 10');
    expect(parameters.map(p => p.value)).toEqual(['2026-01-02', 'Ann', 'Cy', "x' OR 1=1 --"]); // values never in the text
    const rows = await runSql({ connection: 'shop', query: sql }, Object.fromEntries(parameters.map(p => [p.name, p.value])));
    expect(rows).toEqual([{ region: 'East', total: 45, orders: 2 }]);
  });

  it('per dialect: quoting and limits', () => {
    expect(buildSql(spec, 'mysql').sql).toMatch(/^SELECT `c`\.`region`[\s\S]*LIMIT 10$/);
    expect(buildSql(spec, 'mssql').sql).toMatch(/^SELECT TOP \(10\) \[c\]\.\[region\]/);
    expect(buildSql(spec, 'oracle').sql).toMatch(/FETCH FIRST 10 ROWS ONLY$/);
    expect(buildSql({ ...spec, filters: [{ column: 'c.region', op: '=', value: { param: 'Region' } }] }, 'postgres')).toMatchObject({ parameters: [] });
    expect(buildSql({ ...spec, filters: [{ column: 'c.region', op: '=', value: { param: 'Region' } }] }, 'postgres').sql).toContain('"c"."region" = @Region');
  });

  it('refuses names that are not names, and anything but its own operators', () => {
    const bad = [
      { ...spec, tables: [{ name: 'customers; DROP TABLE x', alias: 'c' }] },
      { ...spec, columns: [{ column: 'c.name) FROM x --' }] },
      { ...spec, columns: [{ column: 'c.region', as: 'a"b' }] },
      { ...spec, filters: [{ column: 'c.region', op: 'OR 1=1 --', value: 1 }] },
      { ...spec, filters: [{ column: 'c.region', op: '=', value: { evil: 1 } }] },
      { ...spec, joins: [{ type: 'cross', table: 'orders', alias: 'o', on: [{ left: 'c.id', right: 'o.customer_id' }] }] },
      { ...spec, sort: [{ column: 'c.region', dir: 'desc; DROP' }] },
      { ...spec, limit: '10; DROP' },
      { ...spec, columns: [{ column: 'z.region' }] },
    ];
    for (const s of bad) expect(() => buildSql(s, 'sqlite')).toThrow();
  });

  it('the routes are for designers only', async () => {
    const { GET } = await import('../../app/api/data/sql/schema/route.js');
    const { POST } = await import('../../app/api/data/sql/build/route.js');
    const { decide } = await import('../../src/server/access.js');
    expect(decide('GET', '/api/data/sql/schema', 'viewer')).not.toBe('allow');
    expect(decide('GET', '/api/data/sql/schema', 'designer')).toBe('allow');
    expect(decide('POST', '/api/data/sql/build', 'designer')).toBe('allow');
    process.env.PW_AUTH = 'users'; process.env.PW_SESSION_SECRET = 'x'.repeat(48);
    try {
      expect((await GET(new Request('http://pw.test/api/data/sql/schema?connection=shop'))).status).toBe(403);
      expect((await POST(new Request('http://pw.test/api/data/sql/build', { method: 'POST', body: JSON.stringify(spec) }))).status).toBe(403);
    } finally { delete process.env.PW_AUTH; delete process.env.PW_SESSION_SECRET; }
    const ok = await POST(new Request('http://pw.test/api/data/sql/build', { method: 'POST', body: JSON.stringify(spec) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).dialect).toBe('sqlite');
  });
});
