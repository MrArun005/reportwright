// Live BigQuery, against the goccy/bigquery-emulator (CI: .github/workflows/db-live.yml). It is an EMULATOR, not Google
// BigQuery: the emulator's answers (dry-run bytes, job cancel, type names) can differ from the real service. Opt-in:
// skipped unless PW_LIVE_BIGQUERY is set (the emulator's endpoint, e.g. http://127.0.0.1:9050).
// Goes through the same public path the server uses: runSql (PW_DB_<NAME>) and renderTo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSql } from '../../src/server/sql.js';
import { schemaOf } from '../../src/server/sql/schema.js';
import { renderTo } from '../../src/server/renderer.js';
import { report } from '../helpers.js';

const LABEL = 'Ünïcødé — ₹ 日本語 🚀';
const NAME = 'pwbq';
const endpoint = process.env.PW_LIVE_BIGQUERY;
const url = (extra = '') => `bigquery://pwtest?endpoint=${encodeURIComponent(endpoint)}&location=US${extra}`;
const T = '`pwtest.pwds.types`';
const src = (query) => ({ connection: NAME, query });

describe.skipIf(!endpoint)('BigQuery (live, against the bigquery-emulator)', () => {
  beforeAll(() => { process.env[`PW_DB_${NAME.toUpperCase()}`] = url(); });
  afterAll(() => { delete process.env[`PW_DB_${NAME.toUpperCase()}`]; });

  it('a parameterized query binds its values: a quote in a bound value matches nothing and changes no SQL', async () => {
    expect(await runSql(src(`select id from ${T} where id = @id`), { id: 1 })).toEqual([{ id: 1 }]);
    expect(await runSql(src(`select id from ${T} where label = @l`), { l: "x' OR '1'='1" })).toEqual([]);
    expect(await runSql(src(`select id from ${T} where label = @l`), { l: LABEL })).toEqual([{ id: 1 }]);
  });

  it('types round-trip: INT64, NUMERIC, FLOAT64, unicode STRING, DATE, TIMESTAMP, BOOL, and NULLs', async () => {
    const [r] = await runSql(src(`select id, amount, ratio, label, born, seen, flag from ${T} where id = 1`));
    expect(r.id).toBe(1);
    expect(Number(r.amount)).toBe(1234.5);
    expect(r.ratio).toBe(1.5);
    expect(r.label).toBe(LABEL);
    expect(String(r.born)).toContain('2024-01-02');
    expect(String(r.seen)).toContain('2024-01-02');
    expect(r.flag).toBe(true);
    const [n] = await runSql(src(`select id, amount, ratio, label, born, seen, flag from ${T} where id = 2`));
    expect(n).toEqual({ id: 2, amount: null, ratio: null, label: null, born: null, seen: null, flag: null });
  });

  it('only one read: a write or a second statement is refused before the job runs', async () => {
    await expect(runSql(src(`delete from ${T} where id = 1`))).rejects.toThrow(/SELECT/);
    await expect(runSql(src('select 1 as a; select 2 as a'))).rejects.toThrow(/one/);
    expect(await runSql(src(`select count(*) as n from ${T}`))).toEqual([{ n: 2 }]);
  });

  it('the row cap (PW_SQL_MAX_ROWS=50) refuses the 51st row', async () => {
    expect(await runSql(src('select x from unnest(generate_array(1, 50)) as x'))).toHaveLength(50);
    await expect(runSql(src('select x from unnest(generate_array(1, 51)) as x'))).rejects.toThrow(/more than 50 rows/);
  });

  it('connection errors are clean: an unreachable endpoint gives a message with no URL in it', async () => {
    process.env.PW_DB_PWBADBQ = 'bigquery://pwtest?endpoint=http://127.0.0.1:1&location=US';
    try {
      const err = await runSql({ connection: 'pwbadbq', query: 'select 1 as a' }).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).not.toMatch(/127\.0\.0\.1:1|bigquery:\/\//);
    } finally { delete process.env.PW_DB_PWBADBQ; }
  });

  it('schema listing is not offered for BigQuery yet: a clean 400 that tells the author to write the query', async () => {
    await expect(schemaOf(NAME)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/write the query/) });
  });

  it('a report on the BigQuery source renders to PDF with the values in its text', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 500, h: 60, dataSet: 'Rows', columns: [{ width: 100 }, { width: 400 }],
      header: [{ height: 18, cells: [{ value: 'ID' }, { value: 'Label' }] }],
      detail: [{ height: 14, cells: [{ value: '{ID}' }, { value: '{LABEL}' }] }] }]);
    def.dataSources = [{ name: 'src', type: 'sql', connection: NAME, query: `select id, label from ${T} order by id` }];
    def.dataSets = [{ name: 'Rows', source: 'src', path: '$' }];
    const { bytes } = await renderTo(def, { format: 'pdf' });
    const file = join(mkdtempSync(join(tmpdir(), 'pw-bq-')), 'report.pdf');
    writeFileSync(file, bytes);
    expect(execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })).toContain(LABEL);
  });

  // last: the emulator cannot cancel a running job, so this one would slow every query after it
  it('the deadline (PW_SQL_TIMEOUT_MS=3000) answers 504 on a query that runs past it', async () => {
    const t0 = Date.now();
    await expect(runSql(src('select count(*) from unnest(generate_array(1, 1000000000)) as x'))).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t0).toBeLessThan(20000);
  });

});
