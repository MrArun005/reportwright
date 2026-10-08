// The browser's fetch for a report's data sources (viewer, render worker, designer previews, interactive HTML export).
// A report is a stored definition someone else wrote, and the engine sends its URL, method, headers and body as written.
// On the ReportWright server itself it may only read data: GET (or HEAD) sample data, the data proxy, or a path that is
// not ReportWright's own (an API your reverse proxy serves on this host), and POST /api/data/sql (the engine's own SQL
// call; the server checks who may run what). Never another ReportWright API with the viewer's cookie: an admin who opens
// a report must not create a user, change permissions or read the audit log for it. Other sites get no cookies.

/**
 * POST /api/data/sql as the engine sends it: { report, source, params } runs that report's saved SQL (which the server
 * checks), and nothing else; a REST source cannot send { connection, query } as the viewer. sqlPreview: the designer's
 * own unsaved query may (DataPanel).
 */
function sqlCall(body, sqlPreview) {
  let b;
  try { b = JSON.parse(String(body)); } catch { return false; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  const keys = Object.keys(b);
  if (typeof b.report === 'string' && typeof b.source === 'string') return keys.every(k => ['report', 'source', 'params'].includes(k));
  return sqlPreview && typeof b.query === 'string' && keys.every(k => ['connection', 'query', 'params'].includes(k));
}

import { guardedFetch } from '../engine/data/guard.js';

/**
 * The embedding page's rules for data on other hosts (mountViewer's allowHosts, unsafeFetch and fetch). By default a
 * source may reach public http(s) hosts only: literal private, loopback, link-local and CGNAT addresses, "localhost"
 * names and other schemes are refused, and redirects are checked hop by hop (the engine's guard, data/guard.js). A
 * browser cannot resolve DNS, so a public name that resolves to a private address still gets through: for a
 * multi-tenant app render on the server (its guard checks DNS), or pass a `fetch` that allows only the hosts you know.
 * `fetch` replaces the transport; the guard still runs before it (unsafeFetch turns it off).
 */
let policy = { allowHosts: [], unsafeFetch: false, fetch: null };
/** @param {{ allowHosts?: string[], unsafeFetch?: boolean, fetch?: typeof fetch|null }} [p] */
export function setFetchPolicy({ allowHosts, unsafeFetch = false, fetch: f = null } = {}) {
  policy = { allowHosts: (allowHosts || []).map(h => String(h).toLowerCase().replace(/^\[|\]$/g, '')), unsafeFetch: !!unsafeFetch, fetch: typeof f === 'function' ? f : null };
}
/** What a worker needs to apply the same rules (no function: a worker keeps the page's own fetch on the main thread). */
export const fetchPolicy = () => policy;


const DATA = [/^\/api\/sample\//, /^\/api\/data\/proxy$/];
const OURS = /^\/(?:$|api(?:\/|$)|admin(?:\/|$)|designer(?:\/|$)|viewer(?:\/|$)|login(?:\/|$)|embed(?:\/|$)|_next(?:\/|$))/i;

/** Answers a busy server gives (and a gateway in front of it): try again after a while. */
const BUSY = new Set([429, 502, 503, 504]);
/**
 * fetch that tries a read again when the server is busy: up to `retries` more times, after Retry-After (at most 10 s)
 * or a growing, jittered wait. onRetry({ attempt, max, status }) before each wait, so the viewer can say so. Only
 * reads: GET, HEAD and the engine's POST /api/data/sql (a query, no change).
 * @param {typeof fetch} f @param {{ onRetry?: (r: { attempt: number, max: number, status: number }) => void, retries?: number, wait?: (ms: number) => Promise<void> }} o
 * @returns {typeof fetch}
 */
export function withRetry(f, { onRetry, retries = 3, wait = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  return /** @type {any} */ (async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const read = method === 'GET' || method === 'HEAD' || (method === 'POST' && /\/api\/data\/sql$/.test(new URL(String(url), 'http://x').pathname));
    for (let attempt = 1; ; attempt++) {
      const res = await f(url, init);
      if (!read || !BUSY.has(res.status) || attempt > retries) return res;
      const after = Number(res.headers?.get?.('retry-after'));
      const ms = Number.isFinite(after) && after >= 0 ? Math.min(10000, after * 1000) : Math.round((400 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5));
      onRetry?.({ attempt, max: retries, status: res.status });
      await wait(ms);
    }
  });
}

/**
 * @param {string} base the ReportWright server's origin (the page's, or the embed's server)
 * @param {typeof fetch} [f]
 * @returns {typeof fetch}
 */
export function reportFetch(base, f0 = policy.fetch || ((...a) => fetch(...a)), { sqlPreview = false, onRetry, retries = 3, wait } = {}) {
  const self = new URL(base).origin;
  const { allowHosts, unsafeFetch } = policy;
  const f = withRetry(f0, { onRetry, retries, wait });
  // other sites: public hosts only, each redirect checked (the engine's guard); a refusal names the viewer's option
  const guarded = unsafeFetch ? f : guardedFetch({ allowHosts, viaBase: true }, f);
  const other = (url, init) => guarded(url, init).catch((e) => {
    if (e?.code === 'EPRIVATE') e.message = e.message.replace(/pass allowHosts: (\[[^\]]*\]) to render/, 'mountViewer({ allowHosts: $1 })');
    else if (e && typeof e === 'object') e.message = String(e.message).replace('(pass your own fetch to render)', '(a browser cannot see where it leads: use the URL it redirects to, or render on the server)');
    throw e;
  });
  const out = /** @type {any} */ (async (input, init = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input), base);
    const method = String(init.method || 'GET').toUpperCase();
    if (u.origin !== self) return other(u.href, { ...init, credentials: 'omit' }); // another site (the host page too) gets no cookies
    // the path as the server's router sees it: decoded (Next also tries /%61pi as /api) and with repeated slashes
    // collapsed (Next redirects //api/users to /api/users); an encoded slash or broken encoding is refused
    let path;
    try { path = decodeURIComponent(u.pathname).replace(/\/{2,}/g, '/'); } catch { path = null; }
    const read = path !== null && ['GET', 'HEAD'].includes(method) && !/%2f|%5c/i.test(u.pathname) && (DATA.some(r => r.test(path)) || !OURS.test(path));
    if (!read && !(method === 'POST' && u.pathname === '/api/data/sql' && sqlCall(init.body, sqlPreview))) {
      throw Object.assign(new Error(`A data source may only read data from this ReportWright server (sample data, the data proxy, saved SQL), not ${method} ${path}.`), { status: 403 });
    }
    // cookies only for our own data routes; no redirect followed on this server (one could lead into /api/users)
    const ours = DATA.some(r => r.test(u.pathname)) || u.pathname === '/api/data/sql'; // as written, not decoded
    return f(u.href, { ...init, credentials: ours ? 'same-origin' : 'omit', redirect: 'error' });
  });
  // the engine refuses a source whose host a parameter or an expression builds, as with its own guard
  if (!unsafeFetch) out.hostRule = { allowHosts };
  return out;
}
