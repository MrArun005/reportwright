// @ts-check
// What the Settings page shows about features configured by environment (never a secret, only whether it is set).
import { mailOn, sender, allowedDomains, maxRecipients, maxAttachmentBytes } from './mail.js';

export async function serverStatus() {
  let from = null;
  try { from = mailOn() ? sender().address : null; } catch { from = 'PW_MAIL_FROM is not an address'; }
  return {
    mail: { on: mailOn(), from, allowedDomains: allowedDomains(), maxRecipients: maxRecipients(), maxAttachmentMb: Math.round(maxAttachmentBytes() / 1048576) },
  };
}
