// @ts-check
// SQL storage: SQLite (node:sqlite), Postgres (pg), MySQL (mysql2) or SQL Server (mssql). A connection of its own that may write,
// never the read-only one SQL data sources use. Tables are made on first use; records are JSON in a text column.
//   pw_reports, pw_schedules, pw_jobs, pw_users, pw_fonts, pw_folders, pw_report_acl, pw_tokens (id, data, updated_at)   pw_report_versions (id, stamp, data)

const TABLES = { reports: 'pw_reports', schedules: 'pw_schedules', jobs: 'pw_jobs', users: 'pw_users', fonts: 'pw_fonts', folders: 'pw_folders', reportacl: 'pw_report_acl', reportmeta: 'pw_report_meta', tokens: 'pw_tokens', settings: 'pw_settings', blobs: 'pw_blobs' };
const table = (k) => { if (!TABLES[k]) throw new Error(`Unknown storage kind "${k}"`); return TABLES[k]; };

/** @typedef {((text: string, values?: any[]) => Promise<any[]>) & { setup?: (fn: (run: any) => Promise<void>) => Promise<void> }} Query rows for a SELECT, [] otherwise; setup: run fn as the only writer (SQLite) */

/** @type {Map<string, Promise<Query>>} one connection (pool) per URL, shared across bundles and hot reloads */
const conns = (/** @type {any} */ (globalThis).__pwStoreConns ||= new Map());

/** Block this thread for ms (only while a SQLite file is first opened, before any request is served). @param {number} ms */
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** pg and mysql2 are optional: load them only when used (as in sql.js). */
async function load(pkg) {
  try { return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg); }
  catch { const name = pkg.split('/')[0]; throw new Error(`PW_STORAGE needs ${name}: npm install ${name}`); }
}

/** @param {string} url @param {'sqlite'|'postgres'|'mysql'|'mssql'} dialect @returns {Promise<Query>} */
/** Connections per storage pool (per server thread): PW_STORAGE_POOL_MAX, default 5. */
const poolMax = () => { const n = Math.floor(Number(process.env.PW_STORAGE_POOL_MAX)); return n > 0 ? n : 5; };

async function connect(url, dialect) {
  if (dialect === 'mssql') {
    const sql = (await load('mssql')).default;
    const { mssqlConfig } = await import('../sql.js');
    const pool = await new sql.ConnectionPool({ ...mssqlConfig(url), pool: { max: poolMax() }, connectionTimeout: 10000 }).connect();
    pool.on('error', () => {});
    // our statements have no "?" inside quotes, so each one is a placeholder
    return async (text, values = []) => {
      const r = pool.request();
      let i = 0;
      values.forEach((v, k) => r.input(`p${k + 1}`, typeof v === 'number' ? sql.BigInt : sql.NVarChar(sql.MAX), v));
      return (await r.query(text.replace(/\?/g, () => `@p${++i}`))).recordset || [];
    };
  }
  if (dialect === 'sqlite') {
    const { DatabaseSync } = /** @type {typeof import('node:sqlite')} */ (process.getBuiltinModule('node:sqlite'));
    const file = url.slice('sqlite:'.length);
    const fs = /** @type {typeof import('node:fs')} */ (process.getBuiltinModule('node:fs'));
    // users, sessions and audit live here: readable by this user only, from the first byte (umask 022 makes 0644)
    try { fs.closeSync(fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_RDWR, 0o600)); fs.chmodSync(file, 0o600); } catch { /* opened below anyway */ }
    const db = new DatabaseSync(file);
    // busy_timeout FIRST: switching to WAL needs a moment of the file to itself, and several processes (cluster.mjs,
    // the user CLI) open it at once on a first boot; without a busy handler that is "database is locked" at once
    db.exec('PRAGMA busy_timeout = 10000;');
    for (let i = 0; ; i++) {
      try { db.exec('PRAGMA journal_mode = WAL;'); break; } catch (e) { if (i >= 20 || !/locked|busy/i.test(String(/** @type {any} */ (e)?.message))) throw e; sleepMs(25 * (i + 1)); }
    }
    for (const f of [`${file}-wal`, `${file}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* not made yet */ } }
    const run = async (text, values = []) => db.prepare(text).all(...values);
    // one writer at a time for the schema: BEGIN IMMEDIATE takes the write lock (waiting busy_timeout for it), so
    // a second process booting at the same moment waits here, then finds the tables and pw_meta already done
    return Object.assign(run, { setup: async (fn) => { db.exec('BEGIN IMMEDIATE'); try { await fn(run); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } });
  }
  if (dialect === 'postgres') {
    const pg = (await load('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: poolMax(), connectionTimeoutMillis: 10000 });
    pool.on('error', () => {}); // an idle client that drops must not crash the server
    // our statements have no "?" inside quotes, so each one is a placeholder
    return async (text, values = []) => { let i = 0; return (await pool.query(text.replace(/\?/g, () => `$${++i}`), values)).rows; };
  }
  const mysql = (await load('mysql2/promise')).default;
  const pool = mysql.createPool({ uri: url, connectionLimit: poolMax(), connectTimeout: 10000 });
  return async (text, values = []) => { const [rows] = await pool.execute(text, values); return Array.isArray(rows) ? rows : []; };
}

/**
 * The storage schema's migrations, in order. pw_meta holds the version reached; each step runs once per database
 * (a step another server ran at the same moment fails as "already exists" and is taken as done). v1 is the tables
 * themselves (CREATE ... IF NOT EXISTS above, so databases from before pw_meta start there).
 * @type {{ v: number, what: string, sql: (d: string) => string[] }[]}
 */
export const MIGRATIONS = [
  { v: 2, what: 'indexes for the audit filters and the lease sweep', sql: () => [
    'CREATE INDEX pw_audit_at ON pw_audit (at)', 'CREATE INDEX pw_audit_type ON pw_audit (type)', 'CREATE INDEX pw_audit_actor ON pw_audit (actor)',
    'CREATE INDEX pw_audit_report ON pw_audit (report)', 'CREATE INDEX pw_leases_expires ON pw_leases (expires_at)'] },
  // Postgres uses a btree for a prefix LIKE only with the pattern operator class (the id key's collation is the
  // database's, usually not C): blob listings by prefix (a batch's items) scanned the table. The others use the key.
  { v: 3, what: 'prefix index for blob listings (Postgres)', sql: (d) => (d === 'postgres' ? ['CREATE INDEX pw_blobs_id_prefix ON pw_blobs (id text_pattern_ops)'] : []) },
];
/** @param {(sql: string, values?: any[]) => Promise<any[]>} run @param {string} dialect @param {(t: string, cols: string) => string} create */
async function migrate(run, dialect, create) {
  await run(create('pw_meta', 'k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL'));
  const [row] = await run("SELECT v FROM pw_meta WHERE k = 'schema'");
  let at = row ? Number(row.v) : 1;
  for (const m of MIGRATIONS) {
    if (m.v <= at) continue;
    for (const s of m.sql(dialect)) {
      try { await run(s); } catch (e) { if (!/exist|duplicate|already/i.test(String(/** @type {any} */ (e)?.message))) throw e; }
    }
    if (row || at > 1) await run("UPDATE pw_meta SET v = ? WHERE k = 'schema'", [String(m.v)]);
    else { try { await run("INSERT INTO pw_meta (k, v) VALUES ('schema', ?)", [String(m.v)]); } catch { await run("UPDATE pw_meta SET v = ? WHERE k = 'schema'", [String(m.v)]); } }
    at = m.v;
  }
}

/** @param {string} url @returns {import('./index.js').Store} */
export function sqlStore(url) {
  const dialect = url.startsWith('sqlite:') ? 'sqlite' : url.startsWith('mysql://') ? 'mysql' : url.startsWith('mssql://') ? 'mssql' : 'postgres';
  const text = dialect === 'mysql' ? 'LONGTEXT' : dialect === 'mssql' ? 'NVARCHAR(MAX)' : 'TEXT'; // a report may be 5 MB
  const all = (keys, cols) => [...keys, ...cols];
  const upsert = (t, keys, cols) => dialect === 'mysql'
    ? `INSERT INTO ${t} (${all(keys, cols).join(', ')}) VALUES (${all(keys, cols).map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${cols.map(c => `${c} = VALUES(${c})`).join(', ')}`
    : dialect === 'mssql'
      ? `MERGE ${t} WITH (HOLDLOCK) AS t USING (SELECT ${all(keys, cols).map(c => `? AS ${c}`).join(', ')}) AS s ON ${keys.map(k => `t.${k} = s.${k}`).join(' AND ')} WHEN MATCHED THEN UPDATE SET ${cols.map(c => `${c} = s.${c}`).join(', ')} WHEN NOT MATCHED THEN INSERT (${all(keys, cols).join(', ')}) VALUES (${all(keys, cols).map(c => `s.${c}`).join(', ')});`
      : `INSERT INTO ${t} (${all(keys, cols).join(', ')}) VALUES (${all(keys, cols).map(() => '?').join(', ')}) ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`;
  const bytes = dialect === 'postgres' ? 'octet_length(data)' : dialect === 'mysql' ? 'LENGTH(data)' : dialect === 'mssql' ? 'DATALENGTH(CAST(data AS VARCHAR(MAX)))' : 'LENGTH(CAST(data AS BLOB))';
  // SQL Server has no CREATE TABLE IF NOT EXISTS
  const create = (t, cols) => (dialect === 'mssql' ? `IF OBJECT_ID(N'${t}') IS NULL CREATE TABLE ${t} (${cols})` : `CREATE TABLE IF NOT EXISTS ${t} (${cols})`);

  /** @type {Query} */
  const q = async (sql, values) => {
    if (!conns.has(url)) {
      const ready = connect(url, dialect).then(async (run) => {
        const schema = async (run) => {
          for (const t of Object.values(TABLES)) await run(create(t, `id VARCHAR(255) PRIMARY KEY, data ${text} NOT NULL, updated_at VARCHAR(32) NOT NULL`));
          await run(create('pw_report_versions', `id VARCHAR(255) NOT NULL, stamp VARCHAR(32) NOT NULL, data ${text} NOT NULL, PRIMARY KEY (id, stamp)`));
          await run(create('pw_leases', 'name VARCHAR(255) PRIMARY KEY, owner VARCHAR(255) NOT NULL, expires_at BIGINT NOT NULL'));
          // the audit log: only ever inserted into (and old rows deleted by retention); id sorts by time
          await run(create('pw_audit', `id VARCHAR(64) PRIMARY KEY, at VARCHAR(32) NOT NULL, type VARCHAR(64) NOT NULL, actor VARCHAR(400) NOT NULL, report VARCHAR(255), data ${text} NOT NULL`));
          await migrate(run, dialect, create);
        };
        // SQLite: under one write transaction (see connect). Databases with their own locking: a setup that lost a race
        // with another server's (a CREATE at the same moment) is retried a few times with backoff, then fails
        if (/** @type {any} */ (run).setup) await /** @type {any} */ (run).setup(schema);
        else for (let i = 0; ; i++) { try { await schema(run); break; } catch (e) { if (i >= 4) throw e; await new Promise(r => setTimeout(r, 100 * 2 ** i + Math.random() * 100)); } }
        return run;
      });
      conns.set(url, ready);
      ready.catch(() => conns.delete(url)); // try again on the next call (the database was down)
    }
    return (await /** @type {Promise<Query>} */ (conns.get(url)))(sql, values);
  };

  return {
    async get(k, id) { const [r] = await q(`SELECT data FROM ${table(k)} WHERE id = ?`, [id]); return r ? String(r.data) : null; },
    async put(k, id, data) { await q(upsert(table(k), ['id'], ['data', 'updated_at']), [id, data, new Date().toISOString()]); },
    async remove(k, id) {
      const t = table(k);
      const [r] = await q(`SELECT id FROM ${t} WHERE id = ?`, [id]);
      if (r) await q(`DELETE FROM ${t} WHERE id = ?`, [id]);
      return !!r;
    },
    async ids(k) { return (await q(`SELECT id FROM ${table(k)} ORDER BY id`)).map(r => String(r.id)); },
    /** Ids that start with prefix (an index range, not a scan of the kind). */
    async idsFrom(k, prefix) {
      const like = `${String(prefix).replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;
      return (await q(`SELECT id FROM ${table(k)} WHERE id LIKE ? ESCAPE '\\' ORDER BY id`, [like])).map(r => String(r.id)).filter(id => id.startsWith(prefix));
    },
    async list(k) { return (await q(`SELECT id, data, updated_at FROM ${table(k)} ORDER BY id`)).map(r => ({ id: String(r.id), text: String(r.data), updatedAt: String(r.updated_at) })); },

    async versions(id) {
      return (await q(`SELECT stamp, ${bytes} AS bytes FROM pw_report_versions WHERE id = ? ORDER BY stamp DESC`, [id])).map(r => ({ version: String(r.stamp), bytes: Number(r.bytes) }));
    },
    async getVersion(id, version) { const [r] = await q('SELECT data FROM pw_report_versions WHERE id = ? AND stamp = ?', [id, version]); return r ? String(r.data) : null; },
    async removeVersions(id) { await q('DELETE FROM pw_report_versions WHERE id = ?', [id]); },
    async addVersion(id, version, data, keep) {
      await q(upsert('pw_report_versions', ['id', 'stamp'], ['data']), [id, version, data]);
      const old = (await q('SELECT stamp FROM pw_report_versions WHERE id = ? ORDER BY stamp DESC', [id])).slice(keep);
      for (const r of old) await q('DELETE FROM pw_report_versions WHERE id = ? AND stamp = ?', [id, r.stamp]);
    },

    async appendAudit(e) {
      await q('INSERT INTO pw_audit (id, at, type, actor, report, data) VALUES (?, ?, ?, ?, ?, ?)', [e.id, e.at, e.type, e.actor, e.report ?? null, JSON.stringify(e)]);
    },
    async queryAudit(f) {
      const where = [], vals = [];
      if (f.from) { where.push('at >= ?'); vals.push(f.from); }
      if (f.to) { where.push('at < ?'); vals.push(f.to); }
      if (f.before) { where.push('id < ?'); vals.push(f.before); }
      if (f.type) { if (f.type.endsWith('.')) { where.push('type LIKE ?'); vals.push(`${f.type.replace(/[%_\\]/g, '')}%`); } else { where.push('type = ?'); vals.push(f.type); } }
      if (f.actor) { where.push('actor = ?'); vals.push(f.actor); }
      if (f.report) { where.push('report = ?'); vals.push(f.report); }
      const n = Math.max(1, Math.min(10000, Number(f.limit) || 100));
      const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const sqlText = dialect === 'mssql' ? `SELECT TOP ${n} data FROM pw_audit${w} ORDER BY id DESC` : `SELECT data FROM pw_audit${w} ORDER BY id DESC LIMIT ${n}`;
      return (await q(sqlText, vals)).map(r => JSON.parse(String(r.data)));
    },
    async pruneAudit(before) {
      const [r] = await q('SELECT COUNT(*) AS n FROM pw_audit WHERE at < ?', [before]);
      await q('DELETE FROM pw_audit WHERE at < ?', [before]);
      return Number(r?.n || 0);
    },

    // A lease is taken in one statement: when it is free, has expired, or is already ours.
    async lease(name, owner, ttl) {
      const now = Date.now();
      if (dialect === 'mssql') {
        await q('MERGE pw_leases WITH (HOLDLOCK) AS t USING (SELECT ? AS name, ? AS owner, ? AS expires_at) AS s ON t.name = s.name WHEN MATCHED AND (t.owner = s.owner OR t.expires_at < ?) THEN UPDATE SET owner = s.owner, expires_at = s.expires_at WHEN NOT MATCHED THEN INSERT (name, owner, expires_at) VALUES (s.name, s.owner, s.expires_at);', [name, owner, now + ttl, now]);
      } else if (dialect === 'mysql') {
        // assignments run left to right: owner first, then expires_at only when we now hold it
        await q('INSERT INTO pw_leases (name, owner, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner = IF(owner = VALUES(owner) OR expires_at < ?, VALUES(owner), owner), expires_at = IF(owner = VALUES(owner), VALUES(expires_at), expires_at)', [name, owner, now + ttl, now]);
      } else {
        await q('INSERT INTO pw_leases (name, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE pw_leases.owner = excluded.owner OR pw_leases.expires_at < ?', [name, owner, now + ttl, now]);
      }
      const [r] = await q('SELECT owner FROM pw_leases WHERE name = ?', [name]);
      return r?.owner === owner;
    },
    async release(name, owner) { await q('DELETE FROM pw_leases WHERE name = ? AND owner = ?', [name, owner]); },
    /** Remove leases that ran out before this time (ms); the number removed. */
    async sweepLeases(before) { const [r] = await q('SELECT COUNT(*) AS n FROM pw_leases WHERE expires_at < ?', [before]); await q('DELETE FROM pw_leases WHERE expires_at < ?', [before]); return Number(r?.n || 0); },
  };
}
