// /api/auth/saml/slo — SAML single logout (src/server/sso.js).
//   GET  ?SAMLResponse=…&SigAlg&Signature  the IdP's answer to our LogoutRequest (must match this browser's pw_slo)
//   GET  ?SAMLRequest=…&SigAlg&Signature   an IdP-initiated logout (HTTP-Redirect): ends the account's sessions,
//        answered with a signed LogoutResponse back to the IdP
//   POST SAMLRequest (+RelayState)          the same over HTTP-POST (a signed XML request)
// Unsigned, badly signed, stale, replayed or misdirected messages are refused and logged.
import { accountsOn, clearCookie } from '@/server/session.js';
import { sloOn, samlSloMessage, sloRequestId, samlUserFor, samlLogoutResponseUrl, clearLogoutCookies, publicBase } from '@/server/sso.js';
import { endSessions } from '@/server/users.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

const go = (location, cookies = []) => { const h = new Headers({ location, 'cache-control': 'no-store' }); for (const c of cookies) h.append('set-cookie', c); return new Response(null, { status: 303, headers: h }); };

async function handle(req, form) {
  if (!accountsOn() || !sloOn()) return Response.json({ error: 'SAML single logout is not set up on this server.' }, { status: 404 });
  let m;
  try { m = await samlSloMessage(req, form); }
  catch (e) {
    await audit('auth.slo_failed', { req, status: 'failed', detail: { reason: String(e.message).slice(0, 200) } });
    return Response.json({ error: e.message }, { status: e.status || 400 });
  }
  if (m.kind === 'LogoutResponse') {
    // it must answer the request this browser sent (pw_slo): a response captured elsewhere cannot sign this browser out
    const rid = sloRequestId(req);
    if (!rid || rid !== m.inResponseTo) {
      await audit('auth.slo_failed', { req, status: 'failed', detail: { from: 'idp response', reason: 'not this browser\'s request' } });
      return Response.json({ error: 'This logout answer is not for a sign-out from this browser.' }, { status: 400 });
    }
    await audit('auth.slo', { req, status: m.ok ? 'ok' : 'failed', detail: { from: 'idp response', idpStatus: m.ok ? 'success' : 'not success' } });
    // our side signed out before going to the IdP; RelayState is ignored: the browser always lands on the sign-in page
    return go(`${publicBase(req)}/login`, [clearCookie(req), ...clearLogoutCookies(req)]);
  }
  const u = await samlUserFor(m.nameID, m.format);
  if (u) await endSessions(u.email);
  await audit('auth.slo', { req, actor: u ? `user:${u.email}` : 'anon', detail: { from: 'idp request', account: u ? 'signed out' : 'no such account' } });
  return go(await samlLogoutResponseUrl(req, m), [clearCookie(req), ...clearLogoutCookies(req)]);
}

export async function GET(req) { return handle(req, null); }
export async function POST(req) {
  if (Number(req.headers.get('content-length')) > 1024 * 1024) return Response.json({ error: 'Too large.' }, { status: 413 });
  const f = await req.formData().catch(() => null);
  return handle(req, { SAMLRequest: String(f?.get('SAMLRequest') || ''), RelayState: String(f?.get('RelayState') || '') });
}
