// GET /api/reports/<id>/pdf?param=value[&format=xlsx|html|csv] — server-side render for links and quick checks (view access).
import { safeId } from '@/server/reports.js';
import { baseUrl } from '@/server/renderer.js';
import { principalOf } from '@/server/perms.js';
import { renderInPool } from '@/server/pool.js';
import { busyHeaders } from '@/server/auth.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const principal = await principalOf(req);
    const url = new URL(req.url);
    // ?pdfa=1 gives PDF/A-2b. Signing is not offered here: this route has no API key (use /api/v1/render).
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'format' && k !== 'pdfa'));
    const format = url.searchParams.get('format') || 'pdf';
    // read (view access, saved server-side data as a designer stored it) and rendered in a render worker
    const r = await renderInPool({ ref: safeId(id), how: 'runnable', opt: { parameters, format, baseUrl: baseUrl(req), pdfa: url.searchParams.get('pdfa') === '1', principal } }, { signal: req.signal });
    await audit('report.render', { req, principal, report: id, format, params: parameters, detail: { pages: r.pages, via: 'server link' } });
    return new Response(r.bytes, {
      headers: {
        'content-type': r.contentType,
        'content-length': String(r.bytes.byteLength),
        'content-disposition': `inline; filename="${id}.${r.ext}"`,
        'x-pagewright-pages': String(r.pages),
        'x-pagewright-ms': String(r.ms),
      },
    });
  } catch (e) {
    return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.status || (e.missingParameters ? 400 : 500), headers: busyHeaders(e) });
  }
}
