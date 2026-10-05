// @ts-check
// Single sign-on (enterprise item 4): OpenID Connect and SAML 2.0, for accounts (PW_AUTH=users).
//
// OIDC (PW_OIDC_ISSUER, PW_OIDC_CLIENT_ID, PW_OIDC_CLIENT_SECRET): authorization code with PKCE (S256). state, nonce
// and the PKCE verifier travel in a signed, 10-minute, HttpOnly cookie (pw_sso, SameSite=Lax: the IdP's redirect back
// is a top-level GET, which carries it). The ID token's signature is checked with jose against the issuer's JWKS
// (cached by jose), and its iss, aud (and azp when there are several audiences), exp, iat and nonce. Only asymmetric
// algorithms; never "none".
//
// SAML (PW_SAML_ENTRY_POINT, PW_SAML_IDP_CERT): @node-saml/node-saml checks the XML signature (signed assertions are
// required), the audience and the time conditions. The request this answers is in the signed pw_sso cookie of the
// browser that began it (nothing is stored per start); InResponseTo must name it, in the signed assertion. On top of that this module checks the Recipient and the Destination
// (the ACS URL), the bearer method, and uses each assertion ID once (a storage lease, so across servers too).
// The IdP posts the response from its own site, so the browser sends no Lax cookie with it: the ACS keeps the result
// under a one-time handle for 2 minutes and redirects to /api/auth/saml/finish, a top-level GET that carries the
// cookie set when this browser began the sign-in. The request ids must match: a response captured or made for one
// browser cannot sign in another (no login CSRF).
//
// Both: an account is bound to one IdP identity (OIDC iss + sub, SAML pinned issuer + NameID), never linked to another
// account by email (upsertSsoUser). Its email: OIDC's email, which must have email_verified; SAML's email attribute or
// an emailAddress-format NameID. Role and groups come from a claim or attribute (PW_OIDC_GROUPS_CLAIM, default
// "groups"; PW_SAML_GROUPS_ATTR, default "groups"), mapped by PW_SSO_ROLE_MAP ("idp-admins=admin,idp-design=designer");
// with no mapped value the role is PW_SSO_DEFAULT_ROLE (default viewer; "none" refuses the sign-in). IdP values that
// are valid group names become the user's groups. Users are made on first sign-in and updated on every sign-in.
// PW_PASSWORD_LOGIN=off turns password sign-in off while SSO is set up.
//
// Single logout. SAML (PW_SAML_LOGOUT_URL, the IdP's SLO endpoint, and PW_SAML_SP_KEY or PW_SAML_SP_KEY_FILE, a PEM
// private key; PW_SAML_SP_CERT[_FILE] goes in the metadata): signing out of a SAML session sends a signed LogoutRequest
// (HTTP-Redirect, RSA-SHA256) to the IdP, and its LogoutResponse comes back to /api/auth/saml/slo, where InResponseTo
// must be the request in this browser's signed pw_slo cookie. An IdP-initiated LogoutRequest (HTTP-Redirect or POST)
// must be signed by the IdP's certificate (unsigned is refused), from the pinned issuer, for our SLO address, recent,
// and is used once; it ends every session of the account bound to that NameID and is answered with a signed
// LogoutResponse. OIDC: signing out of an OIDC session goes to the provider's end_session_endpoint (RP-initiated logout)
// with the ID token as id_token_hint (kept in the HttpOnly pw_idt cookie, path /api/auth) and post_logout_redirect_uri
// = <PW_BASE_URL>/login; PW_OIDC_LOGOUT=off keeps sign-out local.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { signSession, readToken, sessionSecret, safeNext } from './session.js';
import { getUser, createUser, updateUser, normEmail, allUsers, ROLES, GROUP } from './users.js';
import { store, withLock } from './storage/index.js';
import { clientAddress } from './limits.js';
import { logWarn } from './errors.js';
import { BUILTIN_GROUPS, RENAMED_GROUP } from './perms.js';

const fail = (msg, status = 400, code = 'sso') => Object.assign(new Error(msg), { status, code });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const rand = (n = 32) => b64u(crypto.randomBytes(n));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

export const oidcOn = () => !!(process.env.PW_OIDC_ISSUER && process.env.PW_OIDC_CLIENT_ID);
// the IdP's entity id is required: an account is bound to (issuer, NameID), and the issuer must be pinned
export const samlOn = () => !!(process.env.PW_SAML_ENTRY_POINT && (process.env.PW_SAML_IDP_CERT || process.env.PW_SAML_IDP_CERT_FILE) && process.env.PW_SAML_IDP_ISSUER);
export const ssoOn = () => oidcOn() || samlOn();
/** Password sign-in is off only when SSO is set up (an admin cannot lock everyone out by a typo). */
export const passwordLoginOn = () => !(process.env.PW_PASSWORD_LOGIN === 'off' && ssoOn());
export const ssoLabels = () => ({ oidc: oidcOn() ? process.env.PW_OIDC_NAME || 'Single sign-on' : null, saml: samlOn() ? process.env.PW_SAML_NAME || 'SAML single sign-on' : null });

/** This server's public origin: PW_BASE_URL (set it in production), else the request's. @param {Request} req */
export const publicBase = (req) => (process.env.PW_BASE_URL || new URL(req.url).origin).replace(/\/$/, '');

/* ---------------- cookies ---------------- */

const COOKIE = 'pw_sso';
const isHttps = (req) => publicBase(req).startsWith('https:');
/** @param {Request} req @param {Record<string, any>} data */
function stateCookie(req, data) {
  const now = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${signSession({ sso: 1, ...data, iat: now, exp: now + 600 }, COOKIE)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`;
}
const clearState = (req) => `${COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
/** @param {Request} req */
function readState(req) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) { const p = readToken(part.slice(i + 1).trim(), COOKIE); return p?.sso ? p : null; }
  }
  return null;
}
export { clearState as clearSsoCookie };

/* ---------------- finishing a sign-in ---------------- */

/**
 * The response for a finished SSO sign-in: the session cookie, the state cookie cleared, and on to `next`.
 * A failure goes back to /login with a short code (the details are in the audit log, not the URL).
 * @param {Request} req @param {() => Promise<{ identity: any, next: string }>} step @param {'oidc'|'saml'} via
 */
/** @param {Request} req @param {() => Promise<{ identity: any, next: string, idToken?: string }>} step @param {'oidc'|'saml'} via */
export async function finishSignIn(req, step, via) {
  const { sessionCookie } = await import('./session.js');
  const { audit } = await import('./audit.js');
  const back = (path, cookies) => { const h = new Headers({ location: `${publicBase(req)}${path}` }); for (const c of cookies) h.append('set-cookie', c); return new Response(null, { status: 303, headers: h }); };
  try {
    const { identity, next, idToken } = await step();
    const email = await upsertSsoUser(identity, via);
    const user = await getUser(email);
    await audit('auth.sso', { req, actor: `user:${email}`, detail: { method: via, issuer: identity.issuer, role: identity.role, groups: identity.groups } });
    // the ID token, for id_token_hint at sign-out (RP-initiated logout); too big for a cookie: sign-out goes without it
    const idt = idToken && idToken.length < 3800 ? [`${IDT}=${idToken}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${isHttps(req) ? '; Secure' : ''}`] : [];
    return back(safeNext(next), [sessionCookie(req, user, { s: via }), clearState(req), ...idt]);
  } catch (e) {
    const err = /** @type {any} */ (e);
    await audit('auth.sso_failed', { req, status: 'failed', detail: { method: via, reason: String(err.message).slice(0, 200) } });
    return back(`/login?sso_error=${encodeURIComponent(err.code || 'sso')}`, [clearState(req)]);
  }
}

/* ---------------- rate limit for starting sign-ins ---------------- */

// ponytail: per process, like the password sign-in limit; a shared store if several servers must count together
const starts = (/** @type {any} */ (globalThis).__pwSsoStarts ||= new Map());
/** True when this address started more than 60 sign-ins in the last minute. @param {Request} req */
export function tooManyStarts(req) {
  const ip = clientAddress(req);
  const now = Date.now();
  const list = (starts.get(ip) || []).filter(t => t > now - 60000);
  list.push(now);
  if (starts.size > 10000) starts.clear();
  starts.set(ip, list.slice(-61));
  return list.length > 60;
}

/* ---------------- users from IdP claims ---------------- */

/** "a=admin, b=designer" → Map. */
function roleMap() {
  const m = new Map();
  for (const pair of (process.env.PW_SSO_ROLE_MAP || '').split(',')) {
    const i = pair.lastIndexOf('=');
    if (i > 0 && ROLES.includes(/** @type {any} */ (pair.slice(i + 1).trim()))) m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return m;
}
const RANK = { viewer: 1, designer: 2, admin: 3 };

/**
 * The account an IdP's answer gives: { email, role, groups, issuer, subject }. Throws when there is no usable email,
 * the domain is not allowed (PW_SSO_ALLOWED_DOMAINS), or there is no role.
 * @param {string} email @param {string[]} values the groups/roles claim @param {{ issuer: string, subject: string }} who
 */
export function mapIdentity(email, values, who) {
  let e;
  try { e = normEmail(email); } catch { throw fail('The identity provider sent an email address Pagewright does not take.', 401, 'email'); }
  if (!who?.issuer || !who?.subject) throw fail('The identity provider did not say who this is (issuer, subject).', 401, 'subject');
  const domains = (process.env.PW_SSO_ALLOWED_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length && !domains.includes(e.split('@')[1])) throw fail('Accounts of this email domain cannot sign in here.', 403, 'domain');
  const vals = (Array.isArray(values) ? values : values == null ? [] : [values]).map(v => String(v)).slice(0, 500);
  const map = roleMap();
  let role = null;
  for (const v of vals) { const r = map.get(v); if (r && (!role || RANK[r] > RANK[role])) role = r; }
  const fallback = process.env.PW_SSO_DEFAULT_ROLE || 'viewer';
  if (!role) role = fallback === 'none' ? null : ROLES.includes(/** @type {any} */ (fallback)) ? fallback : 'viewer';
  if (!role) throw fail('Your account has no role in Pagewright. Ask an admin to add you to a group that has one.', 403, 'no_role');
  // built-in names never come from the IdP; its "designers" group is the custom group the upgrade renamed (perms.js)
  const groups = [...new Set(vals.map(v => v.trim()).map(v => (v.toLowerCase() === 'designers' ? RENAMED_GROUP : v)).filter(v => GROUP.test(v) && !BUILTIN_GROUPS.includes(v.toLowerCase())))].slice(0, 50).sort();
  return { email: e, role, groups, issuer: String(who.issuer), subject: String(who.subject) };
}

/**
 * The account for an IdP identity; returns its email. An account is bound to one identity (via, issuer, subject):
 *  - bound already: that account (even if the IdP's email has changed since), with role and groups from the IdP;
 *  - an account with this email bound to another identity, or with a password: refused ('linked'), unless an admin
 *    set allowSso on it, and then this sign-in binds it (the password stays);
 *  - no account: one is made, bound, with no password.
 * @param {{ email: string, role: string, groups: string[], issuer: string, subject: string }} id @param {'oidc'|'saml'} via
 */
export function upsertSsoUser(id, via) { return withLock('users', () => upsertNow(id, via)); } // two first sign-ins at once: one wins
async function upsertNow(id, via) {
  const sso = { via, issuer: id.issuer, subject: id.subject };
  const same = (u) => u.sso && typeof u.sso === 'object' && u.sso.via === via && u.sso.issuer === sso.issuer && u.sso.subject === sso.subject;
  const bound = (await allUsers()).find(same);
  const linked = () => fail('An account with this email already exists and is not linked to this sign-in. Ask an admin to allow single sign-on for it.', 403, 'linked');
  if (bound) {
    if (bound.disabled) throw fail('This account is disabled.', 403, 'disabled');
    await updateUser(bound.email, { role: id.role, groups: id.groups });
    return bound.email;
  }
  const u = await getUser(id.email);
  if (!u) { await createUser({ email: id.email, role: id.role, groups: id.groups, sso }); return id.email; }
  if (u.disabled) throw fail('This account is disabled.', 403, 'disabled');
  if (!u.allowSso && (u.passwordHash || (u.sso && typeof u.sso === 'object'))) throw linked();
  await updateUser(u.email, { role: id.role, groups: id.groups, sso });
  if (u.allowSso) await (await import('./audit.js')).audit('auth.sso_link', { actor: `user:${u.email}`, detail: { method: via, issuer: id.issuer } }); // an admin's "allow SSO" was used
  return u.email;
}

/* ---------------- OIDC ---------------- */

const ASYMMETRIC = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const g = /** @type {any} */ (globalThis);
g.__pwOidc ||= { disco: null, jwks: new Map() };

/** fetch with a time limit, for URLs the admin set (the IdP may be on the internal network). */
async function idpFetch(url, init = {}) {
  if (!/^https:\/\//.test(url) && process.env.PW_OIDC_ALLOW_HTTP !== '1') throw fail(`The identity provider must use https (${new URL(url).origin}).`, 500);
  // through the SSRF guard: the issuer the operator named may be on a private network; any other host the discovery
  // document names (jwks_uri, the token endpoint) must be public; no redirects
  const { safeFetch } = await import('./safeFetch.js');
  const issuer = String(process.env.PW_OIDC_ISSUER || '').replace(/\/$/, '');
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body; // node's request takes text
  const headers = { ...Object.fromEntries(new Headers(init.headers || {})), ...(init.body instanceof URLSearchParams && { 'content-type': 'application/x-www-form-urlencoded' }) };
  return safeFetch(url, { ...init, body, headers }, { allow: issuer ? [new URL(issuer).origin] : [], hops: 0, deadline: Date.now() + 10000 });
}

/** The issuer's discovery document (cached for an hour), checked against PW_OIDC_ISSUER. */
export async function discovery() {
  const issuer = String(process.env.PW_OIDC_ISSUER).replace(/\/$/, '');
  const c = g.__pwOidc.disco;
  if (c && c.issuer === issuer && Date.now() - c.at < 3600000) return c.doc;
  const res = await idpFetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw fail(`The identity provider's discovery document did not load (HTTP ${res.status}).`, 502);
  const doc = await res.json();
  if (String(doc.issuer).replace(/\/$/, '') !== issuer) throw fail('The identity provider names a different issuer than PW_OIDC_ISSUER.', 502);
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (typeof doc[k] !== 'string') throw fail(`The discovery document has no ${k}.`, 502);
  g.__pwOidc.disco = { issuer, doc, at: Date.now() };
  return doc;
}

const redirectUri = (req) => `${publicBase(req)}/api/auth/oidc/callback`;

/** The IdP URL to send the browser to, and the cookie that remembers this attempt. @param {Request} req @param {string} next */
export async function oidcStart(req, next) {
  sessionSecret();
  const d = await discovery();
  const state = rand(), nonce = rand(), verifier = rand(48);
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const u = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: process.env.PW_OIDC_CLIENT_ID, redirect_uri: redirectUri(req),
    scope: process.env.PW_OIDC_SCOPES || 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  })) u.searchParams.set(k, String(v));
  return { url: u.href, cookie: stateCookie(req, { via: 'oidc', state, nonce, verifier, next: safeNext(next) }) };
}

/**
 * Finish an OIDC sign-in: check state, swap the code (with the PKCE verifier) for tokens, verify the ID token.
 * @param {Request} req @returns {Promise<{ identity: { email: string, role: string, groups: string[] }, next: string, idToken?: string }>}
 */
export async function oidcCallback(req) {
  const sp = new URL(req.url).searchParams;
  const st = readState(req);
  if (!st || st.via !== 'oidc') throw fail('The sign-in took too long or did not start here. Try again.', 400, 'state');
  if (sp.get('error')) throw fail(`The identity provider refused the sign-in (${String(sp.get('error')).slice(0, 60)}).`, 401, 'idp');
  if (!same(sp.get('state') || '', st.state)) throw fail('The sign-in answer does not belong to this browser (state).', 400, 'state');
  const code = sp.get('code');
  if (!code) throw fail('The identity provider sent no code.', 400, 'code');
  const d = await discovery();
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req), code_verifier: st.verifier, client_id: String(process.env.PW_OIDC_CLIENT_ID) });
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (process.env.PW_OIDC_CLIENT_SECRET) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(String(process.env.PW_OIDC_CLIENT_ID))}:${encodeURIComponent(process.env.PW_OIDC_CLIENT_SECRET)}`).toString('base64')}`;
  const res = await idpFetch(d.token_endpoint, { method: 'POST', headers, body });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || typeof tok.id_token !== 'string') throw fail(`The identity provider did not give an ID token (HTTP ${res.status}).`, 401, 'token');
  const claims = await verifyIdToken(tok.id_token, d, st.nonce);
  if (typeof claims.email !== 'string') throw fail('The identity provider sent no email for this account.', 401, 'email');
  if (claims.email_verified !== true) throw fail('The identity provider has not verified this email address.', 401, 'email');
  const values = claims[process.env.PW_OIDC_GROUPS_CLAIM || 'groups'];
  return { identity: mapIdentity(claims.email, /** @type {any} */ (values), { issuer: d.issuer, subject: String(claims.sub) }), next: st.next || '/', idToken: tok.id_token };
}

/**
 * The IdP's signing keys, fetched through the SSRF guard (idpFetch: the issuer's own origin may be private; any other
 * host must be public; no redirects; 10 s), cached for an hour. fresh: fetch again unless fetched in the last 30 s.
 * @param {string} uri @param {boolean} fresh
 */
async function jwksOf(uri, fresh) {
  const { createLocalJWKSet } = await import('jose');
  const c = g.__pwOidc.jwks.get(uri);
  if (c && (Date.now() - c.at < (fresh ? 30000 : 3600000))) return c.set;
  const res = await idpFetch(uri);
  if (!res.ok) throw fail(`The identity provider's keys could not be read (HTTP ${res.status}).`, 502);
  const text = await res.text();
  if (text.length > 1024 * 1024) throw fail("The identity provider's key set is larger than 1 MB.", 502);
  let doc; try { doc = JSON.parse(text); } catch { throw fail("The identity provider's key set is not JSON.", 502); }
  const set = createLocalJWKSet(doc);
  g.__pwOidc.jwks.set(uri, { at: Date.now(), set });
  return set;
}

/** @param {string} idToken @param {any} d discovery @param {string} nonce */
export async function verifyIdToken(idToken, d, nonce) {
  const { jwtVerify } = await import('jose');
  if (typeof d.jwks_uri !== 'string' || (!/^https:\/\//.test(d.jwks_uri) && process.env.PW_OIDC_ALLOW_HTTP !== '1')) throw fail('The identity provider must use https (jwks_uri).', 500);
  const algs = (Array.isArray(d.id_token_signing_alg_values_supported) ? d.id_token_signing_alg_values_supported : ['RS256']).filter(a => ASYMMETRIC.includes(a));
  const verify = async (fresh) => jwtVerify(idToken, await jwksOf(d.jwks_uri, fresh), { issuer: d.issuer, audience: String(process.env.PW_OIDC_CLIENT_ID), algorithms: algs.length ? algs : ['RS256'], clockTolerance: 60, requiredClaims: ['exp', 'iat', 'sub'] });
  let payload;
  try {
    // a key the cached set does not have (the IdP rotated keys): fetch the set again once (at most every 30 s)
    try { ({ payload } = await verify(false)); } catch (e) { if (/** @type {any} */ (e)?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e; ({ payload } = await verify(true)); }
  } catch (e) { throw fail(`The ID token is not valid: ${/** @type {Error} */ (e).message}`, 401, 'id_token'); }
  if (!same(String(payload.nonce || ''), nonce)) throw fail('The ID token is not for this sign-in (nonce).', 401, 'nonce');
  if ((payload.azp !== undefined || (Array.isArray(payload.aud) && payload.aud.length > 1)) && payload.azp !== process.env.PW_OIDC_CLIENT_ID) throw fail('The ID token was issued to another client (azp).', 401, 'azp');
  return payload;
}

/* ---------------- SAML ---------------- */

const ACS = (req) => `${publicBase(req)}/api/auth/saml/acs`;
const spEntity = (req) => process.env.PW_SAML_ISSUER || `${publicBase(req)}/api/auth/saml/metadata`;
async function idpCerts() {
  const file = !process.env.PW_SAML_IDP_CERT && process.env.PW_SAML_IDP_CERT_FILE;
  const raw = file ? await (await import('node:fs/promises')).readFile(file, 'utf8') : process.env.PW_SAML_IDP_CERT || '';
  // PEM blocks, or bare base64 certificates separated by commas
  const pem = String(raw).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return pem || String(raw).split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean);
}

// The AuthnRequest id is kept in the signed, HttpOnly, 10-minute pw_sso cookie of the browser that began the
// sign-in, not on the server: an unauthenticated start writes nothing (no storage to flood). node-saml does not
// check InResponseTo; samlAcs requires one in the Response and in every bearer SubjectConfirmationData of the signed
// assertion, and samlFinish requires it to be the id in this browser's cookie.
let swept = 0;
/** Drop expired sign-in handles (an ACS answer never finished), at most once a minute. */
async function sweep() {
  if (Date.now() - swept < 60000) return;
  swept = Date.now();
  for (const r of await store().list('tokens')) { try { if (JSON.parse(r.text).expires < Date.now()) await store().remove('tokens', r.id); } catch { /* skip */ } }
}
const noCache = { async saveAsync(key, value) { return { value, createdAt: Date.now() }; }, async getAsync() { return null; }, async removeAsync(key) { return key; } };

/** @param {Request} req @param {string} [id] the AuthnRequest ID this server uses */
async function samlFor(req, id) {
  const { SAML } = await import('@node-saml/node-saml');
  return new SAML({
    entryPoint: process.env.PW_SAML_ENTRY_POINT, idpCert: await idpCerts(), issuer: spEntity(req), callbackUrl: ACS(req), audience: spEntity(req),
    idpIssuer: process.env.PW_SAML_IDP_ISSUER || undefined,
    wantAssertionsSigned: true, wantAuthnResponseSigned: false, signatureAlgorithm: 'sha256',
    validateInResponseTo: /** @type {any} */ ('never'), cacheProvider: noCache, // see above: the browser's cookie holds the request
    acceptedClockSkewMs: 60000, maxAssertionAgeMs: 10 * 60000,
    identifierFormat: null, disableRequestedAuthnContext: true,
    ...(id ? { generateUniqueId: () => id } : {}),
    ...(await spSigning()), // with an SP key the AuthnRequests are signed too
  });
}

/** The IdP URL to send the browser to, and the cookie that binds the answer to this browser. */
export async function samlStart(req, next) {
  sessionSecret();
  const rid = `_pw${crypto.randomBytes(20).toString('hex')}`;
  const url = await (await samlFor(req, rid)).getAuthorizeUrlAsync('', new URL(publicBase(req)).host, {});
  return { url, cookie: stateCookie(req, { via: 'saml', rid, next: safeNext(next) }) };
}

/** First child elements of an xml2js node by local name. */
const kids = (node, name) => (node && typeof node === 'object' ? Object.entries(node).filter(([k]) => k.replace(/^.*:/, '') === name).flatMap(([, v]) => v) : []);

/**
 * Check a posted SAMLResponse and keep what it says under a one-time handle. Returns the URL to go on to.
 * @param {Request} req @param {string} samlResponse base64
 */
export async function samlAcs(req, samlResponse) {
  if (typeof samlResponse !== 'string' || !samlResponse || samlResponse.length > 512 * 1024) throw fail('Send a SAMLResponse.', 400, 'response');
  const saml = await samlFor(req);
  let profile;
  if (/<!DOCTYPE|<!ENTITY/i.test(Buffer.from(String(samlResponse), 'base64').toString('utf8'))) throw fail('The SAML response has a DOCTYPE.', 400, 'response'); // before any parser sees it
  try {
    ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse }));
  } catch (e) { throw fail(`The SAML response is not valid: ${/** @type {Error} */ (e).message}`, 401, 'response'); }
  if (!profile) throw fail('The SAML response holds no sign-in.', 401, 'response');
  // Destination of the Response, when given, must be our ACS (node-saml does not check it)
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('The SAML response has a DOCTYPE.', 400, 'response'); // as parseMessage
  const { parseStringPromise } = await import('xml2js');
  const doc = await parseStringPromise(xml);
  const resp = kids(doc, 'Response')[0];
  if (resp?.$?.Destination && resp.$.Destination !== ACS(req)) throw fail('The SAML response is for another address (Destination).', 401, 'destination');
  // Recipient and the bearer method come from the SIGNED assertion that node-saml validated
  const a = /** @type {any} */ (profile).getAssertion?.()?.Assertion;
  if (!a?.$?.ID) throw fail('The SAML assertion has no ID.', 401, 'response');
  const confirmations = kids(kids(a, 'Subject')[0], 'SubjectConfirmation');
  const bearer = confirmations.filter(c => c?.$?.Method === 'urn:oasis:names:tc:SAML:2.0:cm:bearer');
  if (!bearer.length || !bearer.every(c => kids(c, 'SubjectConfirmationData').every(cd => cd?.$?.Recipient === ACS(req)))) throw fail('The SAML assertion is for another address (Recipient).', 401, 'recipient');
  // the request this answers must be named inside the SIGNED assertion: the Response's InResponseTo is not signed, so
  // an assertion with none of its own (IdP-initiated) could be wrapped to answer anyone's request
  if (!profile.inResponseTo || !bearer.every(c => kids(c, 'SubjectConfirmationData').every(cd => cd?.$?.InResponseTo === profile.inResponseTo))) throw fail('The SAML assertion does not answer a sign-in from this server.', 401, 'in_response_to');
  // node-saml checks a bearer confirmation's times only while it validates InResponseTo itself: here instead
  const skew = 60000, now = Date.now();
  for (const cd of bearer.flatMap(c => kids(c, 'SubjectConfirmationData'))) {
    const noa = cd?.$?.NotOnOrAfter, nb = cd?.$?.NotBefore;
    if ((noa && !(Date.parse(noa) + skew > now)) || (nb && !(Date.parse(nb) - skew <= now))) throw fail('The SAML subject confirmation has expired (NotOnOrAfter) or is not valid yet.', 401, 'expired');
  }
  const issuer = /** @type {any} */ (profile).issuer;
  if (!issuer || issuer !== process.env.PW_SAML_IDP_ISSUER) throw fail('The SAML assertion is from another identity provider.', 401, 'issuer');
  if (!profile.nameID) throw fail('The SAML assertion has no NameID.', 401, 'subject');
  // each assertion once, on every server: a lease that never comes back while the assertion could still be valid
  const once = await store().lease(`saml-assertion:${crypto.createHash('sha256').update(String(a.$.ID)).digest('hex')}`, rand(8), 24 * 3600000);
  if (!once) throw fail('This SAML response was used already.', 401, 'replay');
  const rid = profile.inResponseTo;
  if (!rid) throw fail('The SAML response does not answer a sign-in from this server.', 401, 'in_response_to');
  // the email: an attribute, else an email-format NameID
  const attr = (n) => { const v = /** @type {any} */ (profile)[n] ?? profile.attributes?.[n]; return Array.isArray(v) ? v : v == null ? [] : [v]; };
  const emailAttr = process.env.PW_SAML_EMAIL_ATTR;
  const email = (emailAttr ? attr(emailAttr)[0] : attr('email')[0] || attr('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress')[0] || attr('mail')[0])
    || (/:nameid-format:emailAddress$/.test(profile.nameIDFormat || '') ? profile.nameID : null); // a NameID is an email only when it says so
  if (!email) throw fail('The SAML response has no email for this account.', 401, 'email');
  const identity = mapIdentity(String(email), attr(process.env.PW_SAML_GROUPS_ATTR || 'groups'), { issuer, subject: `${profile.nameIDFormat || ''}|${profile.nameID}` });
  await sweep().catch(logWarn('sso token sweep'));
  const handle = rand(24);
  await store().put('tokens', `samlh:${handle}`, JSON.stringify({ id: `samlh:${handle}`, rid, identity, expires: Date.now() + 120000 }));
  return `${publicBase(req)}/api/auth/saml/finish?h=${encodeURIComponent(handle)}`;
}

/** The browser that began the sign-in comes back: the cookie's request id must be the one the IdP answered. */
export async function samlFinish(req) {
  const h = new URL(req.url).searchParams.get('h') || '';
  if (!/^[\w-]{20,64}$/.test(h)) throw fail('Bad sign-in handle.', 400, 'handle');
  const key = `samlh:${h}`;
  const t = await store().get('tokens', key);
  if (!t || !(await store().lease(`saml-handle:${h}`, rand(8), 600000)) || !(await store().remove('tokens', key))) throw fail('The sign-in took too long or was used already. Try again.', 400, 'handle');
  const rec = JSON.parse(t);
  if (rec.expires < Date.now()) throw fail('The sign-in took too long. Try again.', 400, 'handle');
  const st = readState(req);
  if (!st || st.via !== 'saml' || !same(st.rid, rec.rid)) throw fail('The sign-in answer does not belong to this browser.', 400, 'state');
  return { identity: rec.identity, next: st.next || '/' };
}

/** SP metadata for the IdP admin (with the SLO address and the SP's signing certificate when single logout is on). @param {Request} req */
export async function samlMetadata(req) {
  const { generateServiceProviderMetadata } = await import('@node-saml/node-saml');
  const signing = await spSigning();
  return generateServiceProviderMetadata({ issuer: spEntity(req), callbackUrl: ACS(req), wantAssertionsSigned: true, identifierFormat: null,
    ...(signing.privateKey && signing.publicCerts ? signing : {}), ...(sloOn() ? { logoutCallbackUrl: SLO(req) } : {}) });
}

/* ---------------- single logout ---------------- */

const IDT = 'pw_idt';
const SLO_COOKIE = 'pw_slo';
const NS_P = 'urn:oasis:names:tc:SAML:2.0:protocol';
const SIG_ALGS = { 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': 'RSA-SHA256', 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': 'RSA-SHA512' };
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';

export const sloOn = () => samlOn() && !!process.env.PW_SAML_LOGOUT_URL && !!(process.env.PW_SAML_SP_KEY || process.env.PW_SAML_SP_KEY_FILE);
const SLO = (req) => `${publicBase(req)}/api/auth/saml/slo`;
const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** PEM from NAME or NAME_FILE. */
async function pemFrom(name) {
  if (process.env[name]) return String(process.env[name]).replace(/\\n/g, '\n');
  if (process.env[`${name}_FILE`]) return (await import('node:fs/promises')).readFile(String(process.env[`${name}_FILE`]), 'utf8');
  return null;
}
/** The SP's signing key and certificate, when set (PW_SAML_SP_KEY, PW_SAML_SP_CERT). */
async function spSigning() {
  const key = await pemFrom('PW_SAML_SP_KEY');
  if (!key) return {};
  const cert = await pemFrom('PW_SAML_SP_CERT');
  return { privateKey: key, signatureAlgorithm: 'sha256', ...(cert ? { publicCerts: cert } : {}) };
}
const newId = () => `_pw${crypto.randomBytes(20).toString('hex')}`;

/** A signed HTTP-Redirect URL to the IdP's SLO endpoint. @param {'SAMLRequest'|'SAMLResponse'} kind @param {string} xml @param {string} [relay] */
async function signedRedirect(kind, xml, relay) {
  const key = await pemFrom('PW_SAML_SP_KEY');
  if (!key) throw fail('PW_SAML_SP_KEY is not set: single logout needs the SP signing key.', 500);
  let q = `${kind}=${encodeURIComponent(zlib.deflateRawSync(Buffer.from(xml)).toString('base64'))}`;
  if (relay) q += `&RelayState=${encodeURIComponent(relay)}`;
  q += `&SigAlg=${encodeURIComponent(RSA_SHA256)}`;
  q += `&Signature=${encodeURIComponent(crypto.createSign('RSA-SHA256').update(q).sign(key, 'base64'))}`;
  const u = String(process.env.PW_SAML_LOGOUT_URL);
  return `${u}${u.includes('?') ? '&' : '?'}${q}`;
}

/**
 * Begin SP-initiated logout for a SAML-bound account: the IdP URL (a signed LogoutRequest) and the pw_slo cookie that
 * the IdP's answer must match. @param {Request} req @param {any} user the stored user
 */
export async function samlLogoutStart(req, user) {
  const subject = String(user?.sso?.subject || '');
  const i = subject.indexOf('|');
  const format = subject.slice(0, i), nameID = subject.slice(i + 1);
  if (i < 0 || !nameID) throw fail('This account has no SAML NameID.', 400);
  const id = newId();
  const xml = `<samlp:LogoutRequest xmlns:samlp="${NS_P}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${xmlEsc(process.env.PW_SAML_LOGOUT_URL)}">`
    + `<saml:Issuer>${xmlEsc(spEntity(req))}</saml:Issuer><saml:NameID${format ? ` Format="${xmlEsc(format)}"` : ''}>${xmlEsc(nameID)}</saml:NameID></samlp:LogoutRequest>`;
  const now = Math.floor(Date.now() / 1000);
  const cookie = `${SLO_COOKIE}=${signSession({ slo: 1, rid: id, iat: now, exp: now + 600 }, SLO_COOKIE)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`;
  return { url: await signedRedirect('SAMLRequest', xml), cookie };
}

/** Where sign-out of an OIDC session goes next (RP-initiated logout), or null. @param {Request} req */
export async function oidcLogoutUrl(req) {
  if (!oidcOn() || process.env.PW_OIDC_LOGOUT === 'off') return null;
  let d;
  try { d = await discovery(); } catch (e) { logWarn('oidc logout discovery')(e); return null; } // sign-out here still happens
  const end = d.end_session_endpoint;
  if (typeof end !== 'string' || (!/^https:\/\//.test(end) && process.env.PW_OIDC_ALLOW_HTTP !== '1')) return null;
  const u = new URL(end);
  let idt = null;
  for (const part of (req.headers.get('cookie') || '').split(';')) { const k = part.indexOf('='); if (k > 0 && part.slice(0, k).trim() === IDT) idt = part.slice(k + 1).trim(); }
  if (idt && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(idt)) u.searchParams.set('id_token_hint', idt);
  u.searchParams.set('client_id', String(process.env.PW_OIDC_CLIENT_ID));
  u.searchParams.set('post_logout_redirect_uri', `${publicBase(req)}/login`);
  return u.href;
}
/** Set-Cookie lines that forget the single-logout state. @param {Request} req */
export const clearLogoutCookies = (req) => [IDT, SLO_COOKIE].map(n => `${n}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);

/** The raw (still encoded) query parameters, each name at most once. @param {string} url */
function rawQuery(url) {
  const q = new URL(url).search.slice(1);
  const out = new Map();
  for (const part of q ? q.split('&') : []) {
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    if (out.has(k)) throw fail(`The SAML message has ${k} twice.`, 400, 'slo');
    out.set(k, i < 0 ? '' : part.slice(i + 1));
  }
  return out;
}

/** Inflate and parse a message; no DOCTYPE, at most 256 KB. */
async function parseMessage(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('The SAML message has a DOCTYPE.', 400, 'slo');
  const { parseStringPromise } = await import('xml2js');
  return parseStringPromise(xml);
}

/**
 * Check a logout message's envelope: SAML 2.0, from the pinned IdP, naming our SLO address (Destination, required for
 * both bindings: SAML Bindings 3.4.5.2, 3.5.5.2), issued within 5 minutes, not past NotOnOrAfter. useOnce records its ID afterwards.
 * @param {any} doc xml2js @param {Request} req @param {boolean} post @returns {Promise<{ kind: 'LogoutRequest'|'LogoutResponse', el: any }>}
 */
async function checkLogoutMessage(doc, req, post) {
  const [kind] = Object.keys(doc || {});
  const local = String(kind).replace(/^.*:/, '');
  if (!['LogoutRequest', 'LogoutResponse'].includes(local)) throw fail('Not a SAML logout message.', 400, 'slo');
  const el = doc[kind];
  const prefix = kind.includes(':') ? kind.slice(0, kind.indexOf(':')) : '';
  if ((prefix ? el?.$?.[`xmlns:${prefix}`] : el?.$?.xmlns) !== NS_P) throw fail('The logout message is not SAML 2.0.', 400, 'slo');
  const issuer = kids(el, 'Issuer')[0];
  const iss = typeof issuer === 'string' ? issuer : issuer?._;
  if (iss !== process.env.PW_SAML_IDP_ISSUER) throw fail('The logout message is from another identity provider.', 401, 'issuer');
  void post;
  if (el.$?.Destination !== SLO(req)) throw fail('The logout message is for another address (Destination).', 401, 'destination');
  const at = Date.parse(el.$?.IssueInstant || '');
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 5 * 60000) throw fail('The logout message is too old or from the future (IssueInstant).', 401, 'expired');
  const noa = el.$?.NotOnOrAfter;
  if (noa && !(Date.parse(noa) + 60000 > Date.now())) throw fail('The logout message has expired (NotOnOrAfter).', 401, 'expired');
  if (!el.$?.ID) throw fail('The logout message has no ID.', 400, 'slo');
  return { kind: /** @type {any} */ (local), el };
}
/** Each logout message once, on every server (a storage lease for an hour). @param {any} el */
async function useOnce(el) {
  if (!(await store().lease(`saml-slo:${crypto.createHash('sha256').update(String(el.$.ID)).digest('hex')}`, rand(8), 3600000))) throw fail('This logout message was used already.', 401, 'replay');
}

/**
 * A logout message arriving at /api/auth/saml/slo: HTTP-Redirect (GET, signed query) or HTTP-POST (signed XML, requests
 * only). The signature is checked by @node-saml/node-saml for the binding used (validateRedirectAsync: the raw encoded
 * SAMLRequest|SAMLResponse, RelayState, SigAlg, in that order; validatePostRequestAsync: an enveloped signature over the
 * root element), after this module has made sure the message is signed at all (node-saml lets an unsigned redirect
 * through), with an allowed SigAlg (RSA-SHA256/512: no SHA-1, no "none"), and that the query holds nothing else and no
 * name twice (node-saml finds its parameters by substring). The NameID is node-saml's, read from the verified DOM. Then
 * checkLogoutMessage: the pinned issuer, our Destination, a recent IssueInstant, NotOnOrAfter, and each ID once.
 * Returns { kind: 'LogoutResponse', inResponseTo, ok } or { kind: 'LogoutRequest', id, nameID, format, relay }.
 * @param {Request} req @param {Record<string, string>} [form] the POST form
 */
export async function samlSloMessage(req, form) {
  const saml = await samlFor(req);
  if (form) {
    if (!form.SAMLRequest || form.SAMLRequest.length > 512 * 1024) throw fail('Send a signed SAMLRequest (a LogoutResponse comes by HTTP-Redirect).', 400, 'slo');
    const xml = Buffer.from(form.SAMLRequest, 'base64').toString('utf8');
    const { kind, el } = await checkLogoutMessage(await parseMessage(xml), req, true);
    if (kind !== 'LogoutRequest') throw fail('Send a LogoutRequest (a LogoutResponse comes by HTTP-Redirect).', 400, 'slo');
    let profile;
    try { ({ profile } = await saml.validatePostRequestAsync({ SAMLRequest: form.SAMLRequest })); }
    catch (e) { throw fail(`The logout request is not valid: ${/** @type {Error} */ (e).message}`, 401, 'signature'); }
    await useOnce(el);
    return requestOf(profile, el, String(form.RelayState || ''));
  }
  const q = rawQuery(req.url);
  for (const k of q.keys()) if (!['SAMLRequest', 'SAMLResponse', 'RelayState', 'SigAlg', 'Signature'].includes(k)) throw fail(`The logout message has an unknown parameter (${k.slice(0, 20)}).`, 400, 'slo');
  const name = q.has('SAMLRequest') ? 'SAMLRequest' : q.has('SAMLResponse') ? 'SAMLResponse' : null;
  if (!name || (q.has('SAMLRequest') && q.has('SAMLResponse'))) throw fail('Send one SAMLRequest or SAMLResponse.', 400, 'slo');
  if (!q.get('Signature') || !q.get('SigAlg')) throw fail('The logout message is not signed.', 401, 'signature');
  const dec = (k) => { try { return decodeURIComponent(q.get(k).replace(/\+/g, ' ')); } catch { throw fail(`Bad ${k}.`, 400, 'slo'); } };
  if (!SIG_ALGS[dec('SigAlg')]) throw fail('The logout message is signed with an algorithm Pagewright does not take (use RSA-SHA256).', 401, 'signature');
  let xml;
  try { xml = zlib.inflateRawSync(Buffer.from(dec(name), 'base64'), { maxOutputLength: 256 * 1024 }).toString('utf8'); }
  catch { throw fail('The logout message does not inflate.', 400, 'slo'); }
  const { kind, el } = await checkLogoutMessage(await parseMessage(xml), req, false);
  const container = Object.fromEntries([...q.keys()].map(k => [k, dec(k)]));
  let out;
  try { out = await saml.validateRedirectAsync(container, new URL(req.url).search.slice(1)); }
  catch (e) { throw fail(`The logout message is not valid: ${/** @type {Error} */ (e).message}`, 401, 'signature'); }
  await useOnce(el);
  if (kind === 'LogoutRequest') return requestOf(out.profile, el, q.has('RelayState') ? dec('RelayState') : '');
  const code = kids(kids(el, 'Status')[0], 'StatusCode')[0]?.$?.Value;
  return { kind, inResponseTo: String(el.$?.InResponseTo || ''), ok: code === SUCCESS };
}
/** @param {any} profile node-saml's, from the verified message @param {any} el @param {string} relay */
function requestOf(profile, el, relay) {
  if (!profile?.nameID) throw fail('The logout request has no NameID.', 400, 'slo');
  if (String(profile.ID || el.$.ID) !== String(el.$.ID)) throw fail('The logout request does not match its signature.', 401, 'signature');
  // RelayState only goes back to the IdP, inside our signed LogoutResponse: never a place this server sends the browser
  return { kind: 'LogoutRequest', id: String(el.$.ID), nameID: String(profile.nameID), format: String(profile.nameIDFormat || ''), relay: relay.slice(0, 80) };
}

/** The pw_slo request id of this browser, or null. @param {Request} req */
export function sloRequestId(req) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SLO_COOKIE) { const p = readToken(part.slice(i + 1).trim(), SLO_COOKIE); return p?.slo === 1 ? String(p.rid) : null; }
  }
  return null;
}
/** The account bound to a SAML NameID from the pinned IdP, or null. */
export async function samlUserFor(nameID, format) {
  return (await allUsers()).find(u => u.sso?.via === 'saml' && u.sso.issuer === process.env.PW_SAML_IDP_ISSUER && u.sso.subject === `${format}|${nameID}`) || null;
}
/** The signed LogoutResponse URL answering an IdP's LogoutRequest. @param {Request} req @param {{ id: string, relay?: string }} r */
export async function samlLogoutResponseUrl(req, r) {
  const xml = `<samlp:LogoutResponse xmlns:samlp="${NS_P}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${newId()}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${xmlEsc(process.env.PW_SAML_LOGOUT_URL)}" InResponseTo="${xmlEsc(r.id)}">`
    + `<saml:Issuer>${xmlEsc(spEntity(req))}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${SUCCESS}"/></samlp:Status></samlp:LogoutResponse>`;
  return signedRedirect('SAMLResponse', xml, r.relay || undefined);
}
