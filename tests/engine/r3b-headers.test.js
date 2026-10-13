// R3-B item 5 (REVIEW-SECURITY-2 L5, EXTERNAL-REVIEW-3 §3.5): no page sent X-Frame-Options or a CSP. Now every page
// and answer has nosniff, a referrer and permissions policy and frame-ancestors ('none'; the viewer: this origin and
// PW_EMBED_ORIGINS), and report output served on this origin (thumbnail SVG, server renders, downloads) is sandboxed.
import { describe, it, expect } from 'vitest';
import { pageHeaders, outputHeaders, rwHeaders } from '../../src/server/headers.js';
import config from '../../next.config.mjs';

const find = (rules, source) => Object.fromEntries(rules.find(r => (source === ALL ? r.source.startsWith('/((?!viewer/') : r.source === source)).headers.map(h => [h.key, h.value]));
const ALL = '/((?!viewer/).*)';

describe('security headers', () => {
  it('pages and API answers: never framed; the viewer only by this origin and the embed origins', () => {
    const rules = pageHeaders('https://intranet.example.com, https://b.example.org');
    const all = find(rules, '/((?!viewer/).*)');
    expect(all).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    expect(all['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
    expect(all['Permissions-Policy']).toMatch(/camera=\(\)/);
    const viewer = find(rules, '/viewer/:path*');
    expect(viewer['Content-Security-Policy']).toMatch(/frame-ancestors 'self' https:\/\/intranet\.example\.com https:\/\/b\.example\.org;/);
    expect(viewer['X-Frame-Options']).toBeUndefined(); // it cannot list sites
    expect(find(pageHeaders(''), '/viewer/:path*')['X-Frame-Options']).toBe('SAMEORIGIN');
    // a value that would break out of the header is not taken as an origin
    expect(find(pageHeaders("https://a.com; script-src *, 'unsafe-inline'"), '/viewer/:path*')['Content-Security-Policy']).not.toMatch(/script-src|unsafe/);
  });
  it('next.config.mjs serves them', async () => {
    const rules = await config.headers();
    expect(rules.some(r => r.source.startsWith('/((?!viewer/') && r.headers.some(h => h.key === 'X-Frame-Options'))).toBe(true);
    // which rule sets a CSP on which path, as Next matches them: the output routes keep their own
    const { getPathMatch } = await import('next/dist/shared/lib/router/utils/path-match.js');
    const csp = (p) => rules.filter(r => getPathMatch(r.source, { strict: true, removeUnnamedParams: true })(p)).some(r => r.headers.some(h => h.key === 'Content-Security-Policy'));
    for (const p of ['/', '/designer/x', '/api/reports/x', '/viewer/x']) expect(csp(p), p).toBe(true);
    for (const p of ['/api/reports/x/thumb', '/api/reports/x/pdf', '/api/v1/render', '/api/v1/batches/b_1/download']) expect(csp(p), p).toBe(false);
  });
  it('report output on this origin: SVG runs nothing, HTML is sandboxed, files are files', () => {
    expect(outputHeaders('image/svg+xml')['content-security-policy']).toMatch(/default-src 'none'.*sandbox/);
    expect(outputHeaders('text/html; charset=utf-8')['content-security-policy']).toMatch(/^sandbox allow-scripts/);
    expect(outputHeaders('text/html')['content-security-policy']).not.toMatch(/allow-same-origin/);
    expect(outputHeaders('application/zip')['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'");
    for (const t of ['image/svg+xml', 'text/html', 'application/pdf', 'text/csv']) expect(outputHeaders(t)['x-content-type-options']).toBe('nosniff');
  });
  it('the routes that serve output set them (thumbnail, server render, API render, batch download)', async () => {
    const fs = await import('node:fs');
    for (const f of ['app/api/reports/[id]/thumb/route.js', 'app/api/reports/[id]/pdf/route.js', 'app/api/v1/render/route.js', 'app/api/v1/batches/[id]/download/route.js'])
      expect(fs.readFileSync(f, 'utf8'), f).toMatch(/\.\.\.outputHeaders\(/);
  });
});

it('our answer headers go out as x-reportwright-* only (x-pagewright-* removed in 1.0)', () => {
  expect(rwHeaders({ pages: '2' })).toEqual({ 'x-reportwright-pages': '2' });
});
