// Compare two PDFs (the original report's export and the converted report's): POST multipart/form-data with the files
// "original" and "converted" (at most 5 MB each, as an import). Returns compare.json with the self-contained page as
// "html"; ?format=html returns the page alone. Who may import a report may compare: designers, admins, service keys.
// Untrusted input: admitted like a render (src/server/pool.js arrive), the body read under a cap before it is parsed,
// two files only, the comparison bounded (src/compare/index.js LIMITS) and stopped after 60 s.
import { principalOf } from '@/server/perms.js';
import { arrive } from '@/server/pool.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';
import { comparePdfs, toJson, toHtml } from '@/compare/index.js';

export const runtime = 'nodejs';
export const MAX_FILE = 5 * 1024 * 1024; // the import route's limit
const MAX_BODY = 2 * MAX_FILE + 64 * 1024;
const WALL_MS = 60_000;
let running = 0; // ponytail: per-process cap beside the pool's admission; a shared queue if compares ever need to scale out
const MAX_RUNNING = 2;
const err = (status, error, headers) => Response.json({ error }, { status, headers });

/** the body, read under MAX_BODY whatever content-length says (or does not) */
async function readCapped(req) {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return null;
  if (!req.body) return new Uint8Array(0);
  const parts = [];
  let n = 0;
  for await (const c of req.body) {
    n += c.length;
    if (n > MAX_BODY) return null;
    parts.push(c);
  }
  return Buffer.concat(parts);
}

export async function POST(req) {
  let ticket;
  try {
    ticket = arrive(req); // 429/503 before auth or the body, like a render
  } catch (e) {
    return errorResponse(e);
  }
  try {
    const p = await principalOf(req);
    if (p.kind === 'anon') return err(401, 'Sign in to compare reports');
    if (!(p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && p.role !== 'viewer')))
      return err(403, 'Only designers can compare reports');
    ticket.bind(p);
    if (running >= MAX_RUNNING)
      return err(429, 'Too many comparisons are running; try again shortly', { 'retry-after': '5' });
    running++;
    try {
      const body = await readCapped(req);
      if (!body) return err(413, `Each PDF can be at most ${MAX_FILE / 1048576} MB`);
      let form;
      try {
        form = await new Request(req.url, {
          method: 'POST',
          headers: { 'content-type': req.headers.get('content-type') || '' },
          body,
        }).formData();
      } catch {
        return err(400, 'Send multipart/form-data with the files "original" and "converted"');
      }
      const all = [...form.values()].filter((v) => typeof v !== 'string');
      if (all.length !== 2) return err(400, 'Send exactly two files, "original" and "converted"');
      const files = ['original', 'converted'].map((k) => form.get(k));
      if (files.some((f) => !f || typeof f === 'string')) return err(400, 'Send the files "original" and "converted"');
      if (files.some((f) => f.size > MAX_FILE)) return err(413, `Each PDF can be at most ${MAX_FILE / 1048576} MB`);
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
          wallMs: WALL_MS,
          names: files.map((f) => String(f.name || 'file.pdf').slice(0, 120)),
        });
      } catch (e) {
        return err(e.status || 422, `Could not compare the PDFs: ${String(e.message).slice(0, 300)}`);
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
  } finally {
    ticket.release();
  }
}
