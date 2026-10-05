// @ts-check
// Errors as API answers. A message the code wrote for the caller has a status (e.status: 4xx, or a 5xx it means, such
// as "this SQL login can do more than read"): it goes back as written. An error with no status is unexpected (a bug, a
// driver or file-system error whose text may hold paths, hosts or SQL): the caller gets a generic message and a
// reference id, and the log gets the id, the message and the stack, as one JSON line on stderr. Every 5xx is logged.
import crypto from 'node:crypto';

/** Log one server error; its reference id. @param {any} e @param {string} [where] */
export function logError(e, where = '') {
  const id = crypto.randomUUID().slice(0, 8);
  const line = { level: 'error', time: new Date().toISOString(), id, where: where || undefined, status: e?.status || 500, message: String(e?.message ?? e).slice(0, 2000), stack: e?.stack ? String(e.stack).split('\n').slice(1, 8).map(s => s.trim()) : undefined };
  console.error(JSON.stringify(line));
  return id;
}

/** What the caller may see of an error: { message, status, id } (id when it was logged). @param {any} e @param {number} [status] */
export function publicError(e, status = e?.status || 500) {
  // a data source that answered an error (the engine's "HTTP 404 from <url>"): the report's data is missing, not the
  // server broken: 502 that says so. The URL goes to the log only (with the reference): it may name an internal host or
  // carry a value in its path, and the caller may be any viewer or an anonymous embed reader
  const ds = !e?.status && /HTTP (\d{3}) from \S+/.exec(String(e?.message ?? ''));
  if (ds) {
    // logged without query strings: a source URL may carry a key (?api_key=)
    const id = logError(Object.assign(new Error(String(e.message).replace(/\?[^\s"']*/g, '?…')), { stack: e.stack?.replace(/\?[^\s"']*/g, '?…') }), 'data source');
    return { message: `A data source of this report answered HTTP ${ds[1]}. Reference: ${id}.`, status: 502, id };
  }
  if (status < 500) return { message: String(e?.message ?? e), status, id: null };
  const id = logError(e);
  return { message: e?.status ? String(e.message) : `Something went wrong on the server. Reference: ${id}.`, status, id };
}

/**
 * A JSON error answer: { error, requestId? , ...extra }.
 * @param {any} e @param {{ status?: number, headers?: Record<string, string>, extra?: Record<string, any> }} [o]
 */
export function errorResponse(e, { status, headers, extra } = {}) {
  const p = publicError(e, status ?? (e?.status || 500));
  // e.body: fields a 4xx carries for its caller (a 409's current revision)
  return Response.json({ error: p.message, ...(p.id && { requestId: p.id }), ...(p.status < 500 && e?.body && typeof e.body === 'object' ? e.body : {}), ...extra }, { status: p.status, headers: { ...(e?.retryAfter && { 'retry-after': String(e.retryAfter) }), ...headers, ...(p.id && { 'x-request-id': p.id }) } });
}

const warned = new Map();
/**
 * For background work whose failure has no caller to tell (a heartbeat, a sweep, a checkpoint): a .catch() handler that
 * logs one JSON warning line per `where`, at most once a minute (a down database must not flood the log).
 * @param {string} where
 */
export const logWarn = (where) => (e) => {
  const now = Date.now();
  if (now - (warned.get(where) || 0) < 60000) return;
  if (warned.size > 1000) warned.clear();
  warned.set(where, now);
  console.warn(JSON.stringify({ level: 'warn', time: new Date(now).toISOString(), where, message: String(e?.message ?? e).slice(0, 500) }));
};
