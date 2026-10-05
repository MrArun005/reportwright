// GET /api/sample/stress/<rows> — generated rows for the stress sample. Anyone who is not signed in (an embed reader
// with PW_EMBED_ORIGINS, PW_PUBLIC_READONLY) gets at most ANON_MAX_ROWS: 200,000 rows is ~15 MB built synchronously,
// a cheap way to hold the event loop (REVIEW-SECURITY-2 L8). Signed-in users and open development servers get the full cap.
import { sampleStress, STRESS_MAX_ROWS } from '@/sample/stress.js';
import { principalOf } from '@/server/perms.js';
import { accountsOn, currentUser } from '@/server/session.js';

export const ANON_MAX_ROWS = 5000;

export async function GET(req, { params }) {
  const { rows } = await params;
  const n = Number(rows);
  const p = await principalOf(req).catch(() => ({ kind: 'anon' }));
  // the server's own call (a server render's one-GET pass) was already authorised by the render that sent it
  const internal = accountsOn() && !!(await currentUser(req).catch(() => null))?.internal;
  const max = !internal && ['anon', 'public', 'nobody'].includes(p.kind) ? Math.min(ANON_MAX_ROWS, STRESS_MAX_ROWS) : STRESS_MAX_ROWS;
  if (!Number.isInteger(n) || n < 1 || n > max) return Response.json({ error: `Give a row count from 1 to ${max}${max < STRESS_MAX_ROWS ? ' (sign in for more)' : ''}` }, { status: 400 });
  return Response.json(sampleStress(n));
}
