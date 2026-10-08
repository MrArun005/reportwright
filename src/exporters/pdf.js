// @ts-check
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream, rgb } from 'pdf-lib';
import fontkitModule from '@pdf-lib/fontkit';
import { parseColor } from './color.js';
import { makePdfA, setUaMetadata, setInfoDates } from './pdfa.js';
import { safeUrl, drillUrl, asciiUrl } from '../engine/url.js';
import { dataUriBytesOf, dataUriBytes, imageInfoOf, IMAGE_LIMITS } from '../engine/image.js';
import { parseSvg, drawSvg } from './svgimage.js';
import { encryptPdf } from './encrypt.js';
import { createTagger } from './pdfua.js';
import { withDeadline } from './deadline.js';
import { pngProblem } from './png.js';
import { needsTableData } from './regions.js';

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
 *   tagged?: { lang?: string }, drillBase?: string, onWarning?: (message: string) => void, timeoutMs?: number,
 *   creationDate?: Date }} [opt]
 *   subset: a HarfBuzz subsetter (see subset.js). Without it, fonts embed in full.
 *   pdfa: make a PDF/A-2b file (needs an sRGB ICC profile). prepare: last change before saving
 *   (the server adds a signature placeholder there). save: extra pdf-lib save options.
 *   encrypt: { userPassword, ownerPassword, permissions } — AES-256 (see encrypt.js); not with pdfa or prepare.
 *   tagged: an accessible PDF (PDF/UA-1, see pdfua.js): structure tree, marked content, artifacts, language, title
 *   shown; with pdfa it is PDF/A-2a. Off, the file is exactly what it was.
 *   drillBase: the ReportWright server whose viewer a drill-through opens (a URI link); without it a drill-through
 *   is not a link. onWarning: what was left out (a damaged image). timeoutMs: the export's time limit (504).
 *   creationDate: the file's dates (UTC); else SOURCE_DATE_EPOCH when set; with either, the same report exports to the
 *   same bytes (encryption keeps its random key, so it does not).
 */
export function exportPdf(model, fontStore, opt = {}) {
  return withDeadline(pdfOf(model, fontStore, opt), /** @type {any} */ (opt).timeoutMs);
}
/** @type {typeof exportPdf} */
async function pdfOf(model, fontStore, opt) {
  // a fixed date (creationDate, else SOURCE_DATE_EPOCH) makes the file reproducible: its ID then derives from the content
  const fixed = fixedDate(opt);
  const when = fixed ?? new Date();
  const fileId = fixed ? await contentId(model, opt, when) : undefined;
  // updateMetadata off: pdf-lib would stamp the current time on save
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(opt.title || 'Report');
  doc.setProducer('ReportWright');
  doc.setCreator('ReportWright');
  if (opt.author) doc.setAuthor(opt.author);
  setInfoDates(doc, when);
  if (fileId) doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(fileId), PDFHexString.of(fileId)]);

  // Which characters each font must draw, and which shaped glyphs (by ID, with the text each one stands for).
  const used = new Map();
  /** @type {Map<string, Map<number, string>>} */
  const shaped = new Map();
  /** right-to-left clusters whose glyphs' ToUnicode entries cannot spell them: they get an /ActualText span @type {WeakMap<any, Set<number>>} */
  const spans = new WeakMap();
  const chars = (key) => { let c = used.get(key); if (!c) { c = new Set([32]); used.set(key, c); } return c; };
  for (const pg of model.pages) for (const it of pg.items.flatMap(i => (i.t === 'field' ? i.draw.filter(d => d.t === 'text') : i.t === 'text' ? [i] : []))) {
    for (const l of it.lines) {
      if (!l.runs) { const c = chars(it.font); for (const ch of l.text) c.add(/** @type {number} */ (ch.codePointAt(0))); continue; }
      for (const r of l.runs) {
        const c = chars(r.font);
        for (const ch of r.text) c.add(/** @type {number} */ (ch.codePointAt(0)));
        let g = shaped.get(r.font);
        if (!g) { g = new Map(); shaped.set(r.font, g); }
        glyphText(r, fontStore.get(r.font), g, spans);
      }
    }
  }
  // A filled-in form field can hold any character: fonts that fields use embed in full.
  const fieldFonts = new Set();
  for (const pg of model.pages) for (const it of pg.items) if (it.t === 'field') fieldFonts.add(fieldFont(it));
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
      if (glyphs) addGlyphs(pf, glyphs, !!opt.tagged);
      // the font file through our deflate (pdf-lib's is pako, on the main thread), with the Length1 TrueType wants
      const file = bytes, e = /** @type {any} */ (pf).embedder;
      if (!e.isCFF()) e.embedFontStream = async (c) => c.register(PDFRawStream.of(c.obj({ Filter: 'FlateDecode', Length1: file.length }), await deflate(file)));
      fonts.set(key, pf);
    }
    return fonts.get(key);
  };
  const images = new Map();
  /** the picture for a source: { img } (embedded) or { why }, the reason it is left out */
  const image = async (src) => {
    if (images.has(src)) return images.get(src);
    const out = await loadImage(src).catch((e) => ({ img: null, why: `it could not be embedded (${e?.message || e})` }));
    images.set(src, out);
    return out;
  };
  async function loadImage(src) {
    const local = /^data:/i.test(src);
    if (local && dataUriBytes(src) > IMAGE_LIMITS.bytes) return { img: null, why: 'it is larger than the image size limit' };
    if (!local && !opt.fetchImage) return { img: null, why: 'it is a URL, and no fetchImage was given to load it' };
    const bytes = local ? dataUriBytesOf(src) : await opt.fetchImage(src);
    if (!bytes?.length) return { img: null, why: 'it could not be loaded' };
    if (bytes.length > IMAGE_LIMITS.bytes) return { img: null, why: 'it is larger than the image size limit' };
    const info = imageInfoOf(bytes);
    if (info?.type === 'svg') {
      const svg = parseSvg(new TextDecoder().decode(bytes));
      return svg ? { img: { svg, width: svg.w, height: svg.h } } : { img: null, why: 'the SVG could not be read' };
    }
    if (info?.type === 'png') {
      // a small PNG can inflate to gigabytes: refuse very large pixel counts before decoding
      // the size is read the way the decoder reads it (last IHDR); animated or multi-IHDR files are refused
      // a cut or damaged PNG can hang pdf-lib's decoder: checked first, left out with a warning
      const why = 'w' in info && !(/** @type {any} */ (info).suspect) && info.w * info.h <= IMAGE_LIMITS.pixels ? pngProblem(bytes) : 'too large or animated';
      return why ? { img: null, why: `the PNG is not usable (${why})` } : { img: await doc.embedPng(bytes) };
    }
    if (info?.type === 'jpeg') return { img: await doc.embedJpg(bytes) };
    // GIF and WebP are not decoded here (no decoder without a new dependency): left out, with a warning
    return { img: null, why: info ? `${info.type.toUpperCase()} is not embedded (PNG, JPEG and SVG are)` : 'it is not a PNG, JPEG or SVG' };
  }

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
  if (opt.tagged) needsTableData(model, 'An accessible PDF');
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
    if (tags) c.tagged = true;
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
      if ((it.t !== 'text' && it.t !== 'line') || it.rotate) c.et(); // a line waits (Content.line): text goes on in its text object
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
          c.line(s, it.strokeWidth || 1, it.dash, it.x1, H - it.y1, it.x2, H - it.y2);
          break;
        }
        case 'text': {
          const f = it.lines.some(l => !l.runs) ? await font(it.font) : null; // lines with runs name their own fonts
          const color = col(it.color) || BLACK;
          const clipped = it.clip && !insideClip(it, vmetrics(it.font));
          if (clipped) { c.q(); c.s += `${n2(it.clip.x)} ${n2(H - it.clip.y - it.clip.h)} ${n2(it.clip.w)} ${n2(it.clip.h)} re W n\n`; }
          for (const l of it.lines) {
            if (!l.runs) {
              // tagged: a character the font lacks is left out (PDF/UA forbids drawing .notdef), its space kept
              const tj = tags && /** @type {any} */ (f).embedder.tjOf(cleanText(l.text));
              if (tj) c.text(f, it.size, color, l.x, H - l.y, tj, true);
              else c.text(f, it.size, color, l.x, H - l.y, /** @type {any} */ (f).embedder.literalOf(cleanText(l.text)));
              continue;
            }
            for (const r of l.runs) if (r.text.trim()) drawRun(c, r, l.x + r.x, H - l.y, it.size, await font(r.font), color, spans.get(r), shaped.get(r.font));
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
          const f = await font(fieldFont(it));
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
            // pdf-lib draws one glyph per character: text that needs shaping (Arabic, Indic, Thai…) or a fallback
            // font gets the engine's glyphs instead, as on the page. Typing into the field later is the viewer's job.
            const lines = it.draw.filter(d => d.t === 'text').flatMap(d => d.lines.map(l => ({ d, l })));
            if (lines.some(x => x.l.runs)) {
              const a = new Content(shared);
              const top = it.y + it.h; // page y (down) of the box's top: local y (up) = top - page y
              a.s += '/Tx BMC\n';
              a.paint({ rgb: '1 1 1', opacity: 1 }, { rgb: '0.61 0.64 0.69', opacity: 1 }, 0.75);
              a.s += `0.375 0.375 ${n2(it.w - 0.75)} ${n2(it.h - 0.75)} re B\n`;
              a.q();
              a.s += `1 1 ${n2(it.w - 2)} ${n2(it.h - 2)} re W n\n`;
              for (const { d, l } of lines) {
                const color = col(d.color) || BLACK;
                if (!l.runs) { const pf = await font(d.font); a.text(pf, d.size, color, l.x - it.x, top - l.y, /** @type {any} */ (pf).embedder.literalOf(cleanText(l.text))); continue; }
                for (const r of l.runs) if (r.text.trim()) drawRun(a, r, l.x - it.x + r.x, top - l.y, d.size, await font(r.font), color, spans.get(r), shaped.get(r.font));
              }
              a.Q();
              a.s += 'EMC\n';
              const ap = ctx.register(ctx.flateStream(a.s, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, it.w, it.h], Resources: resRef }));
              for (const w of field.acroField.getWidgets()) w.setNormalAppearance(ap);
            }
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
          // drill-through: the target report in the ReportWright viewer, with its parameters (opt.drillBase: the server)
          else if (it.action?.type === 'drill') {
            const href = drillUrl(opt.drillBase, it.action);
            if (href) links.push({ page: p, rect, href, pi, ii, tip: it.tip || `Open the report "${it.action.report}"` });
          }
          // a jump: TOC entries from headings carry their place; others go to the first bookmark of that name (as the viewer does)
          else if (it.action?.type === 'bookmark') {
            const to = it.action.page ? it.action : model.bookmarks?.find(b => b.label === it.action.target);
            if (to) links.push({ page: p, rect, to, pi, ii, tip: it.tip || `Go to ${it.action.target || `page ${to.page}`}` });
          }
          break;
        }
        case 'image': {
          const { img, why } = await image(it.src);
          if (!img) {
            const alt = it.tag?.alt;
            opt.onWarning?.(`Image on page ${pi + 1} (${alt ? `"${alt}"` : String(it.src).slice(0, 40)}) was left out: ${why}`);
            break;
          }
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
    // Node: pages compress on zlib's threads while the next ones are drawn, so a few pages' text waits for its turn,
    // not the whole report's. (A browser compresses on this thread: waiting would only add turns of the event loop.)
    if (NODE_ZLIB && contents.length > 8) await contents[contents.length - 9];
  }
  await Promise.all(contents);
  // a place in the document (page, y from the top), as an explicit destination: that page, scrolled to just above y
  const pageH = (n) => model.pages[n - 1]?.height ?? model.height;
  const pages = doc.getPages();
  const dest = (b) => pages[b.page - 1] && [pages[b.page - 1].ref, PDFName.of('XYZ'), null, pageH(b.page) - b.y + 4, null];
  // links as PDF annotations: URLs open, jumps go to their page
  for (const l of links) {
    const to = l.href ? { A: { Type: 'Action', S: 'URI', URI: pdfLiteral(asciiUrl(l.href)) } } : { Dest: dest(l.to) };
    if (!l.href && !to.Dest) continue;
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', F: 4, Rect: l.rect, Border: [0, 0, 0], ...to });
    if (tags) annot.set(PDFName.of('Contents'), PDFHexString.fromText(String(l.tip || l.href || 'Link'))); // what the link does, for a screen reader
    const ref = doc.context.register(annot);
    if (tags) tags.annot(l.pi, l.ii, ref, 'link');
    const annots = l.page.node.lookup(PDFName.of('Annots'));
    if (annots) annots.push(ref); else l.page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  // the outline: bookmarks and headings (headingLevel) in page order, each at its level
  const marks = outlineEntries(model);
  if (marks.length) addOutline(doc, marks, dest);
  pageLabels(doc, model);
  if (tags) tags.finish({ lang: opt.tagged?.lang, title: opt.title || 'Report' });
  if (opt.prepare) await opt.prepare(doc);
  if (opt.pdfa) makePdfA(doc, { ...opt.pdfa, title: opt.title || 'Report', author: opt.author, created: when, id: fileId, ...(tags ? { conformance: 'A', ua: true } : {}) });
  else if (tags) setUaMetadata(doc, { title: opt.title || 'Report', author: opt.author, created: when });
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
 * The export's fixed date: creationDate, else SOURCE_DATE_EPOCH (seconds since 1970), else none (the time now).
 * @returns {Date | null}
 */
function fixedDate(opt) {
  if (opt.creationDate !== undefined) {
    if (!(opt.creationDate instanceof Date) || Number.isNaN(opt.creationDate.getTime())) throw Object.assign(new Error('creationDate must be a valid Date'), { status: 400 });
    return opt.creationDate;
  }
  const epoch = globalThis.process?.env?.SOURCE_DATE_EPOCH;
  return epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000) : null;
}

/** The document ID for a fixed date: a digest of the page model (its timing left out) and the metadata. */
async function contentId(model, opt, when) {
  // stats (the render's time in ms) is left out
  const bytes = new TextEncoder().encode(JSON.stringify([{ ...model, stats: undefined }, opt.title || 'Report', opt.author || '', when.toISOString()]));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.subarray(0, 16), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * The font a form field names in its default appearance (DA): the report font, or the bundled script font its
 * value is drawn in (Arabic in Inter would be blank boxes once a viewer redraws the field).
 */
function fieldFont(it) {
  for (const d of it.draw) if (d.t === 'text') for (const l of d.lines) for (const r of l.runs || []) if (r.font !== it.font && r.text.trim()) return r.font;
  return it.font;
}

/**
 * Draw one run of shaped glyphs by ID, where the engine placed them: a TJ array whose numbers move each
 * glyph from where the font's own advance (the W array) leaves it to the shaper's position; marks that sit
 * higher or lower use the text rise. /ActualText gives copy and search the characters: for a left-to-right
 * run the whole run in reading order; a right-to-left run (drawn in visual order, which readers reorder
 * themselves) reads through ToUnicode, glyph by glyph, and only a cluster ToUnicode cannot spell gets a span
 * (`spans`, from glyphText); glyphs that stand for nothing (`texts`: '') go last. A span per joined letter, and
 * the dots of joined letters drawn among the letters, made pdftotext split words ("الج ميل", "الت قن ية").
 * @param {Content} c @param {Set<number>} [spans]
 */
function drawRun(c, run, x, y, size, pf, color, spans, texts) {
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
  const all = run.glyphs;
  const adv = (id) => f.getGlyph(id).advanceWidth;
  /** @type {number[]} */
  let g = all, quietAt = -1;
  if (run.rtl) {
    // Glyphs that stand for nothing (the dots of a joined letter; the marks of a cluster in a span) go last, in
    // one empty /ActualText: drawn among the letters they split a reader's words, and a span that starts or ends
    // on a mark has the wrong box ("ف اتورة").
    const hasBase = new Set();
    for (let i = 0; i < all.length; i += 4) if (adv(all[i]) > 0) hasBase.add(all[i + 3]);
    const quiet = (i) => (spans?.has(all[i + 3]) ? adv(all[i]) === 0 && hasBase.has(all[i + 3]) : texts?.get(all[i]) === '');
    g = [];
    for (const late of [false, true]) {
      if (late) quietAt = g.length;
      for (let i = 0; i < all.length; i += 4) if (quiet(i) === late) g.push(all[i], all[i + 1], all[i + 2], all[i + 3]);
    }
    if (quietAt === g.length) quietAt = -1;
  }
  const starts = run.rtl ? [...new Set(all.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b) : [];
  let inSpan = false;
  for (let i = 0; i < g.length; i += 4) {
    const id = g[i], gx = g[i + 1], gy = g[i + 2], cl = g[i + 3];
    if (i === quietAt) { flush(); c.s += span(''); inSpan = true; }
    else if (run.rtl && spans?.has(cl) && (quietAt < 0 || i < quietAt) && (i === 0 || g[i - 1] !== cl)) { // the first glyph of a cluster
      flush(); c.s += span(run.text.slice(cl, starts[starts.indexOf(cl) + 1] ?? run.text.length)); inSpan = true;
    }
    if (gy !== rise) { flush(); c.s += `${n4(gy)} Ts\n`; rise = gy; }
    const adj = Math.round((pen - gx) * per * 1000) / 1000;
    if (id === 0 && c.tagged) pen = gx; // a tagged PDF draws no .notdef (PDF/UA 7.21.8): the glyph is left out, its place kept
    else {
      arr += (adj ? `${adj}` : '') + `<${hex4(id)}>`;
      pen = gx + (adv(id) * size) / f.unitsPerEm;
    }
    if (inSpan && (i + 4 >= g.length || (quietAt < 0 || i + 4 < quietAt) && g[i + 7] !== cl || i + 4 === quietAt)) { flush(); c.s += 'EMC\n'; inSpan = false; }
  }
  flush();
  if (rise) c.s += '0 Ts\n'; // the rise outlives the text object
  c.s += 'ET\n';
  if (!run.rtl) c.s += 'EMC\n';
}

/**
 * The text each shaped glyph stands for, for the font's ToUnicode map: the character whose own (character-map)
 * glyph it is; the characters of its cluster that have no glyph of their own there (a conjunct, a joined
 * Arabic form, a reph) go to ONE glyph, the first that is not a mark, and the cluster's other glyphs (dots,
 * marks) stand for nothing, so a reader gets each character once. A glyph keeps its first text: a
 * right-to-left cluster that would read differently with the texts already set goes into `spans` (drawRun
 * gives it /ActualText). Left-to-right runs always get one span for the whole run.
 * @param {any} run @param {any} font fontkit font @param {Map<number, string>} out
 * @param {WeakMap<any, Set<number>>} [spans]
 */
function glyphText(run, font, out, spans) {
  const g = run.glyphs;
  const starts = [...new Set(g.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b);
  for (let k = 0; k < starts.length; k++) {
    const chars = [...run.text.slice(starts[k], starts[k + 1] ?? run.text.length)];
    const ids = [];
    for (let i = 0; i < g.length; i += 4) if (g[i + 3] === starts[k]) ids.push(g[i]);
    const own = new Map(chars.map(ch => [font.glyphForCodePoint(ch.codePointAt(0)).id, ch]));
    const rest = chars.filter(ch => !ids.includes(font.glyphForCodePoint(ch.codePointAt(0)).id)).join('');
    const carrier = rest ? (ids.find(id => !own.has(id) && font.getGlyph(id).advanceWidth > 0) ?? ids.find(id => !own.has(id))) : undefined;
    let ok = !rest || carrier !== undefined;
    const want = new Map();
    for (const id of ids) {
      const t = own.get(id) ?? (id === carrier ? rest : '');
      if (want.has(id) && want.get(id) !== t) ok = false; // the same glyph twice in one cluster, standing for different text
      want.set(id, t);
    }
    for (const [id, t] of want) {
      if (!out.has(id)) out.set(id, t);
      else if (out.get(id) !== t) ok = false;
    }
    if (!ok && run.rtl && spans) {
      let s = spans.get(run);
      if (!s) spans.set(run, s = new Set());
      s.add(starts[k]);
    }
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
  // and their widths the same way: fontkit's layout runs its own shaper (its Indic one needs a regenerator runtime that is not there)
  e.widthOfTextAtSize = (text, size) => {
    let w = 0;
    for (const ch of text) w += f.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).advanceWidth || 0;
    return (w * size) / f.unitsPerEm;
  };
  const lit = new Map();
  const esc = (b) => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b === 0x0d ? '\\r' : String.fromCharCode(b));
  /** @param {string} text @returns {string} the glyph IDs as two bytes each (one char per byte), escaped for a literal string */
  /** a TJ array body that skips the characters with no glyph (.notdef), moving on by their width; null when there are none */
  e.tjOf = (text) => {
    let out = '', cur = '', any = false;
    for (const ch of text) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      if (f.glyphForCodePoint(cp).id === 0) { any = true; if (cur) out += `(${cur})`; cur = ''; out += `${-Math.round(f.getGlyph(0).advanceWidth * 1000 / f.unitsPerEm)}`; continue; }
      cur += e.literalOf(ch);
    }
    return any ? out + (cur ? `(${cur})` : '') : null;
  };
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

/** tagged: every glyph needs a ToUnicode entry (PDF/UA 7.21.7, PDF/A-2a); one that stands for no character of its own
 *  (a half form of a conjunct) maps to U+200D ZERO WIDTH JOINER, and the run's ActualText gives the real text. */
function addGlyphs(pf, glyphs, tagged = false) {
  const e = pf.embedder;
  const byId = new Map(e.glyphCache.access().map(g => [g.id, g]));
  // plain objects: fontkit caches its glyphs with the code points of their first use
  for (const [id, text] of glyphs) byId.set(id, { id, advanceWidth: e.font.getGlyph(id).advanceWidth, codePoints: text || !tagged ? [...text].map(ch => ch.codePointAt(0)) : [0x200d] });
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
/**
 * Bookmarks and headings together, in reading order (page, then height), without the same entry twice (a heading
 * that is also bookmarked); each at its own level. @param {any} model
 */
function outlineEntries(model) {
  const seen = new Set();
  return [...(model.bookmarks || []), ...(model.headings || [])]
    .map((b, i) => ({ b, i }))
    .sort((p, q) => p.b.page - q.b.page || (p.b.y ?? 0) - (q.b.y ?? 0) || p.i - q.i)
    .map(({ b }) => b)
    .filter((b) => { const k = `${b.page}|${Math.round(b.y ?? 0)}|${b.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
/**
 * Page labels (what a reader shows as the page number): decimal, restarting at 1 where a section restarts the
 * report's numbering (model.pageStarts, newSection). @param {PDFDocument} doc @param {any} model
 */
function pageLabels(doc, model) {
  const n = doc.getPageCount();
  if (!n) return;
  const starts = [...new Set([0, ...(model.pageStarts || [])])].filter(i => i >= 0 && i < n).sort((a, b) => a - b);
  const ctx = doc.context;
  const nums = starts.flatMap(i => [i, ctx.obj({ S: 'D', St: 1 })]);
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: nums }));
}
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
    this._s = '';
    this.bt = false; this.tx = 0; this.ty = 0;
    this.st = { fill: '0 0 0', stroke: '0 0 0', lw: 1, dash: '[] 0', ca: 1, CA: 1, font: '', size: 0 };
    /** @type {any[]} */ this.saved = [];
    /** straight lines waiting to be drawn after the text around them: { key, stroke, w, dash, segs: [x1, y1, x2, y2][] } */
    this.lines = null;
    this.tagged = false;
  }
  /**
   * The operators so far. Any other drawing reads or appends to it, so the lines waiting are drawn first: the text
   * of a table's cells stays in one text object (relative moves, which compress to little) instead of one per cell.
   */
  get s() { this.flushLines(); return this._s; }
  set s(v) { this._s = v; }
  /**
   * A straight line. Untagged, it waits until something other than text is drawn (table borders between cell
   * texts); collinear segments that touch, in the same stroke, become one (a row's border is one line).
   * ponytail: lines move after the text drawn just after them; both are thin and do not cover each other.
   */
  line(stroke, w, dash, x1, y1, x2, y2) {
    if (this.tagged) { this.paint(null, stroke, w, dash); this._s += `${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S\n`; return; }
    const key = `${stroke.rgb}|${stroke.opacity}|${w}|${(dash || []).join(' ')}`;
    if (this.lines && this.lines.key !== key) this.flushLines();
    this.lines ||= { key, stroke, w, dash, segs: [] };
    const segs = this.lines.segs, last = segs[segs.length - 1];
    const eq = (a, b) => Math.abs(a - b) < 0.005;
    if (last && eq(last[1], y1) && eq(last[3], y2) && eq(y1, y2) && eq(last[2], x1)) last[2] = x2; // horizontal, end to end
    else if (last && eq(last[0], x1) && eq(last[2], x2) && eq(x1, x2) && eq(last[3], y1)) last[3] = y2; // vertical
    else segs.push([x1, y1, x2, y2]);
  }
  flushLines() {
    const L = this.lines;
    if (!L) return;
    this.lines = null;
    this.et();
    this.paint(null, L.stroke, L.w, L.dash);
    const g = L.segs;
    // a table's row borders: the same line a row height apart. Drawn once and moved down (cm) for each row, so the
    // operators repeat exactly and compress to almost nothing
    const dy = g.length > 2 ? Math.round((g[1][1] - g[0][1]) * 100) : 0;
    if (dy && g.every((q, i) => q[1] === q[3] && n2(q[0]) === n2(g[0][0]) && n2(q[2]) === n2(g[0][2]) && Math.abs(q[1] - (g[0][1] + i * dy / 100)) < 0.01)) {
      const one = `${n2(g[0][0])} ${n2(g[0][1])} m ${n2(g[0][2])} ${n2(g[0][1])} l S\n`;
      this._s += `q\n${one}${`1 0 0 1 0 ${dy / 100} cm ${one}`.repeat(g.length - 1)}Q\n`;
      return;
    }
    this._s += g.map(([a, b, c, d]) => `${n2(a)} ${n2(b)} m ${n2(c)} ${n2(d)} l`).join(' ') + ' S\n';
  }
  q() { this.et(); this._s += 'q\n'; this.saved.push({ ...this.st }); }
  Q() { this.et(); this._s += 'Q\n'; this.st = this.saved.pop(); }
  /**
   * A line of plain text at (x, y). Lines follow one another in one text object, each placed relative to the
   * last (in whole hundredths, so nothing drifts): most of a table page is these.
   * @param {string} str the glyphs, as a literal string's escaped body (array: a TJ array's body)
   */
  text(pf, size, color, x, y, str, array = false) {
    this.setPaint(color, null);
    this.setFont(pf, size);
    // in tenths of a point (0.035 mm): table rows repeat the same moves, which compress to little
    const X = Math.round(x * 10) * 10, Y = Math.round(y * 10) * 10;
    if (!this.bt) { this._s += 'BT\n'; this.bt = true; this.tx = 0; this.ty = 0; }
    this._s += array ? `${(X - this.tx) / 100} ${(Y - this.ty) / 100} Td [${str}] TJ\n` : `${(X - this.tx) / 100} ${(Y - this.ty) / 100} Td (${str}) Tj\n`;
    this.tx = X; this.ty = Y;
  }
  /** end the open text object, if any: anything but text needs that (and draws the lines waiting) */
  et() { if (this.bt) { this._s += 'ET\n'; this.bt = false; } if (this.lines) this.flushLines(); }
  lineWidth(w) { if (this.lines) this.flushLines(); this.setLineWidth(w); }
  setLineWidth(w) { if (this.st.lw !== w) { this._s += `${n3(w)} w\n`; this.st.lw = w; } }
  /** the graphics state that sets these opacities, or undefined when they are set already */
  gsFor(ca, CA) { return ca === this.st.ca && CA === this.st.CA ? undefined : this.shared.gs(ca, CA); }
  alpha(ca, CA) { if (this.lines) this.flushLines(); this.setAlpha(ca, CA); }
  setAlpha(ca, CA) { const g = this.gsFor(ca, CA); if (g) { this._s += `/${g} gs\n`; this.st.ca = ca; this.st.CA = CA; } }
  /** set up to fill with fill and/or stroke with stroke (width w, dash); the lines waiting are drawn first */
  paint(fill, stroke, w = 1, dash = null) { if (this.lines) this.flushLines(); this.setPaint(fill, stroke, w, dash); }
  setPaint(fill, stroke, w = 1, dash = null) {
    const st = this.st;
    if (fill && fill.rgb !== st.fill) { this._s += `${fill.rgb} rg\n`; st.fill = fill.rgb; }
    if (stroke) {
      if (stroke.rgb !== st.stroke) { this._s += `${stroke.rgb} RG\n`; st.stroke = stroke.rgb; }
      this.setLineWidth(w);
      const d = `[${(dash || []).map(n3).join(' ')}] 0`;
      if (d !== st.dash) { this._s += `${d} d\n`; st.dash = d; }
    }
    this.setAlpha(fill ? fill.opacity : st.ca, stroke ? stroke.opacity : st.CA);
  }
  font(pf, size) { if (this.lines) this.flushLines(); this.setFont(pf, size); }
  setFont(pf, size) {
    const name = this.shared.font(pf);
    if (name !== this.st.font || size !== this.st.size) { this._s += `/${name} ${n3(size)} Tf\n`; this.st.font = name; this.st.size = size; }
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
  // a few at a time: each zlib job holds ~260 KB of state, so a thousand pages started at once held ~250 MB
  if (zslots.free > 0) zslots.free--; else await new Promise((ok) => zslots.wait.push(ok));
  try { return await deflateNow(bytes); } finally { const next = zslots.wait.shift(); if (next) next(); else zslots.free++; }
}
const zslots = { free: 4, wait: /** @type {(() => void)[]} */ ([]) }; // ponytail: 4 = libuv's default thread pool
const NODE_ZLIB = /** @type {any} */ (globalThis).process?.getBuiltinModule?.('node:zlib');
async function deflateNow(bytes) {
  const zlib = NODE_ZLIB;
  if (zlib) return new Promise((ok, fail) => zlib.deflate(bytes, { level: 9 }, (e, z) => (e ? fail(e) : ok(z))));
  if (typeof CompressionStream === 'undefined') return (await import('fflate')).zlibSync(bytes);
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
