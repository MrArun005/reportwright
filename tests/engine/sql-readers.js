// Test helpers: a reading login on the live Postgres and MySQL containers, made the way docs/DATA-SQL.md tells admins.
// PW_TEST_PG / PW_TEST_MYSQL are admin URLs; report connections must use these readers (the probe refuses admins).

/** A Postgres role that can connect and read the public schema; returns its URL. */
export async function pgReader(adminUrl) {
  const { default: P } = await import('pg');
  const c = new P.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pw_reader') THEN CREATE ROLE pw_reader LOGIN PASSWORD 'Reader-Pass-123'; END IF; END $$;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO pw_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO pw_reader; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pw_reader;
      REVOKE CREATE ON DATABASE ${c.database} FROM PUBLIC;`);
  } finally { await c.end(); }
  const u = new URL(adminUrl);
  u.username = 'pw_reader'; u.password = 'Reader-Pass-123';
  return u.href;
}

/** A MySQL user with SELECT on the test database; returns its URL. */
export async function mysqlReader(adminUrl, procs = []) {
  const { default: M } = await import('mysql2/promise');
  const c = await M.createConnection({ uri: adminUrl, multipleStatements: true });
  const db = new URL(adminUrl).pathname.slice(1);
  try {
    await c.query(`CREATE USER IF NOT EXISTS 'pw_reader'@'%' IDENTIFIED BY 'Reader-Pass-123'; GRANT SELECT ON \`${db}\`.* TO 'pw_reader'@'%';`);
    for (const p of procs) await c.query(`GRANT EXECUTE ON PROCEDURE \`${db}\`.\`${p}\` TO 'pw_reader'@'%'`);
  } finally { await c.end(); }
  const u = new URL(adminUrl);
  u.username = 'pw_reader'; u.password = 'Reader-Pass-123';
  return u.href;
}
