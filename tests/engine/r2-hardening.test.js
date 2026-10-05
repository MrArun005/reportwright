// R2 H-1/H-2/H-3: browser image URLs by the data-fetch policy; esc() escapes quotes; SAML ACS DOCTYPE guard; OIDC,
// JWKS and SIEM fetches through the SSRF guard; bounded body reads; clear-text SMTP refused to remote relays.
import { describe, it, expect } from 'vitest';
import { imageHref, pageToSvg } from '../../src/exporters/svg.js';

describe('H-1 image URLs a viewer\'s browser loads', () => {
  it('data:image and own paths as they are; http(s) through the data proxy; anything else not at all', () => {
    expect(imageHref('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(imageHref('/api/sample/logo.png')).toBe('/api/sample/logo.png');
    expect(imageHref('https://tracker.example/p.gif?u=1')).toBe('/api/data/proxy?url=https%3A%2F%2Ftracker.example%2Fp.gif%3Fu%3D1');
    expect(imageHref('http://10.0.0.1/admin', 'https://pw.example')).toBe('https://pw.example/api/data/proxy?url=http%3A%2F%2F10.0.0.1%2Fadmin');
    for (const bad of ['//evil.example/x.png', 'javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'ftp://x/y', '\\\\evil\\share']) expect(imageHref(bad)).toBe('');
    const svg = pageToSvg({ items: [{ t: 'image', x: 0, y: 0, w: 10, h: 10, src: 'https://tracker.example/p.gif' }] }, 100, 100);
    expect(svg).toContain('href="/api/data/proxy?url=https%3A%2F%2Ftracker.example%2Fp.gif"');
    expect(svg).not.toContain('href="https://tracker');
  });
  it('esc() escapes single quotes too', () => {
    expect(pageToSvg({ items: [{ t: 'image', x: 0, y: 0, w: 1, h: 1, src: "/a'b" }] }, 1, 1)).toContain('/a&#39;b');
  });
});

describe('H-2/H-3', () => {
  it('a chunked body past the cap is refused while it is read (no Content-Length)', async () => {
    const { readBody, readDefinition } = await import('../../src/server/reports.js');
    let pulled = 0;
    const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024)); if (pulled > 50) c.close(); } });
    const req = new Request('http://pw.test/x', { method: 'POST', body: stream, duplex: 'half' });
    await expect(readDefinition(req)).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBeLessThan(10); // stopped near 5 MB, not after 50
    expect((await readBody(new Request('http://pw.test/x', { method: 'POST', body: 'abc' }), 10)).length).toBe(3);
  });

  it('the SAML ACS refuses a DOCTYPE before any parser sees it', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/server/sso.js', import.meta.url), 'utf8');
    const acs = src.slice(src.indexOf('validatePostResponseAsync') - 400, src.indexOf('validatePostResponseAsync'));
    expect(acs).toMatch(/<!DOCTYPE\|<!ENTITY/);
  });

  it('OIDC and SIEM fetches go through the SSRF guard: a private host the operator did not name is refused', async () => {
    const keep = { ...process.env };
    Object.assign(process.env, { PW_OIDC_ISSUER: 'https://idp.example.com', PW_OIDC_CLIENT_ID: 'x', PW_OIDC_CLIENT_SECRET: 'y' });
    try {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../src/server/sso.js', import.meta.url), 'utf8');
      expect(src).toMatch(/async function idpFetch[\s\S]{0,1200}return safeFetch\(url, \{ \.\.\.init, body, headers \}, \{ allow: issuer/);
      expect(fs.readFileSync(new URL('../../src/server/siem.js', import.meta.url), 'utf8')).toMatch(/safeFetch\(t\.url/);
      const { safeFetch } = await import('../../src/server/safeFetch.js');
      await expect(safeFetch('http://169.254.169.254/latest/meta-data/', {}, { allow: ['https://idp.example.com'], hops: 0 })).rejects.toThrow();
    } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  });

  it('clear-text SMTP to a non-local relay is refused by default', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/server/mail.js', import.meta.url), 'utf8');
    expect(src).toMatch(/requireTLS: !url\.startsWith\('smtps:'\) && process\.env\.PW_SMTP_REQUIRE_TLS !== '0' && !local/);
    const { checkConfig } = await import('../../src/server/config.js');
    expect(checkConfig({ NODE_ENV: 'production', PW_SMTP_REQUIRE_TLS: '0' }).warnings.join()).toMatch(/clear text/);
  });
});
