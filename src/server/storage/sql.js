// @ts-check
// SQL storage: SQLite (node:sqlite), Postgres (pg) or MySQL (mysql2). A connection of its own that may write,
// never the read-only one SQL data sources use. Tables are made on first use; records are JSON in a text column.
//   pw_reports, pw_schedules, pw_jobs, pw_users, pw_fonts (id, data, updated_at)   pw_report_versions (id, stamp, data)

const TABLES = { reports: 'pw_reports', schedules: 'pw_schedules', jobs: 'pw_jobs', users: 'pw_users', fonts: 'pw_fonts' };
const table = (k) => { if (!TABLES[k]) throw new Error(`Unknown storage kind "${k}"`); return TABLES[k]; };

/** @typedef {(text: string, values?: any[]) => Promise<any[]>} Query rows for a SELECT, [] otherwise */

/** @type {Map<string, Promise<Query>>} one connection (pool) per URL, shared across bundles and hot reloads */
const conns = (/** @type {any} */ (globalThis).__pwStoreConns ||= new Map());

/** pg and mysql2 are optional: load them only when used (as in sql.js). */
async function load(pkg) {
  try { return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg); }
  catch { const name = pkg.split('/')[0]; throw new Error(`PW_STORAGE needs ${name}: npm install ${name}`); }
}

/** @param {string} url @param {'sqlite'|'postgres'|'mysql'} dialect @returns {Promise<Query>} */
async function connect(url, dialect) {
  if (dialect === 'sqlite') {
    const { DatabaseSync } = /** @type {typeof import('node:sqlite')} */ (process.getBuiltinModule('node:sqlite'));
    const db = new DatabaseSync(url.slice('sqlite:'.length));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;'); // other processes (the user CLI) may write too
    return async (text, values = []) => db.prepare(text).all(...values);
  }
  if (dialect === 'postgres') {
    const pg = (await load('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10000 });
    pool.on('error', () => {}); // an idle client that drops must not crash the server
    // our statements have no "?" inside quotes, so each one is a placeholder
    return async (text, values = []) => { let i = 0; return (await pool.query(text.replace(/\?/g, () => `$${++i}`), values)).rows; };
  }
  const mysql = (await load('mysql2/promise')).default;
  const pool = mysql.createPool({ uri: url, connectionLimit: 5, connectTimeout: 10000 });
  return async (text, values = []) => { const [rows] = await pool.execute(text, values); return Array.isArray(rows) ? rows : []; };
}

/** @param {string} url @returns {import('./index.js').Store} */
export function sqlStore(url) {
  const dialect = url.startsWith('sqlite:') ? 'sqlite' : url.startsWith('mysql://') ? 'mysql' : 'postgres';
  const text = dialect === 'mysql' ? 'LONGTEXT' : 'TEXT'; // a report may be 5 MB
  const upsert = (t, keys, cols) => dialect === 'mysql'
    ? `INSERT INTO ${t} (${[...keys, ...cols].join(', ')}) VALUES (${[...keys, ...cols].map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${cols.map(c => `${c} = VALUES(${c})`).join(', ')}`
    : `INSERT INTO ${t} (${[...keys, ...cols].join(', ')}) VALUES (${[...keys, ...cols].map(() => '?').join(', ')}) ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`;
  const bytes = dialect === 'postgres' ? 'octet_length(data)' : dialect === 'mysql' ? 'LENGTH(data)' : 'LENGTH(CAST(data AS BLOB))';

  /** @type {Query} */
  const q = async (sql, values) => {
    if (!conns.has(url)) {
      const ready = connect(url, dialect).then(async (run) => {
        for (const t of Object.values(TABLES)) await run(`CREATE TABLE IF NOT EXISTS ${t} (id VARCHAR(255) PRIMARY KEY, data ${text} NOT NULL, updated_at VARCHAR(32) NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS pw_report_versions (id VARCHAR(255) NOT NULL, stamp VARCHAR(32) NOT NULL, data ${text} NOT NULL, PRIMARY KEY (id, stamp))`);
        await run('CREATE TABLE IF NOT EXISTS pw_leases (name VARCHAR(255) PRIMARY KEY, owner VARCHAR(255) NOT NULL, expires_at BIGINT NOT NULL)');
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
    async list(k) { return (await q(`SELECT id, data, updated_at FROM ${table(k)} ORDER BY id`)).map(r => ({ id: String(r.id), text: String(r.data), updatedAt: String(r.updated_at) })); },

    async versions(id) {
      return (await q(`SELECT stamp, ${bytes} AS bytes FROM pw_report_versions WHERE id = ? ORDER BY stamp DESC`, [id])).map(r => ({ version: String(r.stamp), bytes: Number(r.bytes) }));
    },
    async getVersion(id, version) { const [r] = await q('SELECT data FROM pw_report_versions WHERE id = ? AND stamp = ?', [id, version]); return r ? String(r.data) : null; },
    async addVersion(id, version, data, keep) {
      await q(upsert('pw_report_versions', ['id', 'stamp'], ['data']), [id, version, data]);
      const old = (await q('SELECT stamp FROM pw_report_versions WHERE id = ? ORDER BY stamp DESC', [id])).slice(keep);
      for (const r of old) await q('DELETE FROM pw_report_versions WHERE id = ? AND stamp = ?', [id, r.stamp]);
    },

    // A lease is taken in one statement: when it is free, has expired, or is already ours.
    async lease(name, owner, ttl) {
      const now = Date.now();
      if (dialect === 'mysql') {
        // assignments run left to right: owner first, then expires_at only when we now hold it
        await q('INSERT INTO pw_leases (name, owner, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner = IF(owner = VALUES(owner) OR expires_at < ?, VALUES(owner), owner), expires_at = IF(owner = VALUES(owner), VALUES(expires_at), expires_at)', [name, owner, now + ttl, now]);
      } else {
        await q('INSERT INTO pw_leases (name, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE pw_leases.owner = excluded.owner OR pw_leases.expires_at < ?', [name, owner, now + ttl, now]);
      }
      const [r] = await q('SELECT owner FROM pw_leases WHERE name = ?', [name]);
      return r?.owner === owner;
    },
    async release(name, owner) { await q('DELETE FROM pw_leases WHERE name = ? AND owner = ?', [name, owner]); },
  };
}
