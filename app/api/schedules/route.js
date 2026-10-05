// The Schedules page's API (a signed-in designer or admin; on an open server, the trusted operator). A schedule made
// here belongs to the user and runs as the user is now (src/server/perms.js principalFromId with session); API keys
// keep their own schedules at /api/v1/schedules.
//   GET  — { schedules (mine, each with its last batch), reports (the ones I may view), mail: { on, domains } }
//   POST { template, cron, timezone?, format?, parameters?, email?: { to, subject?, body?, attach? }, fromSnapshot?, enabled? }
import { visibleReports } from '@/server/perms.js';
import { designer, specOf } from '@/server/schedulePage.js';
import { listSchedules, createSchedule } from '@/server/schedules.js';
import { getJob } from '@/server/jobs.js';
import { listReports } from '@/server/reports.js';
import { mailOn, allowedDomains } from '@/server/mail.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';
const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(req) {
  const { p, res } = await designer(req);
  if (res) return res;
  const list = await listSchedules(p);
  const schedules = await Promise.all(list.map(async s => {
    const j = s.lastJobId ? await getJob(s.lastJobId, p) : null;
    return { ...s, lastJob: j && { id: j.id, status: j.status, done: j.done, failed: j.failed, mail: j.mail || null, finishedAt: j.finishedAt || null, download: !!j.download } };
  }));
  const reports = (await visibleReports(p, await listReports())).map(r => ({ id: r.id, name: r.name, parameters: r.parameters }));
  return json({ schedules, reports, mail: { on: mailOn(), domains: allowedDomains() } });
}

export async function POST(req) {
  const { p, res } = await designer(req);
  if (res) return res;
  try {
    const s = await createSchedule(specOf(await req.json()), p, { session: true });
    await audit('schedule.create', { req, principal: p, report: s.template, detail: { schedule: s.id, cron: s.cron, timezone: s.timezone, email: s.email ? s.email.to.length : 0, via: 'page' } });
    return json(s, 201);
  } catch (e) { return json({ error: e.message }, e.status || 500); }
}
