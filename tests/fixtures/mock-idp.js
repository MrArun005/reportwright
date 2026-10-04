// Test identity providers: a small OpenID Connect provider (an HTTP server, RS256 keys made at start) and a SAML IdP
// that signs responses with a test certificate (node-forge) and xml-crypto. Used by tests/engine/sso.test.js and
// tests/e2e/sso.mjs. Each can be told to misbehave (wrong issuer, audience, nonce, expired, unsigned, other key, …).
import http from 'node:http';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

/**
 * An OIDC provider on 127.0.0.1:<port>. `user` is who signs in next; `tamper` changes the next ID token.
 * /authorize answers at once (no login page): it redirects back with a code.
 * @param {{ port?: number, clientId?: string, clientSecret?: string }} [o]
 */
export async function startOidc({ port = 0, clientId = 'pagewright', clientSecret = 'oidc-test-secret' } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true }); // a key the provider does not publish
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const state = { user: { sub: 'u1', email: 'oidc.user@example.com', email_verified: true, groups: [] }, tamper: {}, tokenCalls: 0, lastAuthorize: null };
  let issuer;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, issuer);
    const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/.well-known/openid-configuration') {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    }
    if (u.pathname === '/jwks') return json({ keys: [jwk] });
    if (u.pathname === '/authorize') {
      const p = Object.fromEntries(u.searchParams);
      state.lastAuthorize = p;
      if (p.client_id !== clientId || p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !p.code_challenge) return json({ error: 'invalid_request' }, 400);
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { ...p, user: state.user });
      const back = new URL(p.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', state.tamper.state ?? p.state);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      state.tokenCalls++;
      let body = '';
      for await (const c of req) body += c;
      const p = Object.fromEntries(new URLSearchParams(body));
      const auth = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
      if (auth !== `${clientId}:${clientSecret}`) return json({ error: 'invalid_client' }, 401);
      const c = codes.get(p.code);
      codes.delete(p.code); // one use
      if (!c || p.redirect_uri !== c.redirect_uri) return json({ error: 'invalid_grant' }, 400);
      const challenge = crypto.createHash('sha256').update(String(p.code_verifier || '')).digest('base64url');
      if (challenge !== c.code_challenge) return json({ error: 'invalid_grant', error_description: 'PKCE' }, 400);
      const t = state.tamper;
      const now = Math.floor(Date.now() / 1000);
      const claims = { ...c.user, nonce: t.nonce ?? c.nonce, ...(t.azp ? { azp: t.azp } : {}) };
      let jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(t.iss ?? issuer)
        .setAudience(t.aud ?? clientId).setIssuedAt(t.iat ?? now).setExpirationTime(t.exp ?? now + 300).setSubject(c.user.sub);
      let token = await jwt.sign(t.otherKey ? other.privateKey : privateKey);
      if (t.alg === 'none') token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${token.split('.')[1]}.`;
      if (t.alg === 'HS256') token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience(clientId).setIssuedAt(now).setExpirationTime(now + 300).setSubject(c.user.sub).sign(new TextEncoder().encode(clientSecret));
      return json({ access_token: 'at', token_type: 'Bearer', id_token: token });
    }
    json({ error: 'not found' }, 404);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return { issuer, clientId, clientSecret, state, close: () => new Promise(r => server.close(r)) };
}

/* ---------------- SAML ---------------- */

/** A self-signed RSA certificate and key (PEM). */
export function testCert(cn = 'Test IdP') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const iso = (ms) => new Date(ms).toISOString();

/**
 * An assertion as XML (unsigned).
 * @param {{ id?: string, issuer: string, email: string, groups?: string[], audience: string, recipient: string,
 *   inResponseTo?: string|null, notBefore?: number, notOnOrAfter?: number, rawEmail?: string, method?: string }} a
 */
export function assertionXml(a) {
  const now = Date.now();
  const id = a.id || `_a${crypto.randomBytes(10).toString('hex')}`;
  const nb = iso(a.notBefore ?? now - 60000), noa = iso(a.notOnOrAfter ?? now + 300000);
  const irt = a.inResponseTo ? ` InResponseTo="${esc(a.inResponseTo)}"` : '';
  const email = a.rawEmail ?? esc(a.email);
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(now)}">`
    + `<saml:Issuer>${esc(a.issuer)}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="${a.method || 'urn:oasis:names:tc:SAML:2.0:cm:bearer'}"><saml:SubjectConfirmationData NotOnOrAfter="${noa}" Recipient="${esc(a.recipient)}"${irt}/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${nb}" NotOnOrAfter="${noa}"><saml:AudienceRestriction><saml:Audience>${esc(a.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="groups">${(a.groups || []).map(g => `<saml:AttributeValue>${esc(g)}</saml:AttributeValue>`).join('')}</saml:Attribute></saml:AttributeStatement>`
    + `</saml:Assertion>`;
}

/** Sign the first Assertion in xml (enveloped, exclusive c14n, RSA-SHA256). */
export function signAssertion(xml, key, cert) {
  const sig = new SignedXml({ privateKey: key, publicCert: cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
  return sig.getSignedXml();
}

/** A Response around an assertion (already signed or not). */
export function responseXml({ issuer, destination, inResponseTo, assertion }) {
  const irt = inResponseTo ? ` InResponseTo="${esc(inResponseTo)}"` : '';
  const dest = destination ? ` Destination="${esc(destination)}"` : '';
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(10).toString('hex')}" Version="2.0" IssueInstant="${iso(Date.now())}"${dest}${irt}>`
    + `<saml:Issuer>${esc(issuer)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
}

export const b64 = (s) => Buffer.from(s).toString('base64');

/**
 * A SAML IdP over HTTP for browser tests: GET /sso?SAMLRequest=… (HTTP-Redirect binding) answers at once with a page
 * that POSTs a signed response for `state.user` to the ACS (HTTP-POST binding), as a real IdP does after its login.
 * @param {{ port?: number, issuer: string, acs: string, audience: string, cert: string, key: string }} o
 */
export async function startSamlIdp({ port = 0, issuer, acs, audience, cert, key }) {
  const zlib = await import('node:zlib');
  const state = { user: { email: 'saml.user@example.com', groups: [] }, requests: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/sso') { res.writeHead(404); return res.end(); }
    const xml = zlib.inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest') || '', 'base64')).toString();
    const id = /\bID="([^"]+)"/.exec(xml)?.[1];
    state.requests.push(id);
    const assertion = signAssertion(assertionXml({ issuer, audience, recipient: acs, inResponseTo: id, ...state.user }), key, cert);
    const resp = b64(responseXml({ issuer, destination: acs, inResponseTo: id, assertion }));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>IdP</title><form method="post" action="${esc(acs)}"><input type="hidden" name="SAMLResponse" value="${resp}"><button>Continue</button></form><script>document.forms[0].submit()</script>`);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/sso`, state, close: () => new Promise(r => server.close(r)) };
}
