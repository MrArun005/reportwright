import { sampleSales } from '@/sample/sales.js';

export async function GET(_req, { params }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) return Response.json({ error: 'Give a four-digit year' }, { status: 400 });
  return Response.json(sampleSales(year));
}
