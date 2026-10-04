// Enterprise 1: SQL Server connections (mssql://). Binding is tested always; the driver only when PW_TEST_MSSQL is set:
//   docker run -d --name pw-mssql -e ACCEPT_EULA=1 -e 'MSSQL_SA_PASSWORD=Pw-Test-Strong1!' -p 14330:1433 mcr.microsoft.com/azure-sql-edge
//   PW_TEST_MSSQL='mssql://sa:Pw-Test-Strong1!@127.0.0.1:14330/master?encrypt=false' npx vitest run tests/engine/mssql.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runSql, bindSql, limits, listConnections, testConnection, mssqlConfig, tsqlParts, isOneSelect } from '../../src/server/sql.js';

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
  });
  it('never binds inside comments or names, and refuses statement words in code', () => {
    expect(bindSql('select /* /* */ @x */ @y as [a]]@z]', { y: 1 }, 'mssql')).toEqual({ text: 'select /* /* */ @x */ @pw_1 as [a]]@z]', values: [1] });
    for (const q of ['select 1 as a set rowcount 0', 'select 1 as a commit', 'select 1 as a go', 'select * into #t from x', 'exec sp_who', 'select 1 declare @a int',
      "select 1 waitfor delay '0:0:5'", 'select 1 as [x]] delete from t --]  update t set a = 1']) expect(() => bindSql(q, {}, 'mssql'), q).toThrow(/not allowed/);
    expect(bindSql('select [set], "into", \'delete\' as [update] from t /* drop */ -- exec', {}, 'mssql').values).toEqual([]);
  });
  it('accepts only a plan of exactly one SELECT', () => {
    const plan = (xml) => ({ recordsets: [[{ 'Microsoft SQL Server 2005 XML Showplan': xml }]] });
    const one = (t, extra = '') => `<?xml version="1.0"?><ShowPlanXML xmlns="x"><BatchSequence><Batch><Statements><StmtSimple StatementText="s" StatementType="${t}"${extra}><QueryPlan/></StmtSimple>`;
    expect(isOneSelect(plan(`${one('SELECT')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe(true);
    expect(isOneSelect(plan(`${one('SELECT WITHOUT QUERY')}</Statements></Batch></BatchSequence></ShowPlanXML>`))).toBe(true);
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
    try { expect(listConnections().find(c => c.name === 'msx')).toEqual({ name: 'msx', kind: 'mssql' }); } finally { delete process.env.PW_DB_MSX; }
  });
});

describe.skipIf(!process.env.PW_TEST_MSSQL)('SQL Server (live)', () => {
  const ms = (query) => ({ connection: 'ms', query });
  beforeAll(async () => {
    process.env.PW_DB_MS = process.env.PW_TEST_MSSQL;
    process.env.PW_DB_MSW = process.env.PW_TEST_MSSQL; // the test's own writable setup goes through the driver directly
    const sql = (await import('mssql')).default;
    const pool = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
    await pool.request().batch(`IF OBJECT_ID('dbo.pw_accounts') IS NOT NULL DROP TABLE dbo.pw_accounts;
      CREATE TABLE dbo.pw_accounts (id INT PRIMARY KEY, name NVARCHAR(100), region NVARCHAR(20), opened DATE, big BIGINT);
      INSERT INTO dbo.pw_accounts VALUES (1, N'Asha', 'North', '2024-01-15', 9007199254740993), (2, N'Bilal', 'South', '2024-02-01', 7),
        (3, N'Chen', 'North', '2024-03-10', 8), (4, N'Dev', 'East', '2024-04-20', 9), (5, N'x''; DROP TABLE pw_accounts; --', 'West', '2024-05-05', 10);`);
    await pool.close();
  });
  afterAll(() => { delete process.env.PW_DB_MS; delete process.env.PW_DB_MSW; });
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
    // FOR XML / FOR JSON are reads too (the plan calls them XML SELECT, JSON SELECT)
    expect(Object.values((await runSql(ms('select id from dbo.pw_accounts where id = 1 for json path'), {}))[0])[0]).toBe('[{"id":1}]');
    expect(Object.values((await runSql(ms('select id from dbo.pw_accounts where id = 1 for xml path'), {}))[0])[0]).toBe('<row><id>1</id></row>');
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
    ];
    for (const q of shapes) await expect(runSql(ms(q), {}), q).rejects.toMatchObject({ status: 400 });
    // and what is legal stays legal, with the same meaning on both sides
    expect(await runSql(ms('select 1 as [x]] delete from dbo.pw_accounts --]'), {})).toEqual([{ 'x] delete from dbo.pw_accounts --': 1 }]);
    expect(await runSql(ms('select @n /* /* @z */ */ as [a@b] -- @q'), { n: 3 })).toEqual([{ 'a@b': 3 }]);
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

  it('tests a connection without showing its URL', async () => {
    expect(await testConnection('ms')).toMatchObject({ ok: true });
    process.env.PW_DB_MSBAD = process.env.PW_TEST_MSSQL.replace(/:[^:@/]+@/, ':wrong-password-xyz@');
    try {
      const r = await testConnection('msbad');
      expect(r.ok).toBe(false);
      expect(r.error).not.toContain('wrong-password-xyz');
    } finally { delete process.env.PW_DB_MSBAD; }
  });
});
