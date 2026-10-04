// POST /api/v1/render — render a template to pdf | xlsx | html | csv | json.
// Body: { template: "id" | "id@version" | {definition}, format, parameters, data: { sourceName: json },
//         pdf: { userPassword, ownerPassword, permissions: { print, copy, … } } }
// A user's API key ("email|key") renders only what that user may view (src/server/perms.js).
import { apiPrincipal, fail } from '@/server/auth.js';
import { baseUrl } from '@/server/renderer.js';
import { renderInPool, admit } from '@/server/pool.js';
import { canDesign, checkReport } from '@/server/perms.js';
import { pdfEncryptOptions } from '@/exporters/encrypt.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  try {
    admit(principal); // a caller over the limit hears 429/503 before anything is read
    const body = await req.json().catch(() => { throw Object.assign(new Error('Send a JSON body'), { status: 400 }); });
    const encrypt = pdfEncryptOptions(body.pdf); // 400 on a bad shape, before loading anything
    // the cheap refusals here, before a render takes a place in the queue; the worker checks all of it again
    if (body.template && typeof body.template === 'object' && !canDesign(principal)) throw Object.assign(new Error('Only a designer can render a definition sent in the request. Render a saved template by its id.'), { status: 403 });
    if (body.data && !canDesign(principal)) throw Object.assign(new Error('Only a designer can send data for a render. Render the report with its own data.'), { status: 403 });
    if (typeof body.template === 'string') await checkReport(principal, body.template).catch((e) => { throw e.status === 404 ? Object.assign(new Error(`Template "${body.template}" not found`), { status: 404 }) : e; });
    // the template is read, checked and rendered in a render worker (src/server/pool.js), as this principal
    const r = await renderInPool({ ref: body.template, opt: { encrypt, parameters: body.parameters, data: body.data, format: body.format, baseUrl: baseUrl(req), state: body.state, pdfa: !!body.pdfa, ua: !!body.ua, formulas: body.formulas, static: !!body.static, sign: !!body.sign, principal } }, { signal: req.signal });
    await audit('report.render', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: body.format || 'pdf', params: body.parameters, detail: { pages: r.pages, via: 'api', inline: typeof body.template !== 'string', pushedData: !!body.data, signed: !!body.sign, encrypted: !!encrypt } });
    const name = (body.fileName || r.name || 'report').replace(/[^\w.-]+/g, '-');
    return new Response(r.bytes, { // the worker's buffer, moved here without a copy
      headers: {
        'content-type': r.contentType,
        'content-length': String(r.bytes.byteLength),
        'content-disposition': `${body.format === 'json' ? 'inline' : 'attachment'}; filename="${name}.${r.ext}"`,
        'x-pagewright-pages': String(r.pages),
        'x-pagewright-ms': String(r.ms),
        'x-pagewright-warnings': String(r.warnings),
      },
    });
  } catch (e) { return fail(e); }
}
