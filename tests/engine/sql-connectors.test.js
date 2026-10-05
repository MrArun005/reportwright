// Batch 3b: Oracle, Snowflake and BigQuery connections and stored procedures. No live Oracle, Snowflake or BigQuery
// was available: the drivers are mocked here, and these tests check the safety logic around them (statement check,
// read-only guard, caps, deadline, credentials in errors). SQL Server procedures are tested live in mssql.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { runSql, bindSql, limits, listConnections, codeOnly, assertOneRead, procsOf } from '../../src/server/sql.js';
import { oracleConfig } from '../../src/server/sql/oracle.js';
import { snowflakeConfig } from '../../src/server/sql/snowflake.js';
import { bigqueryConfig } from '../../src/server/sql/bigquery.js';

const mocks = vi.hoisted(() => ({ oracle: null, snowflake: null, bigquery: null }));
vi.mock('oracledb', () => ({ default: { createPool: (...a) => mocks.oracle.createPool(...a), STMT_TYPE_SELECT: 1, OUT_FORMAT_OBJECT: 4002, DB_TYPE_BLOB: { name: 'DB_TYPE_BLOB' } } }));
vi.mock('snowflake-sdk', () => ({ default: { configure() {}, createPool: (...a) => mocks.snowflake.createPool(...a) } }));
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: function BigQuery(cfg) { return mocks.bigquery.make(cfg); } }));

const keep = { ...limits };
let n = 0;
// a fragment makes each URL (and so each driver pool) new: every test gets the mock it set up
const env = (kind, url) => { const name = `${kind}${++n}`; process.env[`PW_DB_${name.toUpperCase()}`] = url.startsWith('sqlite:') ? url : `${url}#t${n}`; return name; };
afterEach(() => { Object.assign(limits, keep); for (const k of Object.keys(process.env)) if (/^PW_DB_(ORA|SF|BQ|PROC)/.test(k)) delete process.env[k]; });

describe('statement check (Oracle, Snowflake, BigQuery)', () => {
  it('one statement, no write or session words outside strings and comments', () => {
    for (const d of ['oracle', 'snowflake', 'bigquery']) {
      expect(() => assertOneRead("select 'delete; drop' as a, \"update\" from t -- insert\n", d), d).not.toThrow();
      expect(() => assertOneRead('select 1 as a from t;', d)).not.toThrow();
      for (const q of ['select 1 from t; delete from t', 'select 1 from t; select 2 from t', 'select * from t for update', 'select 1 into x from t',
        'select 1 from t /* x */ ; commit', 'with x as (select 1 a from t) delete from t', "select 1 /* unended", "select 'unended"]) expect(() => assertOneRead(q, d), `${d}: ${q}`).toThrow();
    }
  });
  it('reads strings and comments as each database does, and refuses quoting it does not model', () => {
    // Oracle: no backslash escape, so \' ends the string and what follows is code
    expect(() => assertOneRead("select 'a\\' ; delete from t --' as x from dual", 'oracle')).toThrow(/one statement|not allowed/);
    // Snowflake: a backslash escapes in '…', so it is all one string
    expect(() => assertOneRead("select 'a\\' ; delete from t --' as x", 'snowflake')).not.toThrow();
    // comments: # only in BigQuery, // only in Snowflake; elsewhere they are code
    expect(() => assertOneRead('select 1 as a # ; delete\n', 'bigquery')).not.toThrow();
    expect(() => assertOneRead('select 1 as a # ; delete\n', 'oracle')).toThrow();
    expect(() => assertOneRead('select 1 as a // ; delete\n', 'snowflake')).not.toThrow();
    expect(() => assertOneRead('select 1 as a // ; delete\n', 'bigquery')).toThrow();
    for (const [q, d] of [["select q'[it's]' from dual", 'oracle'], ["select nq'{x}' from dual", 'oracle'], ['select $$a; delete$$ as a', 'snowflake'],
      ["select '''a''' as a", 'bigquery'], ['select """a""" as a', 'bigquery'], ["select r'a\\' as a", 'bigquery'], ["select b'x' as a", 'bigquery']]) expect(() => codeOnly(q, d), q).toThrow(/cannot use/);
    expect(codeOnly('select col_q, q from t', 'oracle')).toContain('col_q');
  });
  it('binds @name through the driver: :n for Oracle, ? for Snowflake and BigQuery', () => {
    expect(bindSql("select a from t where b = @x and c in (@l) and d = '@x'", { x: 1, l: ['p', 'q'] }, 'oracle')).toEqual({ text: "select a from t where b = :1 and c in (:2, :3) and d = '@x'", values: [1, 'p', 'q'] });
    expect(bindSql("select a from t where b = @x and d = 'it\\'s @x'", { x: 1 }, 'bigquery')).toEqual({ text: "select a from t where b = ? and d = 'it\\'s @x'", values: [1] });
    expect(bindSql('select a from t where b = @x', { x: null }, 'snowflake')).toEqual({ text: 'select a from t where b = ?', values: [null] });
  });
  it('reads connection URLs (credentials percent-decoded)', () => {
    expect(oracleConfig('oracle://rep%40x:p%3Aw@db.example/ORCLPDB1')).toEqual({ user: 'rep@x', password: 'p:w', connectString: 'db.example:1521/ORCLPDB1' });
    expect(snowflakeConfig('snowflake://u:p@xy12345.eu-west-1/SALES/PUBLIC?warehouse=WH&role=READER')).toMatchObject({ account: 'xy12345.eu-west-1', username: 'u', password: 'p', database: 'SALES', schema: 'PUBLIC', warehouse: 'WH', role: 'READER' });
    expect(bigqueryConfig('bigquery://my-proj?keyFile=/k.json&location=EU&maxBytes=5000')).toEqual({ projectId: 'my-proj', keyFilename: '/k.json', location: 'EU', maxBytes: 5000 });
    expect(bigqueryConfig('bigquery://p').maxBytes).toBe(10e9);
  });
});

/** An oracledb pool whose connection records what it is asked. */
function oracleMock({ type = 1, rows = [], meta = [{ name: 'A', dbType: { name: 'DB_TYPE_NUMBER' } }], hang = false } = {}) {
  const log = [];
  const conn = {
    callTimeout: 0,
    async getStatementInfo(t) { log.push(['info', t]); return { statementType: type }; },
    async execute(t, v, o) {
      log.push(['execute', t, v]);
      if (!o?.resultSet) return {};
      if (hang) await new Promise((_, rej) => { conn.break = async () => { log.push(['break']); rej(Object.assign(new Error('cancelled'), { code: 'NJS-123' })); }; });
      let i = 0;
      return { metaData: meta, resultSet: { async getRows(k) { const b = rows.slice(i, i + k); i += k; return b; }, async close() { log.push(['close']); } } };
    },
    async break() { log.push(['break']); }, async rollback() { log.push(['rollback']); }, async close() { log.push(['release']); },
  };
  mocks.oracle = { createPool: async () => ({ getConnection: async () => conn }) };
  return log;
}

describe('Oracle (mocked oracledb, not live-tested)', () => {
  it('the server parse must say SELECT; it runs READ ONLY and is rolled back', async () => {
    let log = oracleMock({ rows: [{ A: 1 }, { A: 2 }] });
    expect(await runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t where b = @b' }, { b: 3 })).toEqual([{ A: 1 }, { A: 2 }]);
    expect(log.map(x => x[0])).toEqual(['info', 'execute', 'execute', 'close', 'rollback', 'release']);
    expect(log[1][1]).toBe('SET TRANSACTION READ ONLY');
    expect(log[2].slice(1)).toEqual(['select a from t where b = :1', [3]]);
    log = oracleMock({ type: 3 }); // not a SELECT (the server says so, whatever the text looks like)
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {})).rejects.toThrow(/one SELECT/);
    expect(log.some(x => x[0] === 'execute')).toBe(false);
  });
  it('caps rows and bytes, measures a LOB before reading it, refuses LONG and XMLType', async () => {
    oracleMock({ rows: Array.from({ length: 50 }, (_, i) => ({ A: i })) });
    limits.rows = 10;
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {})).rejects.toThrow(/more than 10 rows/);
    Object.assign(limits, keep);
    let read = false;
    const lob = { length: 50_000_000, type: 'clob', getData: async () => { read = true; return 'x'; } };
    oracleMock({ rows: [{ C: lob }], meta: [{ name: 'C', dbType: { name: 'DB_TYPE_CLOB' } }] });
    limits.bytes = 1048576;
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select c from t' }, {})).rejects.toThrow(/MB/);
    expect(read).toBe(false);
    for (const t of ['DB_TYPE_LONG', 'DB_TYPE_XMLTYPE', 'DB_TYPE_OBJECT', 'DB_TYPE_JSON']) {
      oracleMock({ rows: [{ L: 'x' }], meta: [{ name: 'L', dbType: { name: t }, dbTypeName: t }] });
      await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select l from t' }, {}), t).rejects.toThrow(/cannot read/);
    }
  });
  it('the deadline breaks the call in flight: 504 on time', async () => {
    const log = oracleMock({ hang: true });
    limits.ms = 150;
    const t0 = Date.now();
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {})).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise(r => setTimeout(r, 20));
    expect(log.some(x => x[0] === 'break')).toBe(true);
  });
  it('never shows the password in an error', async () => {
    mocks.oracle = { createPool: async () => { throw new Error('ORA-01017: invalid credential for user rep, password S3cret-Ora-9'); } };
    const e = await runSql({ connection: env('ora', 'oracle://rep:S3cret-Ora-9@h/S'), query: 'select a from t' }, {}).catch(x => x);
    expect(e.message).toMatch(/ORA-01017/);
    expect(e.message).not.toContain('S3cret-Ora-9');
  });
});

/** A snowflake-sdk pool whose statements stream the given rows. */
function snowflakeMock(rows, { fail } = {}) {
  const log = { cancelled: 0 };
  mocks.snowflake = {
    createPool: (cfg) => ({
      use: async (fn) => fn({
        execute(o) {
          log.opts = o;
          const st = { cancel: (cb) => { log.cancelled++; cb?.(); }, streamRows: () => Readable.from(rows, { objectMode: true }) };
          setTimeout(() => (fail ? o.complete(new Error(fail)) : o.complete(null, st)), 1);
          return st;
        },
      }),
      cfg,
    }),
  };
  return log;
}

describe('Snowflake (mocked snowflake-sdk, not live-tested)', () => {
  it('needs a role; one statement per call; binds values', async () => {
    snowflakeMock([{ A: 1 }]);
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB'), query: 'select 1 as a' }, {})).rejects.toThrow(/read-only role/);
    const log = snowflakeMock([{ A: 1 }]);
    expect(await runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t where b = @b' }, { b: 'x' })).toEqual([{ A: 1 }]);
    expect(log.opts).toMatchObject({ sqlText: 'select a from t where b = ?', binds: ['x'], streamResult: true, parameters: { MULTI_STATEMENT_COUNT: 1 } });
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select 1 as a; drop table t' }, {})).rejects.toThrow(/one statement/);
  });
  it('cancels the statement at the row cap', async () => {
    const log = snowflakeMock(Array.from({ length: 100 }, (_, i) => ({ A: i })));
    limits.rows = 5;
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).rejects.toThrow(/more than 5 rows/);
    expect(log.cancelled).toBe(1);
  });
  it('never shows the password in an error', async () => {
    snowflakeMock([], { fail: 'Incorrect username or password was specified: Sf-Secret-77' });
    const e = await runSql({ connection: env('sf', 'snowflake://u:Sf-Secret-77@acct/DB?role=R'), query: 'select 1 as a' }, {}).catch(x => x);
    expect(e.message).not.toContain('Sf-Secret-77');
  });
});

/** A BigQuery client: the dry run says `type` and `bytes`; the job pages through `rows`. */
function bigqueryMock({ type = 'SELECT', bytes = 1000, rows = [] } = {}) {
  const log = { jobs: [], cancelled: 0 };
  mocks.bigquery = {
    make: (cfg) => ({
      cfg,
      async createQueryJob(o) {
        log.jobs.push(o);
        if (o.dryRun) return [{ metadata: { statistics: { totalBytesProcessed: String(bytes), query: { statementType: type } } } }];
        return [{
          cancel: async () => { log.cancelled++; },
          async getQueryResults({ pageToken, maxResults }) { const i = Number(pageToken || 0); const next = i + maxResults < rows.length ? { pageToken: String(i + maxResults) } : null; return [rows.slice(i, i + maxResults), next]; },
        }];
      },
    }),
  };
  return log;
}

describe('BigQuery (mocked @google-cloud/bigquery, not live-tested)', () => {
  it('a dry run first: SELECT only, and the bytes it would scan within maxBytes; the job is capped too', async () => {
    let log = bigqueryMock({ rows: [{ a: 1, d: { value: '2024-01-02' } }] });
    expect(await runSql({ connection: env('bq', 'bigquery://proj?maxBytes=5000'), query: 'select a, d from t where b = @b and c = @c' }, { b: 1, c: null })).toEqual([{ a: 1, d: '2024-01-02' }]);
    expect(log.jobs[0]).toMatchObject({ dryRun: true, useLegacySql: false, params: [1, null], types: ['INT64', 'STRING'] });
    expect(log.jobs[1]).toMatchObject({ maximumBytesBilled: '5000' });
    expect(log.jobs[1].jobTimeoutMs).toBeGreaterThan(0);
    for (const t of ['SCRIPT', 'INSERT', 'CREATE_TABLE_AS_SELECT', 'CALL', null]) {
      log = bigqueryMock({ type: t });
      await expect(runSql({ connection: env('bq', 'bigquery://proj'), query: 'select 1 as a' }, {}), String(t)).rejects.toThrow(/one SELECT/);
      expect(log.jobs).toHaveLength(1); // the dry run only
    }
    log = bigqueryMock({ bytes: 20e9 });
    await expect(runSql({ connection: env('bq', 'bigquery://proj'), query: 'select 1 as a' }, {})).rejects.toThrow(/would read 20 GB/);
    expect(log.jobs).toHaveLength(1);
  });
  it('reads page by page and cancels the job at the row cap', async () => {
    const log = bigqueryMock({ rows: Array.from({ length: 5000 }, (_, i) => ({ a: i })) });
    limits.rows = 1500;
    await expect(runSql({ connection: env('bq', 'bigquery://proj'), query: 'select a from t' }, {})).rejects.toThrow(/more than 1500 rows/);
    expect(log.cancelled).toBe(1);
  });
});

describe('stored procedures (opt-in per connection)', () => {
  it('only allow-listed ones, with report parameters bound as arguments', async () => {
    const name = env('proc', 'snowflake://u:p@acct/DB?role=R');
    process.env[`PW_DB_${name.toUpperCase()}_PROCS`] = 'sales.top_customers, bad name;drop, region_totals';
    expect(procsOf(name)).toEqual(['sales.top_customers', 'region_totals']);
    expect(listConnections().find(c => c.name === name)).toEqual({ name, kind: 'snowflake', procs: ['sales.top_customers', 'region_totals'] });
    expect(listConnections().some(c => c.name.endsWith('_procs'))).toBe(false);
    const log = snowflakeMock([{ C: 'Asha' }]);
    expect(await runSql({ connection: name, procedure: 'Sales.Top_Customers', args: [{ name: 'region', param: 'r' }, { name: 'n', param: 'n' }] }, { r: 'North', n: 5 })).toEqual([{ C: 'Asha' }]);
    expect(log.opts).toMatchObject({ sqlText: 'CALL Sales.Top_Customers(?, ?)', binds: ['North', 5] });
    await expect(runSql({ connection: name, procedure: 'other_proc' }, {})).rejects.toThrow(/not allowed on this connection/);
    await expect(runSql({ connection: name, procedure: 'region_totals; drop table t' }, {})).rejects.toThrow(/name or schema.name/);
    await expect(runSql({ connection: name, procedure: 'region_totals', args: [{ name: 'x', param: 'missing' }] }, {})).rejects.toThrow(/does not exist/);
    await expect(runSql({ connection: name, procedure: 'region_totals', args: [{ name: 'x', param: 'l' }] }, { l: [1, 2] })).rejects.toThrow(/a list/);
    await expect(runSql({ connection: `${name}_procs`, query: 'select 1' }, {})).rejects.toThrow(/connection name/);
  });
  it('is refused where the database has no read-only way to run one', async () => {
    for (const url of ['oracle://u:p@h/S', 'bigquery://proj', 'sqlite:/tmp/x.db']) {
      const name = env('proc', url);
      process.env[`PW_DB_${name.toUpperCase()}_PROCS`] = 'p';
      await expect(runSql({ connection: name, procedure: 'p' }, {}), url).rejects.toThrow(/not supported/);
    }
  });
});

describe('Designer: stored procedure arguments', () => {
  it('reads "argument = parameter" lines', async () => {
    const { procArgs } = await import('../../src/designer/DataPanel.jsx');
    expect(procArgs('region = region\n @year=@y \n\nbad line\nx = y z')).toEqual([{ name: 'region', param: 'region' }, { name: 'year', param: 'y' }]);
  });
});
