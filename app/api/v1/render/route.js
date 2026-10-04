// POST /api/v1/render — render a template to pdf | xlsx | html | csv | json.
// Body: { template: "id" | "id@version" | {definition}, format, parameters, data: { sourceName: json },
//         pdf: { userPassword, ownerPassword, permissions: { print, copy, … } } }
import { authorize, fail } from '@/server/auth.js';
import { loadTemplate, renderTo, baseUrl } from '@/server/renderer.js';
import { pdfEncryptOptions } from '@/exporters/encrypt.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => { throw Object.assign(new Error('Send a JSON body'), { status: 400 }); });
    const encrypt = pdfEncryptOptions(body.pdf); // 400 on a bad shape, before loading anything
    const def = await loadTemplate(body.template);
    const r = await renderTo(def, { encrypt, parameters: body.parameters, data: body.data, format: body.format, baseUrl: baseUrl(req), state: body.state, pdfa: !!body.pdfa, sign: !!body.sign });
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
