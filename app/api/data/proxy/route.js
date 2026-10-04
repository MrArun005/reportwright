// REST proxy for data sources that need it (CORS, secret headers).
// Only hosts in PW_PROXY_ALLOW may be reached, and never a private address (SSRF): safeFetch
// checks every resolved address, so DNS rebinding cannot get past it.
import { safeFetch, strictUrl } from '@/server/safeFetch.js';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const allow = () => (process.env.PW_PROXY_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export async function GET(req) {
  const target = new URL(req.url).searchParams.get('url');
  let u;
  try { u = strictUrl(target || ''); } catch (e) { return Response.json({ error: `Give a plain absolute http(s) URL in ?url= (${e.message})` }, { status: 400 }); } // the URL checked is the URL fetched
  if (!allow().includes(u.hostname.toLowerCase())) {
    return Response.json({ error: `The host "${u.hostname}" is not in PW_PROXY_ALLOW` }, { status: 403 });
  }
  try {
    const res = await safeFetch(u, { headers: { accept: 'application/json, text/csv;q=0.9, */*;q=0.1' } });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'The response is larger than 5 MB' }, { status: 413 });
    return new Response(buf, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 502 });
  }
}
