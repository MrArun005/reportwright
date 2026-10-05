#!/usr/bin/env node
// Backup and restore of the server's storage (any backend: files, SQLite, Postgres, MySQL, SQL Server) as one SQLite
// file, through the same copy as `pw migrate-storage` (reports and versions, users, grants, folders, schedules, jobs,
// fonts, settings, blobs, the audit log with its chain). docs/OPS.md has the restore drill.
//   PW_STORAGE=postgres://… node scripts/backup.mjs backup [backups/pw-<time>.db]
//   PW_STORAGE=postgres://… node scripts/backup.mjs restore backups/pw-<time>.db [--force]   (server stopped)
// Restore refuses a storage that already holds reports or users unless --force (records with the same id are replaced).
import fs from 'node:fs';
import path from 'node:path';
import { copyStorage } from '../src/server/storage/copy.js';

const [cmd, file, flag] = process.argv.slice(2);
const live = process.env.PW_STORAGE || 'file';
// never print the storage's password: every line out (and any error) has user:password@ and the password itself masked
const secret = (() => { try { return decodeURIComponent(new URL(live).password || ''); } catch { return ''; } })();
const hide = (u) => { let t = String(u).replace(/\/\/[^@/\s]*@/g, '//***@'); if (secret) t = t.split(secret).join('***').split(encodeURIComponent(secret)).join('***'); return t; };
const say = (m) => process.stderr.write(`${hide(m)}\n`);
process.on('uncaughtException', (e) => { say(`backup failed: ${e?.message || e}`); process.exit(1); });
process.on('unhandledRejection', (e) => { say(`backup failed: ${/** @type {any} */ (e)?.message || e}`); process.exit(1); });

if (cmd === 'backup') {
  const out = path.resolve(file || `backups/pw-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  if (fs.existsSync(out)) { say(`${out} exists: pick a new file`); process.exit(2); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const n = await copyStorage(live, `sqlite:${out}`, say);
  console.log(hide(`backed up ${n.records} records, ${n.versions} versions, ${n.audit} audit events from ${hide(live)} to ${out}`));
} else if (cmd === 'restore' && file) {
  if (!fs.existsSync(file)) { say(`${file} not found`); process.exit(2); }
  const { store } = await import('../src/server/storage/index.js');
  const used = (await store().ids('reports')).length + (await store().ids('users')).length;
  if (used && flag !== '--force') { say(`${hide(live)} already holds ${used} reports and users: restore into an empty storage, or pass --force`); process.exit(2); }
  const n = await copyStorage(`sqlite:${path.resolve(file)}`, live, say);
  console.log(hide(`restored ${n.records} records, ${n.versions} versions, ${n.audit} audit events to ${live}`));
} else {
  say('node scripts/backup.mjs backup [out.db] | restore <in.db> [--force]   (the storage is PW_STORAGE, default the files here)');
  process.exit(2);
}
