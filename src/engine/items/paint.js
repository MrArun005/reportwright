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
    : String(text).split(/\r?\n/).map(t => ({ text: t, width: m.width(t, key, size) }));
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
  if (tl && tl.lines.length) {
    const { key, size, lh, pad } = tl;
    let lines = tl.lines;
    const avail = h - pad[0] - pad[2];
    const maxLines = Math.max(1, Math.floor((avail + 1.01) / lh)); // 1pt tolerance, same as can-grow
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (ellipsis) {
        const last = lines[lines.length - 1];
        const t = m.ellipsize(last.text + ' …', key, size, tl.inner);
        lines[lines.length - 1] = { text: t, width: m.width(t, key, size) };
      }
    }
    const { ascent, descent } = m.metrics(key, size);
    const blockH = lines.length * lh;
    let top = y + pad[0];
    if (st.verticalAlign === 'middle') top = y + pad[0] + (avail - blockH) / 2;
    else if (st.verticalAlign === 'bottom') top = y + h - pad[2] - blockH;
    const align = st.textAlign === 'auto' || !st.textAlign ? (numeric ? 'right' : 'left') : st.textAlign;
    const half = (lh - (ascent + descent)) / 2;
    const out = lines.map((ln, i) => {
      let lx = x + pad[3];
      if (align === 'right') lx = x + w - pad[1] - ln.width;
      else if (align === 'center') lx = x + pad[3] + (tl.inner - ln.width) / 2;
      return { x: lx, y: top + i * lh + half + ascent, text: ln.text, w: ln.width };
    }).filter(l => l.text !== '');
    if (out.length) items.push({ t: 'text', font: key, size, color: st.color || '#000', lines: out, clip: { x, y, w, h } });
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

/** Move page-model items by (dx, dy). Returns new objects. */
export function shiftItems(items, dx, dy) {
  return items.map((it) => {
    switch (it.t) {
      case 'text': return { ...it, lines: it.lines.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })), clip: it.clip && { ...it.clip, x: it.clip.x + dx, y: it.clip.y + dy } };
      case 'line': return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
      case 'ellipse': return { ...it, cx: it.cx + dx, cy: it.cy + dy };
      default: return { ...it, x: it.x + dx, y: it.y + dy };
    }
  });
}
