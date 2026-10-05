// R3-B item 1 (REVIEW-SECURITY-2 H1, EXTERNAL-REVIEW-3 §1 pragma_database_list): a SQL data connection never reaches the
// storage database, and a query cannot read which files SQLite has open.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSql, listConnections } from '../../src/server/sql.js';

let dir, storeFile, dataFile;
const ENV = ['PW_STORAGE', 'PW_DB_MAIN', 'PW_DB_COPY', 'PW_DB_LINK', 'PW_DB_DATA', 'PW_DB_HARD'];
const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-sql-'));
  storeFile = path.join(dir, 's.db');
  dataFile = path.join(dir, 'd.db');
  let db = new DatabaseSync(storeFile);
  db.exec(`create table pw_users (id text primary key, data text); insert into pw_users values ('a', '{"passwordHash":"scrypt$x"}');`);
  db.close();
  db = new DatabaseSync(dataFile);
  db.exec('create table t (n integer); insert into t values (1);');
  db.close();
  fs.symlinkSync(storeFile, path.join(dir, 'link.db'));
  fs.linkSync(storeFile, path.join(dir, 'hard.db'));
});
afterEach(() => { for (const k of ENV) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const leak = /pw_users|scrypt/;
const refuses = async (connection, query = 'select data from pw_users') => {
  const e = await runSql({ connection, query }).then(r => ({ rows: r }), x => x);
  expect(e.rows, `connection ${connection} returned rows`).toBeUndefined();
  expect(e.status).toBe(400);
  expect(String(e.message)).not.toMatch(leak);
  return e;
};

describe('the storage database is never a data connection', () => {
  it('PW_STORAGE=sql:<name>: that connection is refused and not listed (the PoC p1 union)', async () => {
    process.env.PW_DB_MAIN = `sqlite:${storeFile}`;
    process.env.PW_STORAGE = 'sql:main';
    await refuses('main', 'select id, data from pw_users union all select id, data from pw_users');
    expect(listConnections().map(c => c.name)).not.toContain('main');
  });
  it('another name for the same file (same URL, symlink, hard link) is refused too', async () => {
    process.env.PW_STORAGE = `sqlite:${storeFile}`;
    process.env.PW_DB_COPY = `sqlite:${storeFile}`;
    process.env.PW_DB_LINK = `sqlite:${path.join(dir, 'link.db')}`;
    process.env.PW_DB_HARD = `sqlite:${path.join(dir, 'hard.db')}`;
    process.env.PW_DB_DATA = `sqlite:${dataFile}`;
    for (const c of ['copy', 'link', 'hard']) await refuses(c);
    expect(listConnections().map(c => c.name)).toEqual(['data']);
    expect(await runSql({ connection: 'data', query: 'select n from t' })).toEqual([{ n: 1 }]);
  });
  it('a network storage URL used as a data connection is refused (same URL)', async () => {
    process.env.PW_STORAGE = 'postgres://pw:secret@db.local/pw';
    process.env.PW_DB_MAIN = 'postgres://pw:secret@db.local/pw';
    const e = await refuses('main', 'select 1');
    expect(String(e.message)).not.toMatch(/secret|db\.local/);
    expect(listConnections().map(c => c.name)).not.toContain('main');
  });
});

describe('a query cannot list or attach database files', () => {
  it('pragma_database_list (with or without parentheses), ATTACH and sqlite_* introspection of files are refused', async () => {
    process.env.PW_DB_DATA = `sqlite:${dataFile}`;
    for (const q of [
      'select file from pragma_database_list',
      'select * from pragma_database_list()',
      'select file from main.pragma_database_list',
      "select * from t; attach database '/tmp/x.db' as x",
      "with a as (select 1) select * from pragma_database_list",
    ]) {
      const e = await runSql({ connection: 'data', query: q }).then(() => null, x => x);
      expect(e, q).not.toBeNull();
      expect(String(e.message)).not.toContain(dir);
    }
  });
  it('a failing query never shows the file path', async () => {
    process.env.PW_DB_DATA = `sqlite:${dataFile}`;
    const e = await runSql({ connection: 'data', query: 'select * from nope' }).then(() => null, x => x);
    expect(String(e.message)).not.toContain(dir);
  });
});

// The text check above is defence in depth; SQLite's own parser decides (EXPLAIN in the child process). These go to
// the driver directly, past the text check, so every spelling the text check might miss is still refused.
describe("SQLite's own plan decides (the driver, past the text check)", () => {
  const ctx = async () => { const sql = await import('../../src/server/sql.js'); return { limits: sql.limits, fail: (m, s) => Object.assign(new Error(m), { status: s }) }; };
  const drive = async (q, values = []) => { const { sqlite } = await import('../../src/server/sql/sqlite.js'); return sqlite(`sqlite:${dataFile}`, q, values, /** @type {any} */ (await ctx())); };
  it('every spelling of pragma_database_list, dbstat and friends is refused; attach is refused', async () => {
    for (const q of [
      'select file from pragma_database_list',
      'select file from "pragma_database_list"',
      'select file from [pragma_database_list]',
      'select file from `PRAGMA_DATABASE_LIST`',
      'select file from main.pragma_database_list',
      'select file from pragma_database_list/**/',
      'select * from (select * from pragma_database_list) x',
      "select * from pragma_table_info('t')",
      'select name from pragma_function_list',
      'select * from pragma_compile_options',
      "attach database '/tmp/r3b.db' as x",
      'select sqlite_attach(1, 2, 3)',
      "select load_extension('x')",
    ]) {
      const r = await drive(q).then(rows => ({ rows }), e => e);
      expect(r.rows, q).toBeUndefined();
      expect(String(r.message), q).not.toContain(dir);
    }
  });
  it('writes are refused by the plan as well as by the read-only open', async () => {
    for (const q of ['insert into t values (2)', 'delete from t', 'create table x (a)', 'vacuum', "pragma journal_mode = delete", 'pragma query_only = off'])
      expect((await drive(q).then(() => null, e => e))?.status, q).toBe(400);
  });
  it('plain reads, joins, CTEs, json_each and json_tree still work', async () => {
    expect((await drive('select n from t where n = ?', [1])).length).toBe(1);
    expect((await drive("with recursive c(x) as (select 1 union all select x + 1 from c where x < 3) select x from c join t on 1 = 1")).length).toBe(3);
    expect((await drive("select value from json_each('[1,2,3]')")).length).toBe(3);
    expect((await drive("select key from json_tree('{\"a\":1}')")).length).toBe(2);
  });
});
