// Outbound HTTP for URLs that reports and API callers choose: data sources, images, batch lists,
// uploads, webhooks, the data proxy. Private and local addresses are refused (SSRF) unless the
// URL is this server (by origin) or its host is in the allow list (PW_INTERNAL_HOSTS).
// The check runs inside the socket's own DNS lookup, so a host cannot pass the check and then
// resolve somewhere else (DNS rebinding). Every redirect hop is checked again.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { domainToASCII } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { accountsOn, internalCookie, basicOn } from './session.js';

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;
/** One deadline for a whole fetch (every redirect, the headers and the body): a server that drips bytes cannot hold a
 *  request open (a socket timeout only counts silence). PW_FETCH_DEADLINE_MS, default 60 s. */
const deadlineMs = () => Number(process.env.PW_FETCH_DEADLINE_MS) || 60000;

const blocked = new net.BlockList(); // also matches IPv4-mapped IPv6 (::ffff:127.0.0.1)
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked.addSubnet(a, p, 'ipv6');

/** True for loopback, private, link-local, shared, multicast and reserved addresses. */
export function isPrivate(ip) {
  if (!net.isIPv6(ip)) return blocked.check(ip, 'ipv4');
  // NAT64 (64:ff9b::/96) carries an IPv4 address in its last 32 bits
  const m = /^64:ff9b::(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i.exec(ip);
  if (m) {
    if (m[3]) return isPrivate(m[3]);
    const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
    return isPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blocked.check(ip, 'ipv6');
}

/**
 * The one parse of a URL the server fetches: the same URL object is checked (allow list, private address, "is this
 * self") and fetched. Refused (400): anything but an absolute http(s) URL; a user name or password; and any host the
 * parser would rewrite, so the host checked is the host written: numeric IPv4 forms (0x7f.1, 2130706433, 127.1),
 * IPv4-mapped IPv6, percent-encoding, backslashes, a trailing dot, whitespace or control characters anywhere.
 * Mixed case is fine (it only lower-cases). DNS is resolved once, in the socket's own lookup (safeFetch), and that
 * address is the one connected to.
 * @param {string|URL} input @returns {URL}
 */
export function strictUrl(input) {
  const s = input instanceof URL ? input.href : String(input);
  const bad = (why) => Object.assign(new Error(`Refused URL (${why}): ${s.slice(0, 200)}`), { status: 400 });
  if (/[\x00-\x1f\x7f\\]/.test(s) || s.trim() !== s) throw bad('a control character, a backslash or surrounding space');
  const m = /^(https?):\/\/([^/?#]*)/i.exec(s);
  if (!m) throw bad('only absolute http and https URLs');
  if (m[2].includes(' ')) throw bad('a space in the host'); // a space in the path or query is only encoded
  let u;
  try { u = new URL(s); } catch { throw bad('not a URL'); }
  if (u.username || u.password || m[2].includes('@')) throw bad('a user name or password in the URL');
  const written = m[2].replace(/:\d*$/, '').toLowerCase(); // as written, without the port
  const host = /[^\x00-\x7f]/.test(written) ? domainToASCII(written) : written; // an international name: its punycode
  if (host !== u.hostname || host.endsWith('.') || host.includes('%')) throw bad(`the host "${m[2]}" is not written plainly`);
  return u;
}

/** Hosts in PW_INTERNAL_HOSTS may resolve to private addresses (internal data APIs). */
export const internalHosts = () => (process.env.PW_INTERNAL_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** The self origin when production has no PW_BASE_URL (renderer.baseUrl): a name that never resolves. */
export const NO_BASE_URL = 'http://pw-base-url-not-set.invalid';

/**
 * A fetch for server-side work: this server's own origin (selfOrigin: PW_BASE_URL, or the address Next listens on;
 * never a request header) plus PW_INTERNAL_HOSTS are allowed; internal: false leaves PW_INTERNAL_HOSTS out.
 * Calls back into this server (relative data URLs) are reads only (GET, HEAD), with the caller's Origin, Referer,
 * Cookie and Authorization taken out, so a report cannot make a request look like this site's page or carry its own
 * credentials; they sign in with accounts on (PW_AUTH=users) by a viewer pass for that one GET, else with the
 * PW_BASIC_AUTH password. No other host ever gets either.
 * @param {string} selfOrigin @param {{ internal?: boolean }} [o]
 */
export const serverFetch = (selfOrigin, { internal = true } = {}) => async (input, init = {}) => {
  const self = selfOrigin && safeOrigin(selfOrigin);
  const url = strictUrl(input); // parsed once: checked and fetched as this object
  if (url.origin === NO_BASE_URL) throw Object.assign(new Error('A relative data URL needs PW_BASE_URL in production (this server\'s public URL): the server never takes its own address from a request.'), { status: 500 });
  const headers = new Headers(init.headers || {});
  // the connection is ours to frame: a report cannot pick the virtual host (Host) or the body's framing
  for (const k of ['host', 'content-length', 'transfer-encoding', 'connection', 'te', 'upgrade', 'x-pagewright-proxy-secret']) headers.delete(k);
  const toSelf = self && url.origin === self;
  // credentials only to the configured self: PW_BASE_URL's exact origin (scheme, host, port); without it, development only
  const credentials = toSelf && (process.env.PW_BASE_URL ? safeOrigin(process.env.PW_BASE_URL) === self : process.env.NODE_ENV !== 'production');
  if (toSelf) {
    if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) throw Object.assign(new Error('A data source may only read (GET) from this server.'), { status: 403 });
    for (const k of ['origin', 'referer', 'cookie', 'authorization', 'x-api-key']) headers.delete(k);
  }
  if (credentials) {
    if (accountsOn()) headers.set('cookie', internalCookie(url.href));
    else if (basicOn()) headers.set('authorization', `Basic ${Buffer.from(String(process.env.PW_BASIC_AUTH)).toString('base64')}`);
    if (process.env.PW_AUTH === 'proxy' && process.env.PW_PROXY_SECRET) headers.set('x-pagewright-proxy-secret', process.env.PW_PROXY_SECRET);
  }
  return safeFetch(url, { ...init, headers }, { allow: [selfOrigin, ...(internal ? internalHosts() : [])].filter(Boolean) });
};

/**
 * A delivery or source URL saved for later (a webhook, an upload, a list of items): http(s), and not a private or
 * local address unless its host is in PW_INTERNAL_HOSTS. Checked when it is saved; safeFetch checks again when it is
 * used (the name may point elsewhere by then). relative: a path on this server is fine (itemsFrom).
 * @param {any} url @param {string} what @param {{ relative?: boolean }} [o]
 */
export async function checkTarget(url, what, { relative = false, internal = true } = {}) {
  if (relative && typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return;
  let u;
  try { u = strictUrl(url); } catch (e) { throw Object.assign(new Error(`${what} must be a plain http(s) URL. ${e.message}`), { status: 400 }); }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (internal && internalHosts().includes(host)) return;
  const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  if (ips.some(isPrivate)) throw refuse(host);
}

const refuse = (host) => Object.assign(new Error(`"${host}" is a private or local address. Add it to PW_INTERNAL_HOSTS to allow it.`), { code: 'EPRIVATE', status: 403 });

/**
 * fetch() with the SSRF guard. Returns a standard Response.
 * @param {string|URL} input
 * @param {{ method?: string, headers?: any, body?: string|Uint8Array }} [init]
 * @param {{ allow?: string[], hops?: number }} [opt] allow: origins ("http://host:port") or host names
 * @returns {Promise<Response>}
 */
export async function safeFetch(input, init = {}, { allow = [], hops = 3, deadline = Date.now() + deadlineMs() } = {}) {
  const url = strictUrl(input);
  const late = () => new Error(`${url.host} did not finish in ${Math.round(deadlineMs() / 1000)} s (the limit for one request)`);
  if (Date.now() >= deadline) throw late();
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Only http and https URLs can be fetched, not ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const trusted = allow.some(a => (a.includes('://') ? safeOrigin(a) === url.origin : a.toLowerCase() === host));
  if (!trusted && net.isIP(host) && isPrivate(host)) throw refuse(host);
  const lookup = (name, opts, cb) => dns.lookup(name, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    if (!trusted && list.some(a => isPrivate(a.address))) return cb(refuse(name));
    return opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
  const headers = Object.fromEntries(new Headers(init.headers || {}));
  let timer;
  const res = await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: init.method || 'GET', headers, lookup, timeout: TIMEOUT_MS }, resolve);
    req.on('timeout', () => req.destroy(new Error(`${url.host} did not answer in ${TIMEOUT_MS / 1000} s`)));
    req.on('error', reject);
    timer = setTimeout(() => req.destroy(late()), deadline - Date.now()); // headers too: a drip-fed status line
    req.end(init.body ?? undefined);
  }).catch((e) => { clearTimeout(timer); throw e; });
  clearTimeout(timer);

  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    if (hops <= 0) throw new Error(`Too many redirects from ${url.host}`);
    const loc = String(res.headers.location);
    const next = /^[a-z][a-z0-9+.-]*:/i.test(loc) || loc.startsWith('//') ? strictUrl(loc.startsWith('//') ? `${url.protocol}${loc}` : loc) : new URL(loc, url);
    const same = next.origin === url.origin;
    const keepBody = res.statusCode === 307 || res.statusCode === 308;
    // credentials never follow a redirect to another site
    const h = same ? headers : Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie|x-api-key|x-pagewright-proxy-secret)$/i.test(k)));
    // a public first hop cannot redirect into the allow list (this server, PW_INTERNAL_HOSTS): its redirects get none
    return safeFetch(next, keepBody ? { ...init, headers: h } : { headers: h }, { allow: trusted ? allow : [], hops: hops - 1, deadline });
  }

  const empty = [204, 205, 304].includes(res.statusCode) || init.method === 'HEAD';
  let body = null;
  if (empty) res.resume(); // nothing to read, and no deadline timer left behind
  else {
    let size = 0;
    const capped = res.pipe(new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        cb(size > MAX_BYTES ? new Error(`The response from ${url.host} is larger than ${MAX_BYTES / 1048576} MB`) : null, chunk);
      },
    }));
    // the body within the same deadline
    const bodyTimer = setTimeout(() => { capped.destroy(late()); res.destroy(); }, Math.max(0, deadline - Date.now()));
    bodyTimer.unref?.();
    capped.on('close', () => clearTimeout(bodyTimer));
    body = /** @type {any} */ (Readable.toWeb(capped));
  }
  const outHeaders = Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, String(v)]]));
  return new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers: outHeaders });
}

function safeOrigin(s) {
  try { return new URL(s).origin; } catch { return null; }
}
