// @ts-check
/** Theme preference: 'light' | 'dark' | 'system'. Stored per browser; the resolved theme goes on <html data-theme>. */

export const THEME_KEY = 'pw-theme';

/** Runs inline in <head> before first paint, so there is no flash of the wrong theme. Keep it tiny and dependency-free. */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;

/** @returns {'light'|'dark'|'system'} */
export function readPreference() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

/** @param {'light'|'dark'|'system'} pref */
export function resolve(pref) {
  if (pref !== 'system') return pref;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {'light'|'dark'|'system'} pref */
export function applyPreference(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* private mode: apply for this page only */ }
  document.documentElement.dataset.theme = resolve(pref);
}
