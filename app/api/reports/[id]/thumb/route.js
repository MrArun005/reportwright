// GET /api/reports/<id>/thumb — page 1 as SVG, with default parameters (view access). Cached per report content and
// per viewer (a subreport in it may show for one user and not another).
import crypto from 'node:crypto';
import { safeId } from '@/server/reports.js';
import { renderTo, baseUrl } from '@/server/renderer.js';
import { pageToSvg, fontFaceCss, fontKeysOf } from '@/exporters/svg.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';
import { principalOf, readReportFor, principalId } from '@/server/perms.js';

export const runtime = 'nodejs';
const cache = (globalThis.__pwThumbs ||= new Map());

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const principal = await principalOf(req);
    const def = await readReportFor(principal, id, 'view');
    const key = `${id}|${principalId(principal)}`;
    const hash = crypto.createHash('sha256').update(JSON.stringify(def)).digest('hex');
    let hit = cache.get(key);
    if (!hit || hit.hash !== hash) {
      const r = await renderTo(def, { format: 'json', baseUrl: baseUrl(req), principal });
      const pg = r.model.pages[0];
      // the home page declares the default fonts; a thumbnail declares the others it uses (fallbacks, uploads)
      const extra = pg ? fontKeysOf({ pages: [pg] }).filter(k => !ALL_FONT_KEYS.includes(k)) : [];
      const svg = pg ? pageToSvg(pg, r.model.width, r.model.height) : '';
      hit = { hash, svg: extra.length ? svg.replace(/^(<svg[^>]*>)/, `$1<style>${fontFaceCss(extra)}</style>`) : svg, pages: r.model.pages.length };
      if (cache.size > 2000) cache.clear();
      cache.set(key, hit);
    }
    return new Response(hit.svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-cache', 'x-pagewright-pages': String(hit.pages) } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || (e.missingParameters ? 422 : 500) });
  }
}
