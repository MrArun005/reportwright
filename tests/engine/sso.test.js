// Enterprise 4: single sign-on. OIDC against a local mock provider, SAML against a test IdP with its own certificate.
// The good path makes the account, maps role and groups and signs in; every forged, stale, replayed or misdirected
// answer is refused, and nobody is signed in by it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startOidc, testCert, assertionXml, signAssertion, responseXml, b64 } from '../fixtures/mock-idp.js';

const BASE = 'http://pw.test';
const ACS = `${BASE}/api/auth/saml/acs`;
const SP = `${BASE}/api/auth/saml/metadata`;
const IDP = 'https://idp.example.com/saml';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sso-'));
let oidc, idp, other, users, session, routes;
const saved = {};
const ENV = (o) => ({
  PW_AUTH: 'users', PW_SESSION_SECRET: 'q'.repeat(40), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, 'sso.db')}`,
  PW_OIDC_ISSUER: o.issuer, PW_OIDC_CLIENT_ID: o.clientId, PW_OIDC_CLIENT_SECRET: o.clientSecret, PW_OIDC_ALLOW_HTTP: '1',
  PW_SAML_ENTRY_POINT: 'https://idp.example.com/sso', PW_SAML_IDP_CERT: idp.cert, PW_SAML_IDP_ISSUER: IDP,
  PW_SSO_ROLE_MAP: 'pw-admins=admin,pw-design=designer', PW_SSO_DEFAULT_ROLE: 'viewer',
});

beforeAll(async () => {
  idp = testCert('Test IdP');
  other = testCert('Someone else');
  oidc = await startOidc();
  for (const [k, v] of Object.entries(ENV(oidc))) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  routes = {
    oidcStart: (await import('../../app/api/auth/oidc/start/route.js')).GET,
    oidcCallback: (await import('../../app/api/auth/oidc/callback/route.js')).GET,
    samlLogin: (await import('../../app/api/auth/saml/login/route.js')).GET,
    acs: (await import('../../app/api/auth/saml/acs/route.js')).POST,
    finish: (await import('../../app/api/auth/saml/finish/route.js')).GET,
    metadata: (await import('../../app/api/auth/saml/metadata/route.js')).GET,
    login: (await import('../../app/api/auth/login/route.js')).POST,
  };
});
afterAll(async () => {
  await oidc.close();
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cookieOf = (res, name) => (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || '']).map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`) && c.length > name.length + 1) || null;
/** The signed-in email for a response that set pw_session, or null. */
const signedInAs = async (res) => {
  const c = cookieOf(res, 'pw_session');
  if (!c) return null;
  return (await session.currentUser(new Request(BASE, { headers: { cookie: c } })))?.email || null;
};

/* ---------------- OIDC ---------------- */

async function oidcSignIn({ tamper = {}, user, cookieOverride, stateOverride } = {}) {
  oidc.state.tamper = tamper;
  if (user) oidc.state.user = { sub: user.email, email_verified: true, groups: [], ...user };
  const start = await routes.oidcStart(new Request(`${BASE}/api/auth/oidc/start?next=/viewer/sales`));
  expect(start.status).toBe(302);
  const cookie = cookieOverride ?? cookieOf(start, 'pw_sso');
  const back = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const cb = new URL(back.headers.get('location'));
  if (stateOverride) cb.searchParams.set('state', stateOverride);
  const res = await routes.oidcCallback(new Request(cb.href.replace(cb.origin, BASE), { headers: cookie ? { cookie } : {} }));
  return { res, start, cb };
}

describe('OpenID Connect', () => {
  it('sends the browser to the provider with PKCE (S256), state and nonce', async () => {
    const start = await routes.oidcStart(new Request(`${BASE}/api/auth/oidc/start?next=/x`));
    const u = new URL(start.headers.get('location'));
    expect(u.origin).toBe(oidc.issuer);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'pagewright', redirect_uri: `${BASE}/api/auth/oidc/callback`, code_challenge_method: 'S256', scope: 'openid email profile' });
    expect(u.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
    expect(u.searchParams.get('nonce')).toMatch(/^[\w-]{40,}$/);
    const set = start.headers.get('set-cookie');
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).not.toContain(u.searchParams.get('state')); // signed, not readable as plain text
  });

  it('signs in, makes the account with the mapped role and groups, and goes on to next', async () => {
    const { res } = await oidcSignIn({ user: { sub: 'olga', email: 'Olga@Example.com', groups: ['pw-design', 'finance', 'bad/group'] } });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/viewer/sales`);
    expect(await signedInAs(res)).toBe('olga@example.com');
    const u = await users.getUser('olga@example.com');
    expect(u).toMatchObject({ role: 'designer', groups: ['finance', 'pw-design'], sso: { via: 'oidc', issuer: oidc.issuer, subject: 'olga' }, passwordHash: null });
    // the IdP is the source of truth: the next sign-in updates role and groups
    const again = await oidcSignIn({ user: { sub: 'olga', email: 'olga@example.com', groups: ['pw-admins'] } });
    expect(await signedInAs(again.res)).toBe('olga@example.com');
    expect(await users.getUser('olga@example.com')).toMatchObject({ role: 'admin', groups: ['pw-admins'] });
    // an SSO account has no password: password sign-in cannot open it
    const pw = await routes.login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'olga@example.com', password: 'anything at all' }) }));
    expect(pw.status).toBe(401);
  });

  const refused = async (o, code) => {
    const { res } = await oidcSignIn(o);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/login?sso_error=${code}`);
    expect(cookieOf(res, 'pw_session')).toBe(null);
  };
  const user = { email: 'mallory@example.com' };
  it('refuses a wrong issuer, audience, nonce, an expired token, another key, alg none or HS256', async () => {
    await refused({ user, tamper: { iss: 'https://evil.example.com' } }, 'id_token');
    await refused({ user, tamper: { aud: 'another-client' } }, 'id_token');
    await refused({ user, tamper: { nonce: 'not-the-nonce' } }, 'nonce');
    await refused({ user, tamper: { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 } }, 'id_token');
    await refused({ user, tamper: { otherKey: true } }, 'id_token');
    await refused({ user, tamper: { alg: 'none' } }, 'id_token');
    await refused({ user, tamper: { alg: 'HS256' } }, 'id_token');
    await refused({ user, tamper: { aud: ['pagewright', 'another-client'] } }, 'azp'); // several audiences need azp
    expect(await users.getUser('mallory@example.com')).toBe(null);
  });
  it('refuses a state from another browser, no cookie at all, and an unverified email', async () => {
    await refused({ user, stateOverride: 'x'.repeat(43) }, 'state');
    await refused({ user, cookieOverride: '' }, 'state');
    const evil = await oidcSignIn({ user }); // a different browser's cookie
    expect(evil.res.status).toBe(303);
    await refused({ user: { email: 'unverified@example.com', email_verified: false } }, 'email');
  });
  it('a provider error comes back as a refusal', async () => {
    const start = await routes.oidcStart(new Request(`${BASE}/api/auth/oidc/start`));
    const res = await routes.oidcCallback(new Request(`${BASE}/api/auth/oidc/callback?error=access_denied&state=x`, { headers: { cookie: cookieOf(start, 'pw_sso') } }));
    expect(res.headers.get('location')).toBe(`${BASE}/login?sso_error=idp`);
  });
  it('PW_SSO_DEFAULT_ROLE=none refuses someone the IdP gives no mapped group', async () => {
    process.env.PW_SSO_DEFAULT_ROLE = 'none';
    try { await refused({ user: { email: 'nobody@example.com', groups: ['other'] } }, 'no_role'); }
    finally { process.env.PW_SSO_DEFAULT_ROLE = 'viewer'; }
  });
  it('a disabled account stays out', async () => {
    await oidcSignIn({ user: { email: 'gone@example.com' } });
    await users.updateUser('gone@example.com', { disabled: true });
    await refused({ user: { email: 'gone@example.com' } }, 'disabled');
  });
});

/* ---------------- SAML ---------------- */

async function samlBegin(next = '/viewer/sales') {
  const r = await routes.samlLogin(new Request(`${BASE}/api/auth/saml/login?next=${encodeURIComponent(next)}`));
  expect(r.status).toBe(302);
  const cookie = cookieOf(r, 'pw_sso');
  const rid = session.readToken(cookie.split('=')[1]).rid;
  return { cookie, rid, location: r.headers.get('location') };
}
const post = (xml) => routes.acs(new Request(ACS, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.example.com' }, body: new URLSearchParams({ SAMLResponse: b64(xml) }) }));
const signed = (o, key = idp.key, cert = idp.cert) => signAssertion(assertionXml({ issuer: IDP, audience: SP, recipient: ACS, ...o }), key, cert);
const respond = (rid, assertion, extra = {}) => responseXml({ issuer: IDP, destination: ACS, inResponseTo: rid, assertion, ...extra });

/** Post a response and, if the ACS accepts it, finish with `cookie`. Returns { acs, fin, email }. */
async function samlComplete(xml, cookie) {
  const acs = await post(xml);
  expect(acs.status).toBe(303);
  const loc = acs.headers.get('location');
  if (!loc.includes('/api/auth/saml/finish')) return { acs, loc, email: null };
  const fin = await routes.finish(new Request(loc, { headers: cookie ? { cookie } : {} }));
  return { acs, fin, loc: fin.headers.get('location'), email: await signedInAs(fin) };
}

describe('SAML 2.0', () => {
  it('publishes SP metadata that asks for signed assertions', async () => {
    const xml = await (await routes.metadata(new Request(`${BASE}/api/auth/saml/metadata`))).text();
    expect(xml).toContain(`entityID="${SP}"`);
    expect(xml).toContain('WantAssertionsSigned="true"');
    expect(xml).toContain(`Location="${ACS}"`);
  });

  it('signs in with a signed assertion, maps role and groups, and goes on to next', async () => {
    const { cookie, rid, location } = await samlBegin();
    expect(location).toMatch(/^https:\/\/idp\.example\.com\/sso\?SAMLRequest=/);
    const r = await samlComplete(respond(rid, signed({ email: 'sam@example.com', inResponseTo: rid, groups: ['pw-admins', 'ops'] })), cookie);
    expect(r.email).toBe('sam@example.com');
    expect(r.loc).toBe(`${BASE}/viewer/sales`);
    expect(await users.getUser('sam@example.com')).toMatchObject({ role: 'admin', groups: ['ops', 'pw-admins'], sso: { via: 'saml', issuer: IDP } });
  });

  const refusedSaml = async (build, why, reason) => {
    const { cookie, rid } = await samlBegin();
    const r = await samlComplete(build(rid), cookie);
    expect(r.email, why).toBe(null);
    expect(r.loc, why).toMatch(/\/login\?sso_error=/);
    const { queryAudit } = await import('../../src/server/audit.js');
    if (reason) expect((await queryAudit({ type: 'auth.sso_failed', limit: 1 }))[0]?.detail?.reason, why).toMatch(reason); // refused for the right reason
    return r;
  };
  const eve = 'eve@example.com';
  it('requires a signed assertion: unsigned, another key or a changed one are refused', async () => {
    await refusedSaml((rid) => respond(rid, assertionXml({ issuer: IDP, audience: SP, recipient: ACS, email: eve, inResponseTo: rid })), 'unsigned', /Invalid signature/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid }, other.key, other.cert)), 'other key', /Invalid signature/);
    await refusedSaml((rid) => respond(rid, signed({ email: 'eve@example.com', inResponseTo: rid, groups: ['ops'] }).replace('>ops<', '>pw-admins<')), 'changed after signing', /Invalid signature/);
    await refusedSaml((rid) => respond(rid, signed({ email: 'eve@example.com', inResponseTo: rid }).replace(/eve@example\.com/g, 'admin@example.com')), 'changed email', /Invalid signature/);
    expect(await users.getUser('admin@example.com')).toBe(null);
  });

  it('is not fooled by signature wrapping', async () => {
    // XSW: the legitimate signed assertion for eve, plus an unsigned one for the admin, in every arrangement
    const evil = (rid, id) => assertionXml({ id, issuer: IDP, audience: SP, recipient: ACS, email: 'admin@example.com', inResponseTo: rid, groups: ['pw-admins'] });
    const good = (rid) => signed({ id: '_good1', email: eve, inResponseTo: rid });
    const shapes = [
      (rid) => respond(rid, evil(rid) + good(rid)),                                              // evil first
      (rid) => respond(rid, good(rid) + evil(rid)),                                              // evil second
      (rid) => respond(rid, evil(rid, '_good1') + good(rid)),                                    // evil with the signed one's ID
      (rid) => respond(rid, evil(rid).replace('</saml:Assertion>', `<saml:Advice>${good(rid)}</saml:Advice></saml:Assertion>`)), // signed one inside the evil one
      (rid) => respond(rid, evil(rid), { extra: '' }).replace('<samlp:Status>', `<samlp:Extensions>${good(rid)}</samlp:Extensions><samlp:Status>`), // signed one in Extensions
    ];
    for (const [i, shape] of shapes.entries()) {
      const { cookie, rid } = await samlBegin();
      const r = await samlComplete(shape(rid), cookie);
      expect(r.email === null || r.email === eve, `shape ${i}: signed in as ${r.email}`).toBe(true);
    }
    expect(await users.getUser('admin@example.com')).toBe(null);
  });

  it('refuses a comment that would cut the signed email short', async () => {
    // the IdP signed "admin@example.com.evil.net"; a comment inserted after "admin@example.com" leaves the signature valid
    const { cookie, rid } = await samlBegin();
    const xml = respond(rid, signed({ email: 'admin@example.com.evil.net', inResponseTo: rid })).replace(/admin@example\.com\.evil\.net/g, 'admin@example.com<!---->.evil.net');
    const r = await samlComplete(xml, cookie);
    expect(r.email).not.toBe('admin@example.com');
  });

  it('checks audience, recipient, destination, bearer method and time', async () => {
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid, audience: 'https://other-sp.example.com' })), 'audience', /audience mismatch/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid, recipient: 'https://other-sp.example.com/acs' })), 'recipient', /Recipient/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid }), { destination: 'https://other-sp.example.com/acs' }), 'destination', /Destination/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid, method: 'urn:oasis:names:tc:SAML:2.0:cm:holder-of-key' })), 'method', /Recipient/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid, notBefore: Date.now() - 3600000, notOnOrAfter: Date.now() - 1800000 })), 'expired', /No valid subject confirmation/);
    await refusedSaml((rid) => respond(rid, signed({ email: eve, inResponseTo: rid, notBefore: Date.now() + 1800000, notOnOrAfter: Date.now() + 3600000 })), 'not yet', /not yet valid/);
  });

  it('answers only requests this server made, each once, in the browser that made it', async () => {
    // unknown request id, and IdP-initiated (no InResponseTo)
    await refusedSaml(() => respond('_unknown', signed({ email: eve, inResponseTo: '_unknown' })), 'unknown request', /InResponseTo is not valid/);
    await refusedSaml(() => respond(null, signed({ email: eve })), 'idp-initiated', /InResponseTo is missing/);
    // replay: the same response twice
    const { cookie, rid } = await samlBegin();
    const xml = respond(rid, signed({ email: eve, inResponseTo: rid }));
    expect((await samlComplete(xml, cookie)).email).toBe(eve);
    expect((await samlComplete(xml, cookie)).email).toBe(null);
    // login CSRF: a valid response for the attacker's own sign-in, finished in the victim's browser (other cookie, or none)
    const attacker = await samlBegin();
    const victim = await samlBegin();
    const ax = respond(attacker.rid, signed({ email: 'attacker@example.com', inResponseTo: attacker.rid }));
    const acs = await post(ax);
    const loc = acs.headers.get('location');
    expect(loc).toMatch(/\/api\/auth\/saml\/finish\?h=/);
    for (const c of [victim.cookie, null]) {
      const fin = await routes.finish(new Request(loc, { headers: c ? { cookie: c } : {} }));
      expect(await signedInAs(fin)).toBe(null);
    }
    // and the handle is single use: the attacker's own browser cannot use it after the failed tries either
    expect(await signedInAs(await routes.finish(new Request(loc, { headers: { cookie: attacker.cookie } })))).toBe(null);
  });

  it('the ACS takes a cross-site POST (the IdP) but every other write still needs the same site', async () => {
    const { guard } = await import('../../src/server/access.js');
    expect(await guard(new Request(ACS, { method: 'POST', headers: { origin: 'https://idp.example.com' } }))).toBe(null);
    expect((await guard(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: 'https://idp.example.com' } })))?.status).toBe(403);
    expect((await guard(new Request(`${BASE}/api/auth/saml/acs/x`, { method: 'POST', headers: { origin: 'https://idp.example.com' } })))?.status).toBe(403);
  });
});

describe('review fixes: identities, linking, binding', () => {
  it('an SSO sign-in never takes over an existing password account (an admin must allow it first)', async () => {
    await users.createUser({ email: 'root@example.com', role: 'admin', password: 'root password 123' });
    const { res } = await oidcSignIn({ user: { sub: 'r1', email: 'root@example.com', groups: [] } });
    expect(res.headers.get('location')).toBe(`${BASE}/login?sso_error=linked`);
    expect(await users.getUser('root@example.com')).toMatchObject({ role: 'admin' }); // not demoted
    // SAML too
    const { cookie, rid } = await samlBegin();
    const r = await samlComplete(respond(rid, signed({ email: 'root@example.com', inResponseTo: rid })), cookie);
    expect(r.email).toBe(null);
    // an admin allows it: the next sign-in binds this IdP identity to the account, and keeps the password
    await users.updateUser('root@example.com', { allowSso: true });
    const ok = await oidcSignIn({ user: { sub: 'r1', email: 'root@example.com', groups: ['pw-admins'] } });
    expect(await signedInAs(ok.res)).toBe('root@example.com');
    expect((await users.getUser('root@example.com')).sso).toMatchObject({ via: 'oidc', issuer: oidc.issuer, subject: 'r1' });
    const { queryAudit } = await import('../../src/server/audit.js');
    expect((await queryAudit({ type: 'auth.sso_link', limit: 1 }))[0]).toMatchObject({ actor: 'user:root@example.com', detail: { method: 'oidc' } }); // the binding is in the log
  });

  it('an account is bound to one IdP identity (issuer, subject): another subject with the same email is refused', async () => {
    const first = await oidcSignIn({ user: { sub: 'alice-1', email: 'alice@example.com' } });
    expect(await signedInAs(first.res)).toBe('alice@example.com');
    const other = await oidcSignIn({ user: { sub: 'someone-else', email: 'alice@example.com' } });
    expect(other.res.headers.get('location')).toBe(`${BASE}/login?sso_error=linked`);
    // the SAML IdP asserting the same email is another identity too
    const { cookie, rid } = await samlBegin();
    expect((await samlComplete(respond(rid, signed({ email: 'alice@example.com', inResponseTo: rid })), cookie)).email).toBe(null);
    // the same subject with a new email at the IdP is still the same account
    const moved = await oidcSignIn({ user: { sub: 'alice-1', email: 'alice.new@example.com' } });
    expect(await signedInAs(moved.res)).toBe('alice@example.com');
  });

  it('an assertion with no InResponseTo of its own cannot be bound to someone else\'s request', async () => {
    const attacker = await samlBegin();
    // a captured IdP-initiated assertion for the boss, wrapped in a Response that names the attacker's request
    const xml = respond(attacker.rid, signed({ email: 'boss@example.com', groups: ['pw-admins'] }));
    expect((await samlComplete(xml, attacker.cookie)).email).toBe(null);
    expect(await users.getUser('boss@example.com')).toBe(null);
  });

  it('a NameID is the email only when its format says so; non-ASCII emails are refused', async () => {
    const { cookie, rid } = await samlBegin();
    const xml = respond(rid, signAssertion(assertionXml({ issuer: IDP, audience: SP, recipient: ACS, inResponseTo: rid, email: 'x', rawEmail: 'pat@example.com' }).replace(/<saml:Attribute Name="email">.*?<\/saml:Attribute>/, '').replace('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'), idp.key, idp.cert));
    expect((await samlComplete(xml, cookie)).email).toBe(null);
    await users.createUser({ email: 'kate@example.com', role: 'viewer', password: 'kate password 1' });
    const kelvin = await oidcSignIn({ user: { sub: 'k1', email: 'Kate@example.com' } });
    expect(kelvin.res.headers.get('location')).toMatch(/sso_error=/);
    expect(() => users.normEmail('Kate@example.com')).toThrow();
  });

  it('PW_SSO_ALLOWED_DOMAINS limits who may sign in', async () => {
    process.env.PW_SSO_ALLOWED_DOMAINS = 'example.com, corp.example';
    try {
      const out = await oidcSignIn({ user: { sub: 'o1', email: 'outsider@gmail.com' } });
      expect(out.res.headers.get('location')).toBe(`${BASE}/login?sso_error=domain`);
      expect(await signedInAs((await oidcSignIn({ user: { sub: 'c1', email: 'carl@corp.example' } })).res)).toBe('carl@corp.example');
    } finally { delete process.env.PW_SSO_ALLOWED_DOMAINS; }
  });

  it('refuses an azp that is not this client, even with one audience', async () => {
    const { res } = await oidcSignIn({ user: { sub: 'z1', email: 'zed@example.com' }, tamper: { azp: 'another-client' } });
    expect(res.headers.get('location')).toBe(`${BASE}/login?sso_error=azp`);
  });

  it('an unverified OIDC email is refused, whatever the settings', async () => {
    process.env.PW_OIDC_TRUST_EMAIL = '1';
    try {
      const { res } = await oidcSignIn({ user: { sub: 'u1', email: 'unverified2@example.com', email_verified: false } });
      expect(res.headers.get('location')).toBe(`${BASE}/login?sso_error=email`);
      expect(await users.getUser('unverified2@example.com')).toBe(null);
    } finally { delete process.env.PW_OIDC_TRUST_EMAIL; }
  });

  it('accounts are scoped per IdP: the same subject from another protocol or issuer is another identity', async () => {
    const { upsertSsoUser } = await import('../../src/server/sso.js');
    const id = (email, issuer = 'https://idp.one', subject = 'same-subject') => ({ email, role: 'viewer', groups: [], issuer, subject });
    expect(await upsertSsoUser({ ...id('first@example.com'), role: 'admin' }, 'oidc')).toBe('first@example.com');
    // a SAML NameID, or another OIDC issuer, that happens to equal that sub does not sign in as first@
    expect(await upsertSsoUser(id('second@example.com'), 'saml')).toBe('second@example.com');
    expect(await upsertSsoUser(id('third@example.com', 'https://idp.two'), 'oidc')).toBe('third@example.com');
    // and asserting first@'s email from there is refused (an attacker IdP naming a victim)
    await expect(upsertSsoUser(id('first@example.com', 'https://idp.two', 'attacker'), 'oidc')).rejects.toMatchObject({ code: 'linked' });
    await expect(upsertSsoUser(id('first@example.com', 'https://idp.one', 'attacker'), 'saml')).rejects.toMatchObject({ code: 'linked' });
    expect(await users.getUser('first@example.com')).toMatchObject({ role: 'admin', sso: { via: 'oidc', issuer: 'https://idp.one', subject: 'same-subject' } });
  });

  it('two first sign-ins for one email at the same moment: one account, bound to one identity', async () => {
    const { upsertSsoUser } = await import('../../src/server/sso.js');
    const id = (subject) => ({ email: 'twin@example.com', role: 'viewer', groups: [], issuer: 'https://idp.one', subject });
    const out = await Promise.allSettled([upsertSsoUser(id('twin-a'), 'oidc'), upsertSsoUser(id('twin-b'), 'oidc')]);
    expect(out.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    const won = out[0].status === 'fulfilled' ? 'twin-a' : 'twin-b';
    expect((await users.getUser('twin@example.com')).sso.subject).toBe(won);
  });

  it('starting SAML sign-ins is rate-limited per address', async () => {
    let last;
    for (let i = 0; i < 70; i++) last = await routes.samlLogin(new Request(`${BASE}/api/auth/saml/login`, { headers: { 'x-forwarded-for': '198.51.100.7' } }));
    expect(last.status).toBe(429);
    expect((await routes.samlLogin(new Request(`${BASE}/api/auth/saml/login`, { headers: { 'x-forwarded-for': '198.51.100.8' } }))).status).toBe(302);
  });
});

describe('password sign-in can be turned off when SSO is on', () => {
  it('PW_PASSWORD_LOGIN=off refuses password sign-in (and only while SSO is set up)', async () => {
    await users.createUser({ email: 'pw@example.com', role: 'viewer', password: 'a long password' });
    const login = () => routes.login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw@example.com', password: 'a long password' }) }));
    process.env.PW_PASSWORD_LOGIN = 'off';
    try {
      expect((await login()).status).toBe(403);
      const keep = { i: process.env.PW_OIDC_ISSUER, e: process.env.PW_SAML_ENTRY_POINT };
      delete process.env.PW_OIDC_ISSUER; delete process.env.PW_SAML_ENTRY_POINT;
      try { expect((await login()).status).toBe(200); } finally { process.env.PW_OIDC_ISSUER = keep.i; process.env.PW_SAML_ENTRY_POINT = keep.e; }
    } finally { delete process.env.PW_PASSWORD_LOGIN; }
  });
});
