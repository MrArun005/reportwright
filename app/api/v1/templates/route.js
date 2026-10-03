import { authorize } from '@/server/auth.js';
import { listReports } from '@/server/reports.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const denied = authorize(req); if (denied) return denied;
  return Response.json(await listReports());
}
