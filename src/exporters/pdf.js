// @ts-check
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream, rgb } from 'pdf-lib';
import fontkitModule from '@pdf-lib/fontkit';
import { parseColor } from './color.js';
import { makePdfA, setUaMetadata } from './pdfa.js';
import { safeUrl } from '../engine/url.js';
import { dataUriBytesOf, dataUriBytes, imageInfoOf, IMAGE_LIMITS } from '../engine/image.js';
import { parseSvg, drawSvg } from './svgimage.js';
import { encryptPdf } from './encrypt.js';
import { createTagger } from './pdfua.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

/** a colour for pdf-lib (color) and for our own operators (rgb: "r g b") */
const colors = new Map();
const col = (c) => {
  if (colors.has(c)) return colors.get(c);
  const p = parseColor(c), v = p ? { color: rgb(p.r, p.g, p.b), opacity: p.a, rgb: `${n3(p.r)} ${n3(p.g)} ${n3(p.b)}` } : null;
  if (colors.size < 1000) colors.set(c, v); // ponytail: a bounded memo; report colours are few
  return v;
};
const BLACK = { color: rgb(0, 0, 0), opacity: 1, rgb: '0 0 0' };
// numbers in content streams: positions to 1/100 pt, colours and matrices finer
const n2 = (v) => Math.round(v * 100) / 100;
const n3 = (v) => Math.round(v * 1000) / 1000;
const n4 = (v) => Math.round(v * 10000) / 10000;
const hex4 = (id) => id.toString(16).padStart(4, '0');
const KAPPA = 4 * ((Math.SQRT2 - 1) / 3);
// as pdf-lib's drawText cleaned text: tabs and line separators become four spaces
const cleanText = (t) => t.replace(/\t|\u0085|\u2028|\u2029/g, '    ').replace(/[\b\v]/g, '');

/**
 * Page model → PDF bytes. Draws exactly the lines the engine made.
 * @param {any} model  render() output
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, author?: string, fetchImage?: (src: string) => Promise<Uint8Array|null>,
 *   subset?: (font: Uint8Array, codePoints: Iterable<number>) => Promise<Uint8Array>,
 *   pdfa?: { icc?: Uint8Array }, prepare?: (doc: PDFDocument) => any, save?: object,
 *   encrypt?: { userPassword?: string, ownerPassword?: string, permissions?: Partial<Record<keyof typeof import('./encrypt.js').PERMISSION_BITS, boolean>> },
 *   tagged?: { lang?: string } }} [opt]
 *   subset: a HarfBuzz subsetter (see subset.js). Without it, fonts embed in full.
 *   pdfa: make a PDF/A-2b file (needs an sRGB ICC profile). prepare: last change before saving
 *   (the server adds a signature placeholder there). save: extra pdf-lib save options.
 *   encrypt: { userPassword, ownerPassword, permissions } — AES-256 (see encrypt.js); not with pdfa or prepare.
 *   tagged: an accessible PDF (PDF/UA-1, see pdfua.js): structure tree, marked content, artifacts, language, title
 *   shown; with pdfa it is PDF/A-2a. Off, the file is exactly what it was.
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
      const full = fontStore.bytes.get(key);
      let bytes = full;
      if (!bytes) throw new Error(`Font "${key}" is not loaded`);
      const glyphs = shaped.get(key);
      // fsType "no subsetting": the licence wants the whole font embedded
      if (opt.subset && !fieldFonts.has(key) && !fontStore.get(key)['OS/2']?.fsType?.noSubsetting) {
        const cps = used.get(key) || new Set([32]);
        try {
          // fontkit reads a glyph header even for an empty glyph: when the last glyph is empty (often the space) and
          // glyf is the last table, that read runs past the end. Zero padding after the tables makes it read zeros.
          const sub = withPadding(await opt.subset(bytes, cps, glyphs ? { glyphs: glyphs.keys() } : undefined));
          // Check every glyph we need: a subset fontkit cannot read embeds the full font instead. (The advance reads the
          // glyph header too; pdf-lib needs no more. The outline, which g.bbox would decode, is never read.)
          const f = fontkit.create(sub);
          for (const cp of cps) void f.glyphForCodePoint(cp).advanceWidth;
          for (const id of glyphs?.keys() || []) void f.getGlyph(id).advanceWidth;
          bytes = sub;
        } catch { /* embed the full font */ }
      }
      // a subset's name starts with a tag (ABCDEF+), which tells readers (and pdffonts) it is one
      const pf = await doc.embedFont(bytes, { subset: false, customName: bytes === full ? undefined : `${subsetTag(bytes)}+${fontStore.get(key).postscriptName || 'Font'}` });
      plainEncoding(pf);
      if (glyphs) addGlyphs(pf, glyphs);
      // the font file through our deflate (pdf-lib's is pako, on the main thread), with the Length1 TrueType wants
      const file = bytes, e = /** @type {any} */ (pf).embedder;
      if (!e.isCFF()) e.embedFontStream = async (c) => c.register(PDFRawStream.of(c.obj({ Filter: 'FlateDecode', Length1: file.length }), await deflate(file)));
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
      if (/^data:/i.test(src)) bytes = dataUriBytes(src) <= IMAGE_LIMITS.bytes ? dataUriBytesOf(src) : null;
      else if (opt.fetchImage) bytes = await opt.fetchImage(src);
      const info = bytes && bytes.length <= IMAGE_LIMITS.bytes ? imageInfoOf(bytes) : null;
      if (info?.type === 'svg') {
        const svg = parseSvg(new TextDecoder().decode(bytes));
        if (svg) img = { svg, width: svg.w, height: svg.h };
      } else if (info?.type === 'png') {
        // a small PNG can inflate to gigabytes: refuse very large pixel counts before decoding
        // the size is read the way the decoder reads it (last IHDR); animated or multi-IHDR files are refused
        if ('w' in info && !info.suspect && info.w * info.h <= IMAGE_LIMITS.pixels) img = await doc.embedPng(bytes);
      } else if (info?.type === 'jpeg') img = await doc.embedJpg(bytes);
    } catch { img = null; }
    images.set(src, img);
    return img;
  };

  // One Resources dictionary for every page: fonts, opacity states and images are named once per document.
  const ctx = doc.context;
  const res = ctx.obj({ Font: {}, ExtGState: {}, XObject: {} });
  const resRef = ctx.register(res);
  const names = new Map();
  /** the resource name of obj (a font, a graphics state or an image) in the shared dictionary */
  const nameOf = (kind, key, value) => {
    let n = names.get(key);
    if (!n) {
      n = `${kind[0]}${names.size + 1}`;
      names.set(key, n);
      /** @type {any} */ (res.get(PDFName.of(kind))).set(PDFName.of(n), value());
    }
    return n;
  };
  const shared = {
    font: (pf) => nameOf('Font', pf, () => pf.ref),
    gs: (ca, CA) => nameOf('ExtGState', `gs ${ca} ${CA}`, () => ctx.obj({ Type: 'ExtGState', ca, CA })),
    image: (img) => nameOf('XObject', img, () => img.ref),
  };

  const links = [];
  const taken = new Set();
  const uniqueName = (n) => { let name = n, i = 1; while (taken.has(name)) name = `${n}_${++i}`; taken.add(name); return name; };
  const contents = [];
  const tags = opt.tagged ? createTagger(model, doc) : null;
  let pi = -1; // the page's index (the tagger's key)
  const vm = new Map();
  /** ascent and descent (below the baseline, positive) per em */
  const vmetrics = (key) => {
    let m = vm.get(key);
    if (!m) { const f = fontStore.get(key), u = f?.unitsPerEm || 1000; vm.set(key, m = { asc: (f?.ascent ?? u) / u, desc: -(f?.descent ?? 0) / u }); }
    return m;
  };
  for (const pg of model.pages) {
    pi++;
    // a page of another body section may have its own size
    const H = pg.height ?? model.height;
    const p = doc.addPage([pg.width ?? model.width, H]);
    p.node.normalize();
    p.node.set(PDFName.of('Resources'), resRef);
    const c = new Content(shared);
    // pdf-lib draws the rare shapes (SVG paths, rounded boxes, SVG images): its operators join this page's stream
    p.maybeEmbedGraphicsState = (o) => c.gsFor(o.opacity ?? 1, o.borderOpacity ?? 1);
    const viaPdfLib = (draw) => {
      c.et();
      c.lineWidth(1); // what a stroke without a width of its own inherits, as before
      draw();
      const ops = /** @type {any} */ (p.getContentStream()).operators;
      for (const op of ops) c.s += op.toString() + '\n';
      ops.length = 0;
    };
    for (let ii = 0; ii < pg.items.length; ii++) {
      const it = pg.items[ii];
      // tagged: the item's marked content (a structure element's MCID, or an artifact)
      const mark = tags && tags.open(pi, ii, it);
      if (mark) { c.et(); c.s += mark; }
      if (it.t !== 'text' || it.rotate) c.et();
      if (it.rotate) {
        // screen rotation is clockwise with y down; PDF's y is up, so the angle flips
        const t = -it.rotate.a * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
        const px = it.rotate.cx, py = H - it.rotate.cy;
        c.q();
        c.s += `${n4(cs)} ${n4(sn)} ${n4(-sn)} ${n4(cs)} ${n2(px - px * cs + py * sn)} ${n2(py - px * sn - py * cs)} cm\n`;
      }
      switch (it.t) {
        case 'rect': {
          const fill = col(it.fill), stroke = col(it.stroke);
          if (!fill && !stroke) break;
          if (it.radius) {
            viaPdfLib(() => p.drawSvgPath(roundRect(it.x, it.y, it.w, it.h, it.radius), {
              x: 0, y: H,
              color: fill?.color, opacity: fill?.opacity,
              borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderOpacity: stroke?.opacity,
              borderDashArray: it.dash || undefined,
            }));
          } else {
            c.paint(fill, stroke, it.strokeWidth || 1, it.dash);
            const x = n2(it.x), y = n2(H - it.y - it.h), w = n2(it.w), h = n2(it.h);
            // a dashed border starts where it always did (bottom-left, going up)
            c.s += (stroke && it.dash?.length ? `${x} ${y} m ${x} ${n2(y + h)} l ${n2(x + w)} ${n2(y + h)} l ${n2(x + w)} ${y} l h` : `${x} ${y} ${w} ${h} re`) + (fill && stroke ? ' B\n' : fill ? ' f\n' : ' S\n');
          }
          break;
        }
        case 'ellipse': {
          const fill = col(it.fill), stroke = col(it.stroke);
          if (!fill && !stroke) break;
          c.paint(fill, stroke, it.strokeWidth || 1, it.dash);
          const cx = it.cx, cy = H - it.cy, rx = it.rx, ry = it.ry, ox = rx * KAPPA, oy = ry * KAPPA;
          c.s += `${n2(cx - rx)} ${n2(cy)} m ${n2(cx - rx)} ${n2(cy - oy)} ${n2(cx - ox)} ${n2(cy - ry)} ${n2(cx)} ${n2(cy - ry)} c `
            + `${n2(cx + ox)} ${n2(cy - ry)} ${n2(cx + rx)} ${n2(cy - oy)} ${n2(cx + rx)} ${n2(cy)} c `
            + `${n2(cx + rx)} ${n2(cy + oy)} ${n2(cx + ox)} ${n2(cy + ry)} ${n2(cx)} ${n2(cy + ry)} c `
            + `${n2(cx - ox)} ${n2(cy + ry)} ${n2(cx - rx)} ${n2(cy + oy)} ${n2(cx - rx)} ${n2(cy)} c h ${fill && stroke ? 'B' : fill ? 'f' : 'S'}\n`;
          break;
        }
        case 'line': {
          const s = col(it.stroke);
          if (!s) break;
          c.paint(null, s, it.strokeWidth || 1, it.dash);
          c.s += `${n2(it.x1)} ${n2(H - it.y1)} m ${n2(it.x2)} ${n2(H - it.y2)} l S\n`;
          break;
        }
        case 'text': {
          const f = it.lines.some(l => !l.runs) ? await font(it.font) : null; // lines with runs name their own fonts
          const color = col(it.color) || BLACK;
          const clipped = it.clip && !insideClip(it, vmetrics(it.font));
          if (clipped) { c.q(); c.s += `${n2(it.clip.x)} ${n2(H - it.clip.y - it.clip.h)} ${n2(it.clip.w)} ${n2(it.clip.h)} re W n\n`; }
          for (const l of it.lines) {
            if (!l.runs) { c.text(f, it.size, color, l.x, H - l.y, /** @type {any} */ (f).embedder.literalOf(cleanText(l.text))); continue; }
            for (const r of l.runs) if (r.text.trim()) drawRun(c, r, l.x + r.x, H - l.y, it.size, await font(r.font), color);
          }
          if (clipped) c.Q();
          break;
        }
        case 'path': {
          const fill = col(it.fill), stroke = col(it.stroke);
          viaPdfLib(() => p.drawSvgPath(it.d, { x: it.x, y: H - it.y, color: fill?.color, opacity: fill?.opacity, borderColor: stroke?.color, borderWidth: stroke ? it.strokeWidth || 1 : 0, borderOpacity: stroke?.opacity, borderLineCap: it.lineCap === 'butt' ? 0 : 1, borderDashArray: it.dash || undefined }));
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
          if (tags) {
            // an accessible field: its name as the description a screen reader says, its widget in a Form element
            field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(it.label || it.name || name));
            const w = field.acroField.getWidgets()[0];
            const ref = w && doc.context.getObjectRef(w.dict);
            if (ref) tags.annot(pi, ii, ref, 'field');
          }
          break;
        }
        case 'link': {
          const rect = [it.x, H - it.y - it.h, it.x + it.w, H - it.y];
          if (it.action?.type === 'url' && safeUrl(it.action.href)) links.push({ page: p, rect, href: it.action.href, pi, ii, tip: it.tip });
          // a jump: TOC entries from headings carry their place; others go to the first bookmark of that name (as the viewer does)
          else if (it.action?.type === 'bookmark') {
            const to = it.action.page ? it.action : model.bookmarks?.find(b => b.label === it.action.target);
            if (to) links.push({ page: p, rect, to, pi, ii, tip: it.tip || `Go to ${it.action.target || `page ${to.page}`}` });
          }
          break;
        }
        case 'image': {
          const img = await image(it.src);
          if (!img) break;
          let w = it.w, h = it.h, x = it.x, y = it.y;
          // clip: the image at its natural size (w, h) from the box's top-left corner, cut to the box (cw, ch)
          const clipBox = it.fit === 'clip' ? [it.x, H - it.y - it.ch, it.cw, it.ch] : it.fit === 'cover' ? [it.x, H - it.y - it.h, it.w, it.h] : null;
          if (it.fit !== 'fill' && it.fit !== 'clip') {
            const s = it.fit === 'cover' ? Math.max(it.w / img.width, it.h / img.height) : Math.min(it.w / img.width, it.h / img.height);
            w = img.width * s; h = img.height * s; x = it.x + (it.w - w) / 2; y = it.y + (it.h - h) / 2;
          }
          // cover overflows its box by design: clip it, as SVG's preserveAspectRatio slice does
          c.q();
          if (clipBox) c.s += `${clipBox.map(n2).join(' ')} re W n\n`;
          if (img.svg) viaPdfLib(() => drawSvg(p, img.svg, { x, y: H - y - h, sx: w / img.width, sy: h / img.height }));
          else { c.alpha(1, c.st.CA); c.s += `${n4(w)} 0 0 ${n4(h)} ${n2(x)} ${n2(H - y - h)} cm /${shared.image(img)} Do\n`; }
          c.Q();
          break;
        }
      }
      if (it.rotate) c.Q();
      if (mark) { c.et(); c.s += 'EMC\n'; }
    }
    c.et();
    // pdf-lib made a stream of its own for the shapes it drew: the page has just this one
    const own = /** @type {any} */ (p).contentStreamRef;
    if (own) ctx.delete(own);
    const ref = ctx.nextRef();
    p.node.set(PDFName.of('Contents'), ref);
    contents.push(deflate(latin1(c.s)).then(z => ctx.assign(ref, PDFRawStream.of(ctx.obj({ Filter: 'FlateDecode' }), z))));
  }
  await Promise.all(contents);
  // a place in the document (page, y from the top), as an explicit destination: that page, scrolled to just above y
  const pageH = (n) => model.pages[n - 1]?.height ?? model.height;
  const pages = doc.getPages();
  const dest = (b) => pages[b.page - 1] && [pages[b.page - 1].ref, PDFName.of('XYZ'), null, pageH(b.page) - b.y + 4, null];
  // links as PDF annotations: URLs open, jumps go to their page
  for (const l of links) {
    const to = l.href ? { A: { Type: 'Action', S: 'URI', URI: pdfLiteral(l.href) } } : { Dest: dest(l.to) };
    if (!l.href && !to.Dest) continue;
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', F: 4, Rect: l.rect, Border: [0, 0, 0], ...to });
    if (tags) annot.set(PDFName.of('Contents'), PDFHexString.fromText(String(l.tip || l.href || 'Link'))); // what the link does, for a screen reader
    const ref = doc.context.register(annot);
    if (tags) tags.annot(l.pi, l.ii, ref, 'link');
    const annots = l.page.node.lookup(PDFName.of('Annots'));
    if (annots) annots.push(ref); else l.page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  if (model.bookmarks?.length) addOutline(doc, model.bookmarks, dest);
  if (tags) tags.finish({ lang: opt.tagged?.lang, title: opt.title || 'Report' });
  if (opt.prepare) await opt.prepare(doc);
  if (opt.pdfa) makePdfA(doc, { ...opt.pdfa, title: opt.title || 'Report', author: opt.author, ...(tags ? { conformance: 'A', ua: true } : {}) });
  else if (tags) setUaMetadata(doc, { title: opt.title || 'Report', author: opt.author });
  if (opt.encrypt) {
    // PDF/A forbids encryption; a signature would need its /Contents left plain inside an encrypted file
    if (opt.pdfa) throw Object.assign(new Error('A PDF/A file cannot have a password. Turn off PDF/A or the password.'), { status: 400 });
    if (opt.prepare) throw Object.assign(new Error('A signed PDF cannot have a password here. Turn off signing or the password.'), { status: 400 });
    await encryptPdf(doc, opt.encrypt);
    return doc.save({ updateFieldAppearances: false, ...(opt.save || {}), useObjectStreams: false });
  }
  // appearances are already drawn in the report font; regenerating would switch them to Helvetica
  return doc.save({ updateFieldAppearances: false, ...(opt.save || {}) });
}

/**
 * Draw one run of shaped glyphs by ID, where the engine placed them: a TJ array whose numbers move each
 * glyph from where the font's own advance (the W array) leaves it to the shaper's position; marks that sit
 * higher or lower use the text rise. /ActualText gives copy and search the characters: for a left-to-right
 * run the whole run in reading order; for a right-to-left run (drawn in visual order, which readers reorder
 * themselves) each cluster that is not one glyph for one character.
 * @param {Content} c
 */
function drawRun(c, run, x, y, size, pf, color) {
  const f = pf.embedder.font;
  const per = 1000 / size;
  const span = (text) => `/Span <</ActualText ${PDFHexString.fromText(text).toString()}>> BDC\n`;
  c.et();
  c.paint(color, null); c.font(pf, size);
  if (!run.rtl) c.s += span(run.text);
  c.s += `BT ${n2(x)} ${n2(y)} Td\n`;
  let arr = '';
  let pen = 0, rise = 0;
  const flush = () => { if (arr) c.s += `[${arr}] TJ\n`; arr = ''; };
  const g = run.glyphs;
  const starts = run.rtl ? [...new Set(g.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b) : [];
  let inSpan = false;
  for (let i = 0; i < g.length; i += 4) {
    const id = g[i], gx = g[i + 1], gy = g[i + 2], cl = g[i + 3];
    if (run.rtl && (i === 0 || g[i - 1] !== cl)) { // the first glyph of a cluster
      let n = 0;
      for (let j = i; j < g.length && g[j + 3] === cl; j += 4) n++;
      const text = run.text.slice(cl, starts[starts.indexOf(cl) + 1] ?? run.text.length);
      if (n > 1 || [...text].length > 1) { flush(); c.s += span(text); inSpan = true; }
    }
    if (gy !== rise) { flush(); c.s += `${n4(gy)} Ts\n`; rise = gy; }
    const adj = Math.round((pen - gx) * per * 1000) / 1000;
    arr += (adj ? `${adj}` : '') + `<${hex4(id)}>`;
    pen = gx + (f.getGlyph(id).advanceWidth * size) / f.unitsPerEm;
    if (inSpan && (i + 4 >= g.length || g[i + 7] !== cl)) { flush(); c.s += 'EMC\n'; inSpan = false; }
  }
  flush();
  if (rise) c.s += '0 Ts\n'; // the rise outlives the text object
  c.s += 'ET\n';
  if (!run.rtl) c.s += 'EMC\n';
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
  /** @param {string} text @returns {string} the glyph IDs, four hex digits each */
  e.hexOf = (text) => {
    let hex = '';
    for (const ch of text) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      let h = memo.get(cp);
      if (h === undefined) memo.set(cp, h = hex4(f.glyphForCodePoint(cp).id));
      hex += h;
    }
    return hex;
  };
  e.encodeText = (text) => PDFHexString.of(e.hexOf(text)); // form field appearances
  const lit = new Map();
  const esc = (b) => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b === 0x0d ? '\\r' : String.fromCharCode(b));
  /** @param {string} text @returns {string} the glyph IDs as two bytes each (one char per byte), escaped for a literal string */
  e.literalOf = (text) => {
    let out = '';
    for (const ch of text) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      let b = lit.get(cp);
      if (b === undefined) { const id = f.glyphForCodePoint(cp).id; lit.set(cp, b = esc(id >> 8) + esc(id & 255)); }
      out += b;
    }
    return out;
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

/**
 * PDF outline (the bookmarks panel) from the page model bookmarks, nested by level: a bookmark is the child of
 * the nearest one before it at a lower level (a skipped level still nests one deep). Every item is open.
 * dest(b): its destination. Headings (headingLevel without a bookmark) stay out: they feed a TOC only.
 */
function addOutline(doc, bookmarks, dest) {
  const ctx = doc.context;
  const root = { ref: ctx.nextRef(), level: -1, kids: /** @type {any[]} */ ([]) };
  const stack = [root];
  for (const b of bookmarks) {
    const Dest = dest(b);
    if (!Dest) continue;
    const level = Math.max(0, Math.min(9, Number(b.level) || 0)); // capped, so the tree is at most 10 deep
    while (stack[stack.length - 1].level >= level) stack.pop();
    const node = { ref: ctx.nextRef(), level, kids: [], Title: PDFHexString.fromText(b.label), Dest };
    stack[stack.length - 1].kids.push(node);
    stack.push(node);
  }
  if (!root.kids.length) return;
  const count = (n) => n.kids.reduce((s, k) => s + 1 + count(k), 0);
  const children = (n) => (n.kids.length ? { First: n.kids[0].ref, Last: n.kids[n.kids.length - 1].ref, Count: count(n) } : {});
  const write = (n) => n.kids.forEach((k, i) => {
    ctx.assign(k.ref, ctx.obj({ Title: k.Title, Parent: n.ref, Dest: k.Dest, ...(i > 0 ? { Prev: n.kids[i - 1].ref } : {}), ...(i < n.kids.length - 1 ? { Next: n.kids[i + 1].ref } : {}), ...children(k) }));
    write(k);
  });
  write(root);
  ctx.assign(root.ref, ctx.obj({ Type: 'Outlines', ...children(root) }));
  doc.catalog.set(PDFName.of('Outlines'), root.ref);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** the font with 16 zero bytes after it (more than a glyph header) */
function withPadding(font) {
  const out = new Uint8Array(font.length + 16);
  out.set(font);
  return out;
}

/** Six capital letters from the subset's bytes (FNV-1a): the same subset always gets the same tag. */
function subsetTag(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  let tag = '';
  for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + ((h >>> 0) % 26)); h = Math.imul(h ^ i, 16777619) >>> 0; }
  return tag;
}

/**
 * Text inside its clip box needs no clip: the lines' advances within it across, the font's ascent and descent
 * within it down. A cell's text almost always fits, and a clip per cell is most of a table page's operators.
 */
function insideClip(it, m) {
  const k = it.clip, asc = m.asc * it.size, desc = m.desc * it.size;
  return it.lines.every(l => l.w != null && !l.runs && l.x >= k.x && l.x + l.w <= k.x + k.w && l.y - asc >= k.y && l.y + desc <= k.y + k.h);
}

/**
 * A page's operators as text. The graphics state is tracked, so a colour, line width, dash, opacity or font
 * that is already set is not set again; q/Q save and restore it as the PDF does.
 */
class Content {
  constructor(shared) {
    this.shared = shared;
    this.s = '';
    this.bt = false; this.tx = 0; this.ty = 0;
    this.st = { fill: '0 0 0', stroke: '0 0 0', lw: 1, dash: '[] 0', ca: 1, CA: 1, font: '', size: 0 };
    /** @type {any[]} */ this.saved = [];
  }
  q() { this.et(); this.s += 'q\n'; this.saved.push({ ...this.st }); }
  Q() { this.et(); this.s += 'Q\n'; this.st = this.saved.pop(); }
  /**
   * A line of plain text at (x, y). Lines follow one another in one text object, each placed relative to the
   * last (in whole hundredths, so nothing drifts): most of a table page is these.
   * @param {string} str the glyphs, as a literal string's escaped body
   */
  text(pf, size, color, x, y, str) {
    this.paint(color, null);
    this.font(pf, size);
    const X = Math.round(x * 100), Y = Math.round(y * 100);
    if (!this.bt) { this.s += 'BT\n'; this.bt = true; this.tx = 0; this.ty = 0; }
    this.s += `${(X - this.tx) / 100} ${(Y - this.ty) / 100} Td (${str}) Tj\n`;
    this.tx = X; this.ty = Y;
  }
  /** end the open text object, if any: anything but text needs that */
  et() { if (this.bt) { this.s += 'ET\n'; this.bt = false; } }
  lineWidth(w) { if (this.st.lw !== w) { this.s += `${n3(w)} w\n`; this.st.lw = w; } }
  /** the graphics state that sets these opacities, or undefined when they are set already */
  gsFor(ca, CA) { return ca === this.st.ca && CA === this.st.CA ? undefined : this.shared.gs(ca, CA); }
  alpha(ca, CA) { const g = this.gsFor(ca, CA); if (g) { this.s += `/${g} gs\n`; this.st.ca = ca; this.st.CA = CA; } }
  /** set up to fill with fill and/or stroke with stroke (width w, dash) */
  paint(fill, stroke, w = 1, dash = null) {
    const st = this.st;
    if (fill && fill.rgb !== st.fill) { this.s += `${fill.rgb} rg\n`; st.fill = fill.rgb; }
    if (stroke) {
      if (stroke.rgb !== st.stroke) { this.s += `${stroke.rgb} RG\n`; st.stroke = stroke.rgb; }
      this.lineWidth(w);
      const d = `[${(dash || []).map(n3).join(' ')}] 0`;
      if (d !== st.dash) { this.s += `${d} d\n`; st.dash = d; }
    }
    this.alpha(fill ? fill.opacity : st.ca, stroke ? stroke.opacity : st.CA);
  }
  font(pf, size) {
    const name = this.shared.font(pf);
    if (name !== this.st.font || size !== this.st.size) { this.s += `/${name} ${n3(size)} Tf\n`; this.st.font = name; this.st.size = size; }
  }
}

/** one byte per char: the content stream holds the glyph bytes of literal strings as chars 0–255 */
function latin1(s) {
  const B = /** @type {any} */ (globalThis).Buffer;
  if (B) return B.from(s, 'latin1'); // Node: native, several times faster than the loop
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * zlib (Flate) compression: Node's zlib on its thread pool (pages compress in parallel, off the main thread), else
 * the platform's CompressionStream (browsers; in Node it is the same zlib behind web streams, slower), else fflate.
 */
async function deflate(bytes) {
  const zlib = /** @type {any} */ (globalThis).process?.getBuiltinModule?.('node:zlib');
  if (zlib) return new Promise((ok, fail) => zlib.deflate(bytes, (e, z) => (e ? fail(e) : ok(z))));
  if (typeof CompressionStream === 'undefined') return (await import('fflate')).zlibSync(bytes);
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
