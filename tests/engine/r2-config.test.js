// R2 A-7: one table of settings (src/server/config.js), checked at boot; one switch for development behaviour.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SETTINGS, checkConfig, devMode } from '../../src/server/config.js';

const ROOT = path.join(import.meta.dirname, '../..');
const files = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(n => (n.isDirectory() ? files(`${d}/${n.name}`) : /\.(m?js|jsx)$/.test(n.name) ? [`${d}/${n.name}`] : []));

it('every PW_ setting the code reads is in the table, and the table is in docs/CONFIG.md', () => {
  const names = new Set(SETTINGS.map(s => s[0]));
  const doc = fs.readFileSync(path.join(ROOT, 'docs/CONFIG.md'), 'utf8');
  const missing = new Set();
  for (const f of [...files('src'), ...files('app'), ...files('scripts'), ...files('bin'), 'proxy.js', 'instrumentation.js', 'next.config.mjs']) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/(?<![_A-Za-z])PW_[A-Z0-9_]*[A-Z0-9](?![A-Za-z0-9_])/g)) {
      if (!names.has(m[0]) && !/^PW_DB_/.test(m[0])) missing.add(`${m[0]} (${f})`);
    }
  }
  expect([...missing]).toEqual([]);
  for (const n of names) expect(doc, n).toContain(`\`${n}\``);
});

it('checkConfig: typos, wrong kinds, dangerous production values, short secrets', () => {
  const r = checkConfig({ NODE_ENV: 'production', PW_RENDR_WORKERS: '2', PW_RENDER_WORKERS: 'many', PW_PUBLIC_READONLY: '1', PW_FIXED_FETCH_HOSTS: '0', PW_AUTH: 'users', PW_SESSION_SECRET: 'short', PW_TRUSTED_PROXIES: '0.0.0.0/0' });
  expect(r.warnings.join('\n')).toMatch(/PW_RENDR_WORKERS is not a ReportWright setting/);
  expect(r.warnings.join('\n')).toMatch(/PW_RENDER_WORKERS="many" is not a number/);
  expect(r.warnings.join('\n')).toMatch(/PW_PUBLIC_READONLY=1/);
  expect(r.warnings.join('\n')).toMatch(/PW_FIXED_FETCH_HOSTS=0/);
  expect(r.warnings.join('\n')).toMatch(/trusts every address/);
  expect(r.errors).toEqual(['PW_SESSION_SECRET is shorter than 32 characters.']);
  expect(checkConfig({ NODE_ENV: 'production', PW_MODE: 'staging' }).errors[0]).toMatch(/PW_MODE/);
  expect(checkConfig({ NODE_ENV: 'development', PW_PUBLIC_READONLY: '1' }).warnings).toEqual([]); // dev: not reported
  expect(checkConfig({ PW_DB_MAIN: 'sqlite:/x.db', PW_DB_MAIN_PROCS: 'a' }).warnings.filter(w => /not a ReportWright/.test(w))).toEqual([]);
});

it('devMode: explicit PW_MODE, else only NODE_ENV development or test; anything else is production', () => {
  const keep = { m: process.env.PW_MODE, n: process.env.NODE_ENV };
  const set = (m, n) => { if (m === undefined) delete process.env.PW_MODE; else process.env.PW_MODE = m; if (n === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = n; };
  try {
    set(undefined, 'staging'); expect(devMode()).toBe(false);
    set(undefined, undefined); expect(devMode()).toBe(false);
    set(undefined, 'development'); expect(devMode()).toBe(true);
    set('prod', 'development'); expect(devMode()).toBe(false);
    set('dev', 'production'); expect(devMode()).toBe(true);
  } finally { set(keep.m, keep.n); }
});
