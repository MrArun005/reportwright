// R3-B item 6: the smaller findings, one test each.
import { describe, it, expect, afterEach } from 'vitest';

const keep = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); });

describe('OIDC jwks_uri goes through the SSRF guard (REVIEW-SECURITY-2 L2)', () => {
  it('a discovery document pointing the keys at a private host is refused', async () => {
    process.env.PW_OIDC_ISSUER = 'https://idp.example.com';
    process.env.PW_OIDC_CLIENT_ID = 'pw';
    const { verifyIdToken } = await import('../../src/server/sso.js');
    for (const uri of ['https://10.0.0.5/keys', 'https://169.254.169.254/latest/meta-data', 'https://127.0.0.1:9/jwks']) {
      const e = await verifyIdToken('a.b.c', { issuer: 'https://idp.example.com', jwks_uri: uri }, 'n').then(() => null, x => x);
      expect(e?.status, uri).toBe(401);
      expect(String(e.message), uri).toMatch(/private|local/i);
    }
  });
});
