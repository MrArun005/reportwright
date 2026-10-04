// POST /api/v1/render — render a template to pdf | xlsx | html | csv | json.
// Body: { template: "id" | "id@version" | {definition}, format, parameters, data: { sourceName: json },
//         pdf: { userPassword, ownerPassword, permissions: { print, copy, … } } }
// A user's API key ("email|key") renders only what that user may view (src/server/perms.js).
import { apiPrincipal, fail } from '@/server/auth.js';
import { loadTemplate, renderTo, baseUrl } from '@/server/renderer.js';
import { pdfEncryptOptions } from '@/exporters/encrypt.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  try {
    const body = await req.json().catch(() => { throw Object.assign(new Error('Send a JSON body'), { status: 400 }); });
    const encrypt = pdfEncryptOptions(body.pdf); // 400 on a bad shape, before loading anything
    const def = await loadTemplate(body.template, principal);
    const r = await renderTo(def, { encrypt, parameters: body.parameters, data: body.data, format: body.format, baseUrl: baseUrl(req), state: body.state, pdfa: !!body.pdfa, sign: !!body.sign, principal });
    await audit('report.render', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: body.format || 'pdf', params: body.parameters, detail: { pages: r.model.pages.length, via: 'api', inline: typeof body.template !== 'string', pushedData: !!body.data, signed: !!body.sign, encrypted: !!encrypt } });
    const name = (body.fileName || def.name || 'report').replace(/[^\w.-]+/g, '-');
    return new Response(r.bytes, {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `${body.format === 'json' ? 'inline' : 'attachment'}; filename="${name}.${r.ext}"`,
        'x-pagewright-pages': String(r.model.pages.length),
        'x-pagewright-ms': String(r.model.stats.ms),
        'x-pagewright-warnings': String(r.model.warnings.length),
      },
    });
  } catch (e) { return fail(e); }
}
