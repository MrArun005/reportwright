// @ts-check
/**
 * A PDF written as it is made (docs/research/STREAMING-1M.md §6): each page's objects go to the sink as soon as the
 * page is added, and only their byte offsets stay, so memory does not grow with the pages. What must come last is
 * written by finish(): the fonts (subset with HarfBuzz, glyph IDs retained, so pages drawn earlier with the full
 * font's IDs stay right), the "of Y" total, the shared Resources, the page tree, outline, catalog, Info, a classic
 * xref table and the trailer. Object numbers the pages refer to (fonts, resources, page parents, later pages) are
 * reserved before their objects exist.
 *
 *   const w = createPdfStream(sink, { fontStore, fonts: ['Inter-Regular'], subset });
 *   const F = w.fontName('Inter-Regular'), T = w.totalPages({ font: 'Inter-Regular', size: 8, width: 30 });
 *   await w.addPage({ width, height, content: `BT /${F} 8 Tf 36 20 Td <${w.encode('Inter-Regular', 'Page 1 of')}> Tj ET q 1 0 0 1 80 20 cm /${T} Do Q` });
 *   await w.finish({ outline, info });
 *
 * Text is drawn by glyph ID (Identity-H, two bytes per glyph): encode() gives the hex and records the glyphs.
 * ponytail: no encryption, PDF/A, tagging, forms or signing yet: those stay on exportPdf (pdf.js) for now.
 */
import fontkitModule from '@pdf-lib/fontkit';
import { zlibSync } from 'fflate';
import { render } from '../engine/index.js';
import { planPaged } from '../engine/paged.js';
import { safeUrl, drillUrl, asciiUrl } from '../engine/url.js';
import { exportPdf } from './pdf.js';
import { Content, drawRun, glyphText, insideClip, col, BLACK, n2, n4, KAPPA, cleanText } from './pdfpaint.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;
const CHUNK = 64 * 1024;
const LEAF = 64; // pages per node of the page tree
const hex4 = (/** @type {number} */ id) => id.toString(16).padStart(4, '0');
const num = (/** @type {number} */ v) => String(Math.round(v * 1000) / 1000);

/**
 * @typedef {{ write(u8: Uint8Array): any, once?: (ev: string, cb: () => void) => any }} Sink
 *   write may return a promise (awaited: back-pressure), or false with a 'drain' event to wait for (a Node Writable).
 * @typedef {{ title: string, page: number, top?: number, level?: number }} OutlineEntry
 *   page: 1-based; top: the destination's y in PDF space (from the bottom), else the page fits the window.
 */

/**
 * @param {Sink} sink
 * @param {{ fontStore: import('../engine/text/fonts.js').FontStore, fonts?: string[],
 *   subset?: (font: Uint8Array, codePoints: Iterable<number>, opt?: { glyphs?: Iterable<number> }) => Promise<Uint8Array>,
 *   id?: string, compress?: number }} opt
 *   fonts: font keys to name now (F1, F2… in this order); any other font is named on first use.
 *   subset: subset.js's subsetter; without it fonts embed in full. id: the file ID (32 hex digits), else random.
 *   compress: the deflate level for page streams (default 6).
 */
export function createPdfStream(sink, opt) {
  const { fontStore } = opt;
  let pos = 0, nextNum = 1;
  /** @type {number[]} byte offset per object number */
  const offsets = [];
  /** @type {Uint8Array[]} */
  let parts = [];
  let size = 0;
  const reserve = () => nextNum++;

  const flush = async () => {
    if (!size) return;
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    parts = []; size = 0;
    const r = sink.write(all);
    if (r === false && sink.once) await new Promise((ok) => /** @type {any} */ (sink).once('drain', ok));
    else await r;
  };
  /** @param {string | Uint8Array} x */
  const put = (x) => {
    const u8 = typeof x === 'string' ? latin1(x) : x;
    parts.push(u8); size += u8.length; pos += u8.length;
    return size >= CHUNK ? flush() : undefined;
  };
  /** an object: its dictionary (or any value), and its stream's bytes (already filtered) */
  /** @param {number} n @param {string} dict @param {Uint8Array} [stream] */
  const writeObj = async (n, dict, stream) => {
    offsets[n] = pos;
    if (!stream) return put(`${n} 0 obj\n${dict}\nendobj\n`);
    await put(`${n} 0 obj\n${dict.replace(/>>\s*$/, `/Length ${stream.length} >>`)}\nstream\n`);
    await put(stream);
    return put('\nendstream\nendobj\n');
  };
  const deflate = (/** @type {Uint8Array} */ b) => zlibSync(b, { level: /** @type {any} */ (opt.compress ?? 6) });
  put('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');

  // fonts: a resource name and the Type0 font's object number each, now; their glyphs are recorded as pages draw
  /** @type {Map<string, { name: string, ref: number, font: any, cps: Set<number>, glyphs: Map<number, string>, memo: Map<number, string> }>} */
  const fonts = new Map();
  let pages = 0, done = false;
  /** a font's record: its resource name and Type0 object number are reserved on first use (its objects come at the end) */
  const fontOf = (/** @type {string} */ key) => {
    let f = fonts.get(key);
    if (!f) {
      if (done) throw new Error('The PDF is finished');
      fonts.set(key, f = { name: `F${fonts.size + 1}`, ref: reserve(), font: fontStore.get(key), cps: new Set([32]), glyphs: new Map(), memo: new Map() });
    }
    return f;
  };

  const resRef = reserve();
  for (const key of opt.fonts || []) fontOf(key);
  /** @type {Map<string, Map<string, string>>} kind → value → name */
  const res = new Map();
  /** @type {{ ref: number, font: string, size: number, width: number, align: string, color: string }[]} */
  const totals = [];
  /** @type {number[]} */
  const pageRefs = [];
  /** @type {number[]} */
  const leaves = [];

  const w = {
    /** @param {string} key @returns {string} the font's resource name (F1…) */
    fontName: (key) => fontOf(key).name,
    /**
     * The text's glyphs, one per character (as the engine measured it: no layout features), as hex for <…> Tj, with
     * the glyphs recorded for the subset, W and ToUnicode.
     * @param {string} key @param {string} text
     */
    encode(key, text) {
      const F = fontOf(key);
      let out = '';
      for (const ch of text) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        let h = F.memo.get(cp);
        if (h === undefined) {
          const id = F.font.glyphForCodePoint(cp).id;
          F.memo.set(cp, h = hex4(id));
          F.cps.add(cp);
          if (!F.glyphs.has(id)) F.glyphs.set(id, ch);
        }
        out += h;
      }
      return out;
    },
    /**
     * Shaped glyphs drawn by ID (conjuncts, joined forms): [glyph ID, the text it stands for ('' for none)].
     * @param {string} key @param {Iterable<[number, string]>} glyphs
     */
    addGlyphs(key, glyphs) {
      const F = fontOf(key);
      for (const [id, text] of glyphs) if (!F.glyphs.has(id)) F.glyphs.set(id, text);
    },
    /**
     * A name in the shared Resources dictionary for a value (an indirect ref "12 0 R" or an inline dictionary).
     * @param {'ExtGState'|'XObject'|'Pattern'|'Shading'|'ColorSpace'} kind @param {string} value
     */
    resource(kind, value) {
      let m = res.get(kind);
      if (!m) res.set(kind, m = new Map());
      let n = m.get(value);
      if (!n) m.set(value, n = `${kind === 'ExtGState' ? 'GS' : kind[0]}${m.size + 1}`);
      return n;
    },
    /** The ExtGState name for fill and stroke opacity. @param {number} ca @param {number} CA */
    gs: (ca, CA) => w.resource('ExtGState', `<< /Type /ExtGState /ca ${num(ca)} /CA ${num(CA)} >>`),
    /**
     * Write an object now (an image: its dictionary and its stream, already filtered). @returns {Promise<number>} its number
     * @param {string} dict @param {Uint8Array} [stream]
     */
    async object(dict, stream) { const n = reserve(); await writeObj(n, dict, stream); return n; },
    /** The object number of page i (0-based), written or not: links and outline entries may point ahead. @param {number} i */
    pageRef(i) { return (pageRefs[i] ??= reserve()); },
    /**
     * The total page count, drawn at the end: a Form XObject whose origin is the text's baseline at the box's left;
     * draw it with `q 1 0 0 1 x y cm /<name> Do Q`. align: within width.
     * @param {{ font: string, size: number, width: number, align?: 'left'|'center'|'right', color?: string }} o
     */
    totalPages(o) {
      fontOf(o.font);
      const ref = reserve();
      totals.push({ ref, font: o.font, size: o.size, width: o.width, align: o.align || 'left', color: o.color || '0 0 0' });
      return w.resource('XObject', `${ref} 0 R`);
    },
    /**
     * Write a page: its content stream (deflated) and its dictionary, now. Nothing of it stays but two offsets.
     * @param {{ width: number, height: number, content: string | Uint8Array, annots?: string[] }} p
     *   content: the page's operators (a string holds bytes 0–255, as pdf.js's Content makes). annots: annotation dictionaries.
     */
    async addPage(p) {
      if (done) throw new Error('The PDF is finished');
      const i = pages++;
      const ref = w.pageRef(i);
      if (i % LEAF === 0) leaves.push(reserve());
      const contents = reserve();
      await writeObj(contents, '<< /Filter /FlateDecode >>', deflate(typeof p.content === 'string' ? latin1(p.content) : p.content));
      const annots = [];
      for (const a of p.annots || []) annots.push(await w.object(a));
      await writeObj(ref, `<< /Type /Page /Parent ${leaves[leaves.length - 1]} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources ${resRef} 0 R /Contents ${contents} 0 R${annots.length ? ` /Annots [${annots.map(a => `${a} 0 R`).join(' ')}]` : ''} >>`);
    },
    /**
     * The end of the file: totals, fonts, resources, page tree, outline, catalog, Info, xref, trailer.
     * @param {{ outline?: OutlineEntry[], info?: { title?: string, author?: string, subject?: string, creationDate?: Date } }} [o]
     * @returns {Promise<{ pages: number, bytes: number }>}
     */
    async finish(o = {}) {
      if (done) throw new Error('The PDF is finished');
      done = true;
      if (!pages) await w.addPage({ width: 595.28, height: 841.89, content: '' }); // a PDF has at least one page
      // "of Y": the number's glyphs are recorded before the fonts are subset
      for (const t of totals) {
        const F = fontOf(t.font), text = String(pages), hex = w.encode(t.font, text);
        let adv = 0;
        for (const ch of text) adv += F.font.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).advanceWidth;
        const tw = adv * t.size / F.font.unitsPerEm;
        const dx = t.align === 'right' ? t.width - tw : t.align === 'center' ? (t.width - tw) / 2 : 0;
        await writeObj(t.ref, `<< /Type /XObject /Subtype /Form /BBox [${num(Math.min(0, dx))} ${num(-t.size)} ${num(Math.max(t.width, dx + tw))} ${num(2 * t.size)}] /Resources << /Font << /${F.name} ${F.ref} 0 R >> >> /Filter /FlateDecode >>`,
          deflate(latin1(`${t.color} rg BT /${F.name} ${num(t.size)} Tf ${num(dx)} 0 Td <${hex}> Tj ET`)));
      }
      const fontDict = [];
      for (const [key, F] of fonts) {
        if (F.glyphs.size) { await writeFont(key, F); fontDict.push(`/${F.name} ${F.ref} 0 R`); }
      }
      let resDict = `<< /ProcSet [/PDF /Text /ImageB /ImageC /ImageI] /Font << ${fontDict.join(' ')} >>`;
      for (const [kind, m] of res) resDict += ` /${kind} << ${[...m].map(([v, n]) => `/${n} ${v}`).join(' ')} >>`;
      await writeObj(resRef, resDict + ' >>');

      // the page tree: leaves of LEAF pages (the pages' /Parent), then nodes of LEAF nodes up to one root
      let level = leaves.map((ref, k) => ({ ref, kids: pageRefs.slice(k * LEAF, Math.min(pages, (k + 1) * LEAF)), count: Math.min(LEAF, pages - k * LEAF) }));
      while (level.length > 1) {
        const up = [];
        for (let k = 0; k < level.length; k += LEAF) {
          const kids = level.slice(k, k + LEAF);
          up.push({ ref: reserve(), kids: kids.map(x => x.ref), count: kids.reduce((s, x) => s + x.count, 0), below: kids });
        }
        for (const node of up) for (const kid of node.below) /** @type {any} */ (kid).parent = node.ref;
        await writeNodes(level);
        level = /** @type {any} */ (up);
      }
      await writeNodes(level);
      const pagesRoot = level[0].ref;

      const outline = await writeOutline(o.outline || []);
      const catalog = reserve();
      await writeObj(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R /PageLabels << /Nums [0 << /S /D /St 1 >>] >>${outline ? ` /Outlines ${outline} 0 R /PageMode /UseOutlines` : ''} >>`);
      const info = reserve(), I = o.info || {};
      await writeObj(info, `<< /Producer ${pdfText('ReportWright')} /Creator ${pdfText('ReportWright')} /Title ${pdfText(I.title || 'Report')}${I.author ? ` /Author ${pdfText(I.author)}` : ''}${I.subject ? ` /Subject ${pdfText(I.subject)}` : ''} /CreationDate ${pdfDate(I.creationDate || new Date())} >>`);

      // object numbers reserved and never used (a link to a page that never came): null objects keep the xref whole
      for (let n = 1; n < nextNum; n++) if (offsets[n] === undefined) await writeObj(n, 'null');
      const xref = pos;
      await put(`xref\n0 ${nextNum}\n0000000000 65535 f \n`);
      for (let n = 1; n < nextNum; n++) await put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
      const id = opt.id || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      await put(`trailer\n<< /Size ${nextNum} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`);
      await flush();
      return { pages, bytes: pos };
    },
  };

  /** @param {{ ref: number, kids: number[], count: number, parent?: number }[]} nodes */
  async function writeNodes(nodes) {
    for (const n of nodes) await writeObj(n.ref, `<< /Type /Pages${n.parent ? ` /Parent ${n.parent} 0 R` : ''} /Kids [${n.kids.map(k => `${k} 0 R`).join(' ')}] /Count ${n.count} >>`);
  }

  /**
   * A Type0 font (Identity-H) over the subset (glyph IDs retained), or the whole font when it cannot be subset or its
   * licence forbids it: CIDFontType2 with FontFile2 (TrueType), or CIDFontType0 with FontFile3/OpenType (CFF).
   * @param {string} key @param {NonNullable<ReturnType<typeof fonts.get>>} F
   */
  async function writeFont(key, F) {
    const f = F.font, full = /** @type {Uint8Array} */ (fontStore.bytes.get(key));
    let bytes = full;
    if (opt.subset && !f['OS/2']?.fsType?.noSubsetting) {
      try {
        // glyphs given: subset.js keeps their IDs (HB_SUBSET_FLAGS_RETAIN_GIDS), which the pages already drew with
        const sub = await opt.subset(full, F.cps, { glyphs: F.glyphs.keys() });
        // fontkit must read every glyph we drew (16 zero bytes after the tables, as pdf.js pads); else the full font
        const padded = new Uint8Array(sub.length + 16);
        padded.set(sub);
        const check = fontkit.create(padded);
        for (const id of F.glyphs.keys()) void check.getGlyph(id).advanceWidth;
        bytes = sub;
      } catch { /* the full font */ }
    }
    const cff = 'CFF ' in f.directory.tables || 'CFF2' in f.directory.tables;
    const base = `${bytes === full ? '' : `${subsetTag(bytes)}+`}${String(f.postscriptName || 'Font').replace(/[^A-Za-z0-9_.-]/g, '')}`;
    const k = 1000 / f.unitsPerEm, s = (/** @type {number} */ v) => Math.round(v * k);
    const desc = reserve(), file = reserve(), cid = reserve(), cmap = reserve();
    const fileDict = cff ? '<< /Subtype /OpenType /Filter /FlateDecode >>' : `<< /Length1 ${bytes.length} /Filter /FlateDecode >>`;
    await writeObj(file, fileDict, deflate(bytes));
    const bb = f.bbox, italic = f.italicAngle || 0;
    const flags = (f.post?.isFixedPitch ? 1 : 0) | 4 | (italic ? 64 : 0);
    await writeObj(desc, `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${s(bb.minX)} ${s(bb.minY)} ${s(bb.maxX)} ${s(bb.maxY)}] /ItalicAngle ${num(italic)} /Ascent ${s(f.ascent)} /Descent ${s(f.descent)} /CapHeight ${s(f.capHeight || f.ascent)} /StemV 80 /${cff ? 'FontFile3' : 'FontFile2'} ${file} 0 R >>`);
    // widths: runs of consecutive glyph IDs, "first [w w w]"
    const ids = [...F.glyphs.keys()].sort((a, b) => a - b);
    let W = '';
    for (let i = 0; i < ids.length;) {
      let j = i;
      while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++;
      W += `${ids[i]} [${ids.slice(i, j + 1).map(id => s(f.getGlyph(id).advanceWidth)).join(' ')}] `;
      i = j + 1;
    }
    await writeObj(cid, `<< /Type /Font /Subtype /${cff ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /W [${W}]${cff ? '' : ' /CIDToGIDMap /Identity'} >>`);
    await writeObj(cmap, '<< /Filter /FlateDecode >>', deflate(latin1(toUnicode(F.glyphs))));
    await writeObj(F.ref, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${cmap} 0 R >>`);
  }

  /**
   * The outline, nested by level (an entry is the child of the nearest one before it at a lower level). @returns the root's number
   * @param {OutlineEntry[]} entries
   */
  async function writeOutline(entries) {
    /** @typedef {{ ref: number, level: number, kids: any[], title?: string, dest?: string }} Node */
    /** @type {Node} */
    const root = { ref: 0, level: -1, kids: [] };
    const stack = [root];
    for (const e of entries) {
      if (!(e.page >= 1 && e.page <= pages)) continue;
      const level = Math.max(0, Math.min(9, Number(e.level) || 0));
      while (stack[stack.length - 1].level >= level) stack.pop();
      /** @type {Node} */
      const node = { ref: reserve(), level, kids: [], title: e.title, dest: `[${pageRefs[e.page - 1]} 0 R ${e.top == null ? '/Fit' : `/XYZ null ${num(e.top)} null`}]` };
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    }
    if (!root.kids.length) return 0;
    root.ref = reserve();
    /** @param {Node} n @returns {number} */
    const count = (n) => n.kids.reduce((t, c) => t + 1 + count(c), 0);
    /** @param {Node} n */
    const children = (n) => (n.kids.length ? ` /First ${n.kids[0].ref} 0 R /Last ${n.kids[n.kids.length - 1].ref} 0 R /Count ${count(n)}` : '');
    /** @param {Node} n @returns {Promise<void>} */
    const write = async (n) => {
      for (let i = 0; i < n.kids.length; i++) {
        const c = n.kids[i];
        await writeObj(c.ref, `<< /Title ${pdfText(c.title)} /Parent ${n.ref} 0 R /Dest ${c.dest}${i ? ` /Prev ${n.kids[i - 1].ref} 0 R` : ''}${i < n.kids.length - 1 ? ` /Next ${n.kids[i + 1].ref} 0 R` : ''}${children(c)} >>`);
        await write(c);
      }
    };
    await write(root);
    await writeObj(root.ref, `<< /Type /Outlines${children(root)} >>`);
    return root.ref;
  }

  return w;
}

/** ToUnicode: each glyph to the text it stands for (UTF-16BE); glyphs that stand for nothing are left out. @param {Map<number, string>} glyphs */
function toUnicode(glyphs) {
  const entries = [...glyphs].filter(([, t]) => t).sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n${chunk.map(([id, t]) => `<${hex4(id)}> <${utf16(t)}>`).join('\n')}\nendbfchar\n`;
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

/** UTF-16BE hex of a string (surrogate pairs as they are in JS). @param {string} t */
const utf16 = (t) => { let h = ''; for (let i = 0; i < t.length; i++) h += hex4(t.charCodeAt(i)); return h; };
/** a text string for Info and the outline: UTF-16BE with its byte-order mark, as hex (nothing to escape) @param {any} t */
const pdfText = (t) => `<feff${utf16(String(t ?? ''))}>`;
/** @param {Date} d */
const pdfDate = (d) => `(D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z)`;

/** Six capital letters from the subset's bytes (FNV-1a), as pdf.js names its subsets. @param {Uint8Array} bytes */
function subsetTag(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  let tag = '';
  for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + ((h >>> 0) % 26)); h = Math.imul(h ^ i, 16777619) >>> 0; }
  return tag;
}

/** one byte per char (a content stream's strings hold glyph bytes as chars 0–255) @param {string} s */
function latin1(s) {
  const B = /** @type {any} */ (globalThis).Buffer;
  if (B) return B.from(s, 'latin1');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * A report to PDF bytes written to sink as its pages are laid out (planPaged: a flowing table, one window of rows at a
 * time), else rendered whole and exported by exportPdf, the same file it always was, written to sink in one piece.
 * opts: render()'s options and exportPdf's (fontStore, subset, title, author, creationDate, drillBase…). Tagged,
 * PDF/A, encrypted and signed files take the whole-model path.
 * @param {any} def @param {any} opts @param {Sink} sink
 * @returns {Promise<{ streamed: boolean, pages: number, warnings: string[], why?: string }>}
 */
export async function exportPdfStream(def, opts, sink) {
  const why = opts.tagged ? 'tagged' : opts.pdfa ? 'PDF/A' : opts.encrypt ? 'encrypted' : opts.prepare ? 'signed' : opts.save ? 'save options' : null;
  const plan = why ? { why } : await planPaged(def, opts);
  if (plan.why !== undefined) {
    const model = await render(def, opts);
    const bytes = await exportPdf(model, opts.fontStore, opts);
    const r = sink.write(bytes);
    if (r === false && sink.once) await new Promise((ok) => /** @type {any} */ (sink).once('drain', ok)); else await r;
    return { streamed: false, pages: model.pages.length, warnings: model.warnings, why: plan.why };
  }
  const { fontStore } = opts;
  const w = createPdfStream(sink, { fontStore, subset: opts.subset });
  /** @type {Map<string, any>} pdf-lib-like fonts for the shared painter: { key, embedder: { font } } */
  const pfs = new Map();
  const pf = (/** @type {string} */ key) => { let f = pfs.get(key); if (!f) pfs.set(key, f = { key, embedder: { font: fontStore.get(key) } }); return f; };
  /** @type {Map<string, Map<number, string>>} shaped glyphs per font: the text each stands for */
  const shaped = new Map();
  const shapedOf = (/** @type {string} */ key) => { let g = shaped.get(key); if (!g) shaped.set(key, g = new Map()); return g; };
  const shared = { font: (f) => w.fontName(f.key), gs: (ca, CA) => w.gs(ca, CA), image: () => { throw new Error('images do not stream yet'); } };
  const vm = new Map();
  const vmetrics = (key) => {
    let m = vm.get(key);
    if (!m) { const f = fontStore.get(key), u = f?.unitsPerEm || 1000; vm.set(key, m = { asc: (f?.ascent ?? u) / u, desc: -(f?.descent ?? 0) / u }); }
    return m;
  };
  const { info, pages } = /** @type {any} */ (plan);
  for await (const pg of pages()) {
    const H = pg.height ?? info.height, annots = [];
    const c = new Content(shared);
    for (const it of pg.items) {
      if ((it.t !== 'text' && it.t !== 'line') || it.rotate) c.et();
      if (it.rotate) {
        const t = -it.rotate.a * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
        const px = it.rotate.cx, py = H - it.rotate.cy;
        c.q();
        c.s += `${n4(cs)} ${n4(sn)} ${n4(-sn)} ${n4(cs)} ${n2(px - px * cs + py * sn)} ${n2(py - px * sn - py * cs)} cm\n`;
      }
      switch (it.t) {
        case 'rect': {
          const fill = col(it.fill), stroke = col(it.stroke);
          if (!fill && !stroke) break;
          if (it.radius) throw new Error('rounded boxes do not stream yet');
          c.paint(fill, stroke, it.strokeWidth || 1, it.dash);
          const x = n2(it.x), y = n2(H - it.y - it.h), rw = n2(it.w), rh = n2(it.h);
          c.s += (stroke && it.dash?.length ? `${x} ${y} m ${x} ${n2(y + rh)} l ${n2(x + rw)} ${n2(y + rh)} l ${n2(x + rw)} ${y} l h` : `${x} ${y} ${rw} ${rh} re`) + (fill && stroke ? ' B\n' : fill ? ' f\n' : ' S\n');
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
          const st = col(it.stroke);
          if (st) c.line(st, it.strokeWidth || 1, it.dash, it.x1, H - it.y1, it.x2, H - it.y2);
          break;
        }
        case 'text': {
          const color = col(it.color) || BLACK;
          const clipped = it.clip && !insideClip(it, vmetrics(it.font));
          if (clipped) { c.q(); c.s += `${n2(it.clip.x)} ${n2(H - it.clip.y - it.clip.h)} ${n2(it.clip.w)} ${n2(it.clip.h)} re W n\n`; }
          for (const l of it.lines) {
            if (!l.runs) { c.text(pf(it.font), it.size, color, l.x, H - l.y, `<${w.encode(it.font, cleanText(l.text))}>`, true); continue; }
            for (const r of l.runs) {
              const g = shapedOf(r.font), spans = new WeakMap();
              glyphText(r, fontStore.get(r.font), g, spans);
              if (r.text.trim()) drawRun(c, r, l.x + r.x, H - l.y, it.size, pf(r.font), color, spans.get(r), g);
            }
          }
          if (clipped) c.Q();
          break;
        }
        case 'link': {
          const rect = `[${[it.x, H - it.y - it.h, it.x + it.w, H - it.y].map(n2).join(' ')}]`;
          const a = it.action;
          const href = a?.type === 'url' && safeUrl(a.href) ? a.href : a?.type === 'drill' ? drillUrl(opts.drillBase, a) : null;
          if (href) annots.push(`<< /Type /Annot /Subtype /Link /F 4 /Rect ${rect} /Border [0 0 0] /A << /Type /Action /S /URI /URI (${asciiUrl(href).replace(/[\\()]/g, '\\$&')}) >> >>`);
          else if (a?.type === 'bookmark' && a.page) annots.push(`<< /Type /Annot /Subtype /Link /F 4 /Rect ${rect} /Border [0 0 0] /Dest [${w.pageRef(a.page - 1)} 0 R /XYZ null ${n2(H - a.y + 4)} null] >>`);
          break; // ponytail: a jump to a bookmark by name needs every page's bookmarks first: left out while streaming
        }
        default: throw new Error(`A ${it.t} item does not stream yet`);
      }
      if (it.rotate) c.Q();
    }
    c.et();
    await w.addPage({ width: pg.width ?? info.width, height: H, content: c.s, annots });
  }
  for (const [key, g] of shaped) w.addGlyphs(key, g);
  // the outline as exportPdf makes it: bookmarks and headings in page order, each entry once
  const seen = new Set();
  const outline = [...info.bookmarks, ...info.headings].map((b, i) => ({ b, i }))
    .sort((p, q) => p.b.page - q.b.page || (p.b.y ?? 0) - (q.b.y ?? 0) || p.i - q.i).map(({ b }) => b)
    .filter((b) => { const k = `${b.page}|${Math.round(b.y ?? 0)}|${b.label}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(b => ({ title: b.label, page: b.page, top: info.height - b.y + 4, level: b.level }));
  const res = await w.finish({ outline, info: { title: opts.title || 'Report', author: opts.author, creationDate: opts.creationDate } });
  return { streamed: true, pages: res.pages, warnings: info.warnings };
}
