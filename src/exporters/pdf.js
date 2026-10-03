// @ts-check
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkitModule from '@pdf-lib/fontkit';
import { parseColor } from './color.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

const col = (c) => { const p = parseColor(c); return p ? { color: rgb(p.r, p.g, p.b), opacity: p.a } : null; };

/**
 * Page model → PDF bytes. Draws exactly the lines the engine made.
 * @param {any} model  render() output
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, author?: string, fetchImage?: (src: string) => Promise<Uint8Array|null> }} [opt]
 */
export async function exportPdf(model, fontStore, opt = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(opt.title || 'Report');
  doc.setProducer('Pagewright');
  doc.setCreator('Pagewright');
  if (opt.author) doc.setAuthor(opt.author);

  const fonts = new Map();
  const font = async (key) => {
    if (!fonts.has(key)) {
      const bytes = fontStore.bytes.get(key);
      if (!bytes) throw new Error(`Font "${key}" is not loaded`);
      fonts.set(key, await doc.embedFont(bytes, { subset: opt.subset ?? false }));
    }
    return fonts.get(key);
  };
  const images = new Map();
  const image = async (src) => {
    if (images.has(src)) return images.get(src);
    let img = null;
    try {
      let bytes = null;
      const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src);
      if (m) bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      else if (opt.fetchImage) bytes = await opt.fetchImage(src);
      if (bytes) img = bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch { img = null; }
    images.set(src, img);
    return img;
  };

  const H = model.height;
  for (const pg of model.pages) {
    const p = doc.addPage([model.width, model.height]);
    for (const it of pg.items) {
      switch (it.t) {
        case 'rect': {
          const fill = col(it.fill), stroke = col(it.stroke);
          if (!fill && !stroke) break;
          if (it.radius) {
            p.drawSvgPath(roundRect(it.x, it.y, it.w, it.h, it.radius), {
              x: 0, y: H,
              color: fill?.color, opacity: fill?.opacity,
              borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderOpacity: stroke?.opacity,
              borderDashArray: it.dash || undefined,
            });
          } else {
            p.drawRectangle({
              x: it.x, y: H - it.y - it.h, width: it.w, height: it.h,
              color: fill?.color, opacity: fill?.opacity,
              borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderOpacity: stroke?.opacity,
              borderDashArray: it.dash || undefined,
            });
          }
          break;
        }
        case 'ellipse': {
          const fill = col(it.fill), stroke = col(it.stroke);
          p.drawEllipse({ x: it.cx, y: H - it.cy, xScale: it.rx, yScale: it.ry, color: fill?.color, opacity: fill?.opacity, borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderDashArray: it.dash || undefined });
          break;
        }
        case 'line': {
          const c = col(it.stroke);
          if (!c) break;
          p.drawLine({ start: { x: it.x1, y: H - it.y1 }, end: { x: it.x2, y: H - it.y2 }, thickness: it.strokeWidth || 1, color: c.color, opacity: c.opacity, dashArray: it.dash || undefined });
          break;
        }
        case 'text': {
          const f = await font(it.font);
          const c = col(it.color) || { color: rgb(0, 0, 0), opacity: 1 };
          if (it.clip) {
            p.pushOperators(pushGraphicsState(), rectangle(it.clip.x, H - it.clip.y - it.clip.h, it.clip.w, it.clip.h), clip(), endPath());
          }
          for (const l of it.lines) p.drawText(l.text, { x: l.x, y: H - l.y, size: it.size, font: f, color: c.color, opacity: c.opacity });
          if (it.clip) p.pushOperators(popGraphicsState());
          break;
        }
        case 'image': {
          const img = await image(it.src);
          if (!img) break;
          let w = it.w, h = it.h, x = it.x, y = it.y;
          if (it.fit !== 'fill') {
            const s = it.fit === 'cover' ? Math.max(it.w / img.width, it.h / img.height) : Math.min(it.w / img.width, it.h / img.height);
            w = img.width * s; h = img.height * s; x = it.x + (it.w - w) / 2; y = it.y + (it.h - h) / 2;
          }
          p.drawImage(img, { x, y: H - y - h, width: w, height: h });
          break;
        }
      }
    }
  }
  return doc.save();
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
