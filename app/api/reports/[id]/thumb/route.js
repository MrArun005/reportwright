// GET /api/reports/<id>/thumb — page 1 as SVG, with default parameters. Cached until the report file changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readReport, safeId } from '@/server/reports.js';
import { renderTo, baseUrl } from '@/server/renderer.js';
import { pageToSvg } from '@/exporters/svg.js';

export const runtime = 'nodejs';
const cache = (globalThis.__pwThumbs ||= new Map());

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const file = path.join(process.cwd(), 'reports', `${id}.pw.json`);
    const mtime = (await fs.stat(file).catch(() => null))?.mtimeMs;
    if (!mtime) return Response.json({ error: 'Report not found' }, { status: 404 });
    let hit = cache.get(id);
    if (!hit || hit.mtime !== mtime) {
      const def = await readReport(id);
      const r = await renderTo(def, { format: 'json', baseUrl: baseUrl(req) });
      const pg = r.model.pages[0];
      hit = { mtime, svg: pg ? pageToSvg(pg, r.model.width, r.model.height) : '', pages: r.model.pages.length };
      cache.set(id, hit);
    }
    return new Response(hit.svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache', 'x-pagewright-pages': String(hit.pages) } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || (e.missingParameters ? 422 : 500) });
  }
}
