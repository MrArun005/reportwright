// Outbound HTTP for URLs that reports and API callers choose: data sources, images, batch lists,
// uploads, webhooks, the data proxy. Private and local addresses are refused (SSRF) unless the
// URL is this server (by origin) or its host is in the allow list (PW_INTERNAL_HOSTS).
// The check runs inside the socket's own DNS lookup, so a host cannot pass the check and then
// resolve somewhere else (DNS rebinding). Every redirect hop is checked again.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { Readable, Transform } from 'node:stream';

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;

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

/** Hosts in PW_INTERNAL_HOSTS may resolve to private addresses (internal data APIs). */
export const internalHosts = () => (process.env.PW_INTERNAL_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/**
 * A fetch for server-side work: this server's own origin plus PW_INTERNAL_HOSTS are allowed.
 * With PW_BASIC_AUTH on, calls back into this server (relative data URLs) send the app password.
 */
export const serverFetch = (selfOrigin) => (url, init = {}) => {
  const self = selfOrigin && safeOrigin(selfOrigin);
  const headers = new Headers(init.headers || {});
  if (process.env.PW_BASIC_AUTH && self && safeOrigin(String(url)) === self && !headers.has('authorization')) {
    headers.set('authorization', `Basic ${Buffer.from(process.env.PW_BASIC_AUTH).toString('base64')}`);
  }
  return safeFetch(url, { ...init, headers }, { allow: [selfOrigin, ...internalHosts()].filter(Boolean) });
};

const refuse = (host) => Object.assign(new Error(`"${host}" is a private or local address. Add it to PW_INTERNAL_HOSTS to allow it.`), { code: 'EPRIVATE', status: 403 });

/**
 * fetch() with the SSRF guard. Returns a standard Response.
 * @param {string|URL} input
 * @param {{ method?: string, headers?: any, body?: string|Uint8Array }} [init]
 * @param {{ allow?: string[], hops?: number }} [opt] allow: origins ("http://host:port") or host names
 * @returns {Promise<Response>}
 */
export async function safeFetch(input, init = {}, { allow = [], hops = 3 } = {}) {
  const url = new URL(input);
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
  const res = await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: init.method || 'GET', headers, lookup, timeout: TIMEOUT_MS }, resolve);
    req.on('timeout', () => req.destroy(new Error(`${url.host} did not answer in ${TIMEOUT_MS / 1000} s`)));
    req.on('error', reject);
    req.end(init.body ?? undefined);
  });

  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    if (hops <= 0) throw new Error(`Too many redirects from ${url.host}`);
    const next = new URL(res.headers.location, url);
    const same = next.origin === url.origin;
    const keepBody = res.statusCode === 307 || res.statusCode === 308;
    // credentials never follow a redirect to another site
    const h = same ? headers : Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie|x-api-key)$/i.test(k)));
    return safeFetch(next, keepBody ? { ...init, headers: h } : { headers: h }, { allow, hops: hops - 1 });
  }

  let size = 0;
  const capped = res.pipe(new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      cb(size > MAX_BYTES ? new Error(`The response from ${url.host} is larger than ${MAX_BYTES / 1048576} MB`) : null, chunk);
    },
  }));
  const empty = [204, 205, 304].includes(res.statusCode) || init.method === 'HEAD';
  if (empty) res.resume();
  const outHeaders = Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, String(v)]]));
  return new Response(empty ? null : /** @type {any} */ (Readable.toWeb(capped)), { status: res.statusCode, statusText: res.statusMessage, headers: outHeaders });
}

function safeOrigin(s) {
  try { return new URL(s).origin; } catch { return null; }
}
