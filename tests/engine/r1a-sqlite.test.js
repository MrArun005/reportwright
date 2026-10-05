// R1-A S-1: a SQLite query can neither crash the server nor freeze it for everyone (external review 2, §2 #1 and #2).
// The repros run against a real SQLite file through runSql, the same path as POST /api/data/sql and a render.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSql, limits } from '../../src/server/sql.js';
import { stopSqlite, sqliteStats } from '../../src/server/sql/sqlite.js';

let dir;
const q = (query) => ({ connection: 'r1a', query });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-'));
  const file = path.join(dir, 't.db');
  const db = new DatabaseSync(file);
  db.exec('create table t (id integer primary key, name text); insert into t values (1, \'a\'), (2, \'b\');');
  db.close();
  process.env.PW_DB_R1A = `sqlite:${file}`;
});
afterAll(() => { stopSqlite(); delete process.env.PW_DB_R1A; fs.rmSync(dir, { recursive: true, force: true }); });

/** The longest the event loop was held while `work` ran, in ms. */
async function stall(work) {
  let worst = 0, last = Date.now();
  const t = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; }, 10);
  try { return { result: await work().then((v) => ({ v }), (e) => ({ e })), worst: () => worst }; } finally { clearInterval(t); }
}

describe('S-1: SQLite runs off the server thread', () => {
  it('the printf crash repro fails one query; the server and the next query go on', async () => {
    const { result, worst } = await stall(() => runSql(q("SELECT printf('%.*c', 900000000, 'x') AS v"), {}));
    expect(result.e?.status).toBe(400);
    expect(String(result.e?.message)).toMatch(/too large|more than/);
    expect(worst()).toBeLessThan(500);
    expect(await runSql(q('select name from t order by id'), {})).toEqual([{ name: 'a' }, { name: 'b' }]);
  }, 60000);

  it('the recursive-CTE freeze repro is stopped at the deadline, and other work runs meanwhile', async () => {
    const was = limits.ms;
    limits.ms = 1500;
    try {
      const t0 = Date.now();
      // unbounded: on the request thread this never returned
      const slow = stall(() => runSql(q('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) AS n FROM c'), {}));
      // a second query runs beside it (its own process) and answers at once
      const t1 = Date.now();
      expect(await runSql(q('select count(*) as n from t'), {})).toEqual([{ n: 2 }]);
      expect(Date.now() - t1).toBeLessThan(1400);
      const { result, worst } = await slow;
      expect(result.e?.status).toBe(504);
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(worst()).toBeLessThan(500);
    } finally { limits.ms = was; }
  }, 60000);

  it('the byte cap holds while reading; zeroblob and randomblob are refused by the statement check', async () => {
    const was = limits.bytes;
    limits.bytes = 1024 * 1024;
    try {
      await expect(runSql(q("SELECT printf('%.*c', 2000000, 'x') AS v"), {})).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/more than 1 MB/) });
    } finally { limits.bytes = was; }
    await expect(runSql(q('SELECT zeroblob(500000000) AS v'), {})).rejects.toThrow(/zeroblob/);
    await expect(runSql(q('SELECT randomblob(5) AS v'), {})).rejects.toThrow(/randomblob/);
  }, 60000);

  it('a query past PW_SQLITE_MEMORY_MB is killed while it runs', async () => {
    process.env.PW_SQLITE_MEMORY_MB = '96';
    stopSqlite(); // a fresh process with the lower heap limit
    try {
      const before = sqliteStats().killed + sqliteStats().crashed;
      // ~400 MB built by SQLite itself (outside V8's heap): only the watch or the heap limit can stop it
      await expect(runSql(q("SELECT length(replace(printf('%.*c', 50000000, 'x'), 'x', 'xxxxxxxx')) AS n"), {})).rejects.toMatchObject({ status: 400 });
      expect(sqliteStats().killed + sqliteStats().crashed).toBeGreaterThan(before);
    } finally { delete process.env.PW_SQLITE_MEMORY_MB; stopSqlite(); }
  }, 60000);

  it('values come back as before: BigInt as a number when exact, else text', async () => {
    expect(await runSql(q('select 9007199254740993 as big, 7 as small, x\'0102\' as b'), {})).toEqual([{ big: '9007199254740993', small: 7, b: new Uint8Array([1, 2]) }]);
  });
});
