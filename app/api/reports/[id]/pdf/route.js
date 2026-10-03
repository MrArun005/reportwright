// GET /api/reports/<id>/pdf?param=value[&format=xlsx|html|csv] — server-side render for links and quick checks.
import { readReport, safeId } from '@/server/reports.js';
import { renderTo, baseUrl } from '@/server/renderer.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const def = await readReport(safeId(id));
    if (!def) return Response.json({ error: 'Report not found' }, { status: 404 });
    const url = new URL(req.url);
    // ?pdfa=1 gives PDF/A-2b. Signing is not offered here: this route has no API key (use /api/v1/render).
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'format' && k !== 'pdfa'));
    const format = url.searchParams.get('format') || 'pdf';
    const r = await renderTo(def, { parameters, format, baseUrl: baseUrl(req), pdfa: url.searchParams.get('pdfa') === '1' });
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
