// i18n for the embeddable viewer and designer (build-embed.mjs resolves i18n/index.js here): English is in the first
// load; another language loads when mountViewer / mountDesigner asks for it (loadLanguage), about 70 KB each.
import en from './en.js';
import gov from './gov.js';
import ux from './ux.js';
import home from './home.js';
import r4 from './r4.js';
import b2 from './b2.js';
import hx from './hx.js';
import { lookups } from './core.js';

const LOADERS = {
  hi: () => import('./hi.js'), es: () => import('./es.js'), fr: () => import('./fr.js'), de: () => import('./de.js'),
  ja: () => import('./ja.js'), zh: () => import('./zh.js'), 'pt-BR': () => import('./pt-BR.js'), ar: () => import('./ar.js'),
};
const merge = (k, v) => ({ ...v, ...gov[k], ...ux[k], ...home[k], ...r4[k], ...b2[k], ...hx[k] });
/** @type {Record<string, Record<string, string>>} */
export const STRINGS = { en: merge('en', en) };
export const LANGUAGES = ['en', ...Object.keys(LOADERS)];
export const { pickLang, dirOf, tParts, t } = lookups(STRINGS, LANGUAGES);
/** Load a language's strings (English until then). Resolves to the language picked. @param {string} [lang] */
export async function loadLanguage(lang) {
  const l = pickLang(lang);
  if (!STRINGS[l] && LOADERS[l]) STRINGS[l] = merge(l, (await LOADERS[l]()).default);
  return l;
}
