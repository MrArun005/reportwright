// @ts-check
import { cssColor } from './color.js';

/** Each font file gets its own CSS family, so local fonts can never replace it. */
export const fontFamilyCss = (key) => `pw-${key}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;

/** @param {any} page @param {number} w @param {number} h */
export function pageToSvg(page, w, h) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" style="font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision">`,
    `<rect width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`];
  for (const it of page.items) {
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
        const attrs = `font-family="${fontFamilyCss(it.font)}" font-size="${n(it.size)}" fill="${cssColor(it.color)}"`;
        for (const l of it.lines) out.push(`<text x="${n(l.x)}" y="${n(l.y)}" ${attrs} xml:space="preserve">${esc(l.text)}</text>`);
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

/** @font-face rules for report fonts served from /fonts. */
export function fontFaceCss(keys, base = '/fonts') {
  return keys.map(k => `@font-face{font-family:"${fontFamilyCss(k)}";src:url("${base}/${k}.ttf") format("truetype");font-display:block}`).join('\n');
}
