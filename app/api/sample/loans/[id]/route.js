import { sampleLoan } from '@/sample/loans.js';

export async function GET(_req, { params }) {
  const { id } = await params;
  const data = sampleLoan(id);
  return data ? Response.json(data) : Response.json({ error: `No loan account "${id}"` }, { status: 404 });
}
