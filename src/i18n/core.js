// The lookups over a STRINGS table (language → key → text), shared by index.js (every language, the app) and
// embed.js (English, other languages loaded on demand: the embeddable viewer and @reportwright/viewer).
/** @param {Record<string, Record<string, string>>} STRINGS @param {string[]} LANGUAGES */
export function lookups(STRINGS, LANGUAGES) {
  const RTL = new Set(['ar']);
  const table = (lang) => STRINGS[pickLang(lang)] || STRINGS.en;
  /** A supported language for a `?lang=` value: exact (any case), then the base language, else English. */
  function pickLang(v) {
    const s = String(v || '').trim().toLowerCase();
    return LANGUAGES.find(l => l.toLowerCase() === s) || LANGUAGES.find(l => l === s.split('-')[0]) || 'en';
  }
  const dirOf = (lang) => (RTL.has(pickLang(lang)) ? 'rtl' : 'ltr');

  /** A string with placeholders as parts, so a page can put elements (a <code>) where the {names} are: odd entries are names. */
  function tParts(lang, key) {
    return (table(lang)[key] ?? STRINGS.en[key] ?? key).split(/\{(\w+)\}/);
  }

  const rules = new Map();
  /** The plural category ("one", "other", …) of a count in a language (Intl.PluralRules; "other" when it cannot tell). */
  function pluralOf(lang, n) {
    const l = pickLang(lang), x = Number(n);
    if (!Number.isFinite(x)) return 'other';
    try {
      if (!rules.has(l)) rules.set(l, new Intl.PluralRules(l));
      return rules.get(l).select(x);
    } catch { return x === 1 ? 'one' : 'other'; }
  }

  /** A UI string; `{name}` placeholders are filled from vars. A key missing in a language falls back to English. */
  function t(lang, key, vars) {
    // a count: `<key>_one` holds the singular ("{n} row"), used when the language's plural rule says "one" for n
    if (vars?.n != null && (table(lang)[`${key}_one`] ?? STRINGS.en[`${key}_one`]) != null && pluralOf(lang, vars.n) === 'one') key = `${key}_one`;
    const s = table(lang)[key] ?? STRINGS.en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s;
  }
  return { pickLang, dirOf, tParts, t };
}
