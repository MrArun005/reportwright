// GET /api/fonts: the uploaded fonts. POST /api/fonts: upload one (designers; see src/server/access.js).
// POST takes multipart/form-data (file, family, weight, style) or the raw file with ?family=&weight=&style=.
// Empty names are read from the font. TTF, OTF, WOFF and WOFF2 up to 20 MB.
import { listFonts, saveFont, MAX_FONT_BYTES } from '@/server/fonts.js';

export const runtime = 'nodejs';

const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });

export async function GET() {
  try { return Response.json(await listFonts()); } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    if (Number(req.headers.get('content-length')) > MAX_FONT_BYTES + 64 * 1024) return fail(Object.assign(new Error('A font can be at most 20 MB.'), { status: 413 }));
    let bytes, names;
    if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return fail(Object.assign(new Error('Add the font file (form field "file").'), { status: 400 }));
      bytes = new Uint8Array(await file.arrayBuffer());
      names = { family: String(form.get('family') || ''), weight: String(form.get('weight') || ''), style: String(form.get('style') || '') };
    } else {
      bytes = new Uint8Array(await req.arrayBuffer()); // ponytail: read before the size check when there is no content-length; cap at the reverse proxy if that matters
      const q = new URL(req.url).searchParams;
      names = { family: q.get('family') || '', weight: q.get('weight') || '', style: q.get('style') || '' };
    }
    return Response.json(await saveFont(bytes, names), { status: 201 });
  } catch (e) { return fail(e); }
}
