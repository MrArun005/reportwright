// POST /api/auth/logout — sign out: clears the cookie and ends every session of this user. A browser that holds a valid
// device cookie of this user keeps it (re-signed: session.rotateDevice), so sign-in floods cannot lock out someone who
// signed out; a sign-out never makes a new device known.
// { everywhere: true } also forgets every device of the account (as a password change does). After a single sign-on
// session the answer also says where the browser goes next ({ redirect }): the SAML IdP's single logout (a signed
// LogoutRequest), or the OIDC provider's end_session_endpoint (src/server/sso.js).
import { endSessions, getUser } from '@/server/users.js';
import { currentUser, clearCookie, sessionClaims, rotateDevice } from '@/server/session.js';
import { sloOn, samlLogoutStart, oidcLogoutUrl, clearLogoutCookies } from '@/server/sso.js';
import { audit } from '@/server/audit.js';
import { readJsonOr } from '@/server/body.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const user = await currentUser(req).catch(() => null);
  const h = new Headers({ 'cache-control': 'no-store' });
  h.append('set-cookie', clearCookie(req));
  let redirect = null, slo = null;
  if (user && !user.internal) {
    const body = await readJsonOr(req, null).catch(() => null); // signing out never fails on the body
    const everywhere = body?.everywhere === true;
    const after = await endSessions(user.email, { everywhere });
    const kept = after && !everywhere ? rotateDevice(req, after) : null;
    if (kept) h.append('set-cookie', kept);
    const via = sessionClaims(req)?.s;
    try {
      if (via === 'saml' && sloOn()) {
        const u = await getUser(user.email);
        if (u?.sso?.via === 'saml') { const r = await samlLogoutStart(req, u); redirect = r.url; slo = 'saml'; h.append('set-cookie', r.cookie); }
      } else if (via === 'oidc') { redirect = await oidcLogoutUrl(req); slo = redirect ? 'oidc' : null; }
    } catch (e) { console.error(`[reportwright] single logout: ${e.message}`); }
    await audit('auth.logout', { req, actor: `user:${user.email}`, ...(slo || everywhere ? { detail: { ...(slo ? { slo } : {}), ...(everywhere ? { everywhere } : {}) } } : {}) });
  }
  if (!slo || slo === 'oidc') for (const c of clearLogoutCookies(req)) h.append('set-cookie', c);
  return Response.json({ ok: true, ...(redirect ? { redirect } : {}) }, { headers: h });
}
