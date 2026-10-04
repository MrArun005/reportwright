import { sampleStress, STRESS_MAX_ROWS } from '@/sample/stress.js';

export async function GET(_req, { params }) {
  const { rows } = await params;
  const n = Number(rows);
  if (!Number.isInteger(n) || n < 1 || n > STRESS_MAX_ROWS) return Response.json({ error: `Give a row count from 1 to ${STRESS_MAX_ROWS}` }, { status: 400 });
  return Response.json(sampleStress(n));
}
