// Batch 3b: stored procedures on live PostgreSQL and MySQL (opt-in):
//   PW_TEST_PG=postgres://postgres:pw@127.0.0.1:15432/postgres PW_TEST_MYSQL=mysql://root:pw@127.0.0.1:13306/pw npx vitest run tests/engine/sql-procs-live.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runSql } from '../../src/server/sql.js';

describe.skipIf(!process.env.PW_TEST_PG)('PostgreSQL: a set-returning function, read-only', () => {
  let pg;
  beforeAll(async () => {
    const { default: P } = await import('pg');
    pg = new P.Client({ connectionString: process.env.PW_TEST_PG });
    await pg.connect();
    await pg.query(`DROP TABLE IF EXISTS pw_p; CREATE TABLE pw_p (id int, region text); INSERT INTO pw_p VALUES (1, 'N'), (2, 'S'), (3, 'N');
      CREATE OR REPLACE FUNCTION pw_by_region(region text, min_id int) RETURNS TABLE (id int) LANGUAGE sql AS $$ SELECT id FROM pw_p WHERE pw_p.region = $1 AND pw_p.id >= $2 ORDER BY id $$;
      CREATE OR REPLACE FUNCTION pw_writer() RETURNS TABLE (n int) LANGUAGE plpgsql AS $$ BEGIN DELETE FROM pw_p; RETURN QUERY SELECT 1; END $$;`);
    process.env.PW_DB_PGP = process.env.PW_TEST_PG;
    process.env.PW_DB_PGP_PROCS = 'pw_by_region,pw_writer';
  });
  afterAll(async () => { delete process.env.PW_DB_PGP; delete process.env.PW_DB_PGP_PROCS; await pg.query('DROP FUNCTION pw_by_region; DROP FUNCTION pw_writer; DROP TABLE pw_p'); await pg.end(); });
  it('runs with named, bound arguments; a function that writes is refused by the READ ONLY transaction', async () => {
    expect(await runSql({ connection: 'pgp', procedure: 'pw_by_region', args: [{ name: 'region', param: 'r' }, { name: 'min_id', param: 'm' }] }, { r: "N' OR 1=1 --", m: 0 })).toEqual([]);
    expect(await runSql({ connection: 'pgp', procedure: 'pw_by_region', args: [{ name: 'region', param: 'r' }, { name: 'min_id', param: 'm' }] }, { r: 'N', m: 2 })).toEqual([{ id: 3 }]);
    await expect(runSql({ connection: 'pgp', procedure: 'pw_writer' }, {})).rejects.toThrow(/read-only/);
    expect((await pg.query('select count(*)::int as n from pw_p')).rows[0].n).toBe(3);
  });
});

describe.skipIf(!process.env.PW_TEST_MYSQL)('MySQL: CALL in a read-only transaction', () => {
  let my;
  beforeAll(async () => {
    const { default: M } = await import('mysql2/promise');
    my = await M.createConnection({ uri: process.env.PW_TEST_MYSQL, multipleStatements: true });
    await my.query(`DROP TABLE IF EXISTS pw_p; CREATE TABLE pw_p (id int, region varchar(10)); INSERT INTO pw_p VALUES (1, 'N'), (2, 'S'), (3, 'N');
      DROP PROCEDURE IF EXISTS pw_by_region; DROP PROCEDURE IF EXISTS pw_writer;
      CREATE PROCEDURE pw_by_region(IN r varchar(10), IN m int) BEGIN SELECT id FROM pw_p WHERE region = r AND id >= m ORDER BY id; SELECT 1 AS second; END;
      CREATE PROCEDURE pw_writer() BEGIN DELETE FROM pw_p; SELECT 1 AS n; END;`);
    process.env.PW_DB_MYP = process.env.PW_TEST_MYSQL;
    process.env.PW_DB_MYP_PROCS = 'pw_by_region,pw_writer';
  });
  afterAll(async () => { delete process.env.PW_DB_MYP; delete process.env.PW_DB_MYP_PROCS; await my.query('DROP PROCEDURE pw_by_region; DROP PROCEDURE pw_writer; DROP TABLE pw_p'); await my.end(); });
  it('runs with bound arguments, first result set only; a procedure that writes is refused', async () => {
    expect(await runSql({ connection: 'myp', procedure: 'pw_by_region', args: [{ name: 'r', param: 'r' }, { name: 'm', param: 'm' }] }, { r: 'N', m: 2 })).toEqual([{ id: 3 }]);
    await expect(runSql({ connection: 'myp', procedure: 'pw_writer' }, {})).rejects.toThrow(/READ ONLY|read-only|read only/i);
    const [[{ n }]] = await my.query('select count(*) as n from pw_p');
    expect(n).toBe(3);
  });
});

// review: every driver bounds rows, bytes and time on the client, whatever the server sends
describe.each([['pg', 'PW_TEST_PG', "select repeat('x', @n) as v", 'select pg_sleep(5) as s'], ['my', 'PW_TEST_MYSQL', "select repeat('x', @n) as v", 'select sleep(5) as s']])('%s: caps on the client', (k, envName, huge, slow) => {
  const on = Boolean(process.env[envName]);
  it.skipIf(!on)('one huge value, many rows, a slow query', async () => {
    const { limits } = await import('../../src/server/sql.js');
    const keep = { ...limits };
    process.env[`PW_DB_CAP${k.toUpperCase()}`] = process.env[envName];
    try {
      Object.assign(limits, { bytes: 1048576 });
      global.gc?.();
      const before = process.memoryUsage().rss;
      // 50 MB in one value (MySQL caps repeat() at max_allowed_packet): the socket is cut at the cap, the value is never buffered
      await expect(runSql({ connection: `cap${k}`, query: huge }, { n: 50_000_000 })).rejects.toThrow(/MB/);
      expect(process.memoryUsage().rss - before).toBeLessThan(80 * 1048576);
      Object.assign(limits, keep, { rows: 100 });
      const many = k === 'pg' ? 'select g from generate_series(1, 1000000) g' : 'select a.table_name as g from information_schema.columns a cross join information_schema.columns b';
      await expect(runSql({ connection: `cap${k}`, query: many }, {})).rejects.toThrow(/more than 100 rows/);
      Object.assign(limits, keep, { ms: 500 });
      const t0 = Date.now();
      await expect(runSql({ connection: `cap${k}`, query: slow }, {})).rejects.toMatchObject({ status: 504 });
      expect(Date.now() - t0).toBeLessThan(2000);
      Object.assign(limits, keep);
      expect(await runSql({ connection: `cap${k}`, query: 'select 1 as a' }, {})).toEqual([{ a: 1 }]); // the pool is fine afterwards
    } finally { Object.assign(limits, keep); delete process.env[`PW_DB_CAP${k.toUpperCase()}`]; }
  }, 60000);
});
