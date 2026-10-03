// @ts-check
import { PDFDocument, PDFName, PDFString, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkitModule from '@pdf-lib/fontkit';
import { parseColor } from './color.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

const col = (c) => { const p = parseColor(c); return p ? { color: rgb(p.r, p.g, p.b), opacity: p.a } : null; };

/**
 * Page model → PDF bytes. Draws exactly the lines the engine made.
 * @param {any} model  render() output
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, author?: string, fetchImage?: (src: string) => Promise<Uint8Array|null>,
 *   subset?: (font: Uint8Array, codePoints: Iterable<number>) => Promise<Uint8Array> }} [opt]
 *   subset: a HarfBuzz subsetter (see subset.js). Without it, fonts embed in full.
 */
export async function exportPdf(model, fontStore, opt = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(opt.title || 'Report');
  doc.setProducer('Pagewright');
  doc.setCreator('Pagewright');
  if (opt.author) doc.setAuthor(opt.author);

  // Which characters each font must draw.
  const used = new Map();
  for (const pg of model.pages) for (const it of pg.items) if (it.t === 'text') {
    let s = used.get(it.font);
    if (!s) { s = new Set([32]); used.set(it.font, s); }
    for (const l of it.lines) for (const ch of l.text) s.add(/** @type {number} */ (ch.codePointAt(0)));
  }
  // A filled-in form field can hold any character: fonts that fields use embed in full.
  const fieldFonts = new Set();
  for (const pg of model.pages) for (const it of pg.items) if (it.t === 'field') fieldFonts.add(it.font);
  const fonts = new Map();
  const font = async (key) => {
    if (!fonts.has(key)) {
      let bytes = fontStore.bytes.get(key);
      if (!bytes) throw new Error(`Font "${key}" is not loaded`);
      if (opt.subset && !fieldFonts.has(key)) {
        const cps = used.get(key) || new Set([32]);
        try {
          const sub = await opt.subset(bytes, cps);
          // fontkit cannot read some subsets (an empty last glyph). Check every glyph we need.
          const f = fontkit.create(sub);
          for (const cp of cps) { const g = f.glyphForCodePoint(cp); void g.advanceWidth; void g.bbox; }
          bytes = sub;
        } catch { /* embed the full font */ }
      }
      fonts.set(key, await doc.embedFont(bytes, { subset: false }));
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
  const links = [];
  const taken = new Set();
  const uniqueName = (n) => { let name = n, i = 1; while (taken.has(name)) name = `${n}_${++i}`; taken.add(name); return name; };
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
        case 'path': {
          const fill = col(it.fill), stroke = col(it.stroke);
          p.drawSvgPath(it.d, { x: it.x, y: H - it.y, color: fill?.color, opacity: fill?.opacity, borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderOpacity: stroke?.opacity, borderLineCap: it.lineCap === 'butt' ? 0 : 1 });
          break;
        }
        case 'field': {
          const form = doc.getForm();
          const f = await font(it.font);
          const name = uniqueName(it.name);
          const box = { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, borderColor: rgb(0.61, 0.64, 0.69), borderWidth: 0.75, backgroundColor: rgb(1, 1, 1) };
          let field;
          if (it.kind === 'checkbox') {
            field = form.createCheckBox(name);
            field.addToPage(p, box);
            if (it.value) field.check();
          } else {
            if (it.kind === 'choice') {
              field = form.createDropdown(name);
              field.addOptions(it.options);
              field.addToPage(p, { ...box, font: f });
              if (it.options.includes(String(it.value))) field.select(String(it.value));
            } else {
              field = form.createTextField(name);
              if (it.kind === 'multiline') field.enableMultiline();
              field.addToPage(p, { ...box, font: f });
              field.setText(String(it.value ?? ''));
            }
            field.setFontSize(it.size);
            field.updateAppearances(f); // in the report font; the default would be Helvetica
          }
          if (it.required) field.enableRequired();
          if (it.readOnly) field.enableReadOnly();
          break;
        }
        case 'link': {
          if (it.action?.type === 'url') links.push({ page: p, rect: [it.x, H - it.y - it.h, it.x + it.w, H - it.y], href: it.action.href });
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
  // URL links as PDF annotations
  for (const l of links) {
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: l.rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) } });
    const ref = doc.context.register(annot);
    const annots = l.page.node.lookup(PDFName.of('Annots'));
    if (annots) annots.push(ref); else l.page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  if (model.bookmarks?.length) addOutline(doc, model.bookmarks, H);
  // appearances are already drawn in the report font; regenerating would switch them to Helvetica
  return doc.save({ updateFieldAppearances: false });
}

/** PDF outline (the bookmarks panel) from the page model bookmarks. Flat list, levels as indentation. */
function addOutline(doc, bookmarks, H) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlineRef = ctx.nextRef();
  const refs = bookmarks.map(() => ctx.nextRef());
  bookmarks.forEach((b, i) => {
    const page = pages[b.page - 1];
    if (!page) return;
    const title = '  '.repeat(b.level || 0) + b.label;
    const dict = { Title: PDFString.of(title), Parent: outlineRef, Dest: [page.ref, PDFName.of('XYZ'), null, H - b.y + 4, null] };
    if (i > 0) dict.Prev = refs[i - 1];
    if (i < refs.length - 1) dict.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(dict));
  });
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
