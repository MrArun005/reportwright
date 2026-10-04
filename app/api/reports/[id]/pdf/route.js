// GET /api/reports/<id>/pdf?param=value[&format=xlsx|html|csv] — server-side render for links and quick checks (view access).
import { safeId } from '@/server/reports.js';
import { renderTo, baseUrl } from '@/server/renderer.js';
import { principalOf, readReportFor } from '@/server/perms.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const principal = await principalOf(req);
    const def = await readReportFor(principal, safeId(id), 'view');
    const url = new URL(req.url);
    // ?pdfa=1 gives PDF/A-2b. Signing is not offered here: this route has no API key (use /api/v1/render).
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'format' && k !== 'pdfa'));
    const format = url.searchParams.get('format') || 'pdf';
    const r = await renderTo(def, { parameters, format, baseUrl: baseUrl(req), pdfa: url.searchParams.get('pdfa') === '1', principal });
    await audit('report.render', { req, principal, report: id, format, params: parameters, detail: { pages: r.model.pages.length, via: 'server link' } });
    return new Response(r.bytes, {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `inline; filename="${id}.${r.ext}"`,
        'x-pagewright-pages': String(r.model.pages.length),
        'x-pagewright-ms': String(r.model.stats.ms),
      },
    });
  } catch (e) {
    return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.status || (e.missingParameters ? 400 : 500) });
  }
}
