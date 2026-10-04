import { sampleHard } from '@/sample/hard.js';

/** Difficult sample data for testing: nulls, Unicode, bad dates, mixed types, deep nesting, big groups. ?rows= sets the transaction count (max 200,000). */
export async function GET(req) {
  const rows = Math.min(200000, Math.max(1, Number(new URL(req.url).searchParams.get('rows')) || 3000));
  return Response.json(sampleHard(rows));
}
