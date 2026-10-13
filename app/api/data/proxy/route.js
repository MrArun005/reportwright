// REST proxy for data sources that need it (CORS, secret headers).
// Only hosts in PW_PROXY_ALLOW may be reached, at every redirect too, and never a private address (SSRF): safeFetch
// checks every resolved address, so DNS rebinding cannot get past it. The answer is data, never a page on our origin:
// JSON, CSV or plain text as such, anything else as application/octet-stream, with nosniff and a sandboxing CSP.
import { safeFetch, strictUrl, proxiedType } from '@/server/safeFetch.js';
import { errorResponse } from '@/server/errors.js';
import { audit } from '@/server/audit.js';
import { principalOf } from '@/server/perms.js';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const allow = () => (process.env.PW_PROXY_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const SAFE = { 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" };
const err = (error, status) => Response.json({ error }, { status, headers: SAFE });

/** the upstream body, read as a stream and stopped at MAX_BYTES (null past it): never buffered whole first */
async function readCapped(res) {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel().catch(() => {}); return null; }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts, n);
}

export async function GET(req) {
  const target = new URL(req.url).searchParams.get('url');
  let u;
  try { u = strictUrl(target || ''); } catch (e) { return err(`Give a plain absolute http(s) URL in ?url= (${e.message})`, 400); } // the URL checked is the URL fetched
  if (!allow().includes(u.hostname.toLowerCase())) return err(`The host "${u.hostname}" is not in PW_PROXY_ALLOW`, 403);
  try {
    const res = await safeFetch(u, { headers: { accept: 'application/json, text/csv;q=0.9, */*;q=0.1' } }, { hostsOnly: allow() });
    const buf = await readCapped(res);
    if (!buf) return err('The response is larger than 5 MB', 413);
    // a data read through the server: host and path only (a query string may hold a token)
    await audit('data.read', { req, principal: await principalOf(req).catch(() => undefined), detail: { via: 'proxy', host: u.hostname, path: u.pathname.slice(0, 200), status: res.status, bytes: buf.byteLength } });
    return new Response(buf, { status: res.status, headers: { 'content-type': proxiedType(res.headers.get('content-type')), ...SAFE } });
  } catch (e) {
    return errorResponse(e, { status: e.status || 502 });
  }
}
