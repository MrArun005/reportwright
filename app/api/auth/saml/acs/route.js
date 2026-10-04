// POST /api/auth/saml/acs — the IdP posts the SAMLResponse here (HTTP-POST binding). It comes from the IdP's site, so
// it is exempt from the same-site Origin check; what protects it is the signed assertion and the browser binding at
// /api/auth/saml/finish (src/server/sso.js).
import { accountsOn } from '@/server/session.js';
import { samlOn, samlAcs, publicBase, clearSsoCookie } from '@/server/sso.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn() || !samlOn()) return Response.json({ error: 'SAML sign-in is not set up on this server.' }, { status: 404 });
  try {
    if (Number(req.headers.get('content-length')) > 1024 * 1024) throw Object.assign(new Error('The SAML response is too large.'), { status: 413, code: 'response' });
    const form = await req.formData();
    const next = await samlAcs(req, String(form.get('SAMLResponse') || ''));
    return new Response(null, { status: 303, headers: { location: next, 'cache-control': 'no-store' } });
  } catch (e) {
    await audit('auth.sso_failed', { req, status: 'failed', detail: { method: 'saml', reason: String(e.message).slice(0, 200) } });
    return new Response(null, { status: 303, headers: { location: `${publicBase(req)}/login?sso_error=${encodeURIComponent(e.code || 'sso')}`, 'set-cookie': clearSsoCookie(req) } });
  }
}
