import { apiPrincipal } from '@/server/auth.js';
import { listReports } from '@/server/reports.js';
import { visibleReports } from '@/server/perms.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req); if (res) return res;
  return Response.json((await visibleReports(principal, await listReports())).map(({ access, folder, ...r }) => r));
}
