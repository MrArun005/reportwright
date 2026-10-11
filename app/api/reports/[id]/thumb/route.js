// GET /api/reports/<id>/thumb — page 1 as SVG, with default parameters (view access, checked on every request).
// Drawn in a worker thread (src/server/thumbs.js): until this version is drawn the answer is 202 with a blank
// placeholder and Retry-After, and the browser asks again.
import { safeId } from '@/server/reports.js';
import { baseUrl } from '@/server/renderer.js';
import { principalOf, readRunnable } from '@/server/perms.js';
import { thumbnail } from '@/server/thumbs.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

import { outputHeaders, rwHeaders } from '@/server/headers.js';

export const runtime = 'nodejs';

const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"><rect width="595" height="842" fill="#fff"/></svg>';

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const principal = await principalOf(req);
    const def = await readRunnable(principal, id); // its SQL runs here too
    const t = await thumbnail(id, def, principal, baseUrl(req));
    if (t.pending) return new Response(PLACEHOLDER, { status: 202, headers: { 'content-type': 'image/svg+xml', ...outputHeaders('image/svg+xml'), 'cache-control': 'no-store', 'retry-after': '1', ...rwHeaders({ pending: '1' }) } });
    if (t.error) return Response.json({ error: t.error }, { status: t.status || 500 });
    // page 1 with live data: a view. repeat: the same viewer's thumbnail of the same report again within 10 s is
    // counted into one entry (audit.js floodGate), never dropped
    await audit('report.view', { req, principal, report: id, detail: { via: 'thumbnail' }, repeat: true });
    return new Response(t.svg, { headers: { 'content-type': 'image/svg+xml', ...outputHeaders('image/svg+xml'), 'cache-control': 'private, no-cache', ...rwHeaders({ pages: String(t.pages) }) } });
  } catch (e) {
    return errorResponse(e, { status: e.status || (e.missingParameters ? 422 : 500) });
  }
}
