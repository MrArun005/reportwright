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
  const name = `rl:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
  const owner = crypto.randomBytes(8).toString('hex');
  const start = crypto.randomInt(limit);
  for (let k = 0; k < limit; k++) {
    const slot = `${name}:${(start + k) % limit}`;
    if (await store().lease(slot, owner, windowMs)) return { ok: true, retryAfter: 0, release: () => store().release(slot, owner) };
  }
  return { ok: false, retryAfter: Math.ceil(windowMs / 1000), release: async () => {} };
}

/** The client address for limits: the last X-Forwarded-For hop (our own reverse proxy's), as the audit log. @param {Request} req */
export const clientAddress = (req) => (req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim().slice(0, 64) || '-';
