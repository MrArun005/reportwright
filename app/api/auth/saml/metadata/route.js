// GET /api/auth/saml/metadata — this service provider's metadata, for the IdP admin.
import { accountsOn } from '@/server/session.js';
import { samlOn, samlMetadata } from '@/server/sso.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!accountsOn() || !samlOn()) return Response.json({ error: 'SAML sign-in is not set up on this server.' }, { status: 404 });
  return new Response(await samlMetadata(req), { headers: { 'content-type': 'application/samlmetadata+xml' } });
}
