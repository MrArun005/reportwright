// POST /api/auth/logout — sign out: clears the cookie and ends every session of this user. After a single sign-on
// session the answer also says where the browser goes next ({ redirect }): the SAML IdP's single logout (a signed
// LogoutRequest), or the OIDC provider's end_session_endpoint (src/server/sso.js).
import { endSessions, getUser } from '@/server/users.js';
import { currentUser, clearCookie, sessionClaims } from '@/server/session.js';
import { sloOn, samlLogoutStart, oidcLogoutUrl, clearLogoutCookies } from '@/server/sso.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const user = await currentUser(req).catch(() => null);
  const h = new Headers({ 'cache-control': 'no-store' });
  h.append('set-cookie', clearCookie(req));
  let redirect = null, slo = null;
  if (user && !user.internal) {
    await endSessions(user.email);
    const via = sessionClaims(req)?.s;
    try {
      if (via === 'saml' && sloOn()) {
        const u = await getUser(user.email);
        if (u?.sso?.via === 'saml') { const r = await samlLogoutStart(req, u); redirect = r.url; slo = 'saml'; h.append('set-cookie', r.cookie); }
      } else if (via === 'oidc') { redirect = await oidcLogoutUrl(req); slo = redirect ? 'oidc' : null; }
    } catch (e) { console.error(`[pagewright] single logout: ${e.message}`); }
    await audit('auth.logout', { req, actor: `user:${user.email}`, ...(slo ? { detail: { slo } } : {}) });
  }
  if (!slo || slo === 'oidc') for (const c of clearLogoutCookies(req)) h.append('set-cookie', c);
  return Response.json({ ok: true, ...(redirect ? { redirect } : {}) }, { headers: h });
}
