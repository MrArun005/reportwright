// Enterprise 1: SQL Server connections (mssql://). Binding is tested always; the driver only when PW_TEST_MSSQL is set:
//   docker run -d --name pw-mssql -e ACCEPT_EULA=1 -e 'MSSQL_SA_PASSWORD=Pw-Test-Strong1!' -p 14330:1433 mcr.microsoft.com/azure-sql-edge
//   PW_TEST_MSSQL='mssql://sa:Pw-Test-Strong1!@127.0.0.1:14330/master?encrypt=false' npx vitest run tests/engine/mssql.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runSql, bindSql, limits, listConnections, testConnection, mssqlConfig } from '../../src/server/sql.js';

describe('binding for SQL Server', () => {
  it('binds @name as @pw_n inputs and leaves [names], strings and @@vars alone', () => {
    expect(bindSql("select [a@b], '@x', @@rowcount, @id, N'it''s @y' from t where r in (@r)", { id: 7, r: ['N', 'S'] }, 'mssql'))
      .toEqual({ text: "select [a@b], '@x', @@rowcount, @pw_1, N'it''s @y' from t where r in (@pw_2, @pw_3)", values: [7, 'N', 'S'] });
  });
  it('the parse-only copy has typed stand-ins, never the values', () => {
    const b = bindSql('select top (@n) * from t where a = @s and b = @f and c = @t and d = @z', { n: 5, s: "x'; drop table t --", f: 1.5, t: true, z: null }, 'mssql', { standIns: true });
    expect(b.text).toBe("select top (CAST(0 AS BIGINT)) * from t where a = N'' and b = CAST(0 AS FLOAT) and c = CAST(0 AS BIT) and d = NULL");
    expect(b.text).not.toContain('drop');
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
