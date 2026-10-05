// Batch 5, item 3: SAML single logout (SP- and IdP-initiated, signed both ways) and OIDC RP-initiated logout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { testCert, startOidc } from '../fixtures/mock-idp.js';

const BASE = 'http://pw.test';
const IDP = 'https://idp.example.com/saml';
const IDP_SLO = 'https://idp.example.com/slo';
const SLO = `${BASE}/api/auth/saml/slo`;
const SP = `${BASE}/api/auth/saml/metadata`;
const NAMEID_FMT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-slo-'));
const saved = {};
let idp, sp, other, oidc, users, session, R, store;

beforeAll(async () => {
  idp = testCert('IdP'); sp = testCert('SP'); other = testCert('Mallory');
  oidc = await startOidc();
  const ENV = {
    PW_AUTH: 'users', PW_SESSION_SECRET: 's'.repeat(40), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, 'slo.db')}`,
    PW_SAML_ENTRY_POINT: 'https://idp.example.com/sso', PW_SAML_IDP_CERT: idp.cert, PW_SAML_IDP_ISSUER: IDP,
    PW_SAML_LOGOUT_URL: IDP_SLO, PW_SAML_SP_KEY: sp.key, PW_SAML_SP_CERT: sp.cert,
    PW_OIDC_ISSUER: oidc.issuer, PW_OIDC_CLIENT_ID: oidc.clientId, PW_OIDC_CLIENT_SECRET: oidc.clientSecret, PW_OIDC_ALLOW_HTTP: '1',
  };
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  ({ store } = await import('../../src/server/storage/index.js'));
  R = { logout: (await import('../../app/api/auth/logout/route.js')).POST, slo: await import('../../app/api/auth/saml/slo/route.js'), metadata: (await import('../../app/api/auth/saml/metadata/route.js')).GET };
  await users.createUser({ email: 'bob@x.test', role: 'viewer', sso: { via: 'saml', issuer: IDP, subject: `${NAMEID_FMT}|bob@x.test` } });
  await users.createUser({ email: 'olly@x.test', role: 'viewer', sso: { via: 'oidc', issuer: oidc.issuer, subject: 'o1' } });
});
afterAll(async () => {
  await oidc.close();
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const req = (url, o = {}) => new Request(url, { headers: { origin: BASE, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers || {}) }, method: o.method || 'GET', body: o.body });
const cookies = (res) => (res.headers.getSetCookie() || []).map(c => c.split(';')[0]);
const cookieOf = (res, n) => cookies(res).find(c => c.startsWith(`${n}=`) && c.length > n.length + 1) || null;
const who = async (cookie) => (await session.currentUser(new Request(BASE, { headers: { cookie } })))?.email || null;
const sessionFor = async (email, s) => session.sessionCookie(new Request(BASE), await users.getUser(email), { s }).split(';')[0];
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const NS = 'xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"';
/** A query signed as the HTTP-Redirect binding does. */
function redirectQuery(kind, xml, key, { relay, alg = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', unsigned = false } = {}) {
  let q = `${kind}=${encodeURIComponent(zlib.deflateRawSync(Buffer.from(xml)).toString('base64'))}`;
  if (relay) q += `&RelayState=${encodeURIComponent(relay)}`;
  if (unsigned) return q;
  q += `&SigAlg=${encodeURIComponent(alg)}`;
  return `${q}&Signature=${encodeURIComponent(crypto.createSign('RSA-SHA256').update(q).sign(key, 'base64'))}`;
}
/** Parse a signed redirect our server made, checking its signature with the SP certificate. */
function readRedirect(url) {
  const u = new URL(url);
  const q = u.search.slice(1);
  const sig = new URLSearchParams(q).get('Signature');
  const signed = q.slice(0, q.indexOf('&Signature='));
  expect(crypto.createVerify('RSA-SHA256').update(signed).verify(sp.cert, Buffer.from(sig, 'base64'))).toBe(true);
  const p = new URLSearchParams(q);
  const kind = p.has('SAMLRequest') ? 'SAMLRequest' : 'SAMLResponse';
  return { origin: `${u.origin}${u.pathname}`, kind, xml: zlib.inflateRawSync(Buffer.from(p.get(kind), 'base64')).toString(), relay: p.get('RelayState') };
}
const logoutResponse = (inResponseTo, o = {}) => `<samlp:LogoutResponse ${NS} ID="_r${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${o.at || iso()}" Destination="${o.dest || SLO}" InResponseTo="${inResponseTo}"><saml:Issuer>${o.issuer || IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status></samlp:LogoutResponse>`;
const logoutRequest = (o = {}) => `<samlp:LogoutRequest ${NS} ID="${o.id || `_q${crypto.randomBytes(8).toString('hex')}`}" Version="2.0" IssueInstant="${o.at || iso()}" Destination="${o.dest || SLO}"><saml:Issuer>${o.issuer || IDP}</saml:Issuer><saml:NameID Format="${NAMEID_FMT}">${o.nameID || 'bob@x.test'}</saml:NameID><samlp:SessionIndex>s1</samlp:SessionIndex></samlp:LogoutRequest>`;

describe('SAML single logout, SP-initiated', () => {
  let rid, sloCookie;
  it('signing out of a SAML session sends a signed LogoutRequest to the IdP', async () => {
    const c = await sessionFor('bob@x.test', 'saml');
    expect(await who(c)).toBe('bob@x.test');
    const res = await R.logout(req(`${BASE}/api/auth/logout`, { method: 'POST', cookie: c }));
    const body = await res.json();
    expect(await who(c)).toBe(null); // local sessions end first
    const m = readRedirect(body.redirect);
    expect(m.origin).toBe(IDP_SLO);
    expect(m.kind).toBe('SAMLRequest');
    expect(m.xml).toContain(`<saml:Issuer>${SP}</saml:Issuer>`);
    expect(m.xml).toContain(`Format="${NAMEID_FMT}">bob@x.test</saml:NameID>`);
    expect(m.xml).toContain(`Destination="${IDP_SLO}"`);
    rid = /ID="([^"]+)"/.exec(m.xml)[1];
    sloCookie = cookieOf(res, 'pw_slo');
    expect(sloCookie).toBeTruthy();
  });
  it('the IdP\'s signed LogoutResponse for this browser\'s request lands on the sign-in page', async () => {
    const res = await R.slo.GET(req(`${SLO}?${redirectQuery('SAMLResponse', logoutResponse(rid), idp.key)}`, { cookie: sloCookie }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/login`);
    const ev = (await (await import('../../src/server/audit.js')).queryAudit({ type: 'auth.slo', limit: 1 }))[0];
    expect(ev.detail).toMatchObject({ from: 'idp response', idpStatus: 'success' });
  });
  it('refuses unsigned, wrongly signed, replayed, stale, misdirected and foreign responses', async () => {
    const tries = [
      redirectQuery('SAMLResponse', logoutResponse(rid), idp.key, { unsigned: true }),
      redirectQuery('SAMLResponse', logoutResponse(rid), other.key),
      redirectQuery('SAMLResponse', logoutResponse(rid), idp.key, { alg: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' }),
      redirectQuery('SAMLResponse', logoutResponse(rid, { at: iso(Date.now() - 600000) }), idp.key),
      redirectQuery('SAMLResponse', logoutResponse(rid, { dest: 'https://evil.test/slo' }), idp.key),
      redirectQuery('SAMLResponse', logoutResponse(rid, { issuer: 'https://evil.test' }), idp.key),
    ];
    for (const q of tries) expect((await R.slo.GET(req(`${SLO}?${q}`, { cookie: sloCookie }))).status).toBeGreaterThanOrEqual(400);
    const q = redirectQuery('SAMLResponse', logoutResponse(rid), idp.key);
    expect((await R.slo.GET(req(`${SLO}?${q}`))).status).toBe(303);
    expect((await R.slo.GET(req(`${SLO}?${q}`))).status).toBe(401); // the same message again
    // a tampered signed part (another InResponseTo) fails the signature
    const t = q.replace(/^SAMLResponse=[^&]+/, `SAMLResponse=${encodeURIComponent(zlib.deflateRawSync(Buffer.from(logoutResponse('_other'))).toString('base64'))}`);
    expect((await R.slo.GET(req(`${SLO}?${t}`))).status).toBe(401);
  });
});

describe('SAML single logout, IdP-initiated', () => {
  it('a signed LogoutRequest (HTTP-Redirect) ends the account\'s sessions and is answered with a signed LogoutResponse', async () => {
    const c = await sessionFor('bob@x.test', 'saml');
    expect(await who(c)).toBe('bob@x.test');
    const res = await R.slo.GET(req(`${SLO}?${redirectQuery('SAMLRequest', logoutRequest({ id: '_idp1' }), idp.key, { relay: 'r1' })}`));
    expect(res.status).toBe(303);
    expect(await who(c)).toBe(null);
    const m = readRedirect(res.headers.get('location'));
    expect(m.origin).toBe(IDP_SLO);
    expect(m.kind).toBe('SAMLResponse');
    expect(m.xml).toContain('InResponseTo="_idp1"');
    expect(m.xml).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
    expect(m.relay).toBe('r1');
  });
  it('refuses an unsigned or foreign-signed request: nobody is signed out', async () => {
    const c = await sessionFor('bob@x.test', 'saml');
    for (const q of [redirectQuery('SAMLRequest', logoutRequest(), idp.key, { unsigned: true }), redirectQuery('SAMLRequest', logoutRequest(), other.key)]) {
      expect((await R.slo.GET(req(`${SLO}?${q}`))).status).toBe(401);
    }
    expect(await who(c)).toBe('bob@x.test');
  });
  it('HTTP-POST: a request signed by the IdP works; one signed by someone else does not', async () => {
    const sign = (xml, key, cert) => {
      const s = new SignedXml({ privateKey: key, publicCert: cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
      s.addReference({ xpath: "//*[local-name(.)='LogoutRequest']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
      s.computeSignature(xml, { location: { reference: "//*[local-name(.)='Issuer']", action: 'after' } });
      return s.getSignedXml();
    };
    const post = (xml) => R.slo.POST(new Request(SLO, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ SAMLRequest: Buffer.from(xml).toString('base64') }) }));
    const c = await sessionFor('bob@x.test', 'saml');
    expect((await post(sign(logoutRequest(), other.key, other.cert))).status).toBe(401);
    expect((await post(logoutRequest())).status).toBe(401);
    expect(await who(c)).toBe('bob@x.test');
    const res = await post(sign(logoutRequest({ id: '_post1' }), idp.key, idp.cert));
    expect(res.status).toBe(303);
    expect(await who(c)).toBe(null);
    expect(readRedirect(res.headers.get('location')).xml).toContain('InResponseTo="_post1"');
  });
  it('the metadata names the SLO address and the SP certificate', async () => {
    const xml = await (await R.metadata(req(SP))).text();
    expect(xml).toContain(`Location="${SLO}"`);
    expect(xml).toContain('SingleLogoutService');
    expect(xml).toContain(sp.cert.split('\n')[1].slice(0, 40));
  });
});

describe('OIDC RP-initiated logout', () => {
  it('signing out of an OIDC session goes to end_session_endpoint with id_token_hint, client_id and the return address', async () => {
    const c = await sessionFor('olly@x.test', 'oidc');
    const res = await R.logout(req(`${BASE}/api/auth/logout`, { method: 'POST', cookie: `${c}; pw_idt=aaa.bbb.ccc` }));
    const u = new URL((await res.json()).redirect);
    expect(`${u.origin}${u.pathname}`).toBe(`${oidc.issuer}/logout`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ id_token_hint: 'aaa.bbb.ccc', client_id: oidc.clientId, post_logout_redirect_uri: `${BASE}/login` });
    expect(cookies(res)).toContain('pw_idt=');
    expect(await who(c)).toBe(null);
  });
  it('PW_OIDC_LOGOUT=off keeps sign-out local; a password session never goes to an IdP', async () => {
    process.env.PW_OIDC_LOGOUT = 'off';
    try { expect((await (await R.logout(req(`${BASE}/api/auth/logout`, { method: 'POST', cookie: await sessionFor('olly@x.test', 'oidc') }))).json()).redirect).toBeUndefined(); }
    finally { delete process.env.PW_OIDC_LOGOUT; }
    await users.createUser({ email: 'pw@x.test', role: 'viewer', password: 'password pass 1' });
    expect((await (await R.logout(req(`${BASE}/api/auth/logout`, { method: 'POST', cookie: await sessionFor('pw@x.test') }))).json()).redirect).toBeUndefined();
  });
});
