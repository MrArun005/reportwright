// C1: SQL data sources. Real SQLite (node:sqlite) in a temp folder; Postgres only when PW_TEST_PG is set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgReader } from './sql-readers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSql, runSavedSql, bindSql, limits } from '../../src/server/sql.js';
import { writeReport, deleteReport } from '../../src/server/reports.js';
import { stampDefinition } from '../../src/server/perms.js';
import { POST } from '../../app/api/data/sql/route.js';
import { loadSources } from '../../src/engine/data/index.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

let dir, file;
const main = (query) => ({ connection: 'main', query });
const count = () => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare('select count(*) as n from accounts').get().n; } finally { db.close(); } };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sql-'));
  file = path.join(dir, 'bank.db');
  const db = new DatabaseSync(file);
  db.exec(`create table accounts (id integer primary key, name text, region text, opened text, big integer);
    insert into accounts values (1, 'Asha', 'North', '2024-01-15', 9007199254740993),
      (2, 'Bilal', 'South', '2024-02-01', 7), (3, 'Chen', 'North', '2024-03-10', 8),
      (4, 'Dev', 'East', '2024-04-20', 9), (5, 'x''; DROP TABLE accounts; --', 'West', '2024-05-05', 10);`);
  db.close();
  process.env.PW_DB_MAIN = `sqlite:${file}`;
});
afterAll(() => { delete process.env.PW_DB_MAIN; fs.rmSync(dir, { recursive: true, force: true }); });

describe('binding @parameters', () => {
  it('binds values as data and never pastes them into the SQL text', async () => {
    expect(await runSql(main('select name from accounts where id = @id'), { id: 2 })).toEqual([{ name: 'Bilal' }]);
    const b = bindSql('select * from t where id = @id and n = @name', { id: 1, name: "x'; DROP TABLE t; --" }, 'sqlite');
    expect(b).toEqual({ text: 'select * from t where id = ? and n = ?', values: [1, "x'; DROP TABLE t; --"] });
    expect(bindSql('select @a, @b, @a', { a: 1, b: 2 }, 'postgres')).toEqual({ text: 'select $1, $2, $3', values: [1, 2, 1] });
  });
  it('keeps injection attempts as data', async () => {
    expect(await runSql(main('select name from accounts where id = @id'), { id: '1 OR 1=1' })).toEqual([]);
    expect(await runSql(main('select id from accounts where name = @n'), { n: "x'; DROP TABLE accounts; --" })).toEqual([{ id: 5 }]);
    expect(await runSql(main('select id from accounts where name = @n'), { n: "' OR '1'='1" })).toEqual([]);
    expect(count()).toBe(5);
  });
  it('ignores @ inside string literals and comments', async () => {
    const rows = await runSql(main(`select '@notaparam' as a, 'it''s @x' as b -- @nope
      from accounts /* @nope */ where id = @id`), { id: 1 });
    expect(rows).toEqual([{ a: '@notaparam', b: "it's @x" }]);
    expect(bindSql("select 'a\\' @x' from t", {}, 'mysql').text).toBe("select 'a\\' @x' from t"); // MySQL: backslash escapes the quote
  });
  it('expands a list to one placeholder per value; an empty list matches nothing', async () => {
    expect(bindSql('select * from t where r in (@r)', { r: ['N', 'S'] }, 'sqlite')).toEqual({ text: 'select * from t where r in (?, ?)', values: ['N', 'S'] });
    expect(bindSql('select * from t where r in (@r)', { r: [] }, 'sqlite')).toEqual({ text: 'select * from t where r in (NULL)', values: [] });
    expect((await runSql(main('select name from accounts where region in (@r) order by id'), { r: ['North', 'East'] })).map(r => r.name)).toEqual(['Asha', 'Chen', 'Dev']);
    expect(await runSql(main('select name from accounts where region in (@r)'), { r: [] })).toEqual([]);
  });
  it('names an unknown parameter', async () => {
    await expect(runSql(main('select * from accounts where id = @acount'), { account: 1 })).rejects.toThrow(/@acount/);
  });
  it('refuses raw driver placeholders, which would bind the wrong values', () => {
    expect(() => bindSql('select * from t where a = ? and b = @b', { b: 1 }, 'sqlite')).toThrow(/@name/);
    expect(() => bindSql('select * from t where a = $1', {}, 'postgres')).toThrow(/@name/);
    expect(bindSql('select a$1, j ? \'k\' from t', {}, 'postgres').text).toBe("select a$1, j ? 'k' from t"); // $ in a name, the jsonb ? operator
  });
  it('refuses a value that is not a value or a list', () => {
    expect(() => bindSql('select @x', { x: { a: 1 } }, 'sqlite')).toThrow(/"x"/);
  });
});

describe('read-only, limits, connections', () => {
  it('refuses INSERT, UPDATE and other writes', async () => {
    await expect(runSql(main("insert into accounts (name) values ('Eve')"), {})).rejects.toMatchObject({ status: 400 });
    await expect(runSql(main('vacuum into @f'), { f: path.join(dir, 'copy.db') })).rejects.toThrow(/SELECT/);
    // the keyword check is not the only guard: the database itself is opened read-only
    await expect(runSql(main("with x as (select 1) update accounts set name = 'hacked'"), {})).rejects.toThrow(/readonly|read-only|not allowed/i); // the statement check, else the read-only file
    expect(count()).toBe(5);
    expect(fs.existsSync(path.join(dir, 'copy.db'))).toBe(false);
  });
  it('stops at the row cap', async () => {
    const keep = limits.rows;
    limits.rows = 3;
    try {
      await expect(runSql(main('select * from accounts'), {})).rejects.toThrow(/more than 3 rows/);
      expect(await runSql(main('select * from accounts limit 3'), {})).toHaveLength(3);
    } finally { limits.rows = keep; }
    expect(limits.rows).toBe(100000);
  });
  it('turns big integers into numbers when safe, strings when not', async () => {
    expect(await runSql(main('select big from accounts where id in (1, 2) order by id'), {})).toEqual([{ big: '9007199254740993' }, { big: 7 }]);
  });
  it('explains an unknown connection', async () => {
    await expect(runSql({ connection: 'reporting', query: 'select 1' }, {})).rejects.toThrow(/PW_DB_REPORTING/);
    await expect(runSql({ connection: '../etc', query: 'select 1' }, {})).rejects.toThrow(/connection/);
  });
  it('reads connections by name in any case', async () => {
    expect(await runSql({ connection: 'Main', query: 'select 1 as one' }, {})).toEqual([{ one: 1 }]);
  });
});

describe('saved-query mode', () => {
  const id = `e2e-sql-${process.pid}`;
  const def = report([], { def: {
    parameters: [{ name: 'region', type: 'string', default: 'North' }, { name: 'since', type: 'date' }],
    dataSources: [
      { name: 'db', type: 'sql', connection: 'main', query: 'select name from accounts where region = @region and opened >= coalesce(@since, \'\') order by id' },
      { name: 'web', type: 'json', data: [] },
    ],
  } });
  const post = (body) => POST(new Request('http://x/api/data/sql', { method: 'POST', body: JSON.stringify(body) }));
  beforeAll(async () => { await stampDefinition({ kind: 'service' }, id, def); await writeReport(id, def); }); // as a designer saves it
  afterAll(() => deleteReport(id));

  it('runs the query saved in the report, with its parameter defaults and types', async () => {
    expect(await runSavedSql(id, 'db', {})).toEqual([{ name: 'Asha' }, { name: 'Chen' }]);
    expect(await runSavedSql(id, 'db', { since: '2024-02-01' })).toEqual([{ name: 'Chen' }]);
  });
  it('ignores SQL sent by the client', async () => {
    const res = await post({ report: id, source: 'db', params: { region: 'South' }, connection: 'main', query: 'select * from accounts' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [{ name: 'Bilal' }] });
  });
  it('404s an unknown report or source, or a source that is not SQL', async () => {
    await expect(runSavedSql(id, 'nope', {})).rejects.toMatchObject({ status: 404 });
    expect((await post({ report: id, source: 'web', params: {} })).status).toBe(404);
    expect((await post({ report: 'no-such-report', source: 'db', params: {} })).status).toBe(404);
  });
  it('answers 400 for a bad body or a bad id', async () => {
    expect((await post({ source: 'db' })).status).toBe(400);
    expect((await post({ report: '../x', source: 'db' })).status).toBe(400);
    expect((await POST(new Request('http://x/api/data/sql', { method: 'POST', body: 'nope' }))).status).toBe(400);
  });
  it('runs ad-hoc SQL only outside production', async () => {
    const res = await post({ connection: 'main', query: 'select name from accounts where id = @id', params: { id: 3 } });
    expect(await res.json()).toEqual({ rows: [{ name: 'Chen' }] });
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const r = await post({ connection: 'main', query: 'select * from accounts', params: {} });
      expect(r.status).toBe(403);
      expect((await r.json()).error).toMatch(/production/);
      // with the shared password on, whoever gets here could save the same query anyway: allowed
      process.env.PW_BASIC_AUTH = 'a:b';
      expect((await post({ connection: 'main', query: 'select name from accounts where id = @id', params: { id: 3 } })).status).toBe(200);
    } finally { process.env.NODE_ENV = env; delete process.env.PW_BASIC_AUTH; }
  });
});

describe('engine', () => {
  const src = { name: 'db', type: 'sql', connection: 'main', query: 'select name from accounts where region in (@regions) and opened >= @since' };
  const params = { regions: ['North'], since: new Date(2024, 0, 1) };

  it('calls opt.sql on the server, with dates as yyyy-MM-dd', async () => {
    const calls = [];
    const out = await loadSources({ dataSources: [src] }, { params, sql: async (s, p) => { calls.push([s, p]); return runSql(s, p); } });
    expect(out.db).toEqual([{ name: 'Asha' }, { name: 'Chen' }]);
    expect(calls[0][1]).toEqual({ regions: ['North'], since: '2024-01-01' });
  });
  it('in the browser, POSTs the report id and source name, never the SQL', async () => {
    let seen;
    const fetch = async (url, init) => { seen = { url, init }; return Response.json({ rows: [{ name: 'Asha' }] }); };
    const out = await loadSources({ dataSources: [src] }, { params, fetch, baseUrl: 'https://pw.example.com/', reportId: 'loans' });
    expect(out.db).toEqual([{ name: 'Asha' }]);
    expect(seen.url).toBe('https://pw.example.com/api/data/sql');
    expect(seen.init.method).toBe('POST');
    expect(JSON.parse(seen.init.body)).toEqual({ report: 'loans', source: 'db', params: { regions: ['North'], since: '2024-01-01' } });
    expect(seen.init.body).not.toMatch(/select|main|query|connection/i);
  });
  it('reports the server error under the source name', async () => {
    const fetch = async () => Response.json({ error: 'The query ran longer than 30 s' }, { status: 504 });
    await expect(loadSources({ dataSources: [src] }, { params, fetch, reportId: 'loans' })).rejects.toThrow('Data source "db": The query ran longer than 30 s');
    await expect(loadSources({ dataSources: [src] }, { params, fetch })).rejects.toThrow(/Data source "db": .*[Ss]ave/);
  });
  it('renders a report from a SQLite source end to end', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 18, dataSet: 'Rows', columns: [{ width: 200 }], detail: [{ height: 18, cells: [{ value: '=Fields.name' }] }] }], { def: {
      parameters: [{ name: 'regions', type: 'string', multi: true }],
      dataSources: [{ name: 'db', type: 'sql', connection: 'main', query: 'select name from accounts where region in (@regions) order by id' }],
      dataSets: [{ name: 'Rows', source: 'db' }],
    } });
    const out = await render(def, { fontStore, parameters: { regions: 'North,East' }, sql: runSql });
    expect(texts(out.pages[0])).toEqual(['Asha', 'Chen', 'Dev']);
    expect(out.warnings).toEqual([]);
    const { renderTo } = await import('../../src/server/renderer.js'); // server renders query directly
    const r = await renderTo(def, { format: 'json', parameters: { regions: ['South'] }, baseUrl: 'http://127.0.0.1:3000' });
    expect(texts(r.model.pages[0])).toEqual(['Bilal']);
  });
});

// Opt-in: PW_TEST_PG=postgres://user@127.0.0.1:5432/db npx vitest run tests/engine/sql.test.js
describe('size cap', () => {
  it('one huge value counts against the byte cap, not just the rows', async () => {
    const keep = { ...limits };
    Object.assign(limits, { bytes: 100000 });
    try {
      await expect(runSql(main("select printf('%.*c', 200000, 'x') as big"), {})).rejects.toThrow(/more than 0 MB|more than/);
      expect((await runSql(main("select printf('%.*c', 1000, 'x') as small"), {}))[0].small.length).toBe(1000);
    } finally { Object.assign(limits, keep); }
  });
});

describe.skipIf(!process.env.PW_TEST_PG)('postgres', () => {
  beforeAll(async () => { process.env.PW_DB_PG = await pgReader(process.env.PW_TEST_PG); }); // a reading role: the probe refuses an admin
  afterAll(() => { delete process.env.PW_DB_PG; });
  const pg = (query) => ({ connection: 'pg', query });

  it('binds, expands lists and keeps dates as written', async () => {
    const rows = await runSql(pg(`select g, @t::text as t, date '2024-01-15' as d from generate_series(1, 5) g where g in (@gs) order by g`), { t: "x'; drop table y; --", gs: [2, 4] });
    expect(rows).toEqual([{ g: 2, t: "x'; drop table y; --", d: '2024-01-15' }, { g: 4, t: "x'; drop table y; --", d: '2024-01-15' }]);
  });
  it('runs read-only, one statement only', async () => {
    await expect(runSql(pg('select 1; commit; create table pw_hack (a int)'), {})).rejects.toThrow(); // COMMIT would end the read-only transaction
    await expect(runSql(pg('with t as (delete from pg_catalog.pg_class where false returning 1) select * from t'), {})).rejects.toThrow(/read-only|data-modifying|not allowed/);
    expect(await runSql(pg("select count(*)::int as n from pg_tables where tablename = 'pw_hack'"), {})).toEqual([{ n: 0 }]);
  });
  it('stops at the row cap and the time limit', async () => {
    const keep = { ...limits };
    Object.assign(limits, { rows: 3, ms: 300 });
    try {
      await expect(runSql(pg('select g from generate_series(1, 10) g'), {})).rejects.toThrow(/more than 3 rows/);
      await expect(runSql(pg('select count(*) as n from generate_series(1, 400000000)'), {})).rejects.toMatchObject({ status: 504 });
    } finally { Object.assign(limits, keep); }
  });
});
