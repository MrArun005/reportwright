// GET /api/v1/livez — 200 while the process answers. No key needed, nothing in it (for a container's liveness probe).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() { return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }); }
