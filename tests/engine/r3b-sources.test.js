// R3-B review finding: the permission check classifies data sources from the same normalised object the engine runs
// (perms.normalizeSource; renderer.js hands those objects to the engine), and an unknown type counts as privileged.
import { describe, it, expect, afterEach } from 'vitest';
import { serverSources, normalizeSource, assertMayStore } from '../../src/server/perms.js';

const keep = process.env.PW_INTERNAL_HOSTS;
afterEach(() => { if (keep === undefined) delete process.env.PW_INTERNAL_HOSTS; else process.env.PW_INTERNAL_HOSTS = keep; });
const privileged = (src) => serverSources({ dataSources: [{ name: 's', ...src }] }).length === 1;
const viewer = { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] };

describe('data source classification', () => {
  it('internal hosts in every spelling the URL parser accepts are privileged', () => {
    process.env.PW_INTERNAL_HOSTS = 'internal.host';
    for (const url of ['http://internal.host/x', 'HTTP://INTERNAL.HOST/x', '  http://internal.host/x', '//internal.host/x', 'http://intern\tal.host/x',
      'http://%69nternal.host/x', 'http://evil.com@internal.host/x', 'https://internal.host:8443/x', 'http://internal.host./x'.replace('host./', 'host/'),
      '=Parameters.u', ' =Parameters.u', 'http://{Parameters.h}/x', '{Parameters.base}/x', 'http:\\\\internal.host\\x'])
      expect(privileged({ type: 'rest', url }), JSON.stringify(url)).toBe(true);
    expect(privileged({ type: 'rest', url: 'http://internal.host@public.example/x' })).toBe(false); // the host is public.example
    expect(privileged({ type: 'rest', url: '/api/sample/sales' })).toBe(false); // this server
  });
  it('flags mean the same to both: a truthy useProxy is the proxy, inline data is inline', () => {
    process.env.PW_INTERNAL_HOSTS = 'internal.host';
    expect(normalizeSource({ type: 'rest', useProxy: 'false' }).useProxy).toBe(true); // the engine reads truthiness
    expect(privileged({ type: 'rest', url: 'http://internal.host/x', useProxy: 'yes' })).toBe(false); // via the public-only proxy
    expect(privileged({ type: 'rest', url: 'http://internal.host/x', useProxy: 0 })).toBe(true);
    expect(privileged({ type: 'csv', url: 'http://internal.host/x', data: '' })).toBe(true); // empty inline data: fetched
    expect(privileged({ type: 'csv', url: 'http://internal.host/x', data: 'a,b' })).toBe(false);
  });
  it('an unknown or ambiguous type is privileged (designer + stamp), SQL always', () => {
    for (const type of ['REST', 'rest ', 'Sql', 'sql ', 'graphQL', 'http', undefined, 7]) expect(privileged({ type, url: 'https://public.example/x' }), String(type)).toBe(true);
    expect(privileged({ type: 'sql', connection: 'main', query: 'select 1' })).toBe(true);
    expect(privileged({ type: 'json', data: [] })).toBe(false);
    expect(() => assertMayStore(viewer, { dataSources: [{ name: 's', type: 'REST', url: 'http://x' }] })).toThrow(/designer/);
  });
});

describe('thumbnail access classes (synthetic-user run: 10,983 placeholders for 202 drawings)', () => {
  it('viewers with the same role and groups share a class; one named in a grant, or another role, does not', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const keepEnv = { ...process.env };
    try {
      Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-class-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-class-')), 's.db')}` });
      const users = await import('../../src/server/users.js'), perms = await import('../../src/server/perms.js');
      for (const [e, role, groups] of [['a@x.io', 'viewer', ['sales']], ['b@x.io', 'viewer', ['sales']], ['c@x.io', 'viewer', ['ops']], ['d@x.io', 'designer', ['sales']], ['e@x.io', 'viewer', ['sales']]])
        await users.createUser({ email: e, role, groups, password: 'a long password 1' });
      const P = async (e) => perms.userPrincipal(e);
      const k = async (e) => perms.accessClass(await P(e));
      expect(await k('a@x.io')).toBe(await k('b@x.io'));
      expect(await k('a@x.io')).not.toBe(await k('c@x.io'));
      expect(await k('a@x.io')).not.toBe(await k('d@x.io'));
      const before = await k('a@x.io');
      await perms.createFolder({ kind: 'service' }, { name: 'F' }).then(f => perms.updateFolder({ kind: 'service' }, f.id, { grants: [{ to: 'user:e@x.io', level: 'view' }] }));
      expect(await k('e@x.io')).not.toBe(await k('a@x.io')); // named in a grant: a class of its own
      expect(await k('a@x.io')).not.toBe(before); // any grant change renews every class
    } finally { for (const x of Object.keys(process.env)) if (!(x in keepEnv)) delete process.env[x]; Object.assign(process.env, keepEnv); }
  });
});
