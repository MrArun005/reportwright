// @ts-check
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080', orange: '#ffa500', yellow: '#ffff00' };

/** @returns {{r:number,g:number,b:number,a:number}|null} channels 0..1 */
export function parseColor(c) {
  if (!c || c === 'none' || c === 'transparent') return null;
  let s = String(c).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).map(Number);
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  return null;
}

/** Safe color for SVG/HTML attributes. */
export function cssColor(c) {
  const p = parseColor(c);
  if (!p) return 'none';
  return `rgba(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)},${p.a})`;
}
