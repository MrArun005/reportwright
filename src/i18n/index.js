// UI strings for the viewer, designer, home, admin and login pages. One table per language with the same keys
// (tests/engine/viewer-p6.test.js checks). Add a language: add a file with every key and list it here.
import en from './en.js';
import hi from './hi.js';
import es from './es.js';
import fr from './fr.js';
import de from './de.js';
import ja from './ja.js';
import zh from './zh.js';
import ptBR from './pt-BR.js';
import ar from './ar.js';
import gov from './gov.js';
import ux from './ux.js';
import home from './home.js';
import r4 from './r4.js';

// gov.js: the server governance strings (batch 5); ux.js: the designer and viewer UX batch (R1-C); home.js: the Overview; r4.js: the R4 bug list. All merged into each language
const base = { en, hi, es, fr, de, ja, zh, 'pt-BR': ptBR, ar };
export const STRINGS = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v, ...gov[k], ...ux[k], ...home[k], ...r4[k] }]));
export const LANGUAGES = Object.keys(STRINGS);
const RTL = new Set(['ar']);

/** A supported language for a `?lang=` value: exact (any case), then the base language, else English. */
export function pickLang(v) {
  const s = String(v || '').trim().toLowerCase();
  return LANGUAGES.find(l => l.toLowerCase() === s) || LANGUAGES.find(l => l === s.split('-')[0]) || 'en';
}
export const dirOf = (lang) => (RTL.has(pickLang(lang)) ? 'rtl' : 'ltr');

/** A string with placeholders as parts, so a page can put elements (a <code>) where the {names} are: odd entries are names. */
export function tParts(lang, key) {
  return (STRINGS[pickLang(lang)][key] ?? STRINGS.en[key] ?? key).split(/\{(\w+)\}/);
}

/** A UI string; `{name}` placeholders are filled from vars. A key missing in a language falls back to English. */
export function t(lang, key, vars) {
  const s = STRINGS[pickLang(lang)][key] ?? STRINGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s;
}
