// GET /fonts/custom/<id>: an uploaded font file, for browsers (@font-face) and the engine in a Worker.
// The id is a hash of the content, so the file never changes: cache it for a year.
import { readFont } from '@/server/fonts.js';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  const { id } = await params;
  const f = await readFont(id);
  if (!f) return Response.json({ error: 'Font not found' }, { status: 404 });
  return new Response(f.bytes, {
    headers: { 'content-type': f.format === 'opentype' ? 'font/otf' : 'font/ttf', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
