// @ts-check
import { resolveFontKey } from '../text/fonts.js';
import { borders, padding, DASH } from '../style.js';

/**
 * Shared painting helpers. They return page-model items in local
 * coordinates; the paginator moves them to their final place.
 */

const MAX_CACHED_TEXT = 256;

/**
 * V8 stores a number field that has once held a fraction as a boxed double (16 bytes more) in every object of that
 * shape, whole numbers too. A field that has also held null keeps whole numbers inline instead. Page coordinates are
 * mostly whole (cell edges, left-aligned text, sizes), so the page model's shapes start out that way: a 50,000-row
 * table's model is 117 MB instead of 133 MB. Kept alive on a used function (V8 forgets a shape no object uses, and a
 * bundler drops an unused constant). Other engines store numbers their own way and are not affected.
 * ponytail: relies on V8 sharing object-literal shapes by property names; if that changes this is a no-op, nothing breaks.
 */
paintBoxAt.shapes = [
  { x: null, y: null, w: null, h: null }, // a text's clip
  { x: null, y: null, text: null, w: null }, // a text line
  { t: null, font: null, size: null, color: null, lines: null, clip: null }, // a text
  { t: null, x: null, y: null, w: null, h: null, fill: null }, // a rect
  { t: null, x1: null, y1: null, x2: null, y2: null, stroke: null, strokeWidth: null, dash: null }, // a line
];

/** Text layout for a box: lines, font key, needed height. */
export function layoutTextLines(text, st, width, m, opt) {
  const wrap = opt?.wrap ?? true;
  const atom = !!opt?.atom; // a number or date value: shrinks to stay on one line, never wraps (as a formatted number)
  // A frozen style is a static one shared by every cell that uses it (style.js): the same text at the same width lays
  // out once per render. Tables repeat most cell texts (a region, a status, a date), so most cells hit this.
  // only short texts (a cell's value), at most 200,000 per render: memory stays bounded whatever the data holds
  if (typeof text !== 'string' || text.length > MAX_CACHED_TEXT || !m.boxes || !Object.isFrozen(st)) return layoutText(text, st, width, m, wrap, atom);
  let byW = m.boxes.get(st);
  if (!byW) { byW = new Map(); m.boxes.set(st, byW); }
  const wk = wrap ? (atom ? `a${width}` : width) : -1 - width;
  let byText = byW.get(wk);
  if (!byText) { byText = new Map(); byW.set(wk, byText); }
  const tl = byText.get(text);
  if (tl) return tl;
  // ponytail: cleared when full; an LRU only if a profile shows thrashing
  if (++m.boxCount > 200000) { m.boxes = new WeakMap(); m.boxCount = 0; }
  // kept from the second time a text is seen: a column of unique values (ids, names) does not fill the cache
  if (tl === undefined) { byText.set(text, 0); return layoutText(text, st, width, m, wrap, atom); }
  const out = layoutText(text, st, width, m, wrap, atom);
  Object.freeze(out.lines);
  byText.set(text, Object.freeze(out));
  return out;
}
/** A style's font key, size, padding and line height; a frozen style's once per render (on the measurer: fonts can change). */
function lookOf(st, m) {
  let l = m.looks && Object.isFrozen(st) ? m.looks.get(st) : undefined;
  if (!l) {
    const size = Number(st.fontSize) || 9;
    l = { key: resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle), size, pad: padding(st), lh: size * (Number(st.lineHeight) || 1.25) };
    if (m.looks && Object.isFrozen(st)) m.looks.set(st, l);
  }
  return l;
}
/** A number as formatted (sign, currency, digits with separators, percent, exponent): it never breaks across lines. */
const NUMBER = /^[\s(+\-\u2212]*[\p{Sc}]?\s?[\p{Sc}A-Z]{0,3}\.?\s?[\d][\d.,'\u00a0\u202f\s]*(?:[eE][+-]?\d+)?\s?%?\)?\s?[\p{Sc}A-Z]{0,3}$/u;
const MIN_FONT = 5; // pt: a word is not shrunk below this; it breaks instead
const MIN_NUMBER_FONT = 3; // pt: a number shrinks until it fits, down to this (cut digits would read as another number)
/**
 * The font size a wrapped text needs so that it breaks only between words: a number on one line, a word as wide as
 * the box. A number (or a single short token) shrinks until it fits (a matrix grand total in a narrow column), never
 * below MIN_NUMBER_FONT; a short label's word down to MIN_FONT; a longer text's word at most 25%. Past that a word
 * breaks inside (the last resort).
 */
function fitSize(text, key, size, inner, m, atom = false) {
  const s = String(text);
  if (s.length > 200) return size;
  const num = atom || NUMBER.test(s.trim());
  // the widest word decides; an amount inside a text ("Total ₹1,61,70,192") shrinks like a number, never breaks
  let longest = 0, word = '';
  if (num) longest = m.width(s.trim(), key, size);
  else for (const w of s.split(/\s+/)) { const ww = w ? m.width(w, key, size) : 0; if (ww > longest) { longest = ww; word = w; } }
  if (longest <= inner) return size;
  // a short label (a column header, a code such as "m02") shrinks further before a word breaks: "Amou|nt" reads as
  // two words. One short token goes as small as a number; a few words to MIN_FONT; a paragraph at most 25%.
  const floor = num || NUMBER.test(word) || (word.length <= 12 && word === s.trim()) ? Math.min(size, MIN_NUMBER_FONT)
    : s.length <= 40 ? Math.min(size, MIN_FONT) : Math.max(MIN_FONT, size * 0.75);
  // in half points: cells shrunk alike share one size (fewer font changes, a smaller PDF)
  return Math.max(floor, Math.min(size, Math.floor((size * (inner / longest) - 0.01) * 2) / 2));
}
function layoutText(text, st, width, m, wrap, atom = false) {
  const look = lookOf(st, m);
  const { key, pad } = look;
  const inner = Math.max(1, width - pad[1] - pad[3]);
  const wraps = wrap && st.wrap !== false;
  // a number never breaks, a word only when it is wider than the box even a little smaller (R4: "4,966,681.4|5")
  const size = wraps && !m.direction(String(text), key) ? fitSize(text, key, look.size, inner, m, atom && !/\n/.test(String(text))) : look.size;
  const lh = size === look.size ? look.lh : look.lh * (size / look.size);
  const lines = wraps
    ? (size !== look.size && ((atom && !/\n/.test(String(text))) || NUMBER.test(String(text).trim())) ? [{ text: String(text).trim(), width: m.width(String(text).trim(), key, size), end: true }] : m.wrap(text, key, size, inner))
    : String(text).split(/\r?\n/).map((t) => {
      const dir = m.direction(t, key); // set for text that needs shaping or bidi
      return dir ? { text: t, width: m.width(t, key, size, dir), dir } : { text: t, width: m.width(t, key, size) };
    });
  return { key, size, lines, lh, pad, inner, needed: lines.length * lh + pad[0] + pad[2] };
}

/**
 * Paint a box: background, text lines, borders.
 * @returns {any[]} page-model items (appended to `out` when given)
 */
export function paintBox({ x, y, w, h, st, tl, numeric = false, m, ellipsis = true, out = null, cell = null }) {
  return paintBoxAt(x, y, w, h, st, tl, numeric, m, ellipsis, out || [], cell);
}
/**
 * paintBox with positional arguments (no argument object: table cells call it hundreds of thousands of times).
 * cell: the text's table cell tag (export data), set when the text item is made: one added later would not fit the
 * object and costs a separate property store per item.
 */
export function paintBoxAt(x, y, w, h, st, tl, numeric, m, ellipsis, items, cell = null) {
  // rounded corners (text boxes, containers, cells): the background and an all-round border become rounded rects
  const radius = Math.max(0, Math.min(Number(st.radius) || 0, w / 2, h / 2));
  if (st.backgroundColor) items.push(radius ? { t: 'rect', x, y, w, h, fill: st.backgroundColor, radius } : { t: 'rect', x, y, w, h, fill: st.backgroundColor });
  // bytes stay bytes (String() would copy them per box): the image pass in render() converts and caps every src
  if (st.backgroundImage) items.push({ t: 'image', x, y, w, h, src: st.backgroundImage, fit: st.backgroundFit || 'cover' });
  if (tl && tl.lines.length) {
    const { key, size, lh, pad } = tl;
    let lines = tl.lines;
    const avail = h - pad[0] - pad[2];
    const maxLines = Math.max(1, Math.floor((avail + 1.01) / lh)); // 1pt tolerance, same as can-grow
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (ellipsis) {
        const last = lines[lines.length - 1];
        const t = m.ellipsize(last.text + ' …', key, size, tl.inner, last.dir);
        lines[lines.length - 1] = { ...last, text: t, width: m.width(t, key, size, last.dir) };
      }
    }
    const { ascent, descent } = m.metrics(key, size);
    const blockH = lines.length * lh;
    let top = y + pad[0];
    if (st.verticalAlign === 'middle') top = y + pad[0] + (avail - blockH) / 2;
    else if (st.verticalAlign === 'bottom') top = y + h - pad[2] - blockH;
    const auto = st.textAlign === 'auto' || !st.textAlign;
    const half = (lh - (ascent + descent)) / 2;
    const cut = lines.length < tl.lines.length; // the last visible line ends in an ellipsis
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.text === '') continue;
      // auto: numbers right, text by its paragraph direction (Arabic and Hebrew right)
      const align = auto ? (numeric || ln.dir === 'rtl' ? 'right' : 'left') : st.textAlign;
      const ly = top + i * lh + half + ascent;
      // justify: each word becomes its own run, spread across the line. A paragraph's last line, a line
      // cut short with an ellipsis, and shaped or right-to-left lines stay as they are.
      if (align === 'justify' && !ln.end && !ln.dir && !(cut && i === lines.length - 1)) {
        const words = ln.text.split(' ').filter(Boolean);
        if (words.length > 1) {
          const ws = words.map(wd => m.width(wd, key, size));
          const gap = (tl.inner - ws.reduce((s, v) => s + v, 0)) / (words.length - 1);
          let wx = x + pad[3];
          for (let k = 0; k < words.length; k++) { out.push({ x: wx, y: ly, text: words[k], w: ws[k] }); wx += ws[k] + gap; }
          continue;
        }
      }
      let lx = x + pad[3];
      if (align === 'right') lx = x + w - pad[1] - ln.width;
      else if (align === 'center') lx = x + pad[3] + (tl.inner - ln.width) / 2;
      const o = { x: lx, y: ly, text: ln.text, w: ln.width };
      if (ln.dir) o.dir = ln.dir;
      out.push(o);
    }
    if (out.length) {
      const deco = st.textDecoration && st.textDecoration !== 'none' ? String(st.textDecoration).toLowerCase() : '';
      const under = deco.includes('underline'), strike = deco.includes('line-through');
      // an exact-size array: one grown by push keeps 16 slots, and the page model holds one per text
      const color = st.color || '#000', ls = out.length === 1 ? [out[0]] : out.slice(), clip = { x, y, w, h };
      // deco: the Word export reads it. Every property in the literal, in the order they always had.
      const text = under || strike
        ? (cell ? { t: 'text', font: key, size, color, lines: ls, clip, deco, cell } : { t: 'text', font: key, size, color, lines: ls, clip, deco })
        : (cell ? { t: 'text', font: key, size, color, lines: ls, clip, cell } : { t: 'text', font: key, size, color, lines: ls, clip });
      items.push(text);
      if (under || strike) {
        // decorations are plain lines, so every exporter draws them without special code; their position and
        // thickness come from the font's own underline and strikeout metrics
        const d = m.decoration(key, size), stroke = st.textDecorationColor || st.color || '#000';
        for (const l of text.lines) {
          if (under) items.push({ t: 'line', x1: l.x, y1: l.y + d.underlineY, x2: l.x + l.w, y2: l.y + d.underlineY, stroke, strokeWidth: d.underlineWidth, dash: null });
          if (strike) items.push({ t: 'line', x1: l.x, y1: l.y + d.strikeY, x2: l.x + l.w, y2: l.y + d.strikeY, stroke, strokeWidth: d.strikeWidth, dash: null });
        }
      }
    }
  }
  const b = bordersOf(st);
  if (radius && same(b.top, b.right) && same(b.top, b.bottom) && same(b.top, b.left)) {
    items.push({ t: 'rect', x, y, w, h, fill: null, stroke: b.top.color, strokeWidth: b.top.width, dash: DASH[b.top.style] || null, radius });
    return items;
  }
  if (b.top) items.push(line(x, y, x + w, y, b.top));
  if (b.bottom) items.push(line(x, y + h, x + w, y + h, b.bottom));
  if (b.left) items.push(line(x, y, x, y + h, b.left));
  if (b.right) items.push(line(x + w, y, x + w, y + h, b.right));
  return items;
}

const same = (p, q) => p && q && p.width === q.width && p.style === q.style && p.color === q.color;

/** A frozen (static, shared) style's borders, parsed once. */
const BORDERS = new WeakMap();
function bordersOf(st) {
  if (!Object.isFrozen(st)) return borders(st);
  let b = BORDERS.get(st);
  if (!b) { b = borders(st); BORDERS.set(st, b); }
  return b;
}

function line(x1, y1, x2, y2, b) {
  return { t: 'line', x1, y1, x2, y2, stroke: b.color, strokeWidth: b.width, dash: DASH[b.style] || null };
}

/**
 * Item arrays that layout made fresh for one unit and nothing else references (a table row's paint): page assembly
 * moves their items into place instead of copying them, which halves the page model's peak memory. An array is
 * moved at most once; any other array is copied (shiftItems), as before.
 */
export const OWNED = new WeakSet();

/** Put items on the page at (dx, dy), appending them to `out`. */
export function placeItems(items, dx, dy, out) {
  if (!OWNED.delete(items)) { for (const it of shiftItems(items, dx, dy)) out.push(it); return; }
  for (const it of items) { moveItem(it, dx, dy); out.push(it); }
}
function moveItem(it, dx, dy) {
  switch (it.t) {
    case 'text':
      for (const l of it.lines) { l.x += dx; l.y += dy; }
      if (it.clip) { it.clip.x += dx; it.clip.y += dy; } // an owned array's items have their own clip (paintBox, shiftLocal)
      break;
    case 'line': it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; break;
    case 'ellipse': it.cx += dx; it.cy += dy; break;
    case 'field': it.x += dx; it.y += dy; it.draw = shiftItems(it.draw, dx, dy); break;
    default: it.x += dx; it.y += dy;
  }
  if (it.rotate) it.rotate = { ...it.rotate, cx: it.rotate.cx + dx, cy: it.rotate.cy + dy };
}

/** Move page-model items by (dx, dy). Returns new objects. A rotated item's centre moves with it. */
export function shiftItems(items, dx, dy) {
  return items.map((it) => {
    let o;
    switch (it.t) {
      case 'text': o = { ...it, lines: it.lines.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })), clip: it.clip && { ...it.clip, x: it.clip.x + dx, y: it.clip.y + dy } }; break;
      case 'line': o = { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy }; break;
      case 'ellipse': o = { ...it, cx: it.cx + dx, cy: it.cy + dy }; break;
      case 'field': o = { ...it, x: it.x + dx, y: it.y + dy, draw: shiftItems(it.draw, dx, dy) }; break;
      default: o = { ...it, x: it.x + dx, y: it.y + dy };
    }
    if (it.rotate) o.rotate = { ...it.rotate, cx: it.rotate.cx + dx, cy: it.rotate.cy + dy };
    return o;
  });
}
