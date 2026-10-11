// The HTML export config: most specific layer wins (viewer prop > report > admin > env > default).
import { describe, it, expect } from 'vitest';
import { resolveHtmlExport, envHtmlExport, isPublicBase, setExport, HTML_EXPORT_DEFAULTS } from '../../src/engine/htmlExport.js';

describe('resolveHtmlExport', () => {
  it('defaults to interactive, inline', () => {
    expect(resolveHtmlExport()).toEqual({ html: 'interactive', drillLinks: 'inline' });
    expect(HTML_EXPORT_DEFAULTS).toEqual({ html: 'interactive', drillLinks: 'inline' });
  });
  it('the most specific layer wins, per key', () => {
    const prop = { html: 'static' }, report = { html: 'tables', drillLinks: 'off' }, admin = { html: 'interactive', drillLinks: 'new-tab' };
    const env = envHtmlExport({ PW_HTML_EXPORT: 'tables', PW_HTML_DRILL_LINKS: 'off' });
    expect(resolveHtmlExport(prop, report, admin, env)).toEqual({ html: 'static', drillLinks: 'off' });
    expect(resolveHtmlExport(undefined, undefined, admin, env)).toEqual({ html: 'interactive', drillLinks: 'new-tab' });
    expect(resolveHtmlExport(null, {}, {}, env)).toEqual({ html: 'tables', drillLinks: 'off' });
  });
  it('unknown values fall through', () => {
    expect(resolveHtmlExport({ html: 'pdf', drillLinks: 'popup' }, { html: 'tables' })).toEqual({ html: 'tables', drillLinks: 'inline' });
  });
});

describe('isPublicBase', () => {
  it('only a public http(s) URL', () => {
    for (const b of [undefined, '', 'http://localhost:3000', 'http://127.0.0.1', 'http://[::1]:3000', 'http://0.0.0.0', 'file:///x', 'nonsense', 'http://app.localhost']) expect(isPublicBase(b)).toBe(false);
    for (const b of ['https://reports.example.com', 'http://10.0.0.5:3000']) expect(isPublicBase(b)).toBe(true);
  });
});

describe('report definition `export`', async () => {
  const { validate } = await import('../../src/engine/schema/validate.js');
  const def = (x) => ({ $schema: 'https://reportwright.dev/schema/report@1', name: 'r', sections: { body: { height: 10, items: [] } }, export: x });
  it('a valid export is clean; bad values warn', () => {
    expect(validate(def({ html: 'tables', drillLinks: 'off' })).warnings.filter(w => /export/i.test(w))).toEqual([]);
    const w = validate(def({ html: 'pdf', drill: 1 })).warnings.join('\n');
    expect(w).toMatch(/export\.html "pdf" is not one of interactive, tables, static/);
    expect(w).toMatch(/Unknown export property "drill"/);
  });
});

describe('setExport (designer Report properties)', () => {
  it('writes export into the definition and removes it on "Use server default"', () => {
    const d = { name: 'r' };
    setExport(d, 'html', 'static'); setExport(d, 'drillLinks', 'new-tab');
    expect(d.export).toEqual({ html: 'static', drillLinks: 'new-tab' });
    setExport(d, 'html', ''); expect(d.export).toEqual({ drillLinks: 'new-tab' });
    setExport(d, 'drillLinks', ''); expect('export' in d).toBe(false);
  });
});
