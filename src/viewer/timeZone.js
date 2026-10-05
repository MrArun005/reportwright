// The viewer's time zone for server renders (/api/reports/<id>/pdf?timeZone=, /api/v1/render { timeZone }), so a
// server file shows dates on the reader's clock as the browser view does. The report's own timeZone still wins.

/** @returns {string|undefined} the browser's IANA zone, e.g. "Asia/Kolkata" */
export function viewerTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

/** `url` with `?timeZone=<viewer zone>` added (kept as is when the zone is unknown or already given). @param {string} url */
export function withTimeZone(url, tz = viewerTimeZone()) {
  if (!tz || /[?&]timeZone=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}timeZone=${encodeURIComponent(tz)}`;
}
