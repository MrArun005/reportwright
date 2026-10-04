// The browser's fetch for a report's data sources (viewer, render worker, designer previews, interactive HTML export).
// A report is a stored definition someone else wrote, and the engine sends its URL, method, headers and body as written.
// On the Pagewright server itself it may only read data: GET (or HEAD) sample data, the data proxy, or a path that is
// not Pagewright's own (an API your reverse proxy serves on this host), and POST /api/data/sql (the engine's own SQL
// call; the server checks who may run what). Never another Pagewright API with the viewer's cookie: an admin who opens
// a report must not create a user, change permissions or read the audit log for it. Other sites get no cookies.

const DATA = [/^\/api\/sample\//, /^\/api\/data\/proxy$/];
const OURS = /^\/(?:$|api(?:\/|$)|admin(?:\/|$)|designer(?:\/|$)|viewer(?:\/|$)|login(?:\/|$)|embed(?:\/|$)|_next(?:\/|$))/i;

/**
 * @param {string} base the Pagewright server's origin (the page's, or the embed's server)
 * @param {typeof fetch} [f]
 * @returns {typeof fetch}
 */
export function reportFetch(base, f = (...a) => fetch(...a)) {
  const self = new URL(base).origin;
  return /** @type {any} */ (async (input, init = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input), base);
    const method = String(init.method || 'GET').toUpperCase();
    if (u.origin !== self) return f(u.href, { ...init, credentials: 'omit' }); // another site (the host page too) gets no cookies
    // the path as the server's router sees it: decoded (Next also tries /%61pi as /api) and with repeated slashes
    // collapsed (Next redirects //api/users to /api/users); an encoded slash or broken encoding is refused
    let path;
    try { path = decodeURIComponent(u.pathname).replace(/\/{2,}/g, '/'); } catch { path = null; }
    const read = path !== null && ['GET', 'HEAD'].includes(method) && !/%2f|%5c/i.test(u.pathname) && (DATA.some(r => r.test(path)) || !OURS.test(path));
    if (!read && !(method === 'POST' && u.pathname === '/api/data/sql')) {
      throw Object.assign(new Error(`A data source may only read data from this Pagewright server (sample data, the data proxy, saved SQL), not ${method} ${path}.`), { status: 403 });
    }
    // cookies only for our own data routes; no redirect followed on this server (one could lead into /api/users)
    const ours = DATA.some(r => r.test(u.pathname)) || u.pathname === '/api/data/sql'; // as written, not decoded
    return f(u.href, { ...init, credentials: ours ? 'same-origin' : 'omit', redirect: 'error' });
  });
}
