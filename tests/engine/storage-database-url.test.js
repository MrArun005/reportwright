// DATABASE_URL is the storage only on Vercel or with PW_STORAGE_FROM_DATABASE_URL=1; never on other hosts.
import { describe, it, expect } from 'vitest';
import { applyDatabaseUrlFallback } from '../../src/server/storage/index.js';

const URL_ = 'postgres://user:pw@db.example/app';
describe('DATABASE_URL storage fallback', () => {
  it('is not used on an arbitrary host', () => {
    const env = { DATABASE_URL: URL_ };
    expect(applyDatabaseUrlFallback(env)).toBe(false);
    expect(env.PW_STORAGE).toBeUndefined();
  });
  it('is used on Vercel', () => {
    const env = { DATABASE_URL: URL_, VERCEL: '1' };
    expect(applyDatabaseUrlFallback(env)).toBe(true);
    expect(env.PW_STORAGE).toBe(URL_);
  });
  it('is used with PW_STORAGE_FROM_DATABASE_URL=1', () => {
    const env = { DATABASE_URL: URL_, PW_STORAGE_FROM_DATABASE_URL: '1' };
    expect(applyDatabaseUrlFallback(env)).toBe(true);
    expect(env.PW_STORAGE).toBe(URL_);
  });
  it('ignores other flag values', () => {
    const env = { DATABASE_URL: URL_, PW_STORAGE_FROM_DATABASE_URL: 'true' };
    expect(applyDatabaseUrlFallback(env)).toBe(false);
    expect(env.PW_STORAGE).toBeUndefined();
  });
  it('never overrides an explicit PW_STORAGE', () => {
    const env = { DATABASE_URL: URL_, VERCEL: '1', PW_STORAGE: 'sqlite:/tmp/x.db' };
    expect(applyDatabaseUrlFallback(env)).toBe(false);
    expect(env.PW_STORAGE).toBe('sqlite:/tmp/x.db');
  });
});
