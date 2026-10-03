// REST proxy for data sources that need it (CORS, secret headers).
// Only hosts in PW_PROXY_ALLOW may be reached. Private networks are blocked (SSRF).
import dns from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const allow = () => (process.env.PW_PROXY_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:') && isPrivate(l.slice(7));
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function GET(req) {
  const target = new URL(req.url).searchParams.get('url');
  let u;
  try { u = new URL(target); } catch { return Response.json({ error: 'Give an absolute URL in ?url=' }, { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) return Response.json({ error: 'Only http and https are allowed' }, { status: 400 });
  if (!allow().includes(u.hostname.toLowerCase())) {
    return Response.json({ error: `The host "${u.hostname}" is not in PW_PROXY_ALLOW` }, { status: 403 });
  }
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) return Response.json({ error: 'The host resolves to a private address' }, { status: 403 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'error', headers: { accept: 'application/json, text/csv;q=0.9, */*;q=0.1' } });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'The response is larger than 5 MB' }, { status: 413 });
    return new Response(buf, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
  } catch (e) {
    return Response.json({ error: e.name === 'AbortError' ? 'The source did not answer in 10 s' : e.message }, { status: 502 });
  } finally { clearTimeout(timer); }
}
