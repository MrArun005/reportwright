import { sampleHard, hardForAccount } from '@/sample/hard.js';

/** Difficult sample data for testing: nulls, Unicode, bad dates, mixed types, deep nesting, big groups. ?rows= sets the transaction count (max 200,000). ?account=<id> keeps one account's accounts and transactions. */
export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const rows = Math.min(200000, Math.max(1, Number(q.get('rows')) || 3000));
  const data = sampleHard(rows);
  return Response.json(q.get('account') ? hardForAccount(data, q.get('account')) : data);
}
