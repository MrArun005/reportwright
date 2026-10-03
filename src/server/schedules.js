// Schedules: run a batch on a cron expression. Stored in data/schedules.json; checked every 30 s.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCron, nextRun } from './cron.js';
import { createBatch } from './jobs.js';

const FILE = path.join(process.cwd(), 'data', 'schedules.json');
const g = globalThis;
g.__pwSched ||= { timer: null };

export async function readSchedules() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return []; }
}
async function writeSchedules(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(list, null, 2));
}

export function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw Object.assign(new Error('Send a schedule object'), { status: 400 });
  if (!s.template) throw Object.assign(new Error('"template" is required'), { status: 400 });
  try { parseCron(s.cron); } catch (e) { throw Object.assign(e, { status: 400 }); }
  try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || 'UTC' }); } catch { throw Object.assign(new Error(`Unknown time zone "${s.timezone}"`), { status: 400 }); }
  if (!s.items && !s.itemsFrom) throw Object.assign(new Error('Give "items" or "itemsFrom"'), { status: 400 });
}

const withNext = (s) => ({ ...s, nextRunAt: s.enabled === false ? null : nextRun(s.cron, s.timezone || 'UTC')?.toISOString() || null });

export async function listSchedules() { return (await readSchedules()).map(withNext); }
export async function getSchedule(id) { const s = (await readSchedules()).find(x => x.id === id); return s ? withNext(s) : null; }

export async function createSchedule(body) {
  validateSchedule(body);
  const s = { enabled: true, timezone: 'UTC', format: 'pdf', ...body, id: `s_${crypto.randomBytes(5).toString('hex')}`, createdAt: new Date().toISOString() };
  const list = await readSchedules();
  list.push(s);
  await writeSchedules(list);
  return withNext(s);
}
export async function updateSchedule(id, patch) {
  const list = await readSchedules();
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return null;
  const next = { ...list[i], ...patch, id, createdAt: list[i].createdAt, updatedAt: new Date().toISOString() };
  validateSchedule(next);
  list[i] = next;
  await writeSchedules(list);
  return withNext(next);
}
export async function deleteSchedule(id) {
  const list = await readSchedules();
  const n = list.filter(x => x.id !== id);
  await writeSchedules(n);
  return n.length !== list.length;
}

export async function runSchedule(s, reason = 'manual') {
  const job = await createBatch({ template: s.template, items: s.items, itemsFrom: s.itemsFrom, format: s.format, output: s.output, webhook: s.webhook, fileName: s.fileName, schedule: { id: s.id, reason } });
  const list = await readSchedules();
  const i = list.findIndex(x => x.id === s.id);
  if (i >= 0) { list[i].lastRunAt = new Date().toISOString(); list[i].lastJobId = job.id; await writeSchedules(list); }
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
