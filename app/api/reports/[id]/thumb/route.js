// GET /api/reports/<id>/thumb — page 1 as SVG, with default parameters (view access, checked on every request).
// Drawn in a worker thread (src/server/thumbs.js): until this version is drawn the answer is 202 with a blank
// placeholder and Retry-After, and the browser asks again.
import { safeId } from '@/server/reports.js';
import { baseUrl } from '@/server/renderer.js';
import { principalOf, readRunnable, principalId } from '@/server/perms.js';
import { thumbnail } from '@/server/thumbs.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

const seen = (/** @type {any} */ (globalThis).__pwThumbSeen ||= new Map());
/** True the first time in an hour for this key (per process; the oldest keys go past 10,000). @param {string} k */
function firstInHour(k) {
  const t = seen.get(k);
  if (t && Date.now() - t < 3600000) return false;
  seen.delete(k); seen.set(k, Date.now());
  if (seen.size > 10000) seen.delete(seen.keys().next().value);
  return true;
}
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"><rect width="595" height="842" fill="#fff"/></svg>';

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const principal = await principalOf(req);
    const def = await readRunnable(principal, id); // its SQL runs here too
    const t = await thumbnail(id, def, principal, baseUrl(req));
    if (t.pending) return new Response(PLACEHOLDER, { status: 202, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', 'retry-after': '1', 'x-pagewright-pending': '1' } });
    if (t.error) return Response.json({ error: t.error }, { status: t.status || 500 });
    // page 1 with live data: a view, written once per viewer and report an hour (a home page of 2,000 reports must not
    // write 2,000 events on every visit); PW_AUDIT_THUMBNAILS=0: never
    if (process.env.PW_AUDIT_THUMBNAILS !== '0' && firstInHour(`${principalId(principal)}|${id}`)) await audit('report.view', { req, principal, report: id, detail: { via: 'thumbnail' } });
    return new Response(t.svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-cache', 'x-pagewright-pages': String(t.pages) } });
  } catch (e) {
    return errorResponse(e, { status: e.status || (e.missingParameters ? 422 : 500) });
  }
}
