// GET /api/fonts: the uploaded fonts. POST /api/fonts: upload one (designers; see src/server/access.js).
// POST takes multipart/form-data (file, family, weight, style) or the raw file with ?family=&weight=&style=.
// Empty names are read from the font. TTF, OTF, WOFF and WOFF2 up to 20 MB.
import { listFonts, saveFont, MAX_FONT_BYTES } from '@/server/fonts.js';
import { principalOf, canDesign } from '@/server/perms.js';
import { errorResponse } from '@/server/errors.js';
import { readBody } from '@/server/reports.js';

export const runtime = 'nodejs';

const fail = (e) => errorResponse(e);

export async function GET() {
  try { return Response.json(await listFonts()); } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    if (!canDesign(await principalOf(req))) return fail(Object.assign(new Error('Only designers can upload fonts.'), { status: 403 }));
    if (Number(req.headers.get('content-length')) > MAX_FONT_BYTES + 64 * 1024) return fail(Object.assign(new Error('A font can be at most 20 MB.'), { status: 413 }));
    let bytes, names;
    const tooBig = () => Object.assign(new Error('A font can be at most 20 MB.'), { status: 413 });
    const raw = await readBody(req, MAX_FONT_BYTES + 64 * 1024, tooBig); // counted as it arrives, chunked too
    if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) {
      const form = await new Response(raw, { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return fail(Object.assign(new Error('Add the font file (form field "file").'), { status: 400 }));
      bytes = new Uint8Array(await file.arrayBuffer());
      names = { family: String(form.get('family') || ''), weight: String(form.get('weight') || ''), style: String(form.get('style') || '') };
    } else {
      bytes = raw;
      const q = new URL(req.url).searchParams;
      names = { family: q.get('family') || '', weight: q.get('weight') || '', style: q.get('style') || '' };
    }
    return Response.json(await saveFont(bytes, names), { status: 201 });
  } catch (e) { return fail(e); }
}
