// @ts-check
/** All engine geometry is in points (1/72 inch). */

export const PAGE_SIZES = {
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export const UNITS = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 };

/** A pageless report grows to fit its content, up to the largest PDF page (200 inches). */
export const PAGELESS_MAX = 14400;

/** @param {number} v @param {keyof UNITS} unit */
export function toPt(v, unit) { return v * UNITS[unit]; }
/** @param {number} pt @param {keyof UNITS} unit */
export function fromPt(pt, unit) { return pt / UNITS[unit]; }

/**
 * @param {{size?: string, width?: number, height?: number, orientation?: string, margins?: number[]|number}} page
 */
/** A size name as the engine reads it: trimmed, case-insensitive ("a4 " -> "A4"); undefined when it names no size. */
export function normalizePageSize(size) {
  if (typeof size !== 'string') return undefined;
  const t = size.trim().toLowerCase();
  if (t === 'pageless') return 'Pageless';
  return Object.keys(PAGE_SIZES).find(k => k.toLowerCase() === t);
}

export function resolvePage(page = {}) {
  const size = normalizePageSize(page.size);
  if (size === 'Pageless') {
    const w = Number(page.width) || 960;
    const m = normBox(page.margins ?? 24);
    return { width: w, height: PAGELESS_MAX, margins: { top: m[0], right: m[1], bottom: m[2], left: m[3] }, bodyWidth: w - m[1] - m[3], pageless: true, minHeight: Number(page.minHeight) || 0 };
  }
  let [w, h] = size ? PAGE_SIZES[size] : [page.width || PAGE_SIZES.A4[0], page.height || PAGE_SIZES.A4[1]];
  if (page.orientation === 'landscape' && h > w) [w, h] = [h, w];
  const m = normBox(page.margins ?? 36);
  return { width: w, height: h, margins: { top: m[0], right: m[1], bottom: m[2], left: m[3] }, bodyWidth: w - m[1] - m[3] };
}

/** CSS-like box shorthand → [top, right, bottom, left] */
export function normBox(v) {
  if (v == null) return [0, 0, 0, 0];
  if (typeof v === 'number') return [v, v, v, v];
  if (typeof v === 'string') v = v.trim().split(/[\s,]+/).map(Number);
  if (!Array.isArray(v)) return [0, 0, 0, 0];
  const a = v.map(x => Number(x) || 0);
  if (a.length === 1) return [a[0], a[0], a[0], a[0]];
  if (a.length === 2) return [a[0], a[1], a[0], a[1]];
  if (a.length === 3) return [a[0], a[1], a[2], a[1]];
  return [a[0], a[1], a[2], a[3]];
}
