// @ts-check
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFOperator, PDFOperatorNames, rgb, pushGraphicsState, popGraphicsState,
  rectangle, clip, endPath, concatTransformationMatrix, beginText, endText, setFontAndSize, setTextMatrix, setTextRise, setFillingColor, setGraphicsState } from 'pdf-lib';
import fontkitModule from '@pdf-lib/fontkit';
import { parseColor } from './color.js';
import { makePdfA } from './pdfa.js';
import { safeUrl } from '../engine/url.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

const col = (c) => { const p = parseColor(c); return p ? { color: rgb(p.r, p.g, p.b), opacity: p.a } : null; };

/**
 * Page model → PDF bytes. Draws exactly the lines the engine made.
 * @param {any} model  render() output
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, author?: string, fetchImage?: (src: string) => Promise<Uint8Array|null>,
 *   subset?: (font: Uint8Array, codePoints: Iterable<number>) => Promise<Uint8Array>,
 *   pdfa?: { icc?: Uint8Array }, prepare?: (doc: PDFDocument) => any, save?: object }} [opt]
 *   subset: a HarfBuzz subsetter (see subset.js). Without it, fonts embed in full.
 *   pdfa: make a PDF/A-2b file (needs an sRGB ICC profile). prepare: last change before saving
 *   (the server adds a signature placeholder there). save: extra pdf-lib save options.
 */
export async function exportPdf(model, fontStore, opt = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(opt.title || 'Report');
  doc.setProducer('Pagewright');
  doc.setCreator('Pagewright');
  if (opt.author) doc.setAuthor(opt.author);

  // Which characters each font must draw, and which shaped glyphs (by ID, with the text each one stands for).
  const used = new Map();
  /** @type {Map<string, Map<number, string>>} */
  const shaped = new Map();
  const chars = (key) => { let c = used.get(key); if (!c) { c = new Set([32]); used.set(key, c); } return c; };
  for (const pg of model.pages) for (const it of pg.items) if (it.t === 'text') {
    for (const l of it.lines) {
      if (!l.runs) { const c = chars(it.font); for (const ch of l.text) c.add(/** @type {number} */ (ch.codePointAt(0))); continue; }
      for (const r of l.runs) {
        const c = chars(r.font);
        for (const ch of r.text) c.add(/** @type {number} */ (ch.codePointAt(0)));
        let g = shaped.get(r.font);
        if (!g) { g = new Map(); shaped.set(r.font, g); }
        glyphText(r, fontStore.get(r.font), g);
      }
    }
  }
  // A filled-in form field can hold any character: fonts that fields use embed in full.
  const fieldFonts = new Set();
  for (const pg of model.pages) for (const it of pg.items) if (it.t === 'field') fieldFonts.add(it.font);
  const fonts = new Map();
  const font = async (key) => {
    if (!fonts.has(key)) {
      let bytes = fontStore.bytes.get(key);
      if (!bytes) throw new Error(`Font "${key}" is not loaded`);
      const glyphs = shaped.get(key);
      // fsType "no subsetting": the licence wants the whole font embedded
      if (opt.subset && !fieldFonts.has(key) && !fontStore.get(key)['OS/2']?.fsType?.noSubsetting) {
        const cps = used.get(key) || new Set([32]);
        try {
          const sub = await opt.subset(bytes, cps, glyphs ? { glyphs: glyphs.keys() } : undefined);
          // fontkit cannot read some subsets (an empty last glyph). Check every glyph we need.
          const f = fontkit.create(sub);
          for (const cp of cps) { const g = f.glyphForCodePoint(cp); void g.advanceWidth; void g.bbox; }
          for (const id of glyphs?.keys() || []) { const g = f.getGlyph(id); void g.advanceWidth; void g.bbox; }
          bytes = sub;
        } catch { /* embed the full font */ }
      }
      const pf = await doc.embedFont(bytes, { subset: false });
      plainEncoding(pf);
      if (glyphs) addGlyphs(pf, glyphs);
      fonts.set(key, pf);
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
      if (it.rotate) {
        // screen rotation is clockwise with y down; PDF's y is up, so the angle flips
        const t = -it.rotate.a * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
        const px = it.rotate.cx, py = H - it.rotate.cy;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(c, sn, -sn, c, px - px * c + py * sn, py - px * sn - py * c));
      }
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
          const f = it.lines.some(l => !l.runs) ? await font(it.font) : null; // lines with runs name their own fonts
          const c = col(it.color) || { color: rgb(0, 0, 0), opacity: 1 };
          if (it.clip) {
            p.pushOperators(pushGraphicsState(), rectangle(it.clip.x, H - it.clip.y - it.clip.h, it.clip.w, it.clip.h), clip(), endPath());
          }
          for (const l of it.lines) {
            if (!l.runs) { p.drawText(l.text, { x: l.x, y: H - l.y, size: it.size, font: f, color: c.color, opacity: c.opacity }); continue; }
            for (const r of l.runs) if (r.text.trim()) drawRun(doc, p, r, l.x + r.x, H - l.y, it.size, await font(r.font), c);
          }
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
          if (it.action?.type === 'url' && safeUrl(it.action.href)) links.push({ page: p, rect: [it.x, H - it.y - it.h, it.x + it.w, H - it.y], href: it.action.href });
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
          // cover overflows its box by design: clip it, as SVG's preserveAspectRatio slice does
          if (it.fit === 'cover') p.pushOperators(pushGraphicsState(), rectangle(it.x, H - it.y - it.h, it.w, it.h), clip(), endPath());
          p.drawImage(img, { x, y: H - y - h, width: w, height: h });
          if (it.fit === 'cover') p.pushOperators(popGraphicsState());
          break;
        }
      }
      if (it.rotate) p.pushOperators(popGraphicsState());
    }
  }
  // URL links as PDF annotations
  for (const l of links) {
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', F: 4, Rect: l.rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: pdfLiteral(l.href) } });
    const ref = doc.context.register(annot);
    const annots = l.page.node.lookup(PDFName.of('Annots'));
    if (annots) annots.push(ref); else l.page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  if (model.bookmarks?.length) addOutline(doc, model.bookmarks, H);
  if (opt.prepare) await opt.prepare(doc);
  if (opt.pdfa) makePdfA(doc, { ...opt.pdfa, title: opt.title || 'Report', author: opt.author });
  // appearances are already drawn in the report font; regenerating would switch them to Helvetica
  return doc.save({ updateFieldAppearances: false, ...(opt.save || {}) });
}

/**
 * Draw one run of shaped glyphs by ID, where the engine placed them: a TJ array whose numbers move each
 * glyph from where the font's own advance (the W array) leaves it to the shaper's position; marks that sit
 * higher or lower use the text rise. /ActualText gives copy and search the characters: for a left-to-right
 * run the whole run in reading order; for a right-to-left run (drawn in visual order, which readers reorder
 * themselves) each cluster that is not one glyph for one character.
 */
function drawRun(doc, p, run, x, y, size, pf, c) {
  const names = (p.__pwFonts ||= new Map());
  if (!names.has(pf)) names.set(pf, p.node.newFontDictionary(pf.name, pf.ref));
  const f = pf.embedder.font;
  const per = 1000 / size;
  const span = (text) => PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), doc.context.obj({ ActualText: PDFHexString.fromText(text) })]);
  const emc = () => PDFOperator.of(PDFOperatorNames.EndMarkedContent);
  const ops = [pushGraphicsState(), setFillingColor(c.color)];
  if (c.opacity < 1) ops.push(setGraphicsState(p.maybeEmbedGraphicsState({ opacity: c.opacity })));
  if (!run.rtl) ops.push(span(run.text));
  ops.push(beginText(), setFontAndSize(names.get(pf), size), setTextMatrix(1, 0, 0, 1, x, y));
  let arr = PDFArray.withContext(doc.context);
  let pen = 0, rise = 0;
  const flush = () => { if (arr.size()) ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arr])); arr = PDFArray.withContext(doc.context); };
  const g = run.glyphs;
  const starts = run.rtl ? [...new Set(g.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b) : [];
  let inSpan = false;
  for (let i = 0; i < g.length; i += 4) {
    const id = g[i], gx = g[i + 1], gy = g[i + 2], cl = g[i + 3];
    if (run.rtl && (i === 0 || g[i - 1] !== cl)) { // the first glyph of a cluster
      let n = 0;
      for (let j = i; j < g.length && g[j + 3] === cl; j += 4) n++;
      const text = run.text.slice(cl, starts[starts.indexOf(cl) + 1] ?? run.text.length);
      if (n > 1 || [...text].length > 1) { flush(); ops.push(span(text)); inSpan = true; }
    }
    if (gy !== rise) { flush(); ops.push(setTextRise(gy)); rise = gy; }
    const adj = Math.round((pen - gx) * per * 1000) / 1000;
    if (adj) arr.push(PDFNumber.of(adj));
    arr.push(PDFHexString.of(id.toString(16).padStart(4, '0')));
    pen = gx + (f.getGlyph(id).advanceWidth * size) / f.unitsPerEm;
    if (inSpan && (i + 4 >= g.length || g[i + 7] !== cl)) { flush(); ops.push(emc()); inSpan = false; }
  }
  flush();
  ops.push(endText());
  if (!run.rtl) ops.push(emc());
  ops.push(popGraphicsState());
  p.pushOperators(...ops);
}

/**
 * The text each shaped glyph stands for, for the font's ToUnicode map: the character whose own (character-map)
 * glyph it is, else the characters of its cluster that have no glyph of their own there (a conjunct, a joined
 * Arabic form, a reph). A glyph used twice keeps its first text.
 * @param {any} run @param {any} font fontkit font @param {Map<number, string>} out
 */
function glyphText(run, font, out) {
  const g = run.glyphs;
  const starts = [...new Set(g.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b);
  for (let k = 0; k < starts.length; k++) {
    const chars = [...run.text.slice(starts[k], starts[k + 1] ?? run.text.length)];
    const ids = [];
    for (let i = 0; i < g.length; i += 4) if (g[i + 3] === starts[k]) ids.push(g[i]);
    const own = new Map(chars.map(ch => [font.glyphForCodePoint(ch.codePointAt(0)).id, ch]));
    const rest = chars.filter(ch => !ids.includes(font.glyphForCodePoint(ch.codePointAt(0)).id)).join('');
    for (const id of ids) if (!out.has(id)) out.set(id, own.get(id) ?? rest);
  }
}

/**
 * pdf-lib writes widths (W) and ToUnicode for the glyphs of the character map, each mapped to its code point.
 * Shaped glyphs need entries too (a conjunct has no code point), and a joined Arabic form should read as its
 * letter, not as a presentation-form code point.
 */
/**
 * A literal PDF string with \ ( ) escaped. pdf-lib writes PDFString.of() as is, so a ')' in data would end the
 * string and the rest would become PDF syntax (a /JavaScript action, say).
 */
const pdfLiteral = (s) => PDFString.of(String(s).replace(/[\\()]/g, '\\$&'));

/**
 * Plain (unshaped) lines: one glyph per character, without OpenType layout. The engine measured them that way
 * (advance widths, no kerning or ligatures), so this draws what was measured, and it skips fontkit's layout, which
 * was about 70% of export time. Shaped and right-to-left text never comes here: drawRun places its glyphs itself.
 */
function plainEncoding(pf) {
  const e = pf.embedder, f = e.font, memo = new Map();
  e.encodeText = (text) => {
    let hex = memo.get(text);
    if (hex === undefined) {
      hex = '';
      for (const ch of text) hex += f.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).id.toString(16).padStart(4, '0');
      memo.set(text, hex);
    }
    return PDFHexString.of(hex);
  };
}

function addGlyphs(pf, glyphs) {
  const e = pf.embedder;
  const byId = new Map(e.glyphCache.access().map(g => [g.id, g]));
  // plain objects: fontkit caches its glyphs with the code points of their first use
  for (const [id, text] of glyphs) byId.set(id, { id, advanceWidth: e.font.getGlyph(id).advanceWidth, codePoints: [...text].map(ch => ch.codePointAt(0)) });
  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  e.glyphCache = { access: () => all };
  const cmap = e.embedUnicodeCmap.bind(e);
  // a glyph that stands for no character of its own stays out of ToUnicode
  e.embedUnicodeCmap = (ctx) => {
    e.glyphCache = { access: () => all.filter(g => g.codePoints.length) };
    try { return cmap(ctx); } finally { e.glyphCache = { access: () => all }; }
  };
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
    const dict = { Title: PDFHexString.fromText(title), Parent: outlineRef, Dest: [page.ref, PDFName.of('XYZ'), null, H - b.y + 4, null] };
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
