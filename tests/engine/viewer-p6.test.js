// Phase 6 viewer: UI languages, search, toolbar arrangement, galley view, frozen table headers.
import { describe, it, expect } from 'vitest';
import { STRINGS, LANGUAGES, t, dirOf, pickLang } from '../../src/i18n/index.js';

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('UI languages', () => {
  it.each(LANGUAGES)('%s has every key, with the same placeholders, and is not an English copy', (lang) => {
    const en = STRINGS.en, tab = STRINGS[lang];
    expect(Object.keys(tab).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(vars(tab[k]), `${lang}.${k}`).toEqual(vars(en[k]));
    if (lang !== 'en') {
      const same = Object.keys(en).filter(k => tab[k] === en[k] && /[a-z]{4}/i.test(en[k]));
      expect(same.length / Object.keys(en).length, `${lang} copies English: ${same.join(', ')}`).toBeLessThan(0.1);
    }
  });
  it('picks a language from ?lang=, falls back to English, and knows the direction', () => {
    expect(pickLang('HI')).toBe('hi');
    expect(pickLang('hi-IN')).toBe('hi');
    expect(pickLang('xx')).toBe('en');
    expect(pickLang(undefined)).toBe('en');
    expect(t('xx', 'parameters')).toBe('Parameters');
    expect(t('hi', 'pagesRows', { pages: 2, rows: 3, ms: 4 })).toBe('2 पृष्ठ · 3 पंक्तियाँ · 4 ms');
    expect(dirOf('hi')).toBe('ltr');
    expect(t('hi', 'noSuchKey')).toBe('noSuchKey');
  });
});
