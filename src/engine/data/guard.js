// @ts-check
/**
 * The engine's own fetch, for a render that brings none (render(def) as a library, no `fetch` option): data sources may
 * reach public http(s) hosts only (SSRF). Refused: other schemes (data:, file:), a user name or password in the URL,
 * loopback, private, link-local, shared (CGNAT), multicast and reserved addresses in any spelling the URL parser
 * reads (2130706433, 0x7f.1, 0177.0.0.1 and IPv4 in IPv6 are normalised by it first), "localhost" names, and in Node a
 * name that resolves to such an address (dns.lookup; a browser has no DNS to ask, its literal addresses are still
 * checked). In Node the request goes out through node:http(s) with the address pinned: the socket's own lookup checks
 * what the name resolves to and connects to that (no rebinding); a failed lookup refuses. Redirects are followed by
 * hand, each hop checked again, at most 5; https → http is refused; another origin gets none of the source's headers.
 * Anything the guard cannot read is refused (fail closed). `allowHosts` names hosts that may be private (an internal
 * API); `unsafeFetch: true` turns the guard off.
 *
 * Every engine fetch, the caller's too, gets one time limit for the whole request (every redirect hop, the headers and
 * the body: fetchTimeoutMs, default 30 s, never past the render's deadline) and one cap on the bytes read
 * (maxFetchBytes, default 64 MB, counted as decoded, so a gzip bomb stops at the cap). A streaming source
 * (init.pwStream) keeps the caller's own cap. Each request (an OData page, a subreport's source) has its own.
 */

export const FETCH_DEFAULTS = { timeoutMs: 30000, maxBytes: 64 * 1048576, hops: 5 };

const V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]
  .map(([a, p]) => [v4num(String(a)), Number(p)]);
/** @param {string} ip @returns {number} */
function v4num(ip) { return ip.split('.').reduce((n, x) => n * 256 + Number(x), 0); }
/** @param {string} ip */
function privateV4(ip) {
  const n = v4num(ip);
  return V4.some(([a, p]) => Math.floor(n / 2 ** (32 - p)) === Math.floor(a / 2 ** (32 - p)));
}
/** The 8 groups of an IPv6 address (as the URL parser writes it: lower-case hex, :: compressed). @param {string} ip */
function groups6(ip) {
  const [h, t = ''] = ip.split('::');
  const a = h ? h.split(':') : [], b = t ? t.split(':') : [];
  if (b.length && b[b.length - 1].includes('.')) { const q = b.pop().split('.').map(Number); b.push(((q[0] << 8) | q[1]).toString(16), ((q[2] << 8) | q[3]).toString(16)); }
  return [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b].map(x => parseInt(x, 16) || 0);
}
/** @param {string} ip without brackets */
function privateV6(ip) {
  const g = groups6(ip);
  const v4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 6).every(x => x === 0)) return true; // ::/96 (:: and ::1 too), IPv4-compatible
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return privateV4(v4()); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 || privateV4(v4()); // NAT64 (well-known and local-use)
  if (g[0] === 0x2002 || (g[0] === 0x2001 && g[1] === 0)) return true; // 6to4, Teredo: reach whatever a gateway routes
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return true;
  return false;
}
/** True for an address no data source may reach by default. @param {string} host a hostname as URL gives it */
export function privateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.includes(':')) return privateV6(h);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return privateV4(h);
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
}
const isIp = (h) => /^\[.*\]$/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h);

const refuse = (host) => Object.assign(new Error(`"${host}" is a private or local address; a data source may not reach it (pass allowHosts: ["${host}"] to render to allow it)`), { status: 403, code: 'EPRIVATE' });

/** Node's built-in modules, without an import (the engine has no Node imports): null outside Node. */
function nodeMod(name) {
  const p = /** @type {any} */ (globalThis).process;
  if (!p?.versions?.node) return null;
  if (!p.getBuiltinModule) throw Object.assign(new Error('The engine\'s fetch guard needs Node 20.16 or later (process.getBuiltinModule); or pass your own fetch to render'), { status: 500 });
  return p.getBuiltinModule(name);
}
const inNode = () => !!(/** @type {any} */ (globalThis).process?.versions?.node);
const addrHost = (a) => (a.family === 6 || String(a.address).includes(':') ? `[${a.address}]` : String(a.address));

/**
 * Check one URL the default fetch would request: scheme, credentials, and a literal address. Anything it cannot
 * read is refused (fail closed). A name is checked again, as resolved, by the Node transport's lookup.
 * @param {string} input @param {string[]} allow lower-case host names
 * @returns {URL}
 */
export function checkUrl(input, allow) {
  let u;
  try { u = new URL(input); } catch { throw Object.assign(new Error(`Not a URL: ${String(input).slice(0, 200)}`), { status: 400 }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error(`Only http and https URLs can be fetched, not ${u.protocol}`), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('A user name or password in a data URL is not allowed'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw Object.assign(new Error('A data URL needs a host'), { status: 400 });
  if (allow.includes(host)) return u;
  let bad = true;
  try { bad = privateHost(u.hostname); } catch { /* unreadable: refused */ }
  if (bad) throw refuse(host);
  return u;
}

/**
 * Node: one request with the address pinned. The socket's own DNS lookup checks every address the name resolves to
 * and connects to the one checked (no second lookup to rebind); a lookup error or an empty answer refuses. The body is
 * asked for uncompressed (identity), so the byte cap counts what is read.
 * @param {URL} url @param {any} init @param {boolean} trusted the host is in allowHosts
 * @returns {Promise<Response>}
 */
function nodeRequest(url, init, trusted) {
  const http = nodeMod('node:http'), https = nodeMod('node:https'), dns = nodeMod('node:dns'), stream = nodeMod('node:stream');
  const lookup = (name, o, cb) => dns.lookup(name, { ...o, all: true }, (err, list) => {
    if (err || !Array.isArray(list) || !list.length) return cb(err || refuse(name));
    let bad = true;
    try { bad = !trusted && list.some(a => privateHost(addrHost(a))); } catch { /* unreadable: refused */ }
    if (bad) return cb(refuse(name));
    return o.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
  const headers = Object.fromEntries(new Headers(init.headers || {}));
  headers['accept-encoding'] = 'identity';
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: init.method || 'GET', headers, lookup, signal: init.signal }, (res) => {
      const pairs = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) pairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
      const none = [101, 204, 205, 304].includes(res.statusCode) || (init.method || 'GET').toUpperCase() === 'HEAD';
      if (none) res.resume();
      // a server that compresses anyway (it ignores accept-encoding: identity): decoded here, so the byte cap counts what is read
      const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
      let body = res, decoded = false;
      if (!none && enc && enc !== 'identity') {
        const zlib = nodeMod('node:zlib');
        const dec = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate() : enc === 'br' ? zlib.createBrotliDecompress() : null;
        if (!dec) { res.resume(); return reject(Object.assign(new Error(`the response is encoded as "${enc}", which the data fetch cannot decode`), { status: 415 })); }
        body = stream.pipeline(res, dec, () => {}); // an error in either destroys the decoded stream too: the caller's read fails
        decoded = true;
      }
      const kept = decoded ? pairs.filter(([k]) => !/^(content-encoding|content-length)$/i.test(k)) : pairs;
      resolve(new Response(none ? null : stream.Readable.toWeb(body), { status: res.statusCode, statusText: res.statusMessage, headers: /** @type {any} */ (kept) }));
    });
    req.on('error', reject);
    req.end(init.body ?? undefined);
  });
}

/** Headers kept on a redirect to another origin: none of the source's own (auth, cookies, keys, custom tokens). */
const CROSS_ORIGIN_KEEP = new Set(['accept', 'accept-language', 'content-type']);
/**
 * The request for a redirect hop, or an error: https → http is refused; another origin keeps only CROSS_ORIGIN_KEEP;
 * 303 (and 301/302 after a non-GET) becomes a GET without a body.
 * @param {URL} from @param {URL} to @param {any} req @param {number} status
 */
export function redirectRequest(from, to, req, status) {
  if (from.protocol === 'https:' && to.protocol !== 'https:') throw Object.assign(new Error(`${from.host} redirects from https to http; not followed`), { status: 403 });
  const headers = new Headers(req.headers || {});
  if (to.origin !== from.origin) for (const k of [...headers.keys()]) if (!CROSS_ORIGIN_KEEP.has(k)) headers.delete(k);
  const get = status === 303 || ((status === 301 || status === 302) && (req.method || 'GET').toUpperCase() !== 'GET');
  return get ? { ...req, method: 'GET', body: undefined, headers } : { ...req, headers };
}

/**
 * The guarded default fetch (see the top of this file). In Node every hop goes through nodeRequest (address pinned);
 * in a browser through `base` with redirects by hand (literal addresses checked; a browser has no DNS to ask).
 * @param {{ allowHosts?: string[], viaBase?: boolean }} opt viaBase: every hop through `base`, in Node too (the browser
 *   viewer's fetch, which its tests run in Node)
 * @param {typeof fetch} base
 * @returns {typeof fetch}
 */
export function guardedFetch(opt, base) {
  const allow = (opt.allowHosts || []).map(h => String(h).toLowerCase().replace(/^\[|\]$/g, ''));
  const node = !opt.viaBase && inNode();
  return /** @type {any} */ (async (input, init = {}) => {
    let url = checkUrl(String(input), allow);
    /** @type {any} */
    let req = { ...init };
    for (let hop = 0; ; hop++) {
      const trusted = allow.includes(url.hostname.replace(/^\[|\]$/g, '').toLowerCase());
      const res = node ? await nodeRequest(url, req, trusted) : await base(url.href, { ...req, redirect: 'manual' });
      if (res.type === 'opaqueredirect') throw new Error(`${url.host} redirects; a redirect cannot be checked here (pass your own fetch to render)`);
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) return res;
      await res.body?.cancel().catch(() => {});
      if (hop >= FETCH_DEFAULTS.hops) throw new Error(`Too many redirects from ${url.host}`);
      const next = checkUrl(new URL(loc, url).href, allow);
      req = redirectRequest(url, next, req, res.status);
      url = next;
    }
  });
}

/**
 * Any fetch with the engine's time limit and byte cap.
 * @param {typeof fetch} f @param {{ fetchTimeoutMs?: number, maxFetchBytes?: number, deadline?: number }} opt
 * @returns {typeof fetch}
 */
export function boundedFetch(f, opt) {
  const ms0 = Number(opt.fetchTimeoutMs) > 0 ? Number(opt.fetchTimeoutMs) : FETCH_DEFAULTS.timeoutMs;
  const max = Number(opt.maxFetchBytes) > 0 ? Number(opt.maxFetchBytes) : FETCH_DEFAULTS.maxBytes;
  return /** @type {any} */ (async (input, init = {}) => {
    const ms = Math.max(1, Math.min(ms0, opt.deadline ? opt.deadline - Date.now() : Infinity));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(Object.assign(new Error(`The data request took longer than ${Math.round(ms)} ms`), { status: 504 })), ms);
    const signal = init.signal ? anySignal([init.signal, ctl.signal]) : ctl.signal;
    let res;
    // raced with the abort: a fetch that ignores the signal (a DNS lookup, a custom fetch) still stops waiting
    const stop = new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason), { once: true }));
    stop.catch(() => {}); // aborted after the answer came: nobody waits on it
    try { res = await Promise.race([f(input, { ...init, signal }), stop]); } catch (e) { clearTimeout(timer); throw ctl.signal.aborted ? ctl.signal.reason : fetchFailure(e, input); }
    if (!res.body || /** @type {any} */ (init).pwStream) { clearTimeout(timer); return res; }
    // the body inside the same time limit, and at most `max` bytes (as decoded: fetch has inflated it already)
    let n = 0;
    const reader = res.body.getReader();
    const body = new ReadableStream({
      async pull(c) {
        try {
          const { done, value } = await reader.read();
          if (done) { clearTimeout(timer); c.close(); return; }
          n += value.byteLength;
          if (n > max) { clearTimeout(timer); reader.cancel().catch(() => {}); c.error(Object.assign(new Error(`The data response is larger than ${Math.round(max / 1048576)} MB (maxFetchBytes)`), { status: 413 })); return; }
          c.enqueue(value);
        } catch (e) { clearTimeout(timer); c.error(ctl.signal.aborted ? ctl.signal.reason : e); }
      },
      cancel(r) { clearTimeout(timer); return reader.cancel(r); },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}
/** The cause of a failed request in words, by the error code Node and undici give (error.cause.code). */
const CAUSES = {
  ENOTFOUND: 'the host name did not resolve', EAI_AGAIN: 'DNS lookup timed out', ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset', EPIPE: 'connection closed', UND_ERR_SOCKET: 'connection closed early',
  ETIMEDOUT: 'timed out', UND_ERR_CONNECT_TIMEOUT: 'connect timed out', EPROTO: 'TLS error',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate does not match the host', DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate chain is untrusted', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate chain is untrusted',
  CERT_HAS_EXPIRED: 'TLS certificate has expired',
};
/**
 * A URL safe to print: no userinfo, and the query and fragment shown as ?… / #… (their values can hold keys and tokens).
 * @param {string} s
 */
export function redactUrl(s) {
  const str = String(s);
  const q = str.search(/[?#]/);
  const base = (q >= 0 ? str.slice(0, q) : str).replace(/^([a-z][\w+.-]*:\/\/)[^/?#]*@/i, '$1');
  return q >= 0 ? `${base}${str[q]}…` : base;
}
/**
 * A failed request as an error that says why: the cause code (DNS, refused, reset, TLS, timeout) and the redacted URL.
 * An error that already carries a status (a refused address, a redirect) passes through.
 * @param {any} e @param {any} input
 */
export function fetchFailure(e, input) {
  if (!e || e.status) return e;
  const code = String(e.cause?.code || e.code || '');
  if (!code && e.message !== 'fetch failed') return e;
  const why = CAUSES[code] || (/^ERR_TLS|CERT_|SSL/.test(code) ? 'TLS error' : '');
  const at = redactUrl(input?.href ?? input);
  return Object.assign(new Error(`the request to ${at} failed${why ? `: ${why}` : ''}${code ? ` (${code})` : ''}`), { code: e.code });
}
/** @param {AbortSignal[]} list */
function anySignal(list) {
  const S = /** @type {any} */ (AbortSignal);
  if (S.any) return S.any(list);
  const c = new AbortController();
  for (const s of list) { if (s.aborted) c.abort(s.reason); else s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}
