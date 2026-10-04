// @ts-check
import { resolveFontKey } from '../text/fonts.js';
import { borders, padding, DASH } from '../style.js';

/**
 * Shared painting helpers. They return page-model items in local
 * coordinates; the paginator moves them to their final place.
 */

/** Text layout for a box: lines, font key, needed height. */
export function layoutTextLines(text, st, width, m, { wrap = true } = {}) {
  const key = resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle);
  const size = Number(st.fontSize) || 9;
  const pad = padding(st);
  const inner = Math.max(1, width - pad[1] - pad[3]);
  const lines = wrap && st.wrap !== false
    ? m.wrap(text, key, size, inner)
    : String(text).split(/\r?\n/).map((t) => {
      const dir = m.direction(t, key); // set for text that needs shaping or bidi
      return dir ? { text: t, width: m.width(t, key, size, dir), dir } : { text: t, width: m.width(t, key, size) };
    });
  const lh = size * (Number(st.lineHeight) || 1.25);
  return { key, size, lines, lh, pad, inner, needed: lines.length * lh + pad[0] + pad[2] };
}

/**
 * Paint a box: background, text lines, borders.
 * @returns {any[]} page-model items
 */
export function paintBox({ x, y, w, h, st, tl, numeric = false, m, ellipsis = true }) {
  const items = [];
  if (st.backgroundColor) items.push({ t: 'rect', x, y, w, h, fill: st.backgroundColor });
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
      const text = { t: 'text', font: key, size, color: st.color || '#000', lines: out, clip: { x, y, w, h } };
      items.push(text);
      const deco = st.textDecoration && st.textDecoration !== 'none' ? String(st.textDecoration).toLowerCase() : '';
      const under = deco.includes('underline'), strike = deco.includes('line-through');
      if (under || strike) {
        text.deco = deco; // the Word export reads this
        // decorations are plain lines, so every exporter draws them without special code; their position and
        // thickness come from the font's own underline and strikeout metrics
        const d = m.decoration(key, size), stroke = st.textDecorationColor || st.color || '#000';
        for (const l of out) {
          if (under) items.push({ t: 'line', x1: l.x, y1: l.y + d.underlineY, x2: l.x + l.w, y2: l.y + d.underlineY, stroke, strokeWidth: d.underlineWidth, dash: null });
          if (strike) items.push({ t: 'line', x1: l.x, y1: l.y + d.strikeY, x2: l.x + l.w, y2: l.y + d.strikeY, stroke, strokeWidth: d.strikeWidth, dash: null });
        }
      }
    }
  }
  const b = borders(st);
  if (b.top) items.push(line(x, y, x + w, y, b.top));
  if (b.bottom) items.push(line(x, y + h, x + w, y + h, b.bottom));
  if (b.left) items.push(line(x, y, x, y + h, b.left));
  if (b.right) items.push(line(x + w, y, x + w, y + h, b.right));
  return items;
}

function line(x1, y1, x2, y2, b) {
  return { t: 'line', x1, y1, x2, y2, stroke: b.color, strokeWidth: b.width, dash: DASH[b.style] || null };
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
