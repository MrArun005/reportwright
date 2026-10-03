import { listSampleAccounts } from '@/sample/loans.js';

export async function GET() {
  return Response.json(listSampleAccounts());
}
