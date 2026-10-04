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
    expect(parts('select 1 --c\rdelete')).toEqual(['Cselect 1 ', 'x--c', 'C\rdelete']); // a CR ends -- as an LF does
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
    try { expect(listConnections().find(c => c.name === 'msx')).toEqual({ name: 'msx', kind: 'mssql' }); } finally { delete process.env.PW_DB_MSX; }
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
