// UI strings for the viewer, designer, home, admin and login pages. One table per language with the same keys
// (tests/engine/viewer-p6.test.js checks). Add a language: add a file with every key and list it here.
import en from './en.js';
import hi from './hi.js';

export const STRINGS = { en, hi };
export const LANGUAGES = Object.keys(STRINGS);
const RTL = new Set(['ar']);

/** A supported language for a `?lang=` value: exact (any case), then the base language, else English. */
export function pickLang(v) {
  const s = String(v || '').trim().toLowerCase();
  return LANGUAGES.find(l => l.toLowerCase() === s) || LANGUAGES.find(l => l === s.split('-')[0]) || 'en';
}
export const dirOf = (lang) => (RTL.has(pickLang(lang)) ? 'rtl' : 'ltr');

/** A UI string; `{name}` placeholders are filled from vars. A key missing in a language falls back to English. */
export function t(lang, key, vars) {
  const s = STRINGS[pickLang(lang)][key] ?? STRINGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s;
}
