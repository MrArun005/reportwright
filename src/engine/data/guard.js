// @ts-check
/**
 * The engine's own fetch, for a render that brings none (render(def) as a library, no `fetch` option): data sources may
 * reach public http(s) hosts only (SSRF). Refused: other schemes (data:, file:), a user name or password in the URL,
 * loopback, private, link-local, shared (CGNAT), multicast and reserved addresses in any spelling the URL parser
 * reads (2130706433, 0x7f.1, 0177.0.0.1 and IPv4 in IPv6 are normalised by it first), "localhost" names, and in Node a
 * name that resolves to such an address (dns.lookup; a browser has no DNS to ask, its literal addresses are still
 * checked). Redirects are followed by hand, each hop checked again, at most 5. `allowHosts` names hosts that may be
 * private (an internal API); `unsafeFetch: true` turns the guard off.
 * ponytail: the name is resolved before the request and again by fetch() itself, so a DNS answer that changes in
 * between (rebinding) is not caught here; the server's safeFetch pins the address in the socket's lookup instead.
 *
 * Every engine fetch, the caller's too, gets a time limit (fetchTimeoutMs, default 30 s, never past the render's
 * deadline) and a cap on the bytes read (maxFetchBytes, default 64 MB, counted after decompression, so a gzip bomb
 * stops at the cap). A streaming source (init.pwStream) keeps the caller's own cap.
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

/** Node's DNS, when the engine runs in Node (no import: the engine has no Node modules; null in a browser). */
function nodeDns() {
  try { const p = /** @type {any} */ (globalThis).process; return p?.getBuiltinModule?.('node:dns') || null; } catch { return null; }
}

/**
 * Check one URL the default fetch would request.
 * @param {string} input @param {string[]} allow lower-case host names
 * @returns {Promise<URL>}
 */
export async function checkUrl(input, allow) {
  let u;
  try { u = new URL(input); } catch { throw Object.assign(new Error(`Not a URL: ${String(input).slice(0, 200)}`), { status: 400 }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error(`Only http and https URLs can be fetched, not ${u.protocol}`), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('A user name or password in a data URL is not allowed'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (allow.includes(host)) return u;
  if (privateHost(u.hostname)) throw refuse(host);
  const dns = !isIp(u.hostname) && nodeDns();
  if (dns) {
    const list = await dns.promises.lookup(host, { all: true }).catch(() => []);
    if (list.some(a => privateHost(a.family === 6 ? `[${a.address}]` : a.address))) throw refuse(host);
  }
  return u;
}

/**
 * The guarded default fetch (see the top of this file).
 * @param {{ allowHosts?: string[] }} opt @param {typeof fetch} base
 * @returns {typeof fetch}
 */
export function guardedFetch(opt, base) {
  const allow = (opt.allowHosts || []).map(h => String(h).toLowerCase().replace(/^\[|\]$/g, ''));
  return /** @type {any} */ (async (input, init = {}) => {
    let url = await checkUrl(String(input), allow);
    /** @type {any} */
    let req = { ...init };
    for (let hop = 0; ; hop++) {
      const res = await base(url.href, { ...req, redirect: 'manual' });
      if (res.type === 'opaqueredirect') throw new Error(`${url.host} redirects; a redirect cannot be checked here (pass your own fetch to render)`);
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) return res;
      await res.body?.cancel().catch(() => {});
      if (hop >= FETCH_DEFAULTS.hops) throw new Error(`Too many redirects from ${url.host}`);
      const next = await checkUrl(new URL(loc, url).href, allow);
      // credentials never follow a redirect to another site; 303 (and 301/302 after a POST) become a GET
      const headers = new Headers(req.headers || {});
      if (next.origin !== url.origin) for (const k of ['authorization', 'cookie', 'x-api-key']) headers.delete(k);
      const get = res.status === 303 || ((res.status === 301 || res.status === 302) && (req.method || 'GET').toUpperCase() !== 'GET');
      req = get ? { ...req, method: 'GET', body: undefined, headers } : { ...req, headers };
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
    try { res = await Promise.race([f(input, { ...init, signal }), stop]); } catch (e) { clearTimeout(timer); throw ctl.signal.aborted ? ctl.signal.reason : e; }
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
/** @param {AbortSignal[]} list */
function anySignal(list) {
  const S = /** @type {any} */ (AbortSignal);
  if (S.any) return S.any(list);
  const c = new AbortController();
  for (const s of list) { if (s.aborted) c.abort(s.reason); else s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}
