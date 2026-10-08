// GET /api/reports/<id>/pdf?param=value[&format=xlsx|html|csv] — server-side render for links and quick checks (view access).
import { safeId } from '@/server/reports.js';
import { baseUrl, checkTimeZone } from '@/server/renderer.js';
import { principalOf, readRunnable, checkParameterValues } from '@/server/perms.js';
import { renderInPool, streamInPool, admit } from '@/server/pool.js';
import { busyHeaders } from '@/server/auth.js';
import { audit } from '@/server/audit.js';
import { throughSnapshot } from '@/server/snapshots.js';
import { errorResponse } from '@/server/errors.js';

import { outputHeaders } from '@/server/headers.js';

export const runtime = 'nodejs';

/** Formats whose output may stream (src/server/pool.js streamInPool). */
const STREAMS = new Set(['csv', 'xlsx', 'pdf']);
/** PDF/A, accessible, signed and encrypted PDFs are made whole (the model path), in a big worker. */
const streams = (o) => { const f = o.format || 'pdf'; return STREAMS.has(f) && !(f === 'pdf' && (o.pdfa || o.ua || o.sign || o.encrypt)); };

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const principal = await principalOf(req);
    admit(principal); // 429/503 before anything is read
    const url = new URL(req.url);
    // ?pdfa=1 gives PDF/A-2b, ?ua=1 an accessible PDF (PDF/UA-1; with pdfa, PDF/A-2a). Signing is not offered here: this route has no API key (use /api/v1/render).
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'format' && k !== 'formulas' && k !== 'csv' && k !== 'pdfa' && k !== 'ua' && k !== 'timeZone'));
    const format = url.searchParams.get('format') || 'pdf';
    // read once (view access, saved server-side data as a designer stored it), then rendered in a render worker
    const def = await readRunnable(principal, safeId(id));
    checkParameterValues(def, parameters, principal); // fixed lists and hidden parameters hold on the server too
    const opt = { parameters, format, baseUrl: baseUrl(req), pdfa: url.searchParams.get('pdfa') === '1', ua: url.searchParams.get('ua') === '1', formulas: url.searchParams.get('formulas') ?? undefined, csv: url.searchParams.get('csv') ?? undefined, timeZone: checkTimeZone(url.searchParams.get('timeZone')), principal }; // ?timeZone=: the viewer's zone
    const r = await throughSnapshot({ def, opt, principal }, () => (streams(opt) ? streamInPool({ ref: safeId(id), def, opt }, { signal: req.signal }) : renderInPool({ ref: safeId(id), def, opt }, { signal: req.signal })));
    await audit('report.render', { req, principal, report: id, format, params: parameters, detail: { pages: r.pages, ms: r.ms ?? undefined, via: 'server link', ...(r.snapshot !== 'off' ? { snapshot: r.snapshot } : {}) } });
    // a stream (a data CSV, Excel or plain PDF of a report that can stream): no length, its first rows go out while the rest render
    return new Response(r.stream || r.bytes, {
      headers: {
        'content-type': r.contentType,
        ...(r.stream ? {} : { 'content-length': String(r.bytes.byteLength) }),
        'content-disposition': `inline; filename="${id}.${r.ext}"`,
        'x-pagewright-pages': String(r.pages),
        'x-pagewright-ms': String(r.ms),
        'x-pagewright-snapshot': r.snapshot,
        ...outputHeaders(r.contentType), // report output on this origin: never a page of the app
      },
    });
  } catch (e) {
    return errorResponse(e, { status: e.status || (e.missingParameters ? 400 : 500), headers: busyHeaders(e), extra: { missingParameters: e.missingParameters } });
  }
}
