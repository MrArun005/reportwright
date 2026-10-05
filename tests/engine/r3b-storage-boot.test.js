// R3-B: several server processes booting at once on a fresh SQLite storage file all come up (cluster.mjs first boot
// failed with "database is locked" while every process made the tables and ran the migrations at the same moment).
// Also item 6: the SQLite storage file (and its -wal/-shm) is created 0600.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-boot-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const mod = pathToFileURL(path.resolve('src/server/storage/index.js')).href;

/** One "server": waits for the shared start time, opens storage, writes and reads one record. */
const boot = (file, at, i) => new Promise((resolve) => {
  const code = `
    const { store } = await import(${JSON.stringify(mod)});
    while (Date.now() < ${at}) {}
    const s = store();
    await s.put('settings', 'p${i}', JSON.stringify({ i: ${i} }));
    await s.lease('lock:boot', 'p${i}', 1000);
    const got = await s.get('settings', 'p${i}');
    process.stdout.write(got ? 'ok' : 'missing');`;
  const cp = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, PW_STORAGE: `sqlite:${file}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  cp.stdout.on('data', d => (out += d));
  cp.stderr.on('data', d => (err += d));
  cp.on('exit', (code) => resolve({ code, out, err }));
});

describe('first boot on a fresh SQLite storage file', () => {
  it('4 processes starting at the same moment all come up (no "database is locked")', async () => {
    for (let round = 0; round < 3; round++) {
      const file = path.join(dir, `fresh-${round}.db`);
      const at = Date.now() + 1500;
      const r = await Promise.all([0, 1, 2, 3].map(i => boot(file, at, i)));
      for (const x of r) expect(x, x.err).toMatchObject({ code: 0, out: 'ok' });
    }
  }, 60000);
  it('the storage file and its WAL files are readable by this user only (0600)', async () => {
    const file = path.join(dir, 'mode.db');
    const r = await boot(file, 0, 9);
    expect(r, r.err).toMatchObject({ code: 0, out: 'ok' });
    for (const f of [file, `${file}-wal`, `${file}-shm`].filter(f => fs.existsSync(f))) expect((fs.statSync(f).mode & 0o777).toString(8), f).toBe('600');
  });
});

describe('a cluster process whose storage cannot open exits (the primary replaces it)', () => {
  it('instrumentation register() exits with PW_CLUSTER=1; throws otherwise', async () => {
    const code = `
      process.env.NEXT_RUNTIME = 'nodejs';
      const { register } = await import(${JSON.stringify(pathToFileURL(path.resolve('instrumentation.js')).href)});
      try { await register(); process.stdout.write('started'); } catch (e) { process.stdout.write('threw'); }`;
    const run = (env) => new Promise((resolve) => {
      const cp = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, PW_STORAGE: 'sqlite:/nonexistent-dir/x/pw.db', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; cp.stdout.on('data', d => (out += d)); cp.on('exit', (c) => resolve({ code: c, out }));
    });
    expect(await run({ PW_CLUSTER: '1' })).toMatchObject({ code: 1, out: '' });
    expect((await run({})).out).toBe('threw');
  }, 30000);
});
