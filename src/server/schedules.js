// Schedules: run a batch on a cron expression. Stored by src/server/storage (data/schedules.json by default); checked every 30 s.
import crypto from 'node:crypto';
import { parseCron, nextRun } from './cron.js';
import { createBatch } from './jobs.js';
import { store } from './storage/index.js';

const g = globalThis;
g.__pwSched ||= { timer: null };

/** Every schedule, oldest first. */
export async function readSchedules() {
  try {
    return (await store().list('schedules')).map(r => JSON.parse(r.text)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  } catch { return []; }
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

export async function listSchedules() { return (await readSchedules()).map(withNext); }
export async function getSchedule(id) { const s = await readOne(id); return s ? withNext(s) : null; }

export async function createSchedule(body) {
  validateSchedule(body);
  const s = { enabled: true, timezone: 'UTC', format: 'pdf', ...body, id: `s_${crypto.randomBytes(5).toString('hex')}`, createdAt: new Date().toISOString() };
  await save(s);
  return withNext(s);
}
export async function updateSchedule(id, patch) {
  const cur = await readOne(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString() };
  validateSchedule(next);
  await save(next);
  return withNext(next);
}
export async function deleteSchedule(id) { return store().remove('schedules', String(id)); }

export async function runSchedule(s, reason = 'manual') {
  const job = await createBatch({ template: s.template, items: s.items, itemsFrom: s.itemsFrom, format: s.format, output: s.output, webhook: s.webhook, fileName: s.fileName, pdfa: s.pdfa, sign: s.sign, schedule: { id: s.id, reason } });
  const cur = await readOne(s.id);
  if (cur) { cur.lastRunAt = new Date().toISOString(); cur.lastJobId = job.id; await save(cur); }
  return job;
}

/**
 * Due when a run time has passed since the last run (or the last edit). lastRunAt is on disk, so a
 * restart does not fire twice, and after downtime a missed run happens once, late.
 * ponytail: one process only; extra replicas set PW_SCHEDULER=off (a lock file or DB row if that changes).
 */
export function isDue(s, now = new Date()) {
  if (s.enabled === false) return false;
  const stamps = [s.lastRunAt, s.updatedAt, s.createdAt].map(t => Date.parse(t || '')).filter(Number.isFinite);
  const since = stamps.length ? Math.max(...stamps) : now.getTime() - 60000;
  const at = nextRun(s.cron, s.timezone || 'UTC', new Date(since));
  return !!at && at <= now;
}

async function tick() {
  const now = new Date();
  for (const s of await readSchedules()) {
    try { if (isDue(s, now)) await runSchedule(s, 'cron'); }
    catch (e) { console.error(`[pagewright] schedule ${s.id}: ${e.message}`); }
  }
}

export function startScheduler() {
  if (g.__pwSched.timer || process.env.PW_SCHEDULER === 'off') return;
  g.__pwSched.timer = setInterval(() => { tick().catch(() => {}); }, 30000);
  g.__pwSched.timer.unref?.();
}
