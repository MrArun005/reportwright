// PATCH /api/users/<email> { role?, password?, disabled?, groups?, allowSso?, resetTwoFactor?, forgetDevices?, unlockSignIn? } — change a
// user. DELETE — remove one. Admins only. resetTwoFactor: true turns their two-factor sign-in off (a lost phone) and ends
// their sessions. unlockSignIn: true forgets every failed sign-in counted for the account (src/server/limits.js).
// The last admin cannot be demoted, disabled or deleted (409).
import { updateUser, deleteUser, getUser } from '@/server/users.js';
import { requireRole } from '@/server/access.js';
import { sessionCookie, sessionClaims } from '@/server/session.js';
import { audit } from '@/server/audit.js';
import { notifyAccount } from '@/server/mail.js';
import { unlockLogin } from '@/server/limits.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

const fail = (e) => errorResponse(e);
// an email always has "@": without one the segment is still percent-encoded (a%40b.c)
const target = async (params) => { const e = String((await params).email); try { return e.includes('@') ? e : decodeURIComponent(e); } catch { return e; } };

export async function PATCH(req, { params }) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const email = await target(params);
    const body = await req.json().catch(() => ({}));
    const patch = {};
    for (const k of ['role', 'password', 'disabled', 'groups', 'allowSso']) if (body[k] !== undefined) patch[k] = body[k];
    if (body.resetTwoFactor === true) patch.resetTwoFactor = true;
    if (body.forgetDevices === true) patch.forgetDevices = true; // every browser of theirs is a stranger again (and signed out)
    const u = await updateUser(email, patch, { by: me });
    if (body.unlockSignIn === true) await unlockLogin(u.email);
    await audit('user.update', { req, actor: `user:${me.email}`, detail: { user: u.email, ...('role' in patch && { role: u.role }), ...('groups' in patch && { groups: u.groups }), ...('disabled' in patch && { disabled: u.disabled }), ...('password' in patch && { password: 'changed' }), ...('allowSso' in patch && { allowSso: u.allowSso }), ...(patch.resetTwoFactor && { twoFactor: 'reset' }), ...(patch.forgetDevices && { devices: 'forgotten' }), ...(body.unlockSignIn === true && { signIn: 'unlocked' }) } });
    if (patch.resetTwoFactor) notifyAccount(u.email, `An admin (${me.email}) turned off two-factor sign-in for your account.`);
    if (patch.password !== undefined) notifyAccount(u.email, `An admin (${me.email}) set a new password for your account.`);
    // a new password ends the user's sessions; an admin who changed their own stays signed in
    const headers = u.email === me.email && (patch.password !== undefined || patch.resetTwoFactor) ? { 'set-cookie': sessionCookie(req, await getUser(u.email), { m: sessionClaims(req)?.m && !patch.resetTwoFactor ? 1 : undefined, s: sessionClaims(req)?.s }) } : undefined;
    return Response.json(u, { headers });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const email = await target(params);
    if (!(await deleteUser(email, { by: me }))) return Response.json({ error: 'No such user.' }, { status: 404 });
    await audit('user.delete', { req, actor: `user:${me.email}`, detail: { user: String(email).toLowerCase() } });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
