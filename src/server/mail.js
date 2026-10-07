// @ts-check
import crypto from 'node:crypto';
import { num as cnum } from './config.js';
// Outgoing mail over SMTP (nodemailer): password-reset links and scheduled reports.
//   PW_SMTP_URL   smtp://user:pass@host:587 (STARTTLS) or smtps://user:pass@host:465
//   PW_MAIL_FROM  the sender: "reports@example.com" or "ReportWright <reports@example.com>"
//   PW_SMTP_REQUIRE_TLS  0 allows a plain connection (default: TLS is required, except to localhost)
// SPF, DKIM and DMARC for the sender's domain are the mail admin's job (docs/GOVERNANCE.md): ReportWright signs nothing.
// Header injection: every address is checked against a strict pattern (no CR, LF, quotes, commas or angle brackets),
// subjects and names lose control characters, and nodemailer may read no file or URL (attachments are bytes only).

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const mailOn = () => !!(process.env.PW_SMTP_URL && process.env.PW_MAIL_FROM);

const ADDR = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** A plain address, lower case; throws 400 otherwise. @param {any} a */
export function checkAddress(a) {
  const s = String(a ?? '').trim();
  if (s.length > 254 || !ADDR.test(s)) throw fail(`"${s.replace(/[\x00-\x1f]/g, '?').slice(0, 80)}" is not an email address.`);
  return s.toLowerCase();
}
/** One line: control characters become spaces. @param {any} s @param {number} [max] */
export const oneLine = (s, max = 200) => String(s ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').trim().slice(0, max);

/** The sender as { name, address }. */
export function sender() {
  const raw = String(process.env.PW_MAIL_FROM || '');
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(raw);
  return m ? { name: oneLine(m[1].replace(/["\\]/g, ''), 80), address: checkAddress(m[2]) } : { name: 'ReportWright', address: checkAddress(raw) };
}

/** PW_MAIL_ALLOWED_DOMAINS: "*" or a list; unset means scheduled mail goes nowhere (fail closed). */
export const allowedDomains = () => (process.env.PW_MAIL_ALLOWED_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const num = (k, d) => cnum(k, d, { min: 1e-9 }); // any positive number (fractions of a MB too)
export const maxRecipients = () => num('PW_MAIL_MAX_RECIPIENTS', 20);
export const maxAttachmentBytes = () => num('PW_MAIL_MAX_ATTACHMENT_MB', 10) * 1024 * 1024;

/**
 * Recipients of scheduled mail: each a plain address, in an allowed domain (a subdomain does not count), at most
 * PW_MAIL_MAX_RECIPIENTS, no repeats. @param {any} list @returns {string[]}
 */
export function checkRecipients(list) {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[,;\s]+/).filter(Boolean) : [];
  if (!arr.length) throw fail('Give at least one recipient.');
  const out = [...new Set(arr.map(checkAddress))];
  if (out.length > maxRecipients()) throw fail(`At most ${maxRecipients()} recipients (PW_MAIL_MAX_RECIPIENTS).`);
  const ok = allowedDomains();
  if (!ok.length) throw fail('Scheduled email is off: set PW_MAIL_ALLOWED_DOMAINS (a list of domains, or *).', 403);
  if (!ok.includes('*')) for (const a of out) if (!ok.includes(a.split('@')[1])) throw fail(`${a} is not in an allowed domain (${ok.join(', ')}).`, 403);
  return out;
}

const g = /** @type {any} */ (globalThis);
async function transport() {
  const url = String(process.env.PW_SMTP_URL);
  if (g.__pwMail?.url === url) return g.__pwMail.t;
  const nodemailer = (await import('nodemailer')).default;
  const host = (() => { try { return new URL(url).hostname; } catch { throw fail('PW_SMTP_URL is not a URL.', 500); } })();
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const t = nodemailer.createTransport(/** @type {any} */ (url), /** @type {any} */ ({
    requireTLS: !url.startsWith('smtps:') && process.env.PW_SMTP_REQUIRE_TLS !== '0' && !local,
    disableFileAccess: true, disableUrlAccess: true, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
  }));
  g.__pwMail = { url, t };
  return t;
}

/**
 * Send one message. to: plain addresses (checked here too). attachments: { filename, content (bytes), contentType }.
 * @param {{ to: string[], subject: string, text: string, idempotencyKey?: string, attachments?: { filename: string, content: Uint8Array|Buffer, contentType: string }[] }} m
 */
export async function sendMail(m) {
  if (!mailOn()) throw fail('Mail is not set up on this server (PW_SMTP_URL, PW_MAIL_FROM).', 503);
  const to = m.to.map(checkAddress);
  const from = sender();
  const att = (m.attachments || []).map(a => ({ filename: oneLine(a.filename, 120).replace(/[\\/"]/g, '-'), content: Buffer.from(a.content), contentType: oneLine(a.contentType, 100) }));
  const info = await (await transport()).sendMail({
    from, to, subject: oneLine(m.subject), text: String(m.text ?? ''), attachments: att,
    envelope: { from: from.address, to }, headers: { 'auto-submitted': 'auto-generated', ...(m.idempotencyKey ? { 'x-pagewright-idempotency-key': oneLine(m.idempotencyKey, 120) } : {}) },
    // one Message-ID per logical mail: a repeat (should one ever happen) is the same message to the receiving servers
    ...(m.idempotencyKey ? { messageId: `<${crypto.createHash('sha256').update(String(m.idempotencyKey)).digest('hex').slice(0, 32)}@pagewright>` } : {}),
  });
  return { messageId: info.messageId, accepted: info.accepted?.length ?? to.length };
}

/** Tell an account holder that their sign-in changed (2FA on or off); never throws. @param {string} email @param {string} what */
export async function notifyAccount(email, what) {
  if (!mailOn()) return;
  try {
    await sendMail({ to: [email], subject: 'Your ReportWright sign-in changed', text: `${what}\n\nIf this was not you, tell an admin at once: they can reset your two-factor sign-in and your password.\n` });
  } catch (e) { console.error(`[reportwright] account notice mail: ${/** @type {Error} */ (e).message}`); }
}
