// @ts-check

/**
 * A report name as a file name, without its extension: each run of characters other than letters, digits, _, ., @
 * and - becomes one dash, with no dashes or dots at the ends ("Sales - Q1 (draft)" → "Sales-Q1-draft"), at most 120
 * characters. `fallback` when nothing is left (a name in another script, or none).
 * @param {unknown} name @param {string} [fallback]
 * @returns {string}
 */
export function fileStem(name, fallback = 'report') {
  const s = String(name ?? '')
    .replace(/[^\w.@-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 120)
    .replace(/^[-.]+|[-.]+$/g, '');
  return s || fallback;
}
