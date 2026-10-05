// Batch 5 (server governance) in a browser, against the production build: two-factor enrolment and sign-in, a password
// reset by email (a mock SMTP server), the Settings, Schedules and audit pages. Starts its own server with accounts:
//   npm run build && node tests/e2e/gov-b5.mjs        (PORT, default 3660)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startSmtp } from '../fixtures/mock-smtp.js';
import { totp } from '../../src/server/totp.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PORT = Number(process.env.PORT || 3660);
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-gov-'));
const ADMIN = 'admin@e2e.test', ADMIN_PW = 'e2e admin password';
const USER = 'pat@e2e.test', USER_PW = 'pat first password';
const step = (s) => console.log('·', s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const qp = (s) => s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const smtp = await startSmtp();
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production', PW_AUTH: 'users', PW_SESSION_SECRET: 'g'.repeat(48), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, 'gov.db')}`,
    PW_ADMIN_EMAIL: ADMIN, PW_ADMIN_PASSWORD: ADMIN_PW, PW_SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, PW_MAIL_FROM: 'Pagewright <noreply@e2e.test>', PW_MAIL_ALLOWED_DOMAINS: 'e2e.test',
    PW_SCHEDULER: 'off', PW_INTERNAL_HOSTS: '127.0.0.1' },
});
let log = '';
server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
const nextMail = (to, re) => (async () => { for (let i = 0; i < 200; i++) { const m = smtp.messages.find(x => x.to.includes(to) && re.test(qp(x.data)) && !x.seen); if (m) { m.seen = true; return qp(m.data); } await sleep(50); } throw new Error(`no mail to ${to} matching ${re}`); })();

const b = await chromium.launch();
const errs = [];
try {
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/login`)).ok) break; } catch { /* not yet */ } if (i > 120) throw new Error(`server did not start:\n${log}`); await sleep(500); }
  const page = async () => { const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signIn = async (p, email, pw, next = '/') => {
    await p.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
    await p.getByLabel('Email').fill(email);
    await p.getByLabel('Password').fill(pw);
    await p.getByRole('button', { name: 'Sign in' }).click();
  };

  step('admin adds a user');
  const pa = await page();
  await signIn(pa, ADMIN, ADMIN_PW, '/admin/users');
  await pa.waitForURL(`${BASE}/admin/users`);
  const add = pa.getByRole('form', { name: 'Add a user' });
  await add.getByLabel('Email').fill(USER);
  await add.getByLabel('Role').selectOption('designer');
  await add.getByLabel(/^Password/).fill(USER_PW);
  await add.getByRole('button', { name: 'Add user' }).click();
  await pa.getByText(`Added ${USER} as designer.`).waitFor();

  step('the user turns on two-factor sign-in on the account page: password again, QR code, a code, recovery codes');
  const pu = await page();
  await signIn(pu, USER, USER_PW, '/account');
  await pu.waitForURL(`${BASE}/account`);
  await pu.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
  await pu.getByLabel('Your password, to confirm it is you').fill(USER_PW);
  await pu.getByRole('button', { name: 'Continue' }).click();
  await pu.getByAltText('QR code for your authenticator app').waitFor();
  const secret = (await pu.getByTestId('totp-secret').textContent()).replace(/\s/g, '');
  await pu.getByLabel('Code from your authenticator app').fill(totp(secret));
  await pu.getByRole('button', { name: 'Confirm' }).click();
  const codes = (await pu.getByTestId('recovery-codes').locator('li').allTextContents());
  assert.equal(codes.length, 10);
  await pu.getByTestId('tf-status').filter({ hasText: 'On' }).waitFor();
  await pu.screenshot({ path: '/tmp/shots/gov-account-2fa.png', fullPage: true });
  await nextMail(USER, /Two-factor sign-in was turned on/);

  step('signing in now asks for the code; a wrong one is refused; the right one signs in');
  const p2 = await page();
  await signIn(p2, USER, USER_PW, '/');
  await p2.getByText('Enter the 6-digit code from your authenticator app.').waitFor();
  await p2.getByLabel('Code from your authenticator app').fill('000000');
  await p2.getByRole('button', { name: 'Verify' }).click();
  await p2.getByRole('alert').filter({ hasText: 'That code is not right.' }).waitFor();
  await p2.getByLabel('Code from your authenticator app').fill(totp(secret, Date.now() + 30000)); // the next step: the enrolment used this one
  await p2.getByRole('button', { name: 'Verify' }).click();
  await p2.waitForURL(`${BASE}/`);

  step('a recovery code works once');
  const p3 = await page();
  await signIn(p3, USER, USER_PW, '/');
  await p3.getByRole('button', { name: 'Use a recovery code' }).click();
  await p3.getByLabel('Recovery code').fill(codes[0]);
  await p3.getByRole('button', { name: 'Verify' }).click();
  await p3.waitForURL(`${BASE}/`);

  step('password reset by email: one answer, a link, a new password, old sessions out');
  const pr = await page();
  await pr.goto(`${BASE}/login`);
  await pr.getByRole('link', { name: 'Forgot your password?' }).click();
  await pr.getByLabel('Email').fill(USER);
  await pr.getByRole('button', { name: 'Send the link' }).click();
  await pr.getByRole('status').filter({ hasText: 'a link is on its way' }).waitFor();
  const mail = await nextMail(USER, /reset\?token=/);
  const link = /(http:\/\/\S+\/login\/reset\?token=\S+)/.exec(mail)[1];
  await pr.goto(link);
  await pr.getByLabel('New password (at least 10 characters)').fill('pat second password');
  await pr.getByRole('button', { name: 'Set the new password' }).click();
  await pr.getByRole('status').filter({ hasText: 'Your password is changed' }).waitFor();
  assert.equal((await (await p2.context().request.get(`${BASE}/api/auth/me`)).status()), 401, 'the earlier session ended');
  await pr.goto(link); // single use
  await pr.getByLabel('New password (at least 10 characters)').fill('pat third password');
  await pr.getByRole('button', { name: 'Set the new password' }).click();
  await pr.getByRole('alert').filter({ hasText: 'does not work any more' }).waitFor();
  // a reset does not remove two-factor sign-in
  const p4 = await page();
  await signIn(p4, USER, 'pat second password', '/');
  await p4.getByText('Enter the 6-digit code from your authenticator app.').waitFor();
  // no account, the same answer
  const r = await fetch(`${BASE}/api/auth/reset/request`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@e2e.test' }) });
  assert.equal(r.status, 202);

  step('admin: settings (require two-factor for admins, the snapshot cache), schedules, audit chain check');
  await pa.goto(`${BASE}/admin/settings`);
  await pa.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await pa.getByTestId('server-status').filter({ hasText: 'noreply@e2e.test' }).waitFor();
  await pa.getByLabel('Reuse a rendering for (seconds, 0 = off)').fill('60');
  await pa.getByRole('form', { name: 'Report snapshot cache' }).getByRole('button', { name: 'Save' }).click();
  await pa.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor();
  await pa.screenshot({ path: '/tmp/shots/gov-settings.png', fullPage: true });
  await pa.goto(`${BASE}/schedules`);
  await pa.getByRole('heading', { name: 'Schedules' }).waitFor();
  await pa.getByRole('form', { name: 'Add schedule' }).waitFor();
  await pa.goto(`${BASE}/admin/audit`);
  await pa.getByRole('button', { name: 'Write a checkpoint now' }).click();
  await pa.getByRole('status').filter({ hasText: 'Checkpoint written' }).waitFor();
  await pa.getByRole('button', { name: 'Check the whole log' }).click();
  const verdict = pa.getByTestId('verify-result').locator('[data-status]');
  await verdict.waitFor();
  assert.ok(['ok', 'unverified'].includes(await verdict.getAttribute('data-status')), 'not tampered');
  await pa.screenshot({ path: '/tmp/shots/gov-audit.png', fullPage: true });
  // requiring two-factor for admins: the admin's own session (no factor) ends and sign-in asks to enrol, with a mailed code
  await pa.goto(`${BASE}/admin/settings`);
  await pa.getByRole('checkbox', { name: 'admin' }).check();
  await pa.getByRole('form', { name: 'Two-factor sign-in' }).getByRole('button', { name: 'Save' }).click();
  await pa.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor();
  await sleep(3200); // the settings cache
  const pz = await page();
  await signIn(pz, ADMIN, ADMIN_PW, '/admin/users');
  await pz.getByText('We emailed a code to your address').waitFor();
  const code = /set up two-factor sign-in: (\d{8})/.exec(await nextMail(ADMIN, /enrolment code|set up two-factor/))[1];
  await pz.getByLabel('Code from the email').fill(code);
  await pz.getByRole('button', { name: 'Continue' }).click();
  const s2 = (await pz.getByTestId('totp-secret').textContent()).replace(/\s/g, '');
  await pz.getByLabel('Code from your authenticator app').fill(totp(s2));
  await pz.getByRole('button', { name: 'Verify' }).click();
  await pz.getByTestId('recovery-codes').waitFor();
  await pz.getByRole('link', { name: 'Continue' }).click();
  await pz.waitForURL(`${BASE}/admin/users`);
  await pz.getByTestId(`tf-${ADMIN}`).filter({ hasText: 'On' }).waitFor();

  assert.deepEqual(errs, []);
  console.log('gov-b5 e2e: ok');
} catch (e) {
  console.error(log.slice(-3000));
  throw e;
} finally {
  await b.close();
  server.kill('SIGTERM');
  await smtp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
