// POST /api/v1/render — render a template to pdf | xlsx | html | csv | json.
// Body: { template: "id" | "id@version" | {definition}, format, parameters, data: { sourceName: json },
//         pdf: { userPassword, ownerPassword, permissions: { print, copy, … } } }
// A user's API key ("email|key") renders only what that user may view (src/server/perms.js).
import { apiPrincipal, fail } from '@/server/auth.js';
import { baseUrl, loadTemplate, checkTimeZone } from '@/server/renderer.js';
import { renderInPool, admit } from '@/server/pool.js';
import { canDesign } from '@/server/perms.js';
import { pdfEncryptOptions } from '@/exporters/encrypt.js';
import { audit } from '@/server/audit.js';
import { throughSnapshot } from '@/server/snapshots.js';

export const runtime = 'nodejs';

/** Only the flags that are on: a render's audit event stays small (it is written for every render). */
const flags = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req, { quiet: true }); // its own event (render) or none (a scrape)
  if (res) return res;
  try {
    admit(principal); // a caller over the limit hears 429/503 before anything is read
    const body = await req.json().catch(() => { throw Object.assign(new Error('Send a JSON body'), { status: 400 }); });
    const encrypt = pdfEncryptOptions(body.pdf); // 400 on a bad shape, before loading anything
    // the cheap refusals here, before a render takes a place in the queue; the worker checks all of it again
    if (body.template && typeof body.template === 'object' && !canDesign(principal)) throw Object.assign(new Error('Only a designer can render a definition sent in the request. Render a saved template by its id.'), { status: 403 });
    if (body.data && !canDesign(principal)) throw Object.assign(new Error('Only a designer can send data for a render. Render the report with its own data.'), { status: 403 });
    // read and checked once, here, as this principal (view access; server-side data as a designer stored it); the
    // worker renders it (src/server/pool.js) and loads its subreports as this principal
    const def = await loadTemplate(body.template, principal);
    const opt = { encrypt, timeZone: checkTimeZone(body.timeZone), parameters: body.parameters, data: body.data, format: body.format, baseUrl: baseUrl(req), state: body.state, pdfa: !!body.pdfa, ua: !!body.ua, formulas: body.formulas, static: !!body.static, sign: !!body.sign, principal };
    // a saved template may come from the snapshot cache (src/server/snapshots.js: off unless an admin sets a TTL)
    const r = await throughSnapshot({ def: typeof body.template === 'string' ? def : null, opt, principal }, () => renderInPool({ ref: typeof body.template === 'string' ? body.template : undefined, def, opt }, { signal: req.signal }));
    await audit('report.render', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: body.format || 'pdf', params: body.parameters, detail: { pages: r.pages, via: 'api', ...(r.snapshot !== 'off' ? { snapshot: r.snapshot } : {}), ...flags({ inline: typeof body.template !== 'string', pushedData: !!body.data, signed: !!body.sign, encrypted: !!encrypt }) } }); // the only event of a render (no api.call)
    const name = (body.fileName || r.name || 'report').replace(/[^\w.-]+/g, '-');
    return new Response(r.bytes, { // the worker's buffer, moved here without a copy
      headers: {
        'content-type': r.contentType,
        'content-length': String(r.bytes.byteLength),
        'content-disposition': `${body.format === 'json' ? 'inline' : 'attachment'}; filename="${name}.${r.ext}"`,
        'x-pagewright-pages': String(r.pages),
        'x-pagewright-ms': String(r.ms),
        'x-pagewright-warnings': String(r.warnings),
        'x-pagewright-snapshot': r.snapshot,
      },
    });
  } catch (e) { return fail(e); }
}
