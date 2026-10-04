// @ts-check
/** Table of contents numbering: 1.2.3, I.II, A.B — one format per level. */
const ROMAN = /** @type {[number, string][]} */ ([[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]);

/** @param {number} n @param {string} kind 'decimal' | 'roman' | 'alpha' */
export function formatNumber(n, kind) {
  if (kind === 'roman' && n > 0 && n < 4000) { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }
  if (kind === 'alpha' && n > 0) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  return String(n);
}

/**
 * The number of each entry. A deeper level restarts when a higher one moves on; a skipped level counts as 1.
 * @param {{ level?: number }[]} entries
 * @param {string | string[]} numbering one format for every level, or one per level (the last repeats)
 */
export function tocNumbers(entries, numbering) {
  const kinds = Array.isArray(numbering) ? numbering : [numbering];
  /** @type {number[]} */
  const counters = [];
  return entries.map(e => {
    const L = Math.max(0, Math.min(9, Number(e.level) || 0));
    for (let k = 0; k < L; k++) counters[k] ||= 1;
    counters[L] = (counters[L] || 0) + 1;
    counters.length = L + 1;
    return counters.map((c, k) => formatNumber(c, kinds[Math.min(k, kinds.length - 1)] || 'decimal')).join('.');
  });
}
