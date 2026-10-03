// @ts-check
import { cssColor } from './color.js';
import { fontFile } from '../engine/text/fonts.js';

/** Each font file gets its own CSS family, so local fonts can never replace it. */
export const fontFamilyCss = (key) => `pw-${key}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;

/** @param {any} page @param {number} w @param {number} h */
export function pageToSvg(page, w, h, { background = true } = {}) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" style="font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision">`];
  if (background) out.push(`<rect width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`);
  // a form field is drawn from its `draw` items (the PDF makes a real widget instead)
  for (const it of page.items.flatMap(i => (i.t === 'field' ? i.draw : [i]))) {
    switch (it.t) {
      case 'rect': {
        const r = it.radius ? ` rx="${n(it.radius)}"` : '';
        const stroke = it.stroke ? ` stroke="${cssColor(it.stroke)}" stroke-width="${n(it.strokeWidth || 1)}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}` : '';
        out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"${r} fill="${cssColor(it.fill)}"${stroke}/>`);
        break;
      }
      case 'ellipse': {
        const stroke = it.stroke ? ` stroke="${cssColor(it.stroke)}" stroke-width="${n(it.strokeWidth || 1)}"` : '';
        out.push(`<ellipse cx="${n(it.cx)}" cy="${n(it.cy)}" rx="${n(it.rx)}" ry="${n(it.ry)}" fill="${cssColor(it.fill)}"${stroke}/>`);
        break;
      }
      case 'line':
        out.push(`<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${cssColor(it.stroke)}" stroke-width="${n(it.strokeWidth)}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}/>`);
        break;
      case 'text': {
        const paint = `font-size="${n(it.size)}" fill="${cssColor(it.color)}"`;
        const attrs = `font-family="${fontFamilyCss(it.font)}" ${paint}`;
        for (const l of it.lines) {
          if (!l.runs) { out.push(`<text x="${n(l.x)}" y="${n(l.y)}" ${attrs} xml:space="preserve">${esc(l.text)}</text>`); continue; }
          // Shaped or bidi text: one <text> per run, in visual order, at the engine's position. The browser shapes
          // each run with the same font (Chrome and Firefox use HarfBuzz too) and must not reorder it.
          for (const r of l.runs) {
            if (!r.text.trim()) continue;
            const font = `font-family="${fontFamilyCss(r.font)}" ${paint}`;
            if (!r.shaped && !r.rtl) { out.push(`<text x="${n(l.x + r.x)}" y="${n(l.y)}" ${font}>${esc(r.text)}</text>`); continue; }
            const style = (r.rtl ? 'direction:rtl;unicode-bidi:bidi-override;' : '') + (r.shaped ? 'font-kerning:normal;font-variant-ligatures:normal' : '');
            out.push(`<text x="${n(l.x + r.x + r.w / 2)}" y="${n(l.y)}" text-anchor="middle" ${font} style="${style}">${esc(r.text)}</text>`);
          }
        }
        break;
      }
      case 'path': {
        const stroke = it.stroke ? ` stroke="${cssColor(it.stroke)}" stroke-width="${n(it.strokeWidth || 1)}" stroke-linecap="${it.lineCap || 'round'}" stroke-linejoin="round"` : '';
        out.push(`<path transform="translate(${n(it.x)} ${n(it.y)})" d="${esc(it.d)}" fill="${cssColor(it.fill)}"${stroke}/>`);
        break;
      }
      case 'link': {
        const tip = it.tip ?? (it.action ? linkTitle(it.action) : '');
        const title = tip ? `<title>${esc(tip)}</title>` : '';
        // a slice of a pie is a path; it moved with the item, so translate by how far the hit box moved
        const tag = it.d ? 'path' : 'rect';
        const geo = it.d
          ? `transform="translate(${n(it.x - (it.x0 ?? it.x))} ${n(it.y - (it.y0 ?? it.y))})" d="${esc(it.d)}"`
          : `x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"`;
        if (!it.action) out.push(`<${tag} class="pw-tip" ${geo} fill="transparent">${title}</${tag}>`);
        else out.push(`<${tag} class="pw-link" ${geo} fill="transparent" data-action="${esc(JSON.stringify(it.action))}" style="cursor:pointer">${title}</${tag}>`);
        break;
      }
      case 'image': {
        const par = it.fit === 'fill' ? 'none' : it.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
        out.push(`<image x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" href="${esc(it.src)}" preserveAspectRatio="${par}"/>`);
        break;
      }
    }
  }
  out.push('</svg>');
  return out.join('');
}

function linkTitle(a) {
  if (a.type === 'url') return a.href;
  if (a.type === 'drill') return `Open ${a.report}`;
  if (a.type === 'toggle') return 'Show or hide details';
  if (a.type === 'sort') return 'Sort';
  if (a.type === 'bookmark') return `Go to ${a.target}`;
  if (a.type === 'params') return 'Filter the report';
  return '';
}

/** @font-face rules for report fonts served from /fonts (uploaded ones from /fonts/custom). */
export function fontFaceCss(keys, base = '/fonts') {
  return keys.map((k) => {
    const file = fontFile(k);
    return `@font-face{font-family:"${fontFamilyCss(k)}";src:url("${base}/${file}")${file.endsWith('.ttf') ? ' format("truetype")' : ''};font-display:block}`;
  }).join('\n');
}

/** Every font key a page model draws with (text items, their runs, form fields). */
export function fontKeysOf(model) {
  const keys = new Set();
  for (const pg of model?.pages || []) for (const it of pg.items.flatMap(i => (i.t === 'field' ? [i, ...i.draw] : [i]))) {
    if (it.font) keys.add(it.font);
    if (it.t === 'text') for (const l of it.lines) for (const r of l.runs || []) keys.add(r.font);
  }
  return [...keys];
}
