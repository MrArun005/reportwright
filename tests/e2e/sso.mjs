// Single sign-on in a real browser (enterprise item 4). Starts its own mock OIDC provider and SAML IdP (on 127.0.0.1,
// so the IdP is another site than the app on localhost, as in production) and its own production server:
//   npm run build && node tests/e2e/sso.mjs        (PORT=3603 by default)
// OIDC: the button goes to the provider and back, the account is made with the mapped role and lands where it began.
// SAML: the IdP's page POSTs the response from its own site; the browser finishes on the app with its Lax cookie.
// Then password sign-in is off (PW_PASSWORD_LOGIN=off), and a forged SAML post from another browser signs nobody in.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { startOidc, startSamlIdp, testCert, assertionXml, signAssertion, responseXml, b64 } from '../fixtures/mock-idp.js';

const PORT = Number(process.env.PORT) || 3603;
const BASE = `http://localhost:${PORT}`;
const step = (s) => console.log('·', s);
const DB = `/tmp/pw-e2e-sso-${Date.now()}.db`;
fs.mkdirSync('/tmp/shots', { recursive: true });

const oidc = await startOidc();
const idpCert = testCert('E2E IdP');
const IDP = 'https://idp.e2e.test';
const saml = await startSamlIdp({ issuer: IDP, acs: `${BASE}/api/auth/saml/acs`, audience: `${BASE}/api/auth/saml/metadata`, cert: idpCert.cert, key: idpCert.key });

const env = {
  ...process.env, PW_AUTH: 'users', PW_SESSION_SECRET: 'e2e-sso-secret-0123456789abcdef0123456789', PW_STORAGE: `sqlite:${DB}`, PW_BASE_URL: BASE,
  PW_ADMIN_EMAIL: 'admin@e2e.test', PW_ADMIN_PASSWORD: 'e2e admin password',
  PW_OIDC_ISSUER: oidc.issuer, PW_OIDC_CLIENT_ID: oidc.clientId, PW_OIDC_CLIENT_SECRET: oidc.clientSecret, PW_OIDC_ALLOW_HTTP: '1', PW_OIDC_NAME: 'Test SSO',
  PW_SAML_ENTRY_POINT: saml.url, PW_SAML_IDP_CERT: idpCert.cert, PW_SAML_IDP_ISSUER: IDP, PW_SAML_NAME: 'Test SAML',
  PW_SSO_ROLE_MAP: 'pw-admins=admin,pw-design=designer',
};
let server;
const startServer = async (extra = {}) => {
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/login`)).ok) return; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('the server did not start');
};
const stopServer = async () => { server.kill(); await new Promise(r => server.once('exit', r)); };

const b = await chromium.launch();
const errs = [];
try {
  await startServer();
  const page = async () => { const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };

  step('OIDC: the button, the provider, back to the page the user asked for, as a designer from the mapped group');
  oidc.state.user = { sub: 'olga', email: 'olga@e2e.test', email_verified: true, groups: ['pw-design', 'finance'] };
  const po = await page();
  await po.goto(`${BASE}/viewer/loan-statement`);
  await po.waitForURL(/\/login\?next=/);
  await po.screenshot({ path: '/tmp/shots/sso-login.png' });
  await po.getByRole('link', { name: 'Sign in with Test SSO' }).click();
  await po.waitForURL(`${BASE}/viewer/loan-statement`);
  assert.equal(oidc.state.lastAuthorize.code_challenge_method, 'S256');
  const me = await (await po.request.get(`${BASE}/api/auth/me`)).json();
  assert.deepEqual(me, { email: 'olga@e2e.test', role: 'designer' });

  step('SAML: the IdP posts from its own site; the browser finishes with its cookie and lands on the home page');
  saml.state.user = { email: 'sam@e2e.test', groups: ['pw-admins'] };
  const ps = await page();
  await ps.goto(`${BASE}/login`);
  await ps.getByRole('link', { name: 'Sign in with Test SAML' }).click();
  await ps.waitForURL(`${BASE}/`);
  assert.deepEqual(await (await ps.request.get(`${BASE}/api/auth/me`)).json(), { email: 'sam@e2e.test', role: 'admin' });
  await ps.getByRole('link', { name: 'Users' }).click();
  await ps.getByRole('cell', { name: /^sam@e2e\.test/ }).waitFor(); // "(you)" follows
  await ps.getByRole('cell', { name: 'olga@e2e.test', exact: true }).waitFor();
  await ps.screenshot({ path: '/tmp/shots/sso-users.png' });
  // the audit log has both sign-ins
  const log = await (await ps.request.get(`${BASE}/api/audit?type=auth.sso`)).json();
  assert.deepEqual(log.map(e => e.actor).sort(), ['user:olga@e2e.test', 'user:sam@e2e.test']);

  step('a SAML response captured for one sign-in signs in nobody when another browser posts it');
  const pa = await page();
  await pa.goto(`${BASE}/api/auth/saml/login`); // the attacker's own sign-in: the IdP answers it…
  await pa.waitForURL(`${BASE}/`);
  const rid = saml.state.requests.at(-1);
  const forged = b64(responseXml({ issuer: IDP, destination: `${BASE}/api/auth/saml/acs`, inResponseTo: rid, assertion: signAssertion(assertionXml({ issuer: IDP, audience: `${BASE}/api/auth/saml/metadata`, recipient: `${BASE}/api/auth/saml/acs`, inResponseTo: rid, email: 'mallory@e2e.test' }), idpCert.key, idpCert.cert) }));
  const victim = await page();
  await victim.setContent(`<form method="post" action="${BASE}/api/auth/saml/acs"><input type="hidden" name="SAMLResponse" value="${forged}"></form>`);
  await Promise.all([victim.waitForURL(/\/login/), victim.evaluate(() => document.forms[0].submit())]);
  assert.equal((await victim.request.get(`${BASE}/api/auth/me`)).status(), 401);

  step('password sign-in off: no password form, the API refuses it, SSO still works');
  await stopServer();
  await startServer({ PW_PASSWORD_LOGIN: 'off' });
  const pp = await page();
  await pp.goto(`${BASE}/login`);
  await pp.getByRole('link', { name: 'Sign in with Test SSO' }).waitFor();
  assert.equal(await pp.getByLabel('Password').count(), 0);
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@e2e.test', password: 'e2e admin password' }) });
  assert.equal(r.status, 403);
  await pp.screenshot({ path: '/tmp/shots/sso-only.png' });
  assert.deepEqual(errs, []);
  console.log('sso e2e: all passed');
} finally {
  await b.close();
  if (server && server.exitCode === null) await stopServer();
  await oidc.close();
  await saml.close();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
}
