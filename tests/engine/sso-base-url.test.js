// Outside development, SSO stays off until PW_BASE_URL fixes the server's own address.
import { describe, it, expect, afterEach } from 'vitest';
import { samlOn, oidcOn } from '../../src/server/sso.js';

const KEYS = ['PW_MODE', 'PW_BASE_URL', 'PW_SAML_ENTRY_POINT', 'PW_SAML_IDP_CERT', 'PW_SAML_IDP_ISSUER', 'PW_OIDC_ISSUER', 'PW_OIDC_CLIENT_ID'];
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]); });

function configure(mode, base) {
  Object.assign(process.env, { PW_MODE: mode, PW_SAML_ENTRY_POINT: 'https://idp.test/sso', PW_SAML_IDP_CERT: 'x', PW_SAML_IDP_ISSUER: 'https://idp.test',
    PW_OIDC_ISSUER: 'https://idp.test', PW_OIDC_CLIENT_ID: 'c' });
  if (base) process.env.PW_BASE_URL = base; else delete process.env.PW_BASE_URL;
}

describe('SSO needs PW_BASE_URL in production', () => {
  it('is off in production without it', () => { configure('prod'); expect(samlOn()).toBe(false); expect(oidcOn()).toBe(false); });
  it('is on in production with it', () => { configure('prod', 'https://reports.test'); expect(samlOn()).toBe(true); expect(oidcOn()).toBe(true); });
  it('is on in development without it', () => { configure('dev'); expect(samlOn()).toBe(true); });
});
