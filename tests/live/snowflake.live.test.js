// Live Snowflake. No free local emulator exists, so this runs only when a real account is configured: the CI job in
// .github/workflows/db-live.yml runs it when the repository secret PW_LIVE_SNOWFLAKE_URL is set, and skips otherwise.
// PW_LIVE_SNOWFLAKE=snowflake://USER:PASS@ACCOUNT/DB/SCHEMA?warehouse=WH&role=READER (a read-only role).
// Literal queries only: nothing is written and no table is needed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runSql } from '../../src/server/sql.js';

const NAME = 'pwsf';
const LABEL = 'Ünïcødé — ₹ 日本語 🚀';

describe.skipIf(!process.env.PW_LIVE_SNOWFLAKE)('Snowflake (live account)', () => {
  beforeAll(() => { process.env[`PW_DB_${NAME.toUpperCase()}`] = process.env.PW_LIVE_SNOWFLAKE; });
  afterAll(() => { delete process.env[`PW_DB_${NAME.toUpperCase()}`]; });

  it('a parameterized query binds its values: a quote in a bound value matches nothing and changes no SQL', async () => {
    expect(await runSql({ connection: NAME, query: 'select 1 as one where @l = @l2' }, { l: 'a', l2: 'a' })).toEqual([{ ONE: 1 }]);
    expect(await runSql({ connection: NAME, query: 'select 1 as one where @l = \'x\'' }, { l: "x' OR '1'='1" })).toEqual([]);
  });

  it('types round-trip: number, float, unicode text, date, timestamp, boolean, and NULL', async () => {
    const [r] = await runSql({ connection: NAME, query: "select 1234.50::NUMBER(12,2) as amount, 1.5::FLOAT as ratio, @l::VARCHAR as label, '2024-01-02'::DATE as born, '2024-01-02 03:04:05'::TIMESTAMP_NTZ as seen, TRUE as flag, NULL::VARCHAR as nothing" }, { l: LABEL });
    expect(Number(r.AMOUNT)).toBe(1234.5);
    expect(r.RATIO).toBe(1.5);
    expect(r.LABEL).toBe(LABEL);
    expect(String(r.BORN)).toContain('2024-01-02');
    expect(String(r.SEEN)).toContain('2024-01-02');
    expect(r.FLAG).toBe(true);
    expect(r.NOTHING).toBeNull();
  });

  it('only one read: a write or a second statement is refused before Snowflake runs it', async () => {
    await expect(runSql({ connection: NAME, query: 'delete from t' })).rejects.toThrow(/SELECT/);
    await expect(runSql({ connection: NAME, query: 'select 1 as a; select 2 as a' })).rejects.toThrow(/one/);
  });

  it('the row cap (PW_SQL_MAX_ROWS) refuses one row past it', async () => {
    const cap = Number(process.env.PW_SQL_MAX_ROWS || 100000);
    await expect(runSql({ connection: NAME, query: `select seq4() as n from table(generator(rowcount => ${cap + 1}))` })).rejects.toThrow(/more than/);
  });
});
