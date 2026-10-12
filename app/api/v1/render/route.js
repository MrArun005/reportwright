// POST /api/v1/render — render a template to pdf | xlsx | html | csv | json.
// Body: { template: "id" | "id@version" | {definition}, format, parameters, data: { sourceName: json },
//         pdf: { userPassword, ownerPassword, permissions: { print, copy, … } } }
// A user's API key ("email|key") renders only what that user may view (src/server/perms.js).
import { apiPrincipal, fail } from '@/server/auth.js';
import { baseUrl, loadTemplate, checkTimeZone } from '@/server/renderer.js';
import { renderInPool, streamInPool, arrive } from '@/server/pool.js';
import { canDesign, checkParameterValues } from '@/server/perms.js';
import { pdfEncryptOptions } from '@/exporters/encrypt.js';
import { audit } from '@/server/audit.js';
import { throughSnapshot } from '@/server/snapshots.js';

import { outputHeaders, rwHeaders } from '@/server/headers.js';

export const runtime = 'nodejs';

/** Formats whose output may stream (src/server/pool.js streamInPool). */
const STREAMS = new Set(['csv', 'xlsx', 'pdf']);
/** Signed and encrypted PDFs are made whole (the model path), in a big worker. */
const streams = (o) => { const f = o.format || 'pdf'; return STREAMS.has(f) && !(f === 'pdf' && (o.sign || o.encrypt)); };

/** Only the flags that are on: a render's audit event stays small (it is written for every render). */
const flags = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

export async function POST(req) {
  let ticket;
  try { ticket = arrive(req); } catch (e) { return fail(e); } // counted from arrival: 429/503 before auth or the body
  try {
    const { principal, res } = await apiPrincipal(req, { quiet: true }); // report.render below is this call's event
    if (res) { ticket.forget(); return res; }
    ticket.bind(principal); // a caller over the limit hears 429/503 before anything is read
    const body = await req.json().catch(() => { throw Object.assign(new Error('Send a JSON body'), { status: 400 }); });
    const encrypt = pdfEncryptOptions(body.pdf); // 400 on a bad shape, before loading anything
    // the cheap refusals here, before a render takes a place in the queue; the worker checks all of it again
    if (body.template && typeof body.template === 'object' && !canDesign(principal)) throw Object.assign(new Error('Only a designer can render a definition sent in the request. Render a saved template by its id.'), { status: 403 });
    if (body.data && !canDesign(principal)) throw Object.assign(new Error('Only a designer can send data for a render. Render the report with its own data.'), { status: 403 });
    // read and checked once, here, as this principal (view access; server-side data as a designer stored it); the
    // worker renders it (src/server/pool.js) and loads its subreports as this principal
    const def = await loadTemplate(body.template, principal);
    checkParameterValues(def, body.parameters, principal); // fixed lists and hidden parameters hold on the server too
    const opt = { encrypt, timeZone: checkTimeZone(body.timeZone), parameters: body.parameters, strictParameters: true, data: body.data, format: body.format, baseUrl: baseUrl(req), state: body.state, pdfa: !!body.pdfa, ua: !!body.ua, formulas: body.formulas, csv: body.csv, static: !!body.static, sign: !!body.sign, principal };
    // a saved template may come from the snapshot cache (src/server/snapshots.js: off unless an admin sets a TTL)
    const r = await throughSnapshot({ def: typeof body.template === 'string' ? def : null, opt, principal }, () => { const job = { ref: typeof body.template === 'string' ? body.template : undefined, def, opt }; return streams(opt) ? streamInPool(job, { signal: req.signal, ticket }) : renderInPool(job, { signal: req.signal, ticket }); });
    await audit('report.render', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: body.format || 'pdf', params: body.parameters, detail: { pages: r.pages, ms: r.ms ?? undefined, via: 'api', ...(r.snapshot !== 'off' ? { snapshot: r.snapshot } : {}), ...flags({ inline: typeof body.template !== 'string', pushedData: !!body.data, signed: !!body.sign, encrypted: !!encrypt }) } }); // the only event of a render (no api.call)
    const name = (body.fileName || r.name || 'report').replace(/[^\w.-]+/g, '-');
    // a stream (a data CSV, Excel or plain PDF of a report that can stream): no length, its first rows go out while the rest render
    return new Response(r.stream || r.bytes, { // the worker's buffer, moved here without a copy
      headers: {
        'content-type': r.contentType,
        ...outputHeaders(r.contentType),
        ...(r.stream ? {} : { 'content-length': String(r.bytes.byteLength) }),
        'content-disposition': `${body.format === 'json' ? 'inline' : 'attachment'}; filename="${name}.${r.ext}"`,
        ...rwHeaders({ pages: String(r.pages), ms: String(r.ms), warnings: String(r.warnings), snapshot: r.snapshot }),
      },
    });
  } catch (e) { return fail(e); } finally { ticket.release(); }
}
