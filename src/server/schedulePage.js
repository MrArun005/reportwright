// @ts-check
// Helpers for the Schedules page's API (app/api/schedules).
import { principalOf, canDesign } from './perms.js';

const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });

/** The principal for these routes: a designer (or the trusted open server); else { res }. @param {Request} req */
export async function designer(req) {
  const p = await principalOf(req);
  if (!canDesign(p)) return { res: json({ error: 'Only a designer can manage schedules.' }, 403) };
  return { p };
}

/** A body from the page, as a schedule spec: one item with these parameters. @param {any} b */
export function specOf(b) {
  const out = { template: b.template, cron: b.cron, timezone: b.timezone || 'UTC', format: b.format || 'pdf', enabled: b.enabled !== false, fromSnapshot: !!b.fromSnapshot, name: typeof b.name === 'string' ? b.name.slice(0, 120) : undefined };
  const params = b.parameters && typeof b.parameters === 'object' && !Array.isArray(b.parameters) ? b.parameters : {};
  out.items = [{ parameters: params, ...(b.fileName ? { name: String(b.fileName).slice(0, 120) } : {}) }];
  if (b.email) out.email = b.email;
  if (typeof out.template !== 'string') throw Object.assign(new Error('Pick a saved report.'), { status: 400 });
  return out;
}
