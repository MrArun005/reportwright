// @ts-check
// Autosave drafts of unsaved designer changes, kept in this browser (localStorage) and offered back on the next open.
// A draft is never a secret store: data sources (URLs, headers, bodies, SQL, inline data), parameter defaults and
// credential-like URL query values are left out; restoring takes them from the saved report. Drafts are per user
// (a hash of the signed-in email), expire after DRAFT_TTL, are cleared at sign-out and when another user opens the
// designer, and are not written when the designer is embedded or framed by another page.
// ponytail: browser storage; a server-side draft in the report's version history is the upgrade (needs an API route).

export const DRAFT_PREFIX = 'pw.draft.';
export const DRAFT_TTL = 7 * 24 * 3600 * 1000;

/** A short, stable hash of the user (FNV-1a), so the key does not spell out the email. */
export function userTag(email) {
  let h = 0x811c9dc5;
  for (const ch of String(email || 'anonymous')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const draftKey = (user, id) => `${DRAFT_PREFIX}${userTag(user)}.${id}`;

const SECRET_PARAM = /token|key|secret|pass|auth|sig|session|code|credential/i;
/** A URL's query values that look like credentials are blanked (the rest of the URL stays as designed). */
function scrubUrl(s) {
  if (typeof s !== 'string' || !/^(https?:)?\/\/|^\/[^/]/.test(s) || !s.includes('?')) return s;
  const [head, ...rest] = s.split('?');
  const q = rest.join('?').split('#')[0];
  const hash = s.includes('#') ? `#${s.split('#').slice(1).join('#')}` : '';
  return `${head}?${q.split('&').map(kv => { const [k] = kv.split('='); return SECRET_PARAM.test(decodeURIComponent(k || '')) ? `${k}=` : kv; }).join('&')}${hash}`;
}
function scrubDeep(v) {
  if (typeof v === 'string') return scrubUrl(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!/^(headers|authorization|password|token|apiKey|secret)$/i.test(k)) o[k] = scrubDeep(x);
    return o;
  }
  return v;
}

/** What may be kept in the browser: the layout, without data sources' settings, parameter defaults or credentials. */
export function sanitizeDraft(def) {
  const d = scrubDeep(JSON.parse(JSON.stringify(def || {})));
  d.dataSources = (def?.dataSources || []).map(s => ({ name: s.name, type: s.type }));
  d.parameters = (d.parameters || []).map(({ default: _d, ...p }) => p);
  return d;
}

/** A draft restored onto the saved report: data sources and parameter defaults come from the saved report by name. */
export function mergeDraft(draft, saved) {
  const src = new Map((saved?.dataSources || []).map(s => [s.name, s]));
  const prm = new Map((saved?.parameters || []).map(p => [p.name, p]));
  return {
    ...draft,
    dataSources: (draft.dataSources || []).map(s => src.get(s.name)).filter(Boolean),
    parameters: (draft.parameters || []).map(p => (prm.has(p.name) && prm.get(p.name).default !== undefined ? { ...p, default: prm.get(p.name).default } : p)),
  };
}

/** @param {Storage} store */
export function writeDraft(store, user, id, def, now = Date.now()) {
  try { store.setItem(draftKey(user, id), JSON.stringify({ at: now, def: sanitizeDraft(def) })); return true; } catch { return false; } // full or blocked storage: no draft
}
/** @param {Storage} store */
export function readDraft(store, user, id, now = Date.now()) {
  try {
    const d = JSON.parse(store.getItem(draftKey(user, id)) || 'null');
    if (!d || !d.def || typeof d.def !== 'object') return null;
    if (!(now - d.at < DRAFT_TTL)) { store.removeItem(draftKey(user, id)); return null; }
    return d;
  } catch { return null; }
}
/** @param {Storage} store */
export function clearDraft(store, user, id) { try { store.removeItem(draftKey(user, id)); } catch { /* blocked storage */ } }
/**
 * Remove drafts: all of them (sign-out), or all but this user's (another user opened the designer), and expired ones.
 * @param {Storage} store
 */
export function clearDrafts(store, keepUser = null, now = Date.now()) {
  try {
    const keep = keepUser == null ? null : `${DRAFT_PREFIX}${userTag(keepUser)}.`;
    const keys = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(DRAFT_PREFIX)) keys.push(k); }
    for (const k of keys) {
      let old = true;
      try { old = !(now - JSON.parse(store.getItem(k) || '{}').at < DRAFT_TTL); } catch { /* unreadable: drop it */ }
      if (!keep || !k.startsWith(keep) || old) store.removeItem(k);
    }
  } catch { /* blocked storage */ }
}
/** Sign-out: no draft stays behind in this browser. */
export function clearAllDrafts() { try { clearDrafts(localStorage); } catch { /* no storage */ } }
