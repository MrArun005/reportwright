// @ts-check
// What the Settings page shows about features configured by environment (never a secret, only whether it is set).
import { samlOn, sloOn, oidcOn } from './sso.js';
import { siemStatus } from './siem.js';
import { publicKeyInfo, keySource } from './audit.js';
import { mailOn, sender, allowedDomains, maxRecipients, maxAttachmentBytes } from './mail.js';

export async function serverStatus() {
  let from = null;
  try { from = mailOn() ? sender().address : null; } catch { from = 'PW_MAIL_FROM is not an address'; }
  let key = null;
  try { key = { fingerprint: publicKeyInfo().fingerprint, source: keySource() }; } catch { key = null; }
  return {
    siem: siemStatus(), auditKey: key,
    sso: { saml: samlOn(), samlLogout: sloOn(), oidc: oidcOn(), oidcLogout: oidcOn() && process.env.PW_OIDC_LOGOUT !== 'off' },
    mail: { on: mailOn(), from, allowedDomains: allowedDomains(), maxRecipients: maxRecipients(), maxAttachmentMb: Math.round(maxAttachmentBytes() / 1048576) },
  };
}
