// @ts-check
// Schedules: run a batch on a cron expression. Stored by src/server/storage (data/schedules.json by default); checked every 30 s.
import crypto from 'node:crypto';
import { parseCron, nextRun } from './cron.js';
import { createBatch, ME, checkDelivery, checkEmail } from './jobs.js';
import { store, withLock } from './storage/index.js';
import { principalId, principalFromId, checkReport, vet, defaultPrincipal, canDesign } from './perms.js';
import { audit } from './audit.js';
import { getUser } from './users.js';
import { logWarn } from './errors.js';
import { num as cnum } from './config.js';

const g = globalThis;
g.__pwSched ||= { timer: null };

/** Every schedule, oldest first. */
export async function readSchedules() {
  // a storage error is an error (it was "no schedules": the scheduler then ran nothing, silently); an unreadable
  // record is skipped and said once
  const out = [];
  for (const r of await store().list('schedules')) { try { out.push(JSON.parse(r.text)); } catch { logWarn(`schedule ${r.id}`)(new Error('unreadable record, skipped')); } }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
const readOne = async (id) => { const t = await store().get('schedules', String(id)); return t ? JSON.parse(t) : null; };
const save = (s) => store().put('schedules', s.id, JSON.stringify(s));

export function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw Object.assign(new Error('Send a schedule object'), { status: 400 });
  if (!s.template) throw Object.assign(new Error('"template" is required'), { status: 400 });
  try { parseCron(s.cron); } catch (e) { throw Object.assign(e, { status: 400 }); }
  try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || 'UTC' }); } catch { throw Object.assign(new Error(`Unknown time zone "${s.timezone}"`), { status: 400 }); }
  if (!s.items && !s.itemsFrom) throw Object.assign(new Error('Give "items" or "itemsFrom"'), { status: 400 });
}

const withNext = (s) => ({ ...s, nextRunAt: s.enabled === false ? null : nextRun(s.cron, s.timezone || 'UTC')?.toISOString() || null });

// A schedule belongs to whoever made it (owner: a principal id). A user's API key sees and changes its own only;
// service keys see all. Every run checks the template again as the owner is now.
/** @typedef {import('./perms.js').Principal} Principal */
// a missing principal is the default (nobody with accounts on); a record with no owner is no one's
// a user's schedules belong to the key that made them: another key of the same user cannot see or retarget them
const mine = (p, s) => { p = vet(p); return p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && !!s.owner && s.owner === principalId(p) && (s.ownerKey || null) === (p.viaKey || null)); };
const shown = ({ owner, ownerKey, ownerSession, ownerSince, ...s }) => withNext(s);
/** A template a principal may render: an id it may view, or (designers, service keys) an inline definition. */
async function checkTemplate(p, template) {
  if (typeof template === 'string') return void await checkReport(p, template);
  if (!canDesign(p)) throw Object.assign(new Error('Only a designer can schedule a definition sent in the request.'), { status: 403 });
}

/** @param {Principal} [p] */
export async function listSchedules(p = defaultPrincipal()) { return (await readSchedules()).filter(s => mine(p, s)).map(shown); }
/** @param {string} id @param {Principal} [p] */
export async function getSchedule(id, p = defaultPrincipal()) { const s = await readOne(id); return s && mine(p, s) ? shown(s) : null; }

/**
 * @param {any} body @param {Principal} [p] @param {{ session?: boolean }} [o] session: made on the Schedules page by a
 *   signed-in user (or the trusted open server), not by an API key: it runs as that user as they are now
 */
export async function createSchedule(body, p = defaultPrincipal(), { session = false } = {}) {
  validateSchedule(body);
  await checkTemplate(p, body.template);
  await checkDelivery(body, p);
  const { ownerSession: _x, ownerSince: _y, ...rest } = body;
  const s = { enabled: true, timezone: 'UTC', format: 'pdf', ...rest, ...(rest.email ? { email: checkEmail(rest.email) } : {}), id: `s_${crypto.randomBytes(5).toString('hex')}`, createdAt: new Date().toISOString(), owner: principalId(p), ownerKey: /** @type {any} */ (vet(p)).viaKey || null, ownerSession: !!session && !/** @type {any} */ (vet(p)).viaKey, ownerSince: session && vet(p).kind === 'user' ? (await getUser(/** @type {any} */ (vet(p)).email))?.createdAt || null : null };
  await withLock('schedules', () => save(s));
  return shown(s);
}
/** @param {string} id @param {any} patch @param {Principal} [p] */
export function updateSchedule(id, patch, p = defaultPrincipal()) { return withLock('schedules', () => updateNow(id, patch, p)); }
async function updateNow(id, patch, p) {
  const cur = await readOne(id);
  if (!cur || !mine(p, cur)) return null;
  const { owner: _ignored, ownerKey: _alsoIgnored, ownerSession: _too, ownerSince: _since, ...rest } = patch || {};
  const next = { ...cur, ...rest, id: cur.id, createdAt: cur.createdAt, owner: cur.owner, ownerKey: cur.ownerKey || null, ownerSession: !!cur.ownerSession, ownerSince: cur.ownerSince || null, updatedAt: new Date().toISOString() };
  if (next.email) next.email = checkEmail(next.email);
  validateSchedule(next);
  if (next.template !== cur.template) await checkTemplate(p, next.template);
  await checkDelivery(next, p);
  await save(next);
  return shown(next);
}
/** @param {string} id @param {Principal} [p] */
export function deleteSchedule(id, p = defaultPrincipal()) {
  return withLock('schedules', async () => {
    const cur = await readOne(id);
    if (!cur || !mine(p, cur)) return false;
    return store().remove('schedules', String(id));
  });
}

/** Run now, as the schedule's owner. @param {any} s a schedule (its owner is read from storage) */
export async function runSchedule(s, reason = 'manual') {
  const rec = (await readOne(s.id)) || s;
  s = rec; // what is stored now (an edit since the caller read it counts)
  const principal = rec.owner ? await principalFromId(rec.owner, rec.ownerKey, { session: !!rec.ownerSession, since: rec.ownerSince, madeAt: rec.createdAt }) : defaultPrincipal(); // no owner: no one's (fail closed)
  const report = typeof s.template === 'string' ? s.template : null;
  let job;
  try {
    job = await createBatch({ template: s.template, items: s.items, itemsFrom: s.itemsFrom, format: s.format, output: s.output, webhook: s.webhook, email: s.email, fileName: s.fileName, pdfa: s.pdfa, sign: s.sign, fromSnapshot: s.fromSnapshot, schedule: { id: s.id, reason } }, undefined, principal, { session: !!rec.ownerSession, since: rec.ownerSince || (principal.kind === 'user' ? (await getUser(principal.email))?.createdAt : null) || null });
  } catch (e) {
    await audit('schedule.run', { actor: rec.owner || 'nobody', report, status: 'failed', detail: { schedule: s.id, reason, error: e.message } });
    throw e;
  }
  await audit('schedule.run', { actor: rec.owner || 'nobody', report, format: job.format, detail: { schedule: s.id, reason, batch: job.id, items: job.total } });
  // re-read under the lock: bookkeeping never writes back a schedule changed or deleted meanwhile
  await withLock('schedules', async () => { const cur = await readOne(s.id); if (cur) { cur.lastRunAt = new Date().toISOString(); cur.lastJobId = job.id; await save(cur); } });
  return job;
}

/**
 * Due when a run time has passed since the last run (or the last edit). lastRunAt is in storage, so a
 * restart does not fire twice, and after downtime a missed run happens once, late. With several servers,
 * only the one holding the "scheduler" lease runs schedules (tickAs).
 */
export function isDue(s, now = new Date()) {
  if (s.enabled === false) return false;
  const stamps = [s.lastRunAt, s.updatedAt, s.createdAt].map(t => Date.parse(t || '')).filter(Number.isFinite);
  const since = stamps.length ? Math.max(...stamps) : now.getTime() - 60000;
  const at = nextRun(s.cron, s.timezone || 'UTC', new Date(since));
  return !!at && at <= now;
}

// the tick runs every 30 s and a stopped leader is replaced within 90 s (both can be shorter for tests)
const tickMs = () => cnum('PW_SCHEDULER_TICK_MS', 30000, { min: 1 });
const leaderMs = () => cnum('PW_SCHEDULER_LEASE_MS', 3 * tickMs(), { min: 1 });

/** One scheduler tick as `owner`: nothing unless this server holds (or takes) the scheduler lease. */
export async function tickAs(owner, now = new Date()) {
  if (!(await store().lease('scheduler', owner, leaderMs()))) return;
  for (const s of await readSchedules()) {
    try {
      // claim the run first (under the lock): a slow item list or upload cannot make the next tick run it again
      const claimed = await withLock('schedules', async () => {
        const cur = await readOne(s.id);
        if (!cur || !isDue(cur, now)) return null;
        await save({ ...cur, lastRunAt: now.toISOString() });
        return cur;
      });
      if (claimed) await runSchedule(claimed, 'cron'); // as it is now, not as the tick listed it
    }
    catch (e) { console.error(`[pagewright] schedule ${s.id}: ${e.message}`); }
  }
}

export function startScheduler() {
  if (g.__pwSched.timer || process.env.PW_SCHEDULER === 'off') return;
  // one tick at a time: a tick still running (a slow schedule) is not joined by the next
  g.__pwSched.timer = setInterval(() => { if (g.__pwSched.busy) return; g.__pwSched.busy = tickAs(ME).catch(logWarn('scheduler tick')).finally(() => { g.__pwSched.busy = null; }); }, tickMs());
  g.__pwSched.timer.unref?.();
}
