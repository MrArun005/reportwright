// @ts-check
// Attempt limits that hold across servers (and the processes of scripts/cluster.mjs): a limit of N tries in a window is
// N storage leases ("slots") named after the key. A try takes a free slot for the window; when every slot is held, the
// try is refused. A try that succeeds may give its slot back (release). Leases are atomic in every storage (a file lock,
// one SQL statement), so N tries at once still get at most N slots: no check-then-count race.
// ponytail: a refused try costs N lease reads; fine for the small limits used here (5 codes, 3 reset mails).
import crypto from 'node:crypto';
import { store } from './storage/index.js';

/**
 * Take one try for `key` (at most `limit` per `windowMs`). { ok: false } when the limit is reached.
 * @param {string} key @param {number} limit @param {number} windowMs
 * @returns {Promise<{ ok: boolean, retryAfter: number, release: () => Promise<void> }>}
 */
export async function attempt(key, limit, windowMs) {
  sweepSoon();
  const name = `rl:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
  // a key found full is refused from memory for 5 s: a flood of refused tries does not each cost `limit` lease reads
  const full = fullKeys.get(name);
  if (full && full > Date.now()) return { ok: false, retryAfter: Math.ceil(windowMs / 1000), release: async () => {} };
  const owner = crypto.randomBytes(8).toString('hex');
  const start = crypto.randomInt(limit);
  for (let k = 0; k < limit; k++) {
    const slot = `${name}:${(start + k) % limit}`;
    if (await store().lease(slot, owner, windowMs)) return { ok: true, retryAfter: 0, release: async () => { fullKeys.delete(name); await store().release(slot, owner); } };
  }
  if (fullKeys.size > 10000) fullKeys.clear();
  fullKeys.set(name, Date.now() + 5000);
  return { ok: false, retryAfter: Math.ceil(windowMs / 1000), release: async () => {} };
}
/** @type {Map<string, number>} */
const fullKeys = (/** @type {any} */ (globalThis).__pwFullKeys ||= new Map());

/** The client address for limits: the last X-Forwarded-For hop (our own reverse proxy's), as the audit log. @param {Request} req */
export const clientAddress = (req) => (req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim().slice(0, 64) || '-';

// leases that ran out are removed hourly (a spray of made-up keys must not grow the storage without bound)
const g = /** @type {any} */ (globalThis);
function sweepSoon() {
  if (Date.now() - (g.__pwLeaseSweep || 0) < 3600 * 1000) return;
  g.__pwLeaseSweep = Date.now();
  store().sweepLeases?.(Date.now() - 60000).catch((e) => console.error(`[pagewright] lease sweep: ${e.message}`));
}

/**
 * Password sign-in limits, across servers: 10 failures in 15 minutes per client address and email, 50 per email from
 * all addresses. Take both before checking the password; give them back when it was right.
 * @param {string} address @param {string} email
 * @returns {Promise<{ ok: boolean, retryAfter: number, release: () => Promise<void> }>}
 */
export async function loginAttempt(address, email) {
  const W = 15 * 60 * 1000;
  const one = await attempt(`login:${address}|${email}`, 10, W);
  if (!one.ok) return one;
  const all = await attempt(`login:*|${email}`, 50, W);
  if (!all.ok) { await one.release(); return all; }
  return { ok: true, retryAfter: 0, release: async () => { await one.release(); await all.release(); } };
}
