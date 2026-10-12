// Compare two PDFs (the original report's export and the converted report's): POST multipart/form-data with the files
// "original" and "converted" (at most 20 MB each). Returns compare.json with the self-contained page as "html";
// ?format=html returns the page alone. Who may import a report may compare: designers, admins, service keys.
import { principalOf } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';
import { comparePdfs, toJson, toHtml } from '@/compare/index.js';

export const runtime = 'nodejs';
const MAX = 20 * 1024 * 1024;
let running = 0; // ponytail: per-process cap; a shared queue if compares ever need to scale out
const MAX_RUNNING = 2;

export async function POST(req) {
  try {
    const p = await principalOf(req);
    if (p.kind === 'anon') return Response.json({ error: 'Sign in to compare reports' }, { status: 401 });
    if (!(p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && p.role !== 'viewer')))
      return Response.json({ error: 'Only designers can compare reports' }, { status: 403 });
    if (Number(req.headers.get('content-length')) > 2 * MAX + 64 * 1024)
      return Response.json({ error: 'Each PDF can be at most 20 MB' }, { status: 413 });
    if (running >= MAX_RUNNING)
      return Response.json(
        { error: 'Too many comparisons are running; try again shortly' },
        { status: 429, headers: { 'retry-after': '5' } },
      );
    running++;
    try {
      let form;
      try {
        form = await req.formData();
      } catch {
        return Response.json(
          { error: 'Send multipart/form-data with the files "original" and "converted"' },
          { status: 400 },
        );
      }
      const files = ['original', 'converted'].map((k) => form.get(k));
      if (files.some((f) => !f || typeof f === 'string'))
        return Response.json({ error: 'Send the files "original" and "converted"' }, { status: 400 });
      if (files.some((f) => f.size > MAX))
        return Response.json({ error: 'Each PDF can be at most 20 MB' }, { status: 413 });
      const bytes = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
      const sp = new URL(req.url).searchParams;
      const n = (k, d, lo, hi) => {
        const v = Number(sp.get(k) ?? d);
        return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
      };
      let r;
      try {
        r = await comparePdfs(bytes[0], bytes[1], {
          tolerance: n('tolerance', 2, 0, 100),
          threshold: n('threshold', 0, 0, 100),
          dpi: n('dpi', 72, 72, 100),
          numbersOnly: sp.get('numbersOnly') === '1',
          names: files.map((f) => String(f.name || 'file.pdf').slice(0, 120)),
        });
      } catch (e) {
        return Response.json(
          { error: `Could not read the PDFs: ${String(e.message).slice(0, 300)}` },
          { status: e.status || 422 },
        );
      }
      await audit('report.compare', { req, principal: p, detail: { verdict: r.verdict, pages: r.pageCount } });
      const html = toHtml(r);
      if (sp.get('format') === 'html')
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          },
        });
      return new Response(`${toJson(r).trimEnd().slice(0, -1)},\n  "html": ${JSON.stringify(html)}\n}\n`, {
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      running--;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
