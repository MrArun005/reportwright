// POST /api/auth/reset/request { email } — mail a password-reset link (needs PW_SMTP_URL and PW_MAIL_FROM; without them
// an admin resets passwords on the Users page). The answer is the same whether or not the account exists, and comes
// before any lookup or mail is done (the work runs after it), so neither its words nor its time tell. 3 requests an
// hour per email and 20 per client address, on every server (src/server/limits.js): over that, 429 for anyone.
import { accountsOn } from '@/server/session.js';
import { issueReset, normEmail, RESET_MS } from '@/server/users.js';
import { mailOn, sendMail } from '@/server/mail.js';
import { attempt, clientAddress, netKey, normAccount } from '@/server/limits.js';
import { publicBase } from '@/server/sso.js';
import { audit } from '@/server/audit.js';
import { devMode } from '@/server/config.js';

export const runtime = 'nodejs';
const HOUR = 3600 * 1000;
const g = /** @type {any} */ (globalThis);
g.__pwResets ||= new Set(); // the work still running (tests wait for it)

/** The link's origin: PW_BASE_URL; outside production the request's (never a Host header in production). */
const linkBase = (req) => (process.env.PW_BASE_URL ? process.env.PW_BASE_URL.replace(/\/$/, '') : !devMode() ? null : publicBase(req));

async function work(req, email, base) {
  try {
    const token = await issueReset(email);
    if (!token) { await audit('auth.reset_request', { req, status: 'failed', detail: { email, reason: 'no password account' } }); return; }
    if (!base) throw new Error('PW_BASE_URL is not set, so the link has no address');
    const link = `${base}/login/reset?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: [email], subject: 'Reset your Pagewright password',
      text: `Someone asked to reset the Pagewright password of ${email}.\n\nSet a new password here (the link works once, for ${RESET_MS / 60000} minutes):\n${link}\n\nIf it was not you, ignore this email: your password stays as it is.\n`,
    });
    await audit('auth.reset_request', { req, actor: `user:${email}`, detail: { sent: true } });
  } catch (e) {
    console.error(`[pagewright] password reset mail: ${e.message}`);
    await audit('auth.reset_request', { req, status: 'failed', detail: { email, reason: String(e.message).slice(0, 200) } });
  }
}

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  if (!mailOn()) return Response.json({ error: 'Password reset by email is not set up on this server. Ask an admin to reset your password.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  let email;
  try { email = normEmail(body?.email); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  // per network, per (email, network) and per email: the owner's own network keeps its 3 an hour however many others
  // asked for this email, and the mailbox gets at most 20 an hour (the escape hatch for a capped account)
  const net = netKey(clientAddress(req));
  const byAddress = await attempt(['reset-ip', net], 20, HOUR);
  const byEmailNet = byAddress.ok ? await attempt(['reset-email-net', normAccount(email), net], 3, HOUR) : null;
  const byEmail = byEmailNet?.ok ? await attempt(['reset-email', normAccount(email)], 20, HOUR) : null;
  if (!byAddress.ok || !byEmailNet?.ok || !byEmail?.ok) {
    await audit('auth.reset_request', { req, status: 'denied', detail: { email, reason: 'rate limited' } });
    return Response.json({ error: 'Too many reset requests. Try again later.' }, { status: 429, headers: { 'retry-after': String(HOUR / 1000) } });
  }
  const job = work(req, email, linkBase(req)).finally(() => g.__pwResets.delete(job));
  g.__pwResets.add(job);
  return Response.json({ ok: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
}
