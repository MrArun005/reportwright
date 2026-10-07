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
import b2 from './b2.js';
import { lookups } from './core.js';

// gov.js: the server governance strings (batch 5); ux.js: the designer and viewer UX batch (R1-C); home.js: the Overview; r4.js: the R4 bug list; b2.js: batch 2 (UI upgrade). All merged into each language
const base = { en, hi, es, fr, de, ja, zh, 'pt-BR': ptBR, ar };
export const STRINGS = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v, ...gov[k], ...ux[k], ...home[k], ...r4[k], ...b2[k] }]));
export const LANGUAGES = Object.keys(STRINGS);
export const { pickLang, dirOf, tParts, t } = lookups(STRINGS, LANGUAGES);
/** Every language is here already (the embed build's i18n/embed.js loads them on demand). */
export const loadLanguage = async (lang) => pickLang(lang);
