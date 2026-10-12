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
  it('every dialect: only built-in functions; a call that reaches files, the network or another server is refused', () => {
    const bad = {
      postgres: ["select dblink('host=evil', 'select 1')", "select lo_import('/etc/passwd')", "select pg_read_file('/etc/passwd')", 'select "lo_import"(\'/x\')',
        "select pg_catalog.pg_read_file('/x')", "select * from dblink('h', 'q') as (a int)", "select my_schema.evil(1)", "select evil(1)", 'select pg_sleep(10)',
        "select query_to_xml('select 1', true, true, '')", "select * from pg_ls_dir('.')"],
      mysql: ["select load_file('/etc/passwd')", "select /*!50000 sleep(10) */ 1", "select /*+ MAX_EXECUTION_TIME(100000) */ 1", "select a from t into outfile '/tmp/x'",
        'select sleep(10)', "select benchmark(1e9, md5('x'))", 'select `load_file`(\'/x\')'],
      mssql: ["select * from sys.fn_xe_file_target_read_file('\\\\evil\\x\\*.xel', null, null, null)", "select * from fn_get_audit_file('\\\\evil\\a', default, default)",
        "select * from [xp_dirtree]('\\\\evil\\s')", "select * from openrowset(bulk 'c:\\x', single_clob) as x", "select * from opendatasource('SQLNCLI', 'Data Source=evil').db.dbo.t",
        'select dbo.evil(1) as a'],
      oracle: ["select utl_http.request('http://evil') from dual", "select sys.urifactory.geturi('http://evil') from dual", "select xmltype(bfilename('D', 'f')) from dual",
        "select app.log_event('x') from dual", "select httpuritype('http://evil').getclob() from dual"],
      snowflake: ["select system$whitelist()", 'select $1 from @my_stage', "select my_external_fn('x')", "select parse_url('http://x')"],
      bigquery: ["select * from external_query('conn', 'select 1')", "select ml.generate_text(model m, (select 1))", "select `proj.ds.fn`(1)", "select proj.ds.fn(1)"],
      sqlite: ["select load_extension('/x.so')", "select readfile('/etc/passwd')", 'select fts3_tokenizer(1)'],
    };
    for (const [d, list] of Object.entries(bad)) for (const q of list) expect(() => assertOneRead(q, d), `${d}: ${q}`).toThrow();
    const good = {
      postgres: "with t(a, b) as (select 1, 2) select coalesce(a, 0)::numeric(10,2), count(*) over (partition by b), to_char(now(), 'YYYY') from t where a in (select g from generate_series(1, 3) g)",
      mysql: "select date_format(d, '%Y'), group_concat(name order by name) from t where x in (1, 2) group by d",
      mssql: "with t as (select 1 as a) select top (10) cast(a as decimal(10, 2)) as v, row_number() over (order by a) as r, [name] from t cross apply openjson('[]') j",
      oracle: "select nvl(a, 0), to_char(d, 'YYYY'), listagg(b, ',') within group (order by b) from t group by d",
      snowflake: "select iff(a > 0, 'y', 'n'), date_trunc('month', d), array_agg(b) within group (order by b) from t group by 1, 2",
      bigquery: "select safe.parse_date('%Y', s), format_date('%Y', d), countif(x) from `proj.ds.t` group by 1, 2",
      sqlite: "select strftime('%Y', d), group_concat(name), ifnull(a, 0) from t",
    };
    for (const [d, q] of Object.entries(good)) {
      if (d === 'mssql') continue; // openjson starts with "open": refused (fail closed), see below
      expect(() => assertOneRead(q, d), `${d}: ${q}`).not.toThrow();
    }
    expect(() => assertOneRead(good.mssql.replace(" cross apply openjson('[]') j", ''), 'mssql')).not.toThrow();
  });

  it('one statement, no write or session words outside strings and comments', () => {
    for (const d of ['oracle', 'snowflake', 'bigquery']) {
      expect(() => assertOneRead("select 'delete; drop' as a, \"region\" from t -- insert\n", d), d).not.toThrow();
      expect(() => assertOneRead('select 1 as a from t;', d)).not.toThrow();
      for (const q of ['select 1 from t; delete from t', 'select 1 from t; select 2 from t', 'select * from t for update', 'select 1 into x from t',
        'select 1 from t /* x */ ; commit', 'with x as (select 1 a from t) delete from t', "select 1 /* unended", "select 'unended"]) expect(() => assertOneRead(q, d), `${d}: ${q}`).toThrow();
    }
  });
  it('Oracle: one plain SELECT; no PL/SQL, locks, links or network/file packages, quoted or not', () => {
    for (const q of ['select "UTL_HTTP".request(\'http://x\') from dual', "select utl_http.request('http://x') as a from dual", 'select sys.dbms_xmlgen.getxml(\'select 1 from dual\') from dual',
      'select a from t@remote', 'select a from "T"@"REMOTE"', 'with function f return number is begin return 1; end; select f() from dual', 'with procedure p is begin null; end; select 1 from dual',
      'select a from t for update', 'begin null; end;', 'call p()', 'select httpuritype(\'http://x\').getclob() from dual', 'select a from t for update of "A"'])
      expect(() => assertOneRead(q, 'oracle'), q).toThrow();
    expect(() => assertOneRead('with x as (select a, "B" from t) select a, "B" from x where c = :1', 'oracle')).not.toThrow();
  });
  it('fails closed on what it does not fully classify (review 3b)', () => {
    const refused = [
      ['postgres', 'select "in"(1)'], ['postgres', 'select pg_catalog."upper"(a) from t'], ['postgres', 'select "lo_import"(\'/x\')'], ['mssql', 'select [upper](a) as b'],
      ['mysql', 'select `upper`(a) from t'], ['postgres', "select 'a\\' as x"], ['mysql', "select 'a\\' ; delete from t -- ' as x"],
      ['postgres', 'select a from t /* a /* b */ c */'], ['mysql', 'select /*+ BKA(t) */ a from t'], ['oracle', 'select /*+ full(t) */ a from t'],
      ['mssql', 'select {fn user()} as u'], ['postgres', 'select {fn now()}'], ['postgres', 'select ａ from t'], ['mssql', 'select 1 as a\u00a0from t'],
      ['postgres', 'select $tag$x$tag$'], ['postgres', "select E'x'"], ['postgres', "select U&'x'"], ['mysql', "select _latin1'x'"], ['sqlite', 'select a\u2028from t'],
      ['mssql', 'select x /* /* */ from t'],
    ];
    for (const [d, q] of refused) expect(() => assertOneRead(q.replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), d), `${d}: ${q}`).toThrow();
    expect(() => assertOneRead("select 'ünïcode ✓' as s, n'x' from t", 'mssql')).not.toThrow(); // inside strings it is fine
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
    // endpoint: only when set (the emulator in CI); real BigQuery gets no apiEndpoint
    expect(bigqueryConfig('bigquery://p?endpoint=http://127.0.0.1:9050')).toMatchObject({ projectId: 'p', apiEndpoint: 'http://127.0.0.1:9050' });
    expect(bigqueryConfig('bigquery://p')).not.toHaveProperty('apiEndpoint');
  });
});

/** An oracledb pool whose connection records what it is asked. */
function oracleMock({ type = 1, rows = [], meta = [{ name: 'A', dbType: { name: 'DB_TYPE_NUMBER' } }], hang = false, probe = {} } = {}) {
  const log = [];
  const answers = { session_privs: [{ P: 'CREATE SESSION' }], ...probe };
  const conn = {
    callTimeout: 0,
    async getStatementInfo(t) { log.push(['info', t]); return { statementType: type }; },
    async execute(t, v, o) {
      if (o?.maxRows) log.push(['probe', t]);
      const asked = Object.keys(answers).find(k => new RegExp(k === 'PUBLIC' ? "grantee = 'PUBLIC' AND privilege = 'EXECUTE'" : `from ${k}\\b`, 'i').test(t));
      if (o?.maxRows) return { rows: asked ? answers[asked] : [] }; // the login probe
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
    expect(log.filter(x => x[0] !== 'probe').map(x => x[0])).toEqual(['info', 'execute', 'execute', 'close', 'rollback', 'release']);
    // the grant check is a positive list over the user, its roles and PUBLIC; READ on a DIRECTORY counts
    expect(log.find(x => x[0] === 'probe' && /all_tab_privs/.test(x[1]) && /'PUBLIC' FROM dual/.test(x[1]))?.[1]).toMatch(/DIRECTORY/);
    // PUBLIC's grants on Oracle's own objects are the install default, of any privilege (SYS grants PUBLIC DELETE on some
    // dictionary tables); PUBLIC on a user's own object is still refused. Live proof: tests/live/oracle.live.test.js
    expect(log.find(x => x[0] === 'probe' && /all_tab_privs/.test(x[1]))?.[1]).toMatch(/grantee = 'PUBLIC' AND NVL\(type, 'PACKAGE'\) <> 'DIRECTORY'\s+AND table_schema IN \(SELECT username FROM all_users WHERE oracle_maintained = 'Y'\)/);
    const main = log.filter(x => x[0] !== 'probe');
    expect(main[1][1]).toBe('SET TRANSACTION READ ONLY');
    expect(main[2].slice(1)).toEqual(['select a from t where b = :1', [3]]);
    log = oracleMock({ type: 3 }); // not a SELECT (the server says so, whatever the text looks like)
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {})).rejects.toThrow(/one SELECT/);
    expect(log.some(x => x[0] === 'execute')).toBe(false);
  });
  it('refuses a login that can do more than read (checked before the query)', async () => {
    for (const [probe, why] of [
      [{ session_privs: [{ P: 'CREATE SESSION' }, { P: 'CREATE TABLE' }] }, /CREATE TABLE/],
      [{ session_privs: [{ P: 'CREATE SESSION' }, { P: 'SELECT ANY TABLE' }] }, /ANY/],
      [{ all_tab_privs: [{ P: 'EXECUTE ON APP.WRITER_FN' }] }, /EXECUTE ON APP.WRITER_FN/],
      [{ PUBLIC: [{ P: 'UTL_HTTP' }] }, /PUBLIC may run UTL_HTTP/],
      [{ user_objects: [{ P: 'FUNCTION F' }] }, /owner of FUNCTION F/],
      [{ all_db_links: [{ P: 'REMOTE' }] }, /database links REMOTE/],
    ]) {
      const log = oracleMock({ rows: [{ A: 1 }], probe });
      await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {}), JSON.stringify(probe)).rejects.toThrow(why);
      expect(log.some(x => x[0] === 'execute'), 'nothing ran').toBe(false);
      void 0;
    }
    mocks.oracle = { createPool: async () => ({ getConnection: async () => ({ async execute() { throw new Error('ORA-00942: table or view does not exist'); }, async break() {}, async rollback() {}, async close() {} }) }) };
    await expect(runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select a from t' }, {})).rejects.toThrow(/ORA-00942/); // fails closed
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
  it('wide rows come in small batches: a batch is never far past the cap', async () => {
    const asked = [];
    const log = oracleMock({ rows: Array.from({ length: 300 }, () => ({ W: 'w'.repeat(10) })), meta: [{ name: 'W', dbType: { name: 'DB_TYPE_VARCHAR' }, byteSize: 32767 }] });
    const orig = mocks.oracle.createPool;
    mocks.oracle.createPool = async (...a) => { const p = await orig(...a); const c = await p.getConnection(); const ex = c.execute.bind(c); c.execute = async (...x) => { const r = await ex(...x); if (r.resultSet) { const g = r.resultSet.getRows; r.resultSet.getRows = (k) => { asked.push(k); return g(k); }; } return r; }; return { getConnection: async () => c }; };
    limits.bytes = 1048576;
    expect(await runSql({ connection: env('ora', 'oracle://u:p@h/S'), query: 'select w from t' }, {})).toHaveLength(300);
    expect(Math.max(...asked)).toBeLessThanOrEqual(4); // 1 MB / 4 / ~64 kB a row
    void log;
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
function snowflakeMock(rows, { fail, grants = { R: [{ privilege: 'USAGE', granted_on: 'WAREHOUSE', name: 'WH' }, { privilege: 'SELECT', granted_on: 'TABLE', name: 'DB.S.T' }] } } = {}) {
  const log = { cancelled: 0, shows: [], released: 0, destroyed: 0 };
  mocks.snowflake = {
    createPool: (cfg) => ({
      release: () => { log.released++; }, destroy: () => { log.destroyed++; },
      acquire: async () => ({
        execute(o) {
          if (!o.streamResult) { log.shows.push([o.sqlText, ...(o.binds || [])]); setTimeout(() => o.complete(null, {}, /^SHOW/.test(o.sqlText) ? (grants[o.binds[0]] || []) : []), 1); return {}; }
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
  it('the role is checked first: its grants, its granted roles and PUBLIC must be USAGE and SELECT only', async () => {
    const R = [{ privilege: 'USAGE', granted_on: 'DATABASE', name: 'DB' }, { privilege: 'USAGE', granted_on: 'ROLE', name: 'INNER' }];
    for (const [grants, why] of [
      [{ R, INNER: [{ privilege: 'USAGE', granted_on: 'INTEGRATION', name: 'EXT_API' }] }, /INNER has USAGE on INTEGRATION/],
      [{ R: [{ privilege: 'OWNERSHIP', granted_on: 'TABLE', name: 'T' }] }, /OWNERSHIP/],
      [{ R: [], PUBLIC: [{ privilege: 'USAGE', granted_on: 'FUNCTION', name: 'EXT_FN' }] }, /PUBLIC has USAGE on FUNCTION/],
      [{ R: [{ privilege: 'SELECT', granted_on: 'EXTERNAL TABLE', name: 'X' }] }, /EXTERNAL_TABLE/],
    ]) {
      const log = snowflakeMock([{ A: 1 }], { grants });
      await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).rejects.toThrow(why);
      expect(log.opts).toBeUndefined(); // the query never ran
    }
    const log = snowflakeMock([{ A: 1 }], { grants: { R, INNER: [{ privilege: 'SELECT', granted_on: 'VIEW', name: 'V' }] } });
    expect(await runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).toEqual([{ A: 1 }]);
    expect(log.shows.map(x => x[0])).toEqual(['USE SECONDARY ROLES NONE', 'SHOW GRANTS TO USER IDENTIFIER(?)', 'SHOW GRANTS TO ROLE IDENTIFIER(?)', 'SHOW GRANTS TO ROLE IDENTIFIER(?)', 'SHOW GRANTS TO ROLE IDENTIFIER(?)']);
    expect(log.released).toBe(1);
    // the user may hold no other role (default secondary roles would switch it on); USE SECONDARY ROLES NONE on every query
    const two = snowflakeMock([{ A: 1 }], { grants: { R, INNER: [], u: [{ role: 'R' }, { role: 'SYSADMIN' }] } });
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).rejects.toThrow(/SYSADMIN/);
    expect(two.opts).toBeUndefined();
    const name = env('sf', 'snowflake://u:p@acct/DB?role=R');
    const again = snowflakeMock([{ A: 1 }], { grants: { R: [] } });
    await runSql({ connection: name, query: 'select a from t' }, {});
    await runSql({ connection: name, query: 'select a from t' }, {});
    expect(again.shows.filter(x => x[0] === 'USE SECONDARY ROLES NONE')).toHaveLength(2);
  });
  it('cancels the statement at the row cap', async () => {
    const log = snowflakeMock(Array.from({ length: 100 }, (_, i) => ({ A: i })));
    limits.rows = 5;
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).rejects.toThrow(/more than 5 rows/);
    expect(log.cancelled).toBe(1);
    expect(log.destroyed).toBe(1); // a cancelled statement's connection is not pooled
  });
  it('a statement that never answers: 504 on time, and it is cancelled', async () => {
    let cancelled = 0;
    mocks.snowflake = { createPool: () => ({ release() {}, destroy() {}, acquire: async () => ({ execute: (o) => { if (!o.streamResult) { setTimeout(() => o.complete(null, {}, []), 1); return {}; } return { cancel: (cb) => { cancelled++; cb?.(); } }; } }) }) };
    limits.ms = 150;
    const t0 = Date.now();
    await expect(runSql({ connection: env('sf', 'snowflake://u:p@acct/DB?role=R'), query: 'select a from t' }, {})).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(cancelled).toBe(1);
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
    expect(log.jobs[0]).toMatchObject({ dryRun: true, useLegacySql: false, params: ['1', null], types: ['INT64', 'STRING'] });
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
  it('a slow first page: 504 on time, and the job is cancelled', async () => {
    const log = bigqueryMock();
    const make = mocks.bigquery.make;
    mocks.bigquery.make = (cfg) => { const c = make(cfg); const cj = c.createQueryJob; c.createQueryJob = async (o) => { const [j] = await cj(o); if (!o.dryRun) j.getQueryResults = () => new Promise(() => {}); return [j]; }; return c; };
    limits.ms = 150;
    const t0 = Date.now();
    await expect(runSql({ connection: env('bq', 'bigquery://proj'), query: 'select a from t' }, {})).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(log.cancelled).toBeGreaterThanOrEqual(1);
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
