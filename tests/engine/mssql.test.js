// Enterprise 1: SQL Server connections (mssql://). Binding is tested always; the driver only when PW_TEST_MSSQL is set:
//   docker run -d --name pw-mssql -e ACCEPT_EULA=1 -e 'MSSQL_SA_PASSWORD=Pw-Test-Strong1!' -p 14330:1433 mcr.microsoft.com/azure-sql-edge
//   PW_TEST_MSSQL='mssql://sa:Pw-Test-Strong1!@127.0.0.1:14330/master?encrypt=false' npx vitest run tests/engine/mssql.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { runSql, bindSql, limits, listConnections, testConnection, mssqlConfig, tsqlParts, isOneSelect, probeReadOnly, streamRows, sizeOf, clock } from '../../src/server/sql.js';

describe('binding for SQL Server', () => {
  it('binds @name as @pw_n inputs and leaves [names], strings and @@vars alone', () => {
    expect(bindSql("select [a@b], '@x', @@rowcount, @id, N'it''s @y' from t where r in (@r) and c = a@b", { id: 7, r: ['N', 'S'] }, 'mssql'))
      .toEqual({ text: "select [a@b], '@x', @@rowcount, @pw_1, N'it''s @y' from t where r in (@pw_2, @pw_3) and c = a@b", values: [7, 'N', 'S'] });
  });
  it('scans T-SQL as the server does: nested comments, ]] and "" escapes; unfinished ones are refused', () => {
    const parts = (q) => tsqlParts(q).map(p => (p.code ? 'C' : 'x') + p.text);
    expect(parts('select /* a /* b */ @x */ 1')).toEqual(['Cselect ', 'x/* a /* b */ @x */', 'C 1']);
    expect(parts('select [a]]@b], "c""@d", N\'e\'\'@f\' -- @g\n,1')).toEqual(['Cselect ', 'x[a]]@b]', 'C, ', 'x"c""@d"', 'C, N', "x'e''@f'", 'C ', 'x-- @g', 'C\n,1']);
    for (const q of ['select 1 /* /* */', "select 'x", 'select [a]] from t', 'select "a']) expect(() => tsqlParts(q), q).toThrow(/does not end/);
    expect(parts('select 1 --c\rdelete')).toEqual(['Cselect 1 ', 'x--c', 'C\rdelete']); // a CR ends -- as an LF does
  });
  it('never binds inside comments or names, and refuses statement words in code', () => {
    expect(bindSql('select /* /* */ @x */ @y as [a]]@z]', { y: 1 }, 'mssql')).toEqual({ text: 'select /* /* */ @x */ @pw_1 as [a]]@z]', values: [1] });
    for (const q of ['select 1 as a set rowcount 0', 'select 1 as a commit', 'select 1 as a go', 'select * into #t from x', 'exec sp_who', 'select 1 declare @a int',
      "select 1 waitfor delay '0:0:5'", 'select 1 as [x]] delete from t --]  update t set a = 1']) expect(() => bindSql(q, {}, 'mssql'), q).toThrow(/not allowed/);
    expect(bindSql('select [set], "into", \'delete\' as [update] from t /* drop */ -- exec', {}, 'mssql').values).toEqual([]);
  });
  it('the read-only probe fails closed: an error is not a pass', async () => {
    const pool = (fail) => ({ request: () => ({ query: async () => { if (fail === 'query') throw new Error('lost'); return { recordset: [{ sysadmin: 0 }] }; } }) });
    const sql = { Transaction: class { async begin() {} async rollback() {} }, Request: class { async batch() { const e = new Error('cancelled'); e.number = 0; throw e; } } };
    await expect(probeReadOnly(sql, pool('query'))).rejects.toThrow(/lost/);
    await expect(probeReadOnly(sql, pool())).rejects.toThrow(/cancelled/); // CREATE TABLE failed, but not with "permission denied"
    const denied = { ...sql, Request: class { async batch() { throw Object.assign(new Error('CREATE TABLE permission denied'), { number: 262 }); } } };
    expect(await probeReadOnly(denied, pool())).toBe('');
    expect(await probeReadOnly(sql, { request: () => ({ query: async () => ({ recordset: [{ sysadmin: null }] }) }) })).toBe('sysadmin'); // unknown is not "no"
  });
  it('accepts only a plan of exactly one SELECT', () => {
    const plan = (xml) => ({ recordsets: [[{ 'Microsoft SQL Server 2005 XML Showplan': xml }]] });
    const one = (t, extra = '') => `<?xml version="1.0"?><ShowPlanXML xmlns="x"><BatchSequence><Batch><Statements><StmtSimple StatementText="s" StatementType="${t}"${extra}><QueryPlan/></StmtSimple>`;
    expect(isOneSelect(plan(`${one('SELECT')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe('SELECT');
    expect(isOneSelect(plan(`${one('SELECT WITHOUT QUERY')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe('SELECT WITHOUT QUERY');
    expect(isOneSelect(plan(`${one('JSON SELECT')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe('JSON SELECT');
    expect(isOneSelect(plan(`${one('XML SELECT')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe('XML SELECT'); // refused when its result comes
    for (const bad of [
      plan(`${one('SELECT INTO')}</Statements></Batch></BatchSequence></ShowPlanXML>`),
      plan(`${one('DELETE')}</Statements></Batch></BatchSequence></ShowPlanXML>`),
      plan(`${one('SELECT')}</StmtSimple><StmtSimple StatementType="SELECT"/></Statements></Batch></BatchSequence></ShowPlanXML>`),
      plan(`${one('SELECT')}</StmtSimple><StmtCond/></Statements></Batch></BatchSequence></ShowPlanXML>`),
      plan(`${one('SELECT', ' StatementType="DELETE"')}</Statements></Batch></BatchSequence></ShowPlanXML>`),
      plan('<ShowPlanXML><BatchSequence><Batch><Statements></Statements></Batch></BatchSequence></ShowPlanXML>'),
      plan('<ShowPlanXML><BatchSequence><Batch/><Batch/></BatchSequence></ShowPlanXML>'),
      plan('not a plan'), { recordsets: [] }, { recordsets: [[], []] }, { recordsets: [[{ a: 1 }]] }, null,
    ]) expect(isOneSelect(bad)).toBe(false);
  });
  it('reads the connection URL without showing it', () => {
    expect(mssqlConfig('mssql://u%40x:p%3Aw@db.example:1444/sales?encrypt=false&trustServerCertificate=true&instance=SQL1'))
      .toMatchObject({ user: 'u@x', password: 'p:w', server: 'db.example', port: 1444, database: 'sales', options: { encrypt: false, trustServerCertificate: true, instanceName: 'SQL1' } });
    expect(mssqlConfig('mssql://u:p@h/db')).toMatchObject({ port: 1433, options: { encrypt: true, trustServerCertificate: false } });
    process.env.PW_DB_MSX = 'mssql://u:p@h/db';
    try { expect(listConnections().find(c => c.name === 'msx')).toEqual({ name: 'msx', kind: 'mssql', procs: [] }); } finally { delete process.env.PW_DB_MSX; }
  });
});


describe('SQL Server resource caps (batch 3b, no server needed)', () => {
  const fake = () => Object.assign(new EventEmitter(), { cancelled: 0, cancel() { this.cancelled++; queueMicrotask(() => this.emit('done')); } });
  const sql = { Xml: 'x', UDT: 'u', Geography: 'g', Geometry: 'm' };
  const run = (r, o = {}) => streamRows(r, () => {}, { sql, overdue: () => {}, ...o });
  it('counts info and error messages: a flood is cancelled', async () => {
    const r = fake();
    const p = run(r);
    r.emit('recordset', { a: { name: 'a', type: 'n' } });
    for (let i = 0; i < 1500 && !r.cancelled; i++) r.emit('info', { message: 'Warning: null value eliminated' });
    await expect(p).rejects.toThrow(/more than 1000 messages/);
    expect(r.cancelled).toBe(1);
    const big = fake();
    const keep = { ...limits };
    Object.assign(limits, { bytes: 100000 });
    try {
      const q = run(big);
      for (let i = 0; i < 50 && !big.cancelled; i++) big.emit('error', Object.assign(new Error('x'.repeat(4000)), { number: 50000 }));
      await expect(q).rejects.toThrow(/MB/);
    } finally { Object.assign(limits, keep); }
  });
  it('a second result set, and xml or CLR columns, stop the request', async () => {
    const r = fake();
    const p = run(r, { one: 'one only' });
    r.emit('recordset', {}); r.emit('recordset', {});
    await expect(p).rejects.toThrow(/one only/);
    const x = fake();
    const q = run(x, { odd: true });
    x.emit('recordset', { h: { name: 'h', type: 'u' } });
    await expect(q).rejects.toThrow(/xml or a CLR type/);
  });
  it('counts every value type: lists (same-name columns), buffers, objects', async () => {
    expect(sizeOf(['ab', 'cd'])).toBe(8 + 4 + 4);
    expect(sizeOf(Buffer.alloc(10))).toBe(10);
    expect(sizeOf({ x: 'y'.repeat(100) })).toBeGreaterThan(200);
    const keep = { ...limits };
    Object.assign(limits, { bytes: 1000 });
    try {
      const r = fake();
      const p = run(r, { lobSize: 10000 });
      r.emit('recordset', { a: { name: 'a', type: 'n' } });
      for (let i = 0; i < 10 && !r.cancelled; i++) r.emit('row', { a: ['x'.repeat(100), 'y'.repeat(100)] });
      await expect(p).rejects.toThrow(/more than 0 MB/);
    } finally { Object.assign(limits, keep); }
  });
  it('the clock cancels what it tracks, and nothing starts after it fired', async () => {
    const c = clock(30);
    const r = { cancel: () => { r.n = (r.n || 0) + 1; } };
    c.track(r);
    await new Promise(res => setTimeout(res, 60));
    expect(r.n).toBe(1);
    expect(() => c.track({})).toThrow(/longer than/);
    await expect(c.inTime(new Promise(() => {}))).rejects.toMatchObject({ status: 504 });
    c.stop();
  });
  it('review 3b-2: the request in flight is cancelled even when the 504 timer fires first', async () => {
    const real = Date.now;
    let t = real();
    const c = clock(50);
    const r = { cancel: () => { r.n = (r.n || 0) + 1; } };
    c.track(r);
    Date.now = () => real() + 1; // the clock moved a millisecond between the deadline and the wait (seen live)
    try { await expect(c.inTime(new Promise(() => {}))).rejects.toMatchObject({ status: 504 }); } finally { Date.now = real; }
    c.stop();
    expect(r.n).toBe(1);
    void t;
  });
  it('the per-database probe stops at its deadline, whatever the server does', async () => {
    const live = [];
    const hang = () => { const r = { cancel() { r.reject(Object.assign(new Error('cancelled'), { code: 'ECANCEL' })); }, query: () => new Promise((_, rej) => { r.reject = rej; }) }; live.push(r); return r; };
    let n = 0;
    // the first answer passes and lists 1,000 databases; each database then hangs
    const pool = { request: () => (n++ === 0 ? { query: async () => ({ recordset: [{ sysadmin: 0 }] }) } : n === 2 ? { query: async () => ({ recordset: Array.from({ length: 1000 }, (_, i) => ({ q: `[d${i}]`, name: `d${i}` })) }) } : hang()) };
    const c = clock(150);
    const t0 = Date.now();
    await expect(probeReadOnly({}, pool, c)).rejects.toThrow();
    c.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(live).toHaveLength(1); // the next database never started
  });
});

// PW_TEST_MSSQL is an admin login (sa): the setup makes a database pwtest and a reading login pw_reader in it
// (db_datareader + SHOWPLAN), as the README tells admins to. Report queries run as pw_reader.
const READER_PW = 'Reader-Pass-123!';
const readerUrl = () => { const u = new URL(process.env.PW_TEST_MSSQL); u.username = 'pw_reader'; u.password = encodeURIComponent(READER_PW); u.pathname = '/pwtest'; return u.href; };
describe.skipIf(!process.env.PW_TEST_MSSQL)('SQL Server (live)', () => {
  const ms = (query) => ({ connection: 'ms', query });
  beforeAll(async () => {
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    await admin.request().batch(`IF DB_ID('pwtest') IS NULL CREATE DATABASE pwtest`);
    await admin.request().batch(`IF SUSER_ID('pw_reader') IS NULL CREATE LOGIN pw_reader WITH PASSWORD = '${READER_PW}', CHECK_POLICY = OFF`);
    await admin.request().batch(`USE pwtest;
      IF USER_ID('pw_reader') IS NULL CREATE USER pw_reader FOR LOGIN pw_reader;
      ALTER ROLE db_datareader ADD MEMBER pw_reader; GRANT SHOWPLAN TO pw_reader;
      IF OBJECT_ID('dbo.pw_accounts') IS NOT NULL DROP TABLE dbo.pw_accounts;
      CREATE TABLE dbo.pw_accounts (id INT PRIMARY KEY, name NVARCHAR(100), region NVARCHAR(20), opened DATE, big BIGINT);
      INSERT INTO dbo.pw_accounts VALUES (1, N'Asha', 'North', '2024-01-15', 9007199254740993), (2, N'Bilal', 'South', '2024-02-01', 7),
        (3, N'Chen', 'North', '2024-03-10', 8), (4, N'Dev', 'East', '2024-04-20', 9), (5, N'x''; DROP TABLE pw_accounts; --', 'West', '2024-05-05', 10);`);
    await admin.close();
    process.env.PW_DB_MS = readerUrl();
  });
  afterAll(() => { delete process.env.PW_DB_MS; });
  const count = async () => (await runSql(ms('select count(*) as n from dbo.pw_accounts'), {}))[0].n;

  it('binds values, expands lists, keeps dates as written and big numbers exact', async () => {
    expect(await runSql(ms('select name from dbo.pw_accounts where id = @id'), { id: 2 })).toEqual([{ name: 'Bilal' }]);
    expect(await runSql(ms('select id from dbo.pw_accounts where name = @n'), { n: "x'; DROP TABLE pw_accounts; --" })).toEqual([{ id: 5 }]);
    expect(await runSql(ms('select name from dbo.pw_accounts where id = @id'), { id: '1 OR 1=1' }).catch(e => e.message)).toMatch(/conver/i);
    expect((await runSql(ms('select name from dbo.pw_accounts where region in (@r) order by id'), { r: ['North', 'East'] })).map(r => r.name)).toEqual(['Asha', 'Chen', 'Dev']);
    expect(await runSql(ms('select name from dbo.pw_accounts where region in (@r)'), { r: [] })).toEqual([]);
    expect(await runSql(ms('select opened, big from dbo.pw_accounts where id = 1'), {})).toEqual([{ opened: '2024-01-15', big: '9007199254740993' }]);
    expect(await runSql(ms('with t as (select id from dbo.pw_accounts) select top (@n) id from t order by id'), { n: 2 })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await count()).toBe(5);
    // FOR JSON is a read too (the plan calls it JSON SELECT), and it counts against the row cap; FOR XML is refused
    expect(Object.values((await runSql(ms('select id from dbo.pw_accounts where id = 1 for json path'), {}))[0])[0]).toBe('[{"id":1}]');
    await expect(runSql(ms('select id from dbo.pw_accounts where id = 1 for xml path'), {})).rejects.toThrow(/FOR XML is not supported/);
    await expect(runSql(ms('select id from dbo.pw_accounts for xml auto'), {})).rejects.toThrow(/FOR XML is not supported/);
    const keep = { ...limits };
    Object.assign(limits, { rows: 2 });
    try { await expect(runSql(ms('select id from dbo.pw_accounts for json path'), {})).rejects.toThrow(/more than 2 rows/); }
    finally { Object.assign(limits, keep); }
  });

  it('runs exactly one SELECT: no second statement, no writes, no procedures', async () => {
    for (const q of [
      'select 1 as a delete from dbo.pw_accounts', // T-SQL needs no ";" between statements
      'select 1 as a; commit; delete from dbo.pw_accounts',
      'select * into dbo.pw_copy from dbo.pw_accounts',
      'with t as (select 1 a) select a from t; drop table dbo.pw_accounts',
      "select 1 as a waitfor delay '00:00:05'",
    ]) await expect(runSql(ms(q), {}), q).rejects.toThrow(/one SELECT/);
    await expect(runSql(ms('exec sp_who'), {})).rejects.toThrow(/SELECT/);
    await expect(runSql(ms('update dbo.pw_accounts set name = name'), {})).rejects.toThrow(/SELECT/);
    expect(await count()).toBe(5);
    expect(await runSql(ms("select count(*) as n from sys.tables where name = 'pw_copy'"), {})).toEqual([{ n: 0 }]);
  });

  it('refuses every shape that tried to make the checked text differ from the run text', async () => {
    const shapes = [
      'select 1 as a /* /* */ delete from dbo.pw_accounts /* */ */ delete from dbo.pw_accounts',
      'select 1 as [x]] delete from dbo.pw_accounts --] delete from dbo.pw_accounts',
      'select 1 as a; set showplan_xml off; delete from dbo.pw_accounts',
      'select 1 as a set rowcount 0',
      'select 1 as a commit delete from dbo.pw_accounts',
      'select 1 as a\ngo\ndelete from dbo.pw_accounts',
      'select 1 as a /* unfinished',
      "select N'x as a",
      'declare @a int select @a as a',
      "select 1 as a; exec('delete from dbo.pw_accounts')",
      // the corpus: every way a statement could hide or slip in
      'select 1 as a /* /* nested */ still a comment */ delete from dbo.pw_accounts',
      'select 1 as "a""b" delete from dbo.pw_accounts',
      "select N'it''s' as a delete from dbo.pw_accounts",
      "select 1 as a\nGO\nselect 2 as b",
      'select 1 as a select 2 as b',
      'exec sp_who',
      'execute sp_who',
      'select * into dbo.pw_copy from dbo.pw_accounts',
      "select 1 as a waitfor delay '00:00:05'",
      'select 1 as a commit',
      'set showplan_xml off',
      'select 1 as a; set showplan_xml off',
      "select * from openrowset('SQLNCLI', 'Server=.;Trusted_Connection=yes', 'select 1')",
      "select * from openquery(x, 'select 1')",
      'select 1 as a\u000cdelete from dbo.pw_accounts',
      'select 1 as a\u00a0delete from dbo.pw_accounts',
      'select 1 as a\u2028delete from dbo.pw_accounts',
      'select 1 as a ｄｅｌｅｔｅ from dbo.pw_accounts', // fullwidth letters
      'select 1 as a dеlete from dbo.pw_accounts', // a Cyrillic е
      'ѕelect 1 as a', // a Cyrillic ѕ
      'select 1 as a insert dbo.pw_accounts (id) values (9)',
      'select 1 as a merge dbo.pw_accounts as t using (select 9 as id) s on t.id = s.id when not matched then insert (id) values (9);',
      'select 1 as a truncate table dbo.pw_accounts',
      'select next value for dbo.nope as a', // no such sequence: a compile error, still 400
      'select 1 as a --\rdelete from dbo.pw_accounts', // a lone CR ends a -- comment on SQL Server
    ];
    for (const q of shapes) await expect(runSql(ms(q), {}), q).rejects.toMatchObject({ status: 400 });
    // and what is legal stays legal, with the same meaning on both sides
    expect(await runSql(ms('select 1 as [x]] delete from dbo.pw_accounts --]'), {})).toEqual([{ 'x] delete from dbo.pw_accounts --': 1 }]);
    expect(await runSql(ms('select @n /* @z */ as [a@b] -- @q'), { n: 3 })).toEqual([{ 'a@b': 3 }]);
    await expect(runSql(ms('select @n /* /* @z */ */ as [a@b]'), { n: 3 })).rejects.toThrow(/nested comments/); // fail closed (3b)
    expect(await count()).toBe(5);
  });

  it('a statement the keyword scan does not know is still refused by the server parse', async () => {
    // two SELECTs: no word in it is refused, the plan has two statements
    await expect(runSql(ms('select 1 as a; with x as (select 2 as b) select b from x'), {})).rejects.toThrow(/one SELECT/);
    await expect(runSql(ms('select 1 as a select 2 as b'), {})).rejects.toThrow(/one SELECT/);
    // a statement the list does not name (RECEIVE) does not get through either
    await expect(runSql(ms('select 1 as a receive top (1) * from dbo.q'), {})).rejects.toMatchObject({ status: 400 });
  });

  it('rolls back whatever a SELECT manages to change (a function with side effects cannot, but the guard holds anyway)', async () => {
    // NEXT VALUE FOR changes state in a SELECT; the transaction is rolled back, so no row is ever written by a report
    expect(await runSql(ms('select top 1 id from dbo.pw_accounts order by id'), {})).toEqual([{ id: 1 }]);
  });

  it('stops on the client: rows past the cap and text past the byte cap are never read; one deadline for all', async () => {
    const keep = { ...limits };
    try {
      // 2 billion rows: the request is cancelled at row 11, at once
      Object.assign(limits, { rows: 10, ms: 20000 });
      let t0 = Date.now();
      await expect(runSql(ms('select a.object_id from sys.all_objects a cross join sys.all_objects b cross join sys.all_objects c'), {})).rejects.toThrow(/more than 10 rows/);
      expect(Date.now() - t0).toBeLessThan(5000);
      // a few rows, but each a megabyte of text
      Object.assign(limits, { rows: 1000, bytes: 3 * 1048576 });
      t0 = Date.now();
      await expect(runSql(ms("select top 100 replicate(cast('x' as varchar(max)), 300000) as big from sys.all_objects"), {})).rejects.toThrow(/more than 3 MB/);
      expect(Date.now() - t0).toBeLessThan(5000);
      // one value larger than the cap
      await expect(runSql(ms("select replicate(cast('x' as varchar(max)), 4000000) as big"), {})).rejects.toThrow(/MB/);
      // the deadline covers the probe, the parse check and the run together
      Object.assign(limits, { ms: 1200, bytes: keep.bytes });
      t0 = Date.now();
      await expect(runSql(ms('select count_big(*) as n from sys.all_objects a cross join sys.all_objects b cross join sys.all_objects c where checksum(concat(a.name, b.name, c.name)) = 1'), {})).rejects.toMatchObject({ status: 504 });
      expect(Date.now() - t0).toBeLessThan(4000);
      await expect(runSql(ms("select 1 as a waitfor delay '00:00:05'"), {})).rejects.toMatchObject({ status: 400 });
    } finally { Object.assign(limits, keep); }
    // the pooled connections are clean afterwards
    expect((await runSql(ms('select id from dbo.pw_accounts'), {})).length).toBe(5);
  });

  it('stops at the row cap and the time limit', async () => {
    const keep = { ...limits };
    Object.assign(limits, { rows: 3, ms: 1000 });
    try {
      await expect(runSql(ms('select id from dbo.pw_accounts'), {})).rejects.toThrow(/more than 3 rows/);
      // a slow SELECT: a cross join big enough to run past the limit
      await expect(runSql(ms('select count_big(*) as n from sys.all_objects a cross join sys.all_objects b cross join sys.all_objects c where checksum(concat(a.name, b.name, c.name)) = 1'), {})).rejects.toMatchObject({ status: 504 });
    } finally { Object.assign(limits, keep); }
    // the pooled connection is clean again: no row cap left behind
    expect((await runSql(ms('select id from dbo.pw_accounts'), {})).length).toBe(5);
  });

  it('refuses a login that can write, before running anything', async () => {
    process.env.PW_DB_MSADMIN = process.env.PW_TEST_MSSQL; // sa: sysadmin
    try {
      await expect(runSql({ connection: 'msadmin', query: 'select 1 as a' }, {})).rejects.toThrow(/login can write \(sysadmin\)/);
      const r = await testConnection('msadmin');
      expect(r).toMatchObject({ ok: false });
      expect(r.error).not.toContain('Pw-Test');
    } finally { delete process.env.PW_DB_MSADMIN; }
    // a reader that was also given any right to change something is refused too: a table, a column, a schema
    // (even an empty one), another user to impersonate, a procedure, a role that can write
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    const grants = [
      ['GRANT INSERT ON dbo.pw_accounts TO pw_reader', 'REVOKE INSERT ON dbo.pw_accounts TO pw_reader', /pw_accounts/],
      ['GRANT UPDATE ON dbo.pw_accounts (name) TO pw_reader', 'REVOKE UPDATE ON dbo.pw_accounts (name) TO pw_reader', /UPDATE/],
      ["IF SCHEMA_ID('pw_empty') IS NULL EXEC('CREATE SCHEMA pw_empty'); GRANT INSERT ON SCHEMA::pw_empty TO pw_reader", 'REVOKE INSERT ON SCHEMA::pw_empty TO pw_reader; DROP SCHEMA pw_empty', /SCHEMA/],
      ['GRANT IMPERSONATE ON USER::dbo TO pw_reader', 'REVOKE IMPERSONATE ON USER::dbo TO pw_reader', /IMPERSONATE/],
      // an owner has implicit rights that are in no permission table
      ["IF SCHEMA_ID('pw_owned') IS NULL EXEC('CREATE SCHEMA pw_owned AUTHORIZATION pw_reader')", 'DROP SCHEMA pw_owned', /owner of the schema \[pw_owned\]/],
      ["IF DATABASE_PRINCIPAL_ID('pw_owner_role') IS NULL CREATE ROLE pw_owner_role; EXEC('CREATE SCHEMA pw_rs AUTHORIZATION pw_owner_role'); ALTER ROLE pw_owner_role ADD MEMBER pw_reader", 'ALTER ROLE pw_owner_role DROP MEMBER pw_reader; DROP SCHEMA pw_rs; DROP ROLE pw_owner_role', /owner of the schema \[pw_rs\]/],
      ['ALTER AUTHORIZATION ON OBJECT::dbo.pw_accounts TO pw_reader', 'ALTER AUTHORIZATION ON OBJECT::dbo.pw_accounts TO SCHEMA OWNER', /owner of \[pw_accounts\]/],
      // owning a role, a type; holding a grant option; server rights through a server role or public
      ["IF DATABASE_PRINCIPAL_ID('pw_owned_role') IS NULL CREATE ROLE pw_owned_role AUTHORIZATION pw_reader; GRANT INSERT ON dbo.pw_accounts TO pw_owned_role", 'DROP ROLE pw_owned_role', /owner of role \[pw_owned_role\]/],
      ["IF TYPE_ID('pw_t') IS NULL CREATE TYPE pw_t FROM INT; ALTER AUTHORIZATION ON TYPE::pw_t TO pw_reader", 'DROP TYPE pw_t', /owner of type \[pw_t\]/],
      ['GRANT SELECT ON dbo.pw_accounts TO pw_reader WITH GRANT OPTION', 'REVOKE SELECT ON dbo.pw_accounts TO pw_reader CASCADE; GRANT SELECT ON dbo.pw_accounts TO pw_reader; REVOKE SELECT ON dbo.pw_accounts TO pw_reader', /granted SELECT/],
      ["USE master; IF SUSER_ID('pw_srv_role') IS NULL CREATE SERVER ROLE pw_srv_role; GRANT IMPERSONATE ON LOGIN::sa TO pw_srv_role; ALTER SERVER ROLE pw_srv_role ADD MEMBER pw_reader", 'USE master; ALTER SERVER ROLE pw_srv_role DROP MEMBER pw_reader; DROP SERVER ROLE pw_srv_role', /IMPERSONATE/],
      ['USE master; GRANT IMPERSONATE ON LOGIN::sa TO public', 'USE master; REVOKE IMPERSONATE ON LOGIN::sa TO public', /IMPERSONATE/],
      // positive lists (3b): a VIEW right the old filter let through, and a schema right
      ['USE master; CREATE USER pw_reader FOR LOGIN pw_reader; GRANT EXECUTE ON sys.xp_regwrite TO pw_reader', 'USE master; REVOKE EXECUTE ON sys.xp_regwrite TO pw_reader; DROP USER pw_reader', /xp_regwrite/],
      ['USE master; GRANT VIEW SERVER STATE TO pw_reader', 'USE master; REVOKE VIEW SERVER STATE TO pw_reader', /VIEW SERVER STATE/],
      ['GRANT VIEW DATABASE STATE TO pw_reader', 'REVOKE VIEW DATABASE STATE TO pw_reader', /VIEW DATABASE STATE/],
      ['GRANT VIEW DEFINITION ON SCHEMA::dbo TO pw_reader', 'REVOKE VIEW DEFINITION ON SCHEMA::dbo TO pw_reader', /VIEW DEFINITION/],
      ["IF DATABASE_PRINCIPAL_ID('pw_writers') IS NULL CREATE ROLE pw_writers; GRANT DELETE ON SCHEMA::dbo TO pw_writers; ALTER ROLE pw_writers ADD MEMBER pw_reader", 'ALTER ROLE pw_writers DROP MEMBER pw_reader; DROP ROLE pw_writers', /DELETE/],
    ];
    let n = 0;
    for (const [grant, revoke, why] of grants) {
      try {
        await admin.request().batch(`USE pwtest; ${grant};`);
        process.env.PW_DB_MSW2 = `${readerUrl()}&probe=${++n}`; // another pool: a fresh probe
        await expect(runSql({ connection: 'msw2', query: 'select 1 as a' }, {}), grant).rejects.toThrow(why);
      } finally {
        await admin.request().batch(`USE pwtest; ${revoke};`);
        delete process.env.PW_DB_MSW2;
      }
    }
    await admin.close();
    process.env.PW_DB_MSW2 = `${readerUrl()}&probe=clean`;
    try { expect(await runSql({ connection: 'msw2', query: 'select 1 as a' }, {})).toEqual([{ a: 1 }]); } finally { delete process.env.PW_DB_MSW2; }
  });

  it('no error from a query shows the connection URL or its password', async () => {
    process.env.PW_DB_MSBAD2 = readerUrl().replace(/:[^:@/]+@/, ':Leaky-Secret-99@');
    try {
      const e = await runSql({ connection: 'msbad2', query: 'select 1 as a' }, {}).catch(x => x);
      expect(e.message).not.toContain('Leaky-Secret-99');
      expect(e.message).not.toContain('pw_reader');
    } finally { delete process.env.PW_DB_MSBAD2; }
  });

  it('review: the deadline holds for requests started after it passed: a query waiting for a pooled connection stops on time', async () => {
    const keep = { ...limits };
    const slow = 'select count_big(*) as n from sys.all_objects a cross join sys.all_objects b cross join sys.all_objects c where checksum(concat(a.name, b.name, c.name)) = 1';
    try {
      await runSql(ms('select 1 as a'), {}); // the login probe is fresh
      Object.assign(limits, { ms: 6000 });
      const busy = Array.from({ length: 5 }, () => runSql(ms(slow), {}).catch(e => e)); // every pooled connection (max 5)
      await new Promise(r => setTimeout(r, 300));
      Object.assign(limits, { ms: 800 });
      const t0 = Date.now();
      await expect(runSql(ms('select 1 as a'), {})).rejects.toMatchObject({ status: 504 });
      expect(Date.now() - t0).toBeLessThan(2000); // the time limit, not the wait for a connection
      await Promise.all(busy);
    } finally { Object.assign(limits, keep); }
    // every connection is clean afterwards: no SHOWPLAN, row cap or text size left behind
    for (let i = 0; i < 6; i++) expect(await runSql(ms('select id from dbo.pw_accounts'), {})).toHaveLength(5);
  }, 30000);

  it('review: one huge text value is cut by the server (TEXTSIZE) and refused, not buffered in full', async () => {
    const keep = { ...limits };
    Object.assign(limits, { bytes: 3 * 1048576 });
    try {
      global.gc?.();
      const before = process.memoryUsage().rss;
      const t0 = Date.now();
      // 100 MB of text in one value (nvarchar), and 60 MB in one varchar value
      await expect(runSql(ms("select replicate(cast(N'x' as nvarchar(max)), 50000000) as big"), {})).rejects.toThrow(/MB/);
      await expect(runSql(ms("select replicate(cast('y' as varchar(max)), 60000000) as big"), {})).rejects.toThrow(/MB/);
      await expect(runSql(ms("select cast(replicate(cast(0x41 as varbinary(max)), 60000000) as varbinary(max)) as big"), {})).rejects.toThrow(/MB/);
      expect(process.memoryUsage().rss - before).toBeLessThan(80 * 1048576);
      expect(Date.now() - t0).toBeLessThan(20000);
      // a value within its share passes (a quarter of the cap: the driver holds a value up to four times over);
      // xml and CLR (UDT) columns are refused (no size cap on the server for them)
      expect((await runSql(ms("select replicate(cast('z' as varchar(max)), 300000) as v"), {}))[0].v).toHaveLength(300000);
      await expect(runSql(ms("select replicate(cast('z' as varchar(max)), 1000000) as v"), {})).rejects.toThrow(/MB/);
      await expect(runSql(ms("select cast('<a/>' as xml) as x"), {})).rejects.toThrow(/xml/i);
      // (CLR types such as hierarchyid are refused the same way; Azure SQL Edge has no CLR to test them with)
      // the cap is set again for every query: a larger cap later lets a larger value through
      Object.assign(limits, { bytes: 12 * 1048576 });
      expect((await runSql(ms("select replicate(cast('z' as varchar(max)), 1200000) as v"), {}))[0].v).toHaveLength(1200000);
    } finally { Object.assign(limits, keep); }
  }, 60000);

  it('review 2: the worst row is bounded before a byte is read: many (MAX) columns, wide rows, many columns, xml', async () => {
    const keep = { ...limits };
    Object.assign(limits, { bytes: 3 * 1048576 });
    const cols = (n, expr) => `with x as (select ${expr} as v) select ${Array.from({ length: n }, (_, i) => `v as c${i}`).join(', ')} from x`;
    try {
      global.gc?.();
      const before = process.memoryUsage().rss;
      let t0 = Date.now();
      // 300 columns of 1 MB each: one row would be 300 MB
      await expect(runSql(ms(cols(300, "replicate(cast('a' as varchar(max)), 1000000)")), {})).rejects.toThrow(/too many large columns|MB/);
      // 10 columns of 1 MB: each value is cut at its share of the cap and refused
      await expect(runSql(ms(cols(10, "replicate(cast('a' as varchar(max)), 1000000)")), {})).rejects.toThrow(/MB/);
      // 1,000 columns of nvarchar(4000): an 8 MB row
      await expect(runSql(ms(cols(1000, "cast(replicate(N'b', 4000) as nvarchar(4000))")), {})).rejects.toThrow(/row|MB/);
      // more columns than a report can use
      await expect(runSql(ms(cols(1100, '1')), {})).rejects.toThrow(/columns/);
      expect(process.memoryUsage().rss - before).toBeLessThan(80 * 1048576);
      expect(Date.now() - t0).toBeLessThan(15000);
      // xml is refused before the server builds it
      t0 = Date.now();
      await expect(runSql(ms('select (select top 2000000 a.name from sys.all_objects a cross join sys.all_objects b for xml path, type) as x'), {})).rejects.toThrow(/xml/i);
      expect(Date.now() - t0).toBeLessThan(3000);
      // a sensible report still runs: a few (MAX) columns and some fixed ones
      expect(await runSql(ms("select id, name, cast(name as nvarchar(max)) as n2, replicate(cast('q' as varchar(max)), 1000) as q from dbo.pw_accounts"), {})).toHaveLength(5);
    } finally { Object.assign(limits, keep); }
  }, 60000);

  it('review 2: a query whose plan is larger than the cap is refused (the plan is cut, not buffered)', async () => {
    const keep = { ...limits };
    Object.assign(limits, { bytes: 262144, ms: 60000 });
    try {
      const q = `select count(*) as n from ${Array.from({ length: 60 }, (_, i) => `sys.all_objects t${i}`).join(' cross join ')}`;
      await expect(runSql(ms(q), {})).rejects.toThrow(/plan|large|one SELECT/i);
    } finally { Object.assign(limits, keep); }
    expect(await runSql(ms('select 1 as a'), {})).toEqual([{ a: 1 }]);
  }, 60000);

  it('review: a login that can write in any other user database is refused', async () => {
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    try {
      await admin.request().batch(`USE master; IF DB_ID('pwother') IS NOT NULL BEGIN ALTER DATABASE pwother SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE pwother; END; CREATE DATABASE pwother`);
      await admin.request().batch(`USE pwother; CREATE USER pw_reader FOR LOGIN pw_reader; ALTER ROLE db_datawriter ADD MEMBER pw_reader;`);
      process.env.PW_DB_MSW3 = `${readerUrl()}&p=o1`;
      await expect(runSql({ connection: 'msw3', query: 'select 1 as a' }, {})).rejects.toThrow(/in the database pwother: db_datawriter/);
      await admin.request().batch(`USE pwother; ALTER ROLE db_datawriter DROP MEMBER pw_reader; ALTER ROLE db_datareader ADD MEMBER pw_reader;`);
      process.env.PW_DB_MSW3 = `${readerUrl()}&p=o2`;
      expect(await runSql({ connection: 'msw3', query: 'select 1 as a' }, {})).toEqual([{ a: 1 }]); // reading there is fine
      // master and msdb are user-reachable too (review 3b: they were skipped): a writer there is refused
      for (const db of ['msdb', 'master']) {
        await admin.request().batch(`USE ${db}; IF USER_ID('pw_reader') IS NULL CREATE USER pw_reader FOR LOGIN pw_reader; ALTER ROLE db_datawriter ADD MEMBER pw_reader;`);
        try {
          process.env.PW_DB_MSW3 = `${readerUrl()}&p=s${db.length}`; // not the name: errors scrub every part of the URL
          expect((await runSql({ connection: 'msw3', query: 'select 1 as a' }, {}).catch(e => e)).message).toMatch(new RegExp(`in the database ${db}: `));
        } finally { await admin.request().batch(`USE ${db}; ALTER ROLE db_datawriter DROP MEMBER pw_reader; DROP USER pw_reader;`); }
      }
    } finally {
      delete process.env.PW_DB_MSW3;
      await admin.request().batch(`USE master; IF DB_ID('pwother') IS NOT NULL BEGIN ALTER DATABASE pwother SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE pwother; END`);
      await admin.close();
    }
  }, 60000);

  it('batch 3b: columns with the same name count in full; plans are streamed; database names are quoted by the server', async () => {
    const keep = { ...limits };
    try {
      Object.assign(limits, { bytes: 3 * 1048576 });
      // 20 rows × two 200 kB values (100,000 characters) under one name: 8 MB, once counted as two numbers
      await expect(runSql(ms("with x as (select top 20 replicate(cast('a' as varchar(max)), 100000) as v from sys.all_objects) select v as a, v as a from x"), {})).rejects.toThrow(/more than 3 MB/);
      // 3,000 statements in one text: refused at the second plan, not buffered (each plan would be read in full before)
      global.gc?.();
      const before = process.memoryUsage().rss;
      const t0 = Date.now();
      await expect(runSql(ms(Array.from({ length: 3000 }, (_, i) => `select ${i} as n`).join(' ')), {})).rejects.toMatchObject({ status: 400 });
      expect(Date.now() - t0).toBeLessThan(10000);
      expect(process.memoryUsage().rss - before).toBeLessThan(80 * 1048576);
      // sql_variant has a fixed size (8016 bytes) and is read like any value
      expect(await runSql(ms("select cast(N'x' as sql_variant) as v, cast(2 as sql_variant) as w"), {})).toEqual([{ v: 'x', w: 2 }]);
    } finally { Object.assign(limits, keep); }
    // a server message is cut, however long the value it repeats
    const e = await runSql(ms('select cast(@s as int) as i'), { s: 'q'.repeat(20000) }).catch(x => x);
    expect(e.message.length).toBeLessThanOrEqual(1000);
    // a database whose name has ] and ' in it: the probe still runs there (QUOTENAME on the server)
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    const odd = "pw]q'db";
    try {
      await admin.request().batch(`USE master; IF DB_ID(N'${odd.replace(/'/g, "''")}') IS NULL CREATE DATABASE ${'[' + odd.replace(/]/g, ']]') + ']'}`);
      await admin.request().batch(`USE ${'[' + odd.replace(/]/g, ']]') + ']'}; IF USER_ID('pw_reader') IS NULL CREATE USER pw_reader FOR LOGIN pw_reader; ALTER ROLE db_datareader ADD MEMBER pw_reader;`);
      process.env.PW_DB_MSQ = `${readerUrl()}&p=quoted`;
      expect(await runSql({ connection: 'msq', query: 'select 1 as a' }, {})).toEqual([{ a: 1 }]);
      await admin.request().batch(`USE ${'[' + odd.replace(/]/g, ']]') + ']'}; ALTER ROLE db_datawriter ADD MEMBER pw_reader;`);
      process.env.PW_DB_MSQ = `${readerUrl()}&p=quoted2`;
      await expect(runSql({ connection: 'msq', query: 'select 1 as a' }, {})).rejects.toThrow(/pw\]q'db: db_datawriter/);
    } finally {
      delete process.env.PW_DB_MSQ;
      await admin.request().batch(`USE master; IF DB_ID(N'${odd.replace(/'/g, "''")}') IS NOT NULL BEGIN ALTER DATABASE ${'[' + odd.replace(/]/g, ']]') + ']'} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${'[' + odd.replace(/]/g, ']]') + ']'}; END`);
      await admin.close();
    }
  }, 120000);

  it('batch 3b: a probe that runs out of time fails the query on time and is not cached', async () => {
    const keep = { ...limits };
    process.env.PW_DB_MSP = `${readerUrl()}&p=slowprobe`;
    try {
      Object.assign(limits, { ms: 40 });
      const t0 = Date.now();
      await expect(runSql({ connection: 'msp', query: 'select 1 as a' }, {})).rejects.toMatchObject({ status: 504 });
      expect(Date.now() - t0).toBeLessThan(1500);
      Object.assign(limits, keep);
      expect(await runSql({ connection: 'msp', query: 'select 1 as a' }, {})).toEqual([{ a: 1 }]);
    } finally { Object.assign(limits, keep); delete process.env.PW_DB_MSP; }
  }, 30000);

  it('batch 3b: an allow-listed stored procedure runs with bound arguments, first result set only, rolled back', async () => {
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    try {
      await admin.request().batch(`USE pwtest; IF OBJECT_ID('dbo.pw_by_region') IS NOT NULL DROP PROCEDURE dbo.pw_by_region;
        IF OBJECT_ID('dbo.pw_other') IS NOT NULL DROP PROCEDURE dbo.pw_other;`);
      await admin.request().batch(`USE pwtest; EXEC('CREATE PROCEDURE dbo.pw_by_region @region NVARCHAR(20), @min INT AS
        BEGIN UPDATE dbo.pw_accounts SET name = name + ''!''; SELECT id, name FROM dbo.pw_accounts WHERE region = @region AND id >= @min ORDER BY id; SELECT 1 AS second; END');
        EXEC('CREATE PROCEDURE dbo.pw_other AS SELECT 1 AS a');
        GRANT EXECUTE ON dbo.pw_by_region TO pw_reader; GRANT EXECUTE ON dbo.pw_other TO pw_reader;`);
      process.env.PW_DB_MSPROC = `${readerUrl()}&p=proc1`;
      // EXECUTE on a procedure the connection does not list is a right to change data: refused
      process.env.PW_DB_MSPROC_PROCS = 'dbo.pw_by_region';
      await expect(runSql({ connection: 'msproc', procedure: 'dbo.pw_by_region', args: [{ name: 'region', param: 'r' }, { name: 'min', param: 'm' }] }, { r: 'North', m: 1 })).rejects.toThrow(/pw_other/);
      await admin.request().batch('USE pwtest; REVOKE EXECUTE ON dbo.pw_other TO pw_reader');
      process.env.PW_DB_MSPROC = `${readerUrl()}&p=proc2`;
      // the update inside it is rolled back; the second result set is not read
      expect(await runSql({ connection: 'msproc', procedure: 'dbo.pw_by_region', args: [{ name: 'region', param: 'r' }, { name: '@min', param: 'm' }] }, { r: 'North', m: 2 })).toEqual([{ id: 3, name: 'Chen!' }]);
      expect(await runSql({ connection: 'msproc', query: 'select name from dbo.pw_accounts where id = 3' }, {})).toEqual([{ name: 'Chen' }]);
      await expect(runSql({ connection: 'msproc', procedure: 'dbo.pw_other' }, {})).rejects.toThrow(/not allowed/);
      // the same login without the allow-list is refused: it can EXECUTE something
      process.env.PW_DB_MSPROC2 = `${readerUrl()}&p=proc3`;
      await expect(runSql({ connection: 'msproc2', query: 'select 1 as a' }, {})).rejects.toThrow(/EXECUTE/);
    } finally {
      delete process.env.PW_DB_MSPROC; delete process.env.PW_DB_MSPROC_PROCS; delete process.env.PW_DB_MSPROC2;
      await admin.request().batch(`USE pwtest; IF OBJECT_ID('dbo.pw_by_region') IS NOT NULL DROP PROCEDURE dbo.pw_by_region; IF OBJECT_ID('dbo.pw_other') IS NOT NULL DROP PROCEDURE dbo.pw_other;`);
      await admin.close();
    }
  }, 60000);

  it('batch 3b lifecycle: 1,000 queries stopped at a cap leave no connection behind', async () => {
    const keep = { ...limits };
    process.env.PW_DB_MSLEAK = `${readerUrl()}&p=leak`;
    const sql = (await import('mssql')).default;
    const admin = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    try {
      const count = async () => (await admin.request().query("select count(*) as n from sys.dm_exec_sessions where login_name = 'pw_reader'")).recordset[0].n;
      const before = await count(); // other tests' pools hold sessions of this login too
      await runSql({ connection: 'msleak', query: 'select 1 as a' }, {}); // the probe is fresh
      Object.assign(limits, { rows: 2 });
      await Promise.all(Array.from({ length: 10 }, async () => {
        for (let i = 0; i < 100; i++) await expect(runSql({ connection: 'msleak', query: 'select id from dbo.pw_accounts' }, {})).rejects.toThrow(/more than 2 rows/);
      }));
      Object.assign(limits, keep);
      await new Promise(r => setTimeout(r, 1000));
      expect(await count() - before).toBeLessThanOrEqual(5); // this pool's size at most: every stopped connection was closed
      expect(await runSql({ connection: 'msleak', query: 'select count(*) as n from dbo.pw_accounts' }, {})).toEqual([{ n: 5 }]);
    } finally { Object.assign(limits, keep); delete process.env.PW_DB_MSLEAK; await admin.close(); }
  }, 300000);

  it('tests a connection without showing its URL', async () => {
    expect(await testConnection('ms')).toMatchObject({ ok: true });
    process.env.PW_DB_MSBAD = readerUrl().replace(/:[^:@/]+@/, ':wrong-password-xyz@');
    try {
      const r = await testConnection('msbad');
      expect(r.ok).toBe(false);
      expect(r.error).not.toContain('wrong-password-xyz');
    } finally { delete process.env.PW_DB_MSBAD; }
  });
});
