// UI strings with a count use the singular form for one ("1 rule", not "1 rules"): a `<key>_one` string is picked
// when the language's plural rule says "one" for vars.n.
import { describe, it, expect } from 'vitest';
import { t, LANGUAGES, STRINGS } from '../../src/i18n/index.js';

describe('plural strings', () => {
  it('English: one rule, two rules, zero rules', () => {
    expect(t('en', 'cf_nRules', { n: 1 })).toBe('1 rule');
    expect(t('en', 'cf_nRules', { n: 2 })).toBe('2 rules');
    expect(t('en', 'cf_nRules', { n: 0 })).toBe('0 rules');
    expect(t('en', 'dsRows', { n: 1 })).toBe('1 row');
    expect(t('en', 'dsFound', { n: 1 })).toBe('Found 1 row.');
    expect(t('en', 'dsFound', { n: 12 })).toBe('Found 12 rows.');
    expect(t('en', 'cw_apiData', { n: 1 })).toBe('API data · 1 row');
    expect(t('en', 'cw_apiDataFiltered', { n: 1 })).toBe('API data · 1 row (after the data set filters)');
  });
  it('follows each language’s rule: French singular for 0 and 1, German only for 1', () => {
    expect(t('fr', 'dsRows', { n: 0 })).toBe('0 ligne');
    expect(t('fr', 'dsRows', { n: 2 })).toBe('2 lignes');
    expect(t('de', 'dsRows', { n: 1 })).toBe('1 Zeile');
    expect(t('de', 'dsRows', { n: 0 })).toBe('0 Zeilen');
    expect(t('es', 'cf_nRules', { n: 1 })).toBe('1 regla');
  });
  it('a count passed as a string still picks the form; other vars are left alone', () => {
    expect(t('en', 'cf_nRules', { n: '1' })).toBe('1 rule');
    expect(t('en', 'parameters')).toBe('Parameters');
  });
  it('every language has the singular forms (same placeholders as the plural)', () => {
    for (const lang of LANGUAGES)
      for (const k of ['cf_nRules', 'dsRows', 'dsFound', 'cw_apiData', 'cw_apiDataFiltered']) {
        expect(STRINGS[lang][`${k}_one`], `${lang}.${k}_one`).toMatch(/\{n\}/);
      }
  });
  it('the viewer status line: 1 page · 1 row', () => {
    const line = (lang, pages, rows) =>
      t(lang, 'pagesRows', {
        pages: pages === 1 ? t(lang, 'pageOne') : t(lang, 'pageMany', { n: pages }),
        rows: t(lang, 'dsRows', { n: rows }),
        ms: 4,
      });
    expect(line('en', 1, 1)).toBe('1 page · 1 row · 4 ms');
    expect(line('en', 3, 20)).toBe('3 pages · 20 rows · 4 ms');
  });
});
