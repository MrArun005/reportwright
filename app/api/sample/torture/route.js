import { sampleTorture } from '@/sample/torture.js';

/** Synthetic lending portfolio (180 loans, 12 months) for the ReportWright Torture Test report. Deterministic. */
export async function GET() {
  return Response.json(sampleTorture());
}
