// @ts-check
// Security headers. Pages and API answers get them from next.config.mjs (pageHeaders, built with the embed origins);
// a route that serves report output on this origin (a thumbnail SVG, a server render, a batch download) adds
// outputHeaders for its content type, so a rendered file can never run as a page of the app.
// ponytail: the page CSP limits framing, base, objects and forms, not scripts: Next's inline hydration scripts would
// need per-request nonces (middleware) for a script-src; add them when the app has no other inline scripts.

const BASE = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
];

/** Routes that serve report output on this origin (path-to-regexp source fragments, without the leading slash). */
const OUTPUT = ['api/reports/[^/]+/(?:thumb|pdf)', 'api/v1/render', 'api/v1/batches/[^/]+/download'];

/**
 * The header rules for next.config.mjs: frame-ancestors 'none' everywhere, except the viewer pages, which the sites
 * in PW_EMBED_ORIGINS (and this origin) may frame. X-Frame-Options for browsers without frame-ancestors.
 * @param {string} embedOrigins PW_EMBED_ORIGINS (comma-separated)
 */
export function pageHeaders(embedOrigins = '') {
  const origins = embedOrigins.split(',').map(s => s.trim()).filter(s => /^https?:\/\/[^\s;,']+$/.test(s));
  const csp = (ancestors) => `frame-ancestors ${ancestors}; base-uri 'self'; object-src 'none'; form-action 'self'`;
  return [
    // everything but the viewer and the routes that serve report output: never framed (API answers too). A config
    // header replaces a route's own header of the same name, so the output routes are left out here and set their
    // CSP by content type (outputHeaders); they get the rest below
    { source: `/((?!viewer/|${OUTPUT.map(o => `${o}$`).join('|')}).*)`, headers: [...BASE, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: csp("'none'") }] },
    { source: `/(${OUTPUT.join('|')})`, headers: [...BASE, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
    // the viewer: this origin and the embedding sites (X-Frame-Options cannot list sites: only without any)
    { source: '/viewer/:path*', headers: [...BASE, ...(origins.length ? [] : [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]), { key: 'Content-Security-Policy', value: csp(["'self'", ...origins].join(' ')) }] },
  ];
}

/**
 * Headers for report output served on this origin, by content type. Set by the route (route headers win over the
 * config's for the same name). HTML runs sandboxed (an opaque origin: no cookies, no app APIs), keeping its own scripts
 * (the interactive export pins them by hash); an SVG may not run anything; a PDF only opens; anything else is a file.
 * @param {string} type @returns {Record<string, string>}
 */
export function outputHeaders(type) {
  const t = String(type || '').toLowerCase();
  const csp = t.startsWith('text/html') ? "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals; frame-ancestors 'self'"
    : t.startsWith('image/svg') ? "default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; sandbox; frame-ancestors 'self'"
      : t.startsWith('application/pdf') ? "frame-ancestors 'self'; object-src 'none'"
        : "default-src 'none'; sandbox; frame-ancestors 'none'";
  return { 'x-content-type-options': 'nosniff', 'content-security-policy': csp };
}

/**
 * Our own x-reportwright-* answer headers, each also sent under its old name x-pagewright-* (deprecated 0.13.2, gone in
 * 1.0) so a client written before the rename keeps reading it. @param {Record<string, string>} h name → value
 */
export const rwHeaders = (h) => Object.fromEntries(Object.entries(h).flatMap(([k, v]) => [[`x-reportwright-${k}`, v], [`x-pagewright-${k}`, v]]));
