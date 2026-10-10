// @ts-check
/**
 * A PDF written as it is made (docs/research/STREAMING-1M.md §6): each page's objects go to the sink as soon as the
 * page is added, and only their places stay, so memory does not grow with the pages. What must come last is
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
 * The writer itself has no encryption, forms or signing (those stay on exportPdf, pdf.js); PDF/A and tagging (PDF/UA)
 * are added by writePagedPdf (pdfstreamtags.js, the XMP and output intent).
 */
import { fontkit, loadFontkit } from '../engine/lazylibs.js';
import { Zlib, deflateSync, inflateSync } from '@reportwright/pdf/fflate';
import { render } from '../engine/index.js';
import { planPaged } from '../engine/paged.js';
import { sqlBatches } from '../engine/stream.js';
import { safeUrl, drillUrl, asciiUrl } from '../engine/url.js';
import { exportPdf, forcedPdfLib } from './pdf.js';
import { xmpPacket } from './pdfa.js';
import { createStreamTagger } from './pdfstreamtags.js';
import { standardFontDict, embeddedPage, embeddedWarnings, standIns } from './pdfstandard.js';
import { Content, drawRun, glyphText, insideClip, col, BLACK, n2, n4, KAPPA, cleanText, deflate } from './pdfpaint.js';
import { dataUriBytesOf, dataUriBytes, imageInfoOf, IMAGE_LIMITS } from '../engine/image.js';
import { pngProblem } from './png.js';

const CHUNK = 64 * 1024;
const LEAF = 64; // pages per node of the page tree
const OBJSTM = 100; // small objects per object stream
const XBITS = 14, XB = 1 << XBITS; // cross-reference entries per block
const TAGGED_LARGE = 1000000; // structure elements past which a tagged file's result warns (about 120,000 table rows)
const IN_FLIGHT = 8; // pages compressing at once (zlib's 4 threads busy, the next drawn meanwhile)
const hex4 = (/** @type {number} */ id) => id.toString(16).padStart(4, '0');
const num = (/** @type {number} */ v) => String(Math.round(v * 1000) / 1000);
/** a font's resource name, from its key: the same in every writer */
const fontRes = (/** @type {string} */ key) => `F_${key.replace(/[^A-Za-z0-9.-]/g, '_')}`;
/** a byte in a literal string: ( ) \\ escaped, CR as \\r (a bare CR would read as a line end) */
const esc = (/** @type {number} */ b) => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b === 0x0d ? '\\r' : String.fromCharCode(b));

/**
 * @typedef {{ write(u8: Uint8Array): any, once?: (ev: string, cb: () => void) => any }} Sink
 *   write may return a promise (awaited: back-pressure), or false with a 'drain' event to wait for (a Node Writable).
 * @typedef {{ title: string, page: number, top?: number, level?: number }} OutlineEntry
 *   page: 1-based; top: the destination's y in PDF space (from the bottom), else the page fits the window.
 */

/**
 * What sink.write(bytes) returned, waited for: a promise, or false and the 'drain' event (a Node Writable; its 'error'
 * or 'close' ends the wait too, with an error, so a destroyed sink does not leave the export waiting forever).
 * @param {Sink} sink @param {any} r
 */
function written(sink, r) {
  const s = /** @type {any} */ (sink);
  if (r !== false || !s.once) return Promise.resolve(r);
  return new Promise((ok, fail) => {
    const off = () => { s.off?.('drain', onDrain); s.off?.('error', onError); s.off?.('close', onClose); };
    const onDrain = () => { off(); ok(undefined); };
    const onError = (/** @type {any} */ e) => { off(); fail(e); };
    const onClose = () => { off(); fail(Object.assign(new Error('The sink closed before the PDF was written'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })); };
    s.once('drain', onDrain); s.once('error', onError); s.once('close', onClose);
  });
}
/**
 * p, or signal's reason as soon as it aborts (p goes on, unwatched).
 * @template T @param {Promise<T>} p @param {AbortSignal} [signal] @returns {Promise<T>}
 */
export function raced(p, signal) {
  if (!signal) return p;
  if (signal.aborted) { p.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((ok, fail) => {
    const on = () => fail(signal.reason);
    signal.addEventListener('abort', on, { once: true });
    p.then((v) => { signal.removeEventListener('abort', on); ok(v); }, (e) => { signal.removeEventListener('abort', on); fail(e); });
  });
}

/**
 * @param {Sink} sink
 * @param {{ fontStore: import('../engine/text/fonts.js').FontStore, fonts?: string[],
 *   subset?: (font: Uint8Array, codePoints: Iterable<number>, opt?: { glyphs?: Iterable<number> }) => Promise<Uint8Array>,
 *   id?: string, signal?: AbortSignal, pdf?: any, onWarning?: (message: string) => void }} opt
 *   fonts: font keys to name now (F1, F2… in this order); any other font is named on first use.
 *   subset: subset.js's subsetter; without it fonts embed in full. id: the file ID (32 hex digits), else random.
 *   signal: stops a wait for the sink (back-pressure) when it aborts. pdf: a @reportwright/pdf document (createPdf) that
 *   writes the objects, pages and the file's end instead of this writer's own (the sink is then unused).
 *   onWarning: a font embedded whole because its subset could not be used.
 */
export function createPdfStream(sink, opt) {
  const { fontStore } = opt;
  /** the @reportwright/pdf document (opt.pdf's extension API): objects, pages and the file's end go through it */
  const core = opt.pdf?.core;
  let pos = 0, nextNum = 0;
  // where each object is: kind 1 at byte loc, 2 in object stream loc at index idx, 3 waiting for its object stream; in
  // blocks of XB numbers (7 bytes an object). A tagged file has an element per table cell, millions of objects (N44): a
  // block the numbers have gone two past is deflated (a few KB), and what is placed in it later (a page-tree node, the
  // structure tree's root) is kept apart in `late`, one number each
  /** @type {({ kind: Uint8Array, loc: Uint32Array, idx: Uint16Array } | Uint8Array)[]} */
  const blocks = [];
  /** @type {Map<number, number>} object → kind · 2^48 + loc · 2^16 + idx, for a block already deflated */
  const late = new Map();
  let packed = 0; // bytes of the deflated blocks
  const place = (/** @type {number} */ n, /** @type {number} */ k, /** @type {number} */ l, i = 0) => {
    const b = blocks[n >>> XBITS];
    if (b instanceof Uint8Array) { late.set(n, k * 2 ** 48 + l * 2 ** 16 + i); return; }
    const j = n & (XB - 1);
    b.kind[j] = k; b.loc[j] = l; b.idx[j] = i;
  };
  const reserve = () => {
    if (core) return core.reserve();
    const n = nextNum++;
    if (!(n & (XB - 1))) {
      blocks.push({ kind: new Uint8Array(XB), loc: new Uint32Array(XB), idx: new Uint16Array(XB) });
      const old = blocks.length - 3, b = blocks[old];
      if (old > 0 && !(b instanceof Uint8Array)) { // block 0: object 0 and the file's first objects, kept open
        for (let j = 0; j < XB; j++) if (b.kind[j] !== 1 && b.kind[j] !== 2) late.set(old * XB + j, b.kind[j] * 2 ** 48);
        const raw = new Uint8Array(XB * 7);
        raw.set(b.kind); raw.set(new Uint8Array(b.loc.buffer), XB); raw.set(new Uint8Array(b.idx.buffer), XB * 5);
        packed += (blocks[old] = deflateSync(raw, { level: 1 })).length;
      }
    }
    return n;
  };
  /** @type {[number, any]} the block last opened for reading */
  let reading = [-1, null];
  /** where object n is: [kind, loc, idx] @param {number} n */
  const where = (n) => {
    const v = late.get(n);
    if (v !== undefined) return [Math.floor(v / 2 ** 48), Math.floor(v / 2 ** 16) % 2 ** 32, v % 2 ** 16];
    const bi = n >>> XBITS, j = n & (XB - 1);
    const z = blocks[bi];
    if (z instanceof Uint8Array && reading[0] !== bi) { const raw = inflateSync(z); reading = [bi, { kind: raw.subarray(0, XB), loc: new Uint32Array(raw.buffer, raw.byteOffset + XB, XB), idx: new Uint16Array(raw.buffer, raw.byteOffset + XB * 5, XB) }]; }
    const b = z instanceof Uint8Array ? reading[1] : z;
    return [b.kind[j], b.loc[j], b.idx[j]];
  };
  if (!core) reserve(); // object 0: free
  /** @type {Uint8Array[]} */
  let parts = [];
  let size = 0;

  const flush = async () => {
    if (!size) return;
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    parts = []; size = 0;
    await raced(written(sink, sink.write(all)), opt.signal);
  };
  /** @param {string | Uint8Array} x */
  const put = (x) => {
    const u8 = typeof x === 'string' ? latin1(x) : x;
    parts.push(u8); size += u8.length; pos += u8.length;
    return size >= CHUNK ? flush() : undefined;
  };
  /** @type {[number, string][]} small objects waiting for their object stream */
  let batch = [];
  /** an object stream of the waiting objects */
  const writeBatch = async () => {
    if (!batch.length) return;
    const b = batch; batch = [];
    const sn = reserve();
    let head = '', body = '';
    b.forEach(([n, d], i) => { head += `${n} ${body.length} `; body += `${d}\n`; place(n, 2, sn, i); });
    const raw = latin1(head + body);
    await writeObj(sn, `<< /Type /ObjStm /N ${b.length} /First ${head.length} /Filter /FlateDecode >>`, await deflate(raw));
  };
  /** an object: its dictionary (or any value), and its stream's bytes (already filtered) */
  /** @param {number} n @param {string} dict @param {Uint8Array} [stream] */
  const writeObj = async (n, dict, stream) => {
    if (core) return core.write(n, dict, stream);
    if (!stream) { // small objects go into object streams, OBJSTM at a time (compressed together, as pdf-lib saves)
      batch.push([n, dict]);
      place(n, 3, 0); // placed when its object stream is written
      return batch.length >= OBJSTM ? writeBatch() : undefined;
    }
    place(n, 1, pos);
    await put(`${n} 0 obj\n${dict.replace(/>>\s*$/, `/Length ${stream.length} >>`)}\nstream\n`);
    await put(stream);
    return put('\nendstream\nendobj\n');
  };
  if (!core) put('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');

  // fonts: a resource name and the Type0 font's object number each, now; their glyphs are recorded as pages draw
  /** @type {Map<string, { name: string, ref: number, font: any, cps: Set<number>, glyphs: Map<number, string>, memo: Map<number, string>, lit: Map<number, string> }>} */
  const fonts = new Map();
  let pages = 0, done = false;
  /** @type {any[]} pages whose streams are compressing */
  const inFlight = [];
  /** a font's record: its resource name and Type0 object number are reserved on first use (its objects come at the end) */
  const fontOf = (/** @type {string} */ key) => {
    let f = fonts.get(key);
    if (!f) {
      if (done) throw new Error('The PDF is finished');
      fonts.set(key, f = { name: fontRes(key), ref: reserve(), font: fontStore.get(key), cps: new Set([32]), glyphs: new Map(), memo: new Map(), lit: new Map() });
    }
    return f;
  };

  const resRef = core ? core.resourcesRef : reserve();
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
          F.memo.set(cp, h = F.font.standard ? id.toString(16).padStart(2, '0') : hex4(id)); // a standard font: one byte
          F.cps.add(cp);
          if (!F.glyphs.has(id)) F.glyphs.set(id, ch);
        }
        out += h;
      }
      return out;
    },
    /**
     * The same glyphs as a literal string's body, two bytes each, escaped (as pdf.js draws plain text): ( … ) Tj.
     * @param {string} key @param {string} text
     */
    literal(key, text) {
      const F = fontOf(key);
      let out = '';
      // Latin-1 text (most of a table): each character's escaped bytes from a table, no Map, no string iterator
      const L = (/** @type {any} */ (F).lat ||= new Array(256));
      let i = 0;
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c > 255) break;
        let b = L[c];
        if (b === undefined) {
          const id = parseInt(w.encode(key, String.fromCharCode(c)), 16);
          L[c] = b = F.font.standard ? esc(id) : esc(id >> 8) + esc(id & 255);
        }
        out += b;
      }
      if (i === text.length) return out;
      text = text.slice(i);
      for (const ch of text) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        let b = F.lit.get(cp);
        if (b === undefined) {
          const id = parseInt(w.encode(key, ch), 16);
          F.lit.set(cp, b = F.font.standard ? esc(id) : esc(id >> 8) + esc(id & 255));
        }
        out += b;
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
    resource(kind, value, name = undefined) {
      if (core) return core.resource(kind, value, name);
      let m = res.get(kind);
      if (!m) res.set(kind, m = new Map());
      let n = m.get(value);
      if (!n) m.set(value, n = name || `${kind === 'ExtGState' ? 'GS' : kind[0]}${m.size + 1}`);
      return n;
    },
    /**
     * The ExtGState name for fill and stroke opacity, named by its values (the same name in every writer: pages
     * painted elsewhere, parallel.js, use it too). @param {number} ca @param {number} CA
     */
    gs: (ca, CA) => w.resource('ExtGState', `<< /Type /ExtGState /ca ${num(ca)} /CA ${num(CA)} >>`, `GS${num(ca)}_${num(CA)}`),
    /**
     * A PNG or JPEG through @reportwright/pdf (not the legacy writer), written now: its name in the shared Resources,
     * its size in pixels upright (EXIF orientation applied) and that orientation as a unit-square matrix.
     * @param {Uint8Array} bytes @param {any} [o] embedImage's options
     */
    async image(bytes, o) {
      if (!core) throw new Error('images need the @reportwright/pdf writer');
      const img = await /** @type {any} */ (opt.pdf).embedImage(bytes, o);
      const r = core.imageResource(img);
      return { name: r.name, width: img.width, height: img.height, orientation: r.orientation };
    },
    /** What this writer's pages used, for another writer to take over (pages painted elsewhere). */
    used: () => ({ fonts: [...fonts].map(([key, F]) => [key, [...F.cps], [...F.glyphs]]), gs: [...(res.get('ExtGState')?.keys() || [])] }),
    /** Take over what pages painted elsewhere used (used() of their writer). @param {any} u */
    take(u) {
      for (const [key, cps, glyphs] of u.fonts) { const F = fontOf(key); for (const cp of cps) F.cps.add(cp); for (const [id, t] of glyphs) if (!F.glyphs.has(id)) F.glyphs.set(id, t); }
      for (const v of u.gs) { const m = /** @type {any} */ (v).match(/\/ca (\S+) \/CA (\S+)/); w.gs(Number(m[1]), Number(m[2])); }
    },
    /**
     * Write an object now (an image: its dictionary and its stream, already filtered). @returns {Promise<number>} its number
     * @param {string} dict @param {Uint8Array} [stream]
     */
    async object(dict, stream) { const n = reserve(); await writeObj(n, dict, stream); return n; },
    /** Bytes held for the cross-reference: the open blocks, the deflated ones, the late entries (a Map's ~40 each). */
    get xrefBytes() { return blocks.reduce((t, b) => t + (b instanceof Uint8Array ? 0 : XB * 7), packed + late.size * 40); },
    /** An object number to write later (objectAt). */
    reserve: () => reserve(),
    /** Write a reserved object. @param {number} n @param {string} dict @param {Uint8Array} [stream] */
    objectAt: (n, dict, stream) => writeObj(n, dict, stream),
    /**
     * Write a reserved object whose text may be long (an array of every row's element): head, the parts as they come,
     * tail; written out in place, never held whole. @param {number} n @param {string} head @param {Iterable<string>} parts @param {string} tail
     */
    async bigObject(n, head, parts, tail) {
      if (core) return core.writeBig(n, head, parts, tail);
      place(n, 1, pos);
      await put(`${n} 0 obj\n${head}`);
      for (const x of parts) await put(x);
      await put(`${tail}\nendobj\n`);
    },
    /** The object number of page i (0-based), written or not: links and outline entries may point ahead. @param {number} i */
    pageRef(i) { return core ? core.pageRef(i) : (pageRefs[i] ??= reserve()); },
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
     * @param {{ width: number, height: number, content?: string | Uint8Array, deflated?: Uint8Array, annots?: (string | { ref: number, dict: string })[], extra?: string }} p
     *   deflated: the content stream already compressed (zlib), as pages painted elsewhere come.
     *   content: the page's operators (a string holds bytes 0–255, as pdf.js's Content makes). annots: annotation
     *   dictionaries (with a reserved number: { ref, dict }). extra: more entries for the page dictionary (/StructParents 3).
     */
    async addPage(p) {
      if (done) throw new Error('The PDF is finished');
      const i = pages++;
      if (core) return corePage(p);
      const ref = w.pageRef(i);
      if (i % LEAF === 0) leaves.push(reserve());
      const contents = reserve(), parent = leaves[leaves.length - 1];
      // the stream compresses on zlib's threads while the next pages are drawn: a few pages wait, in order
      const z = p.deflated ? Promise.resolve(p.deflated) : deflate(typeof p.content === 'string' ? latin1(p.content) : p.content);
      z.catch(() => {}); // awaited (and thrown) when the page is written
      inFlight.push({ ref, contents, parent, p: { width: p.width, height: p.height, annots: p.annots, extra: p.extra }, z });
      while (inFlight.length > IN_FLIGHT) await writeNext();
    },
    /**
     * The end of the file: totals, fonts, resources, page tree, outline, catalog, Info, xref, trailer.
     * @param {{ outline?: OutlineEntry[], info?: { title?: string, author?: string, subject?: string, creationDate?: Date }, catalog?: string, pageStarts?: number[] }} [o]
     *   catalog: more entries for the catalog (the structure tree, metadata, output intents). pageStarts: the pages
     *   (0-based) where the numbering restarts at 1 (the page labels).
     * @returns {Promise<{ pages: number, bytes: number }>}
     */
    async finish(o = {}) {
      if (done) throw new Error('The PDF is finished');
      if (!pages) await w.addPage({ width: 595.28, height: 841.89, content: '' }); // a PDF has at least one page
      while (inFlight.length) await writeNext();
      done = true;
      if (core) return coreFinish(o);
      // "of Y": the number's glyphs are recorded before the fonts are subset
      for (const t of totals) await writeTotal(t);
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
      await writeObj(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R /PageLabels ${pageLabels(o.pageStarts, pages)}${outline ? ` /Outlines ${outline} 0 R /PageMode /UseOutlines` : ''}${o.catalog || ''} >>`);
      const info = reserve();
      await writeObj(info, infoDict(o.info));

      // object numbers reserved and never used (a link to a page that never came): null objects keep the xref whole
      for (let n = 1; n < nextNum; n++) if (!where(n)[0]) await writeObj(n, 'null');
      await writeBatch();
      // a cross-reference stream (object streams need one): per object its type, offset or object stream, index
      const xn = reserve(), size = nextNum, xref = pos;
      place(xn, 1, xref);
      // compressed a block of entries at a time (fflate's streaming zlib): never all the entries at once
      const out = /** @type {Uint8Array[]} */ ([]);
      const zs = new Zlib({ level: 6 }, (d) => { out.push(d); });
      // each entry filtered by PNG's Up predictor (/Predictor 12: a filter byte, then each byte less the one above): the
      // offsets and object stream numbers that change little row to row compress to almost nothing
      const prev = new Uint8Array(7), row = new Uint8Array(7);
      for (let from = 0; from < size; from += 65536) {
        const to = Math.min(size, from + 65536), rows = new Uint8Array((to - from) * 8);
        for (let n = from; n < to; n++) {
          row.fill(0);
          if (n === 0) { row[5] = 0xff; row[6] = 0xff; } // object 0: free
          else {
            const [k, l, i] = where(n);
            row[0] = k; row[1] = l >>> 24 & 255; row[2] = l >>> 16 & 255; row[3] = l >>> 8 & 255; row[4] = l & 255;
            if (k === 2) { row[5] = i >> 8; row[6] = i & 255; }
          }
          const at = (n - from) * 8;
          rows[at] = 2; // Up
          for (let b = 0; b < 7; b++) { rows[at + 1 + b] = (row[b] - prev[b]) & 255; prev[b] = row[b]; }
        }
        zs.push(rows, to === size);
      }
      let zn = 0; for (const c of out) zn += c.length;
      const z = new Uint8Array(zn); zn = 0; for (const c of out) { z.set(c, zn); zn += c.length; }
      const id = opt.id || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      await put(`${xn} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /DecodeParms << /Columns 7 /Predictor 12 >> /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] /Filter /FlateDecode /Length ${z.length} >>\nstream\n`);
      await put(z);
      await put(`\nendstream\nendobj\nstartxref\n${xref}\n%%EOF\n`);
      await flush();
      return { pages, bytes: pos };
    },
  };

  /**
   * A page through @reportwright/pdf: the engine's operators (or a worker's compressed stream) as its content, its
   * annotations and entries; the writer compresses and writes it in order. @param {any} p
   */
  async function corePage(p) {
    const page = /** @type {any} */ (opt.pdf).addPage({ width: p.width, height: p.height });
    // ponytail: the page's own content builder is replaced by our stream, compressed by pdfpaint's deflate (level 9, as
    // the paint workers compress theirs: a parallel export stays the same file, byte for byte)
    const z = p.deflated ? Promise.resolve(p.deflated) : deflate(typeof p.content === 'string' ? latin1(p.content) : p.content || new Uint8Array(0));
    z.catch(() => {});
    page.content = { s: ' ', end: () => '' };
    for (const a of p.annots || []) {
      const ref = typeof a === 'string' ? core.reserve() : a.ref, dict = typeof a === 'string' ? a : a.dict;
      page.annots.push({ ref, make: () => dict });
    }
    for (const [k, v] of dictEntries(p.extra || '')) page.entries.set(k, v);
    const ended = page.end();
    page.z = z; // set before the writer reads it (queued, written in turn)
    await ended;
  }
  /** The end through @reportwright/pdf: "of Y", fonts, outline in its finisher; Info and catalog entries as ours. @param {any} o */
  async function coreFinish(o) {
    core.onFinish(async () => {
      for (const t of totals) await writeTotal(t);
      for (const [key, F] of fonts) if (F.glyphs.size) { await writeFont(key, F); core.resource('Font', `${F.ref} 0 R`, F.name); }
      const outline = await writeOutline(o.outline || []);
      if (outline) { core.catalog('Outlines', `${outline} 0 R`); core.catalog('PageMode', '/UseOutlines'); }
    });
    core.catalog('PageLabels', pageLabels(o.pageStarts, Math.max(1, pages)));
    for (const [k, v] of dictEntries(o.catalog || '')) core.catalog(k, v);
    core.info = infoDict(o.info);
    const r = await /** @type {any} */ (opt.pdf).end();
    return { pages: r.pages, bytes: r.bytes };
  }

  /** the oldest page waiting for its compressed stream: written, stream and dictionary */
  async function writeNext() {
    const { ref, contents, parent, p, z } = /** @type {any} */ (inFlight.shift());
    await writeObj(contents, '<< /Filter /FlateDecode >>', await z);
    const annots = [];
    for (const a of p.annots || []) annots.push(typeof a === 'string' ? await w.object(a) : (await writeObj(a.ref, a.dict), a.ref));
    await writeObj(ref, `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources ${resRef} 0 R /Contents ${contents} 0 R${annots.length ? ` /Annots [${annots.map(a => `${a} 0 R`).join(' ')}]` : ''}${p.extra || ''} >>`);
  }

  /** "of Y": the total's form XObject (the number's glyphs are recorded before the fonts are subset) @param {typeof totals[number]} t */
  async function writeTotal(t) {
    const F = fontOf(t.font), text = String(pages), hex = w.encode(t.font, text);
    let adv = 0;
    for (const ch of text) adv += F.font.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).advanceWidth;
    const tw = adv * t.size / F.font.unitsPerEm;
    const dx = t.align === 'right' ? t.width - tw : t.align === 'center' ? (t.width - tw) / 2 : 0;
    await writeObj(t.ref, `<< /Type /XObject /Subtype /Form /BBox [${num(Math.min(0, dx))} ${num(-t.size)} ${num(Math.max(t.width, dx + tw))} ${num(2 * t.size)}] /Resources << /Font << /${F.name} ${F.ref} 0 R >> >> /Filter /FlateDecode >>`,
      await deflate(latin1(`${t.color} rg BT /${F.name} ${num(t.size)} Tf ${num(dx)} 0 Td <${hex}> Tj ET`)));
  }

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
    if (F.font.standard) { await writeObj(F.ref, standardFontDict(F.font)); return; } // named, not embedded (pdfstandard.js)
    const f = F.font, full = /** @type {Uint8Array} */ (fontStore.bytes.get(key));
    if (!f.lite) await loadFontkit(); // checks a subset (a font read by sfnt.js checks it the same way, without fontkit)
    let bytes = full, psName = f.postscriptName; // N10: a subset of a variable font says the weight it is cut at
    if (opt.subset && !(f.lite ? f.noSubsetting : f['OS/2']?.fsType?.noSubsetting)) {
      try {
        // glyphs given: subset.js keeps their IDs (HB_SUBSET_FLAGS_RETAIN_GIDS), which the pages already drew with
        const sub = await opt.subset(full, F.cps, { glyphs: F.glyphs.keys() });
        const why = (await import('../engine/text/sfnt.js')).subsetProblem(sub); // a cut or damaged subset: the full font
        if (why) throw new Error(why);
        // fontkit must read every glyph we drew (16 zero bytes after the tables, as pdf.js pads); else the full font
        const padded = new Uint8Array(sub.length + 16);
        padded.set(sub);
        const check = (f.lite && (await import('../engine/text/sfnt.js')).liteFont(padded, () => { throw new Error('subset: not read by sfnt.js'); })) || (await loadFontkit(), fontkit.create(padded));
        for (const id of F.glyphs.keys()) { if (check.lite && id >= check.numGlyphs) throw new Error('subset: glyph missing'); void check.getGlyph(id).advanceWidth; }
        bytes = sub;
        psName = check.postscriptName || psName;
      } catch (e) { opt.onWarning?.(`The font ${f.postscriptName || key} is embedded whole: its subset could not be used (${/** @type {any} */ (e)?.message || e})`); }
    }
    const cff = 'CFF ' in f.directory.tables || 'CFF2' in f.directory.tables;
    const base = `${bytes === full ? '' : `${subsetTag(bytes)}+`}${String(psName || 'Font').replace(/[^A-Za-z0-9_.-]/g, '')}`;
    // metrics and widths unrounded in 1/1000 em, as pdf-lib writes them (readers that place text by them agree)
    const k = 1000 / f.unitsPerEm, s = (/** @type {number} */ v) => String(v * k);
    const desc = reserve(), file = reserve(), cid = reserve(), cmap = reserve();
    const fileDict = cff ? '<< /Subtype /OpenType /Filter /FlateDecode >>' : `<< /Length1 ${bytes.length} /Filter /FlateDecode >>`;
    await writeObj(file, fileDict, await deflate(bytes));
    const bb = f.bbox, italic = f.italicAngle || 0;
    const flags = ((f.lite ? f.fixedPitch : f.post?.isFixedPitch) ? 1 : 0) | 4 | (italic ? 64 : 0);
    await writeObj(desc, `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${s(bb.minX)} ${s(bb.minY)} ${s(bb.maxX)} ${s(bb.maxY)}] /ItalicAngle ${num(italic)} /Ascent ${s(f.ascent)} /Descent ${s(f.descent)} /CapHeight ${s(f.capHeight || f.ascent)} /XHeight ${s(f.xHeight || 0)} /StemV 0 /${cff ? 'FontFile3' : 'FontFile2'} ${file} 0 R >>`);
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
    await writeObj(cmap, '<< /Filter /FlateDecode >>', await deflate(latin1(toUnicode(F.glyphs))));
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
      const node = { ref: reserve(), level, kids: [], title: e.title, dest: `[${w.pageRef(e.page - 1)} 0 R ${e.top == null ? '/Fit' : `/XYZ null ${num(e.top)} null`}]` };
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

/** The Info dictionary (both writers). @param {{ title?: string, author?: string, subject?: string, creationDate?: Date }} [I] */
const infoDict = (I = {}) => `<< /Producer ${pdfText('ReportWright')} /Creator ${pdfText('ReportWright')} /Title ${pdfText(I.title || 'Report')}${I.author ? ` /Author ${pdfText(I.author)}` : ''}${I.subject ? ` /Subject ${pdfText(I.subject)}` : ''} /CreationDate ${pdfDate(I.creationDate || new Date())} /ModDate ${pdfDate(I.creationDate || new Date())} >>`;

/**
 * The entries of a dictionary's body as [key, value] (" /StructTreeRoot 5 0 R /Lang (en)"): values may nest << >>, [ ]
 * and ( ) strings. Only the engine's own text is read here. @param {string} s @returns {[string, string][]}
 */
export function dictEntries(s) {
  /** @type {[string, string][]} */
  const out = [];
  let i = s.indexOf('/');
  while (i >= 0 && i < s.length) {
    let k = i + 1;
    while (k < s.length && !/[\s/<>\[\]()]/.test(s[k])) k++;
    const key = s.slice(i + 1, k);
    while (/\s/.test(s[k])) k++;
    const start = k;
    let depth = 0;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '(') { let d = 1; for (k++; k < s.length && d; k++) { if (s[k] === '\\') k++; else if (s[k] === '(') d++; else if (s[k] === ')') d--; } k--; }
      else if (c === '<' || c === '[') depth++;
      else if (c === '>' || c === ']') depth--;
      else if (c === '/' && !depth && k > start && /\s/.test(s[k - 1])) break;
    }
    out.push([key, s.slice(start, k).trim()]);
    i = k < s.length ? k : -1;
  }
  return out;
}

/** UTF-16BE hex of a string (surrogate pairs as they are in JS). @param {string} t */
const utf16 = (t) => { let h = ''; for (let i = 0; i < t.length; i++) h += hex4(t.charCodeAt(i)); return h; };
/** a text string for Info and the outline: UTF-16BE with its byte-order mark, as hex (nothing to escape) @param {any} t */
const pdfText = (t) => `<feff${utf16(String(t ?? ''))}>`;
/** @param {Date} d */
/** a date as pdfa.js's setInfoDates writes it (UTC, to the second): the XMP metadata says the same */
const pdfDate = (d) => `(D:${d.toISOString().replace(/\D/g, '').slice(0, 14)}+00'00')`;

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
 * opts: render()'s options and exportPdf's (fontStore, subset, title, author, creationDate, drillBase…). Tagged
 * (PDF/UA-1) and PDF/A files stream too; encrypted and signed files, save options and PDF/A without a colour profile
 * take the whole-model path (the result's why says which).
 * timeoutMs (or deadline) bounds the whole export, waits for the sink included; signal (an AbortSignal) stops it at its
 * next wait (a row batch, the sink, a sort, a page). Stopped or failed: it rejects (the signal's reason, an AbortError;
 * a timeout: status 504, code 'ETIMEDOUT'), the rows' cursors are closed, a sort's temporary files removed.
 * @param {any} def @param {any} opts @param {Sink} sink
 * @returns {Promise<{ streamed: boolean, pages: number, warnings: string[], why?: string }>}
 */
export async function exportPdfStream(def, opts, sink) {
  opts.signal?.throwIfAborted();
  checkPdfWriter(opts);
  const t0 = Date.now();
  const deadline = opts.deadline ?? (Number(opts.timeoutMs) > 0 ? t0 + Number(opts.timeoutMs) : undefined);
  // one signal for every wait: the caller's, the time limit, and an error the sink reports
  const ctl = new AbortController();
  const signal = ctl.signal;
  const onAbort = () => ctl.abort(opts.signal.reason);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = deadline ? setTimeout(() => ctl.abort(Object.assign(new Error(`The PDF export ran longer than ${Math.round((deadline - t0) / 100) / 10} s, its time limit (timeoutMs).`), { name: 'TimeoutError', code: 'ETIMEDOUT', status: 504, timeout: true })), Math.max(0, deadline - t0)) : null;
  const s = /** @type {any} */ (sink);
  const onSinkError = (/** @type {any} */ e) => ctl.abort(e);
  s.on?.('error', onSinkError);
  try {
    return await streamed(def, { ...opts, deadline, signal }, sink);
  } catch (e) {
    const err = signal.aborted ? signal.reason : e;
    if (err?.timeout && !err.code) err.code = 'ETIMEDOUT';
    throw err;
  } finally {
    clearTimeout(/** @type {any} */ (timer));
    opts.signal?.removeEventListener('abort', onAbort);
    s.off?.('error', onSinkError);
  }
}
/** @param {any} def @param {any} opts @param {Sink} sink */
async function streamed(def, opts, sink) {
  const { signal } = opts;
  const why = forcedPdfLib() ? 'PW_FORCE_PDFLIB' : opts.encrypt ? 'encrypted' : opts.prepare ? 'signed' : opts.save ? 'save options' : opts.pdfa && !opts.pdfa.icc?.length ? 'PDF/A without a colour profile' : null;
  const plan = why ? { why } : await raced(planPaged(def, opts), signal);
  if (plan.why !== undefined) {
    // render() reads SQL through opts.sql (whole rows): the sqlRows batches, gathered (this path holds the model whole anyway)
    // tagged: the cell tags an accessible PDF builds its tables from (exportData), as the streamed windows render them
    const base = opts.tagged && !opts.exportData ? { ...opts, exportData: true } : opts;
    const rOpts = opts.sqlRows && !opts.sql ? { ...base, sql: async (/** @type {any} */ src, /** @type {any} */ p) => { const all = []; for await (const b of sqlBatches(opts.sqlRows, src, p, signal)) for (const r of b) all.push(r); return all; } } : base;
    const model = await raced(render(def, rOpts), signal);
    const bytes = await raced(exportPdf(model, opts.fontStore, { ...opts, timeoutMs: opts.deadline ? Math.max(1, opts.deadline - Date.now()) : undefined }), signal);
    await raced(written(sink, sink.write(bytes)), signal);
    // said, not silent: a report that was meant to stream holds every page in memory instead
    const warnings = [`The PDF was not streamed (${plan.why}): the report was rendered whole, so its memory grows with its pages.`, ...model.warnings];
    return { streamed: false, pages: model.pages.length, warnings, why: plan.why };
  }
  const r = await writePagedPdf(plan, opts, sink);
  return { streamed: true, ...r };
}

/**
 * The pages of a paged plan (planPaged) as a PDF written to sink, page by page.
 * @param {any} plan @param {any} opts fontStore, subset, title, author, creationDate, drillBase @param {Sink} sink
 * @returns {Promise<{ pages: number, warnings: string[] }>}
 */
export async function writePagedPdf(plan, opts, sink) {
  const { fontStore } = opts;
  if (opts.pdfa || opts.tagged) await fontStore.load(standIns(fontStore)); // standard fonts are drawn in their embedded stand-ins
  const { info, pages } = /** @type {any} */ (plan);
  const onWarning = (/** @type {string} */ m) => { if (!info.warnings.includes(m)) info.warnings.push(m); };
  const w = createPdfStream(sink, { fontStore, subset: opts.subset, id: opts.id, signal: opts.signal, pdf: await newWriter(sink, opts), onWarning });
  // tagged (PDF/UA-1): a structure tree written as the pages are (pdfstreamtags.js)
  const tags = opts.tagged ? createStreamTagger(w, { maxElements: Number(opts.tagged.maxElements) || Infinity }) : null;
  const env = paintEnv(w, fontStore, { drillBase: opts.drillBase, tags, embedAll: !!(opts.pdfa || tags), pageHeight: info.pageHeights ? (/** @type {number} */ i) => info.pageHeights[i] : undefined });
  const { shaped } = env;
  // opts.parallel: windows laid out and painted by that many worker threads (Node), their pages written here in order;
  // 'auto': as many as the cores but one (4 at most), started only once the report is big (paged.js, lazy)
  const auto = opts.parallel === 'auto';
  const size = auto ? autoWorkers() : Number(opts.parallel);
  const pool = !tags && (auto ? size > 0 : size > 1) ? paintPool(size, fontStore, opts, info) : null;
  let pi = -1;
  /** each page's height, for the outline's places @type {number[]} */
  const heights = [];
  const it = pages(pool ? { run: pool.run, parallel: pool.size, total: pool.total, lazy: auto } : {})[Symbol.asyncIterator]();
  let pending = false; // a read the signal stopped waiting for: the iterator is busy, its return() would wait for it
  try {
    for (;;) {
      opts.signal?.throwIfAborted();
      pending = true;
      const x = await raced(it.next(), opts.signal);
      pending = false;
      if (x.done) break;
      const pg = x.value;
      pi++;
      const H = pg.height ?? info.height;
      heights[pi] = H;
      if (pg.deflated) { // painted by a worker: its fonts and glyphs first, then its links' pages by number
        for (const f of pg.embedded || []) env.embedded?.add(f);
        if (pg.used) { w.take(pg.used); for (const [k, g] of pg.shaped) { const m = env.shapedOf(k); for (const [id, t] of g) if (!m.has(id)) m.set(id, t); } }
        const annots = pg.annots.map((/** @type {string} */ a) => a.replace(/@@P(\d+)@@/g, (_, i) => String(w.pageRef(Number(i)))));
        await w.addPage({ width: pg.width ?? info.width, height: H, deflated: pg.deflated, annots });
        continue;
      }
      // the page's pictures, embedded before it is painted (once per source); one left out is said, as pdf-lib's path says it
      for (const im of pg.items) if (im.t === 'image') {
        let r = env.images.get(im.src);
        if (!r) env.images.set(im.src, r = await loadImage(im.src, w, opts));
        if (!r.img) onWarning(`Image on page ${pi + 1} (${im.tag?.alt ? `"${im.tag.alt}"` : String(im.src).slice(0, 40)}) was left out: ${r.why}`);
      }
      const { content, annots } = paintPage(pg, H, env);
      await w.addPage({ width: pg.width ?? info.width, height: H, content, annots, extra: tags ? await tags.end(w.pageRef(pi)) : undefined });
    }
  } finally {
    // the rows' cursors close as the pages' generators unwind; a read still running (its cursor told by the signal)
    // closes them when it ends
    if (pending) it.return?.(undefined)?.catch(() => {}); else await it.return?.(undefined);
    await pool?.close();
  }
  for (const [key, g] of shaped) w.addGlyphs(key, g);
  // the outline as exportPdf makes it: bookmarks and headings in page order, each entry once
  const seen = new Set();
  const outline = [...info.bookmarks, ...info.headings].map((b, i) => ({ b, i }))
    .sort((p, q) => p.b.page - q.b.page || (p.b.y ?? 0) - (q.b.y ?? 0) || p.i - q.i).map(({ b }) => b)
    .filter((b) => { const k = `${b.page}|${Math.round(b.y ?? 0)}|${b.label}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(b => ({ title: b.label, page: b.page, top: (heights[b.page - 1] ?? info.height) - b.y + 4, level: b.level }));
  // PDF/A and PDF/UA: the structure tree's root, XMP metadata, the output intent (as pdfa.js adds them)
  const title = opts.title || 'Report', when = new Date(Math.floor((opts.creationDate || new Date()).getTime() / 1000) * 1000);
  let catalog = tags ? await tags.finish({ lang: opts.tagged.lang }) : '';
  if (opts.pdfa || tags) {
    const xmp = new TextEncoder().encode(xmpPacket({ title, author: opts.author, stamp: when.toISOString().replace('.000Z', 'Z'), pdfa: opts.pdfa ? (tags ? 'A' : 'B') : null, ua: !!tags }));
    catalog += ` /Metadata ${await w.object('<< /Type /Metadata /Subtype /XML >>', xmp)} 0 R`;
  }
  if (opts.pdfa) {
    const icc = await w.object('<< /N 3 /Filter /FlateDecode >>', await deflate(opts.pdfa.icc));
    catalog += ` /OutputIntents [${await w.object(`<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${icc} 0 R >>`)} 0 R]`;
  }
  const res = await w.finish({ outline, catalog, info: { title, author: opts.author, creationDate: when }, pageStarts: info.pageStarts });
  // a tagged file of millions of elements is valid, but tools that load every object (qpdf, pikepdf) need gigabytes
  for (const x of env.embedded ? embeddedWarnings(env.embedded) : []) info.warnings.push(x);
  if (tags && tags.count > TAGGED_LARGE) info.warnings.push(`The tagged PDF has ${tags.count.toLocaleString('en-US')} structure elements (${res.pages.toLocaleString('en-US')} pages): readers open it, but tools that load every object of a file (qpdf, pikepdf) may run out of memory on it. tagged.maxElements caps it.`);
  return { pages: res.pages, warnings: info.warnings };
}

/** opts.pdfWriter, 'pdf' (the default) or 'legacy'; anything else is a 400 (checked first by both exporters) @param {any} opts */
export function checkPdfWriter(opts) {
  const which = opts.pdfWriter ?? 'pdf';
  if (which !== 'pdf' && which !== 'legacy') throw Object.assign(new TypeError(`pdfWriter is 'pdf' (the default) or 'legacy', not ${JSON.stringify(which)}`), { status: 400 });
  return which;
}

/**
 * The @reportwright/pdf writer the file goes through, or null for the engine's own (pdfWriter: 'legacy', kept for one
 * release). Loaded on first use. It writes our objects as they are; Info, metadata and the tags stay the engine's.
 * @param {Sink} sink @param {any} opts
 */
async function newWriter(sink, opts) {
  if (checkPdfWriter(opts) === 'legacy') return null;
  const { createPdf } = await import('@reportwright/pdf');
  // the sink stays the caller's: written with back-pressure as before, never ended here
  return createPdf({ write: (/** @type {Uint8Array} */ u8) => raced(written(sink, sink.write(u8)), opts.signal) },
    // object streams at zlib's level 9, as the engine's own writer packed them (its files are no bigger)
    { metadata: false, id: opts.id, signal: opts.signal, creationDate: opts.creationDate, objectStreamLevel: 9 });
}

/**
 * Page labels (what a reader shows as the page number): decimal, restarting at 1 on each page of starts (0-based, a
 * section that restarts the numbering), as exportPdf's pdf-lib path writes them. @param {number[]|undefined} starts @param {number} n pages
 */
function pageLabels(starts, n) {
  const at = [...new Set([0, ...(starts || [])])].filter(i => i >= 0 && i < n).sort((a, b) => a - b);
  return `<< /Nums [${at.map(i => `${i} << /S /D /St 1 >>`).join(' ')}] >>`;
}

/**
 * A picture's bytes checked as exportPdf's pdf-lib path checks them (size limits, fetchImage, a damaged or huge PNG,
 * PNG and JPEG only), then embedded: { img } or { why }, the reason it is left out.
 * ponytail: the same checks as pdf.js's loadImage; one copy once pdf-lib's path goes (Phase C).
 * @param {string} src @param {any} w the writer @param {any} opts fetchImage
 * @returns {Promise<{ img?: any, why?: string }>}
 */
async function loadImage(src, w, opts) {
  try {
    const local = /^data:/i.test(src);
    if (local && dataUriBytes(src) > IMAGE_LIMITS.bytes) return { why: 'it is larger than the image size limit' };
    if (!local && !opts.fetchImage) return { why: 'it is a URL, and no fetchImage was given to load it' };
    const bytes = local ? dataUriBytesOf(src) : await opts.fetchImage(src);
    if (!bytes?.length) return { why: 'it could not be loaded' };
    if (bytes.length > IMAGE_LIMITS.bytes) return { why: 'it is larger than the image size limit' };
    const info = /** @type {any} */ (imageInfoOf(bytes));
    if (info?.type === 'png') {
      const why = 'w' in info && !info.suspect && info.w * info.h <= IMAGE_LIMITS.pixels ? pngProblem(bytes) : 'too large or animated';
      if (why) return { why: `the PNG is not usable (${why})` };
    } else if (info?.type !== 'jpeg') return { why: info ? `${info.type.toUpperCase()} is not embedded (PNG, JPEG and SVG are)` : 'it is not a PNG, JPEG or SVG' };
    // ponytail: the decoded-size bound of the pixel limit at 8-bit RGBA; a 16-bit PNG near the limit is refused
    return { img: await w.image(bytes, { maxDecodedBytes: IMAGE_LIMITS.pixels * 4 }) };
  } catch (e) { return { why: `it could not be embedded (${/** @type {any} */ (e)?.message || e})` }; }
}

/** a literal string, \ ( ) escaped @param {string} v */
const lit = (v) => `(${String(v).replace(/[\\()]/g, '\\$&')})`;
/** The text a link covers (pdf.js's coveredText): the page's lines whose start lies in its box, in reading order. */
function coveredText(items, box) {
  const lines = [];
  for (const t of items) if (t.t === 'text' && t.lines) for (const l of t.lines) if (l.text?.trim() && l.x >= box.x && l.x <= box.x + box.w && l.y >= box.y && l.y <= box.y + box.h) lines.push(l);
  return lines.sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.text.trim()).join(' ');
}

/**
 * A page of the model as its content stream's operators and its link annotations, drawn with the shared painter
 * (pdfpaint.js) as exportPdf draws it. env (paintEnv): the writer's names and glyph records, the page refs links jump
 * to, the tagger when tagged. Pages painted in parallel (parallel.js) use a writer of their own and the same names.
 * @param {any} pg @param {number} H @param {any} env
 * @returns {{ content: string, annots: any[] }}
 */
export function paintPage(pg, H, env) {
  if (env.embedded) pg = embeddedPage(pg, env.font, env.embedded);
  const annots = [];
  const c = new Content(env.shared);
  const { tags } = env;
  if (tags) { c.tagged = true; c.artLines = true; tags.page(pg.win ?? 0); }
  for (const it of pg.items) {
    // tagged: lines wait and are drawn together as one artifact (a table's borders); a cell's plain text is marked inside
    // the open text object, so the cells' text stays one text object as untagged (BT, then BDC … EMC per cell)
    const mark = tags && it.t !== 'line' && tags.open(it);
    const inText = mark && it.t === 'text' && !it.rotate && it.lines.every((/** @type {any} */ l) => !l.runs) && !(it.clip && !insideClip(it, env.vmetrics(it.font)));
    if (inText) {
      if (!c.bt) { c._s += 'BT\n'; c.bt = true; c.tx = 0; c.ty = 0; }
      c._s += mark;
    } else if (mark) { c.et(); c.s += mark; }
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
        const clipped = it.clip && !insideClip(it, env.vmetrics(it.font));
        if (clipped) { c.q(); c.s += `${n2(it.clip.x)} ${n2(H - it.clip.y - it.clip.h)} ${n2(it.clip.w)} ${n2(it.clip.h)} re W n\n`; }
        for (const l of it.lines) {
          if (!l.runs) { c.text(env.pf(it.font), it.size, color, l.x, H - l.y, env.literal(it.font, cleanText(l.text))); continue; }
          for (const r of l.runs) {
            const g = env.shapedOf(r.font), spans = new WeakMap();
            glyphText(r, env.font(r.font), g, spans);
            if (r.text.trim()) drawRun(c, r, l.x + r.x, H - l.y, it.size, env.pf(r.font), color, spans.get(r), g);
          }
        }
        if (clipped) c.Q();
        break;
      }
      case 'link': {
        const rect = `[${[it.x, H - it.y - it.h, it.x + it.w, H - it.y].map(n2).join(' ')}]`;
        const a = it.action;
        const href = a?.type === 'url' && safeUrl(a.href) ? a.href : a?.type === 'drill' ? drillUrl(env.drillBase, a) : null;
        const to = href ? `/A << /Type /Action /S /URI /URI ${lit(asciiUrl(href))} >>` : a?.type === 'bookmark' && a.page ? `/Dest [${env.pageRef(a.page - 1)} 0 R /XYZ null ${n2((env.pageHeight?.(a.page - 1) ?? H) - a.y + 4)} null]` : null;
        if (!to) break; // ponytail: a jump to a bookmark by name needs every page's bookmarks first: left out while streaming
        if (!tags) { annots.push(`<< /Type /Annot /Subtype /Link /F 4 /Rect ${rect} /Border [0 0 0] ${to} >>`); break; }
        // tagged: what the link does, for a screen reader, and its Link element
        const ref = env.reserve(), key = tags.link(it, ref);
        const say = coveredText(pg.items, it) || it.tip || href || (a.target ? `Go to ${a.target}` : `Go to page ${a.page}`);
        annots.push({ ref, dict: `<< /Type /Annot /Subtype /Link /F 4 /Rect ${rect} /Border [0 0 0] ${to} /Contents ${pdfText(say)} /StructParent ${key} >>` });
        break;
      }
      case 'image': {
        const img = env.images?.get(it.src)?.img;
        if (!img) break; // left out (said when it was loaded)
        // as exportPdf's pdf-lib path draws it: the fit in the box, cover and clip cut to it
        let w = it.w, h = it.h, x = it.x, y = it.y;
        const clipBox = it.fit === 'clip' ? [it.x, H - it.y - it.ch, it.cw, it.ch] : it.fit === 'cover' ? [it.x, H - it.y - it.h, it.w, it.h] : null;
        if (it.fit !== 'fill' && it.fit !== 'clip') {
          const s = it.fit === 'cover' ? Math.max(it.w / img.width, it.h / img.height) : Math.min(it.w / img.width, it.h / img.height);
          w = img.width * s; h = img.height * s; x = it.x + (it.w - w) / 2; y = it.y + (it.h - h) / 2;
        }
        const o = img.orientation, upright = o[0] === 1 && o[1] === 0 && o[2] === 0 && o[3] === 1 && o[4] === 0 && o[5] === 0;
        c.q();
        if (clipBox) c.s += `${clipBox.map(n2).join(' ')} re W n\n`;
        c.alpha(1, c.st.CA);
        c.s += `${n4(w)} 0 0 ${n4(h)} ${n2(x)} ${n2(H - y - h)} cm${upright ? '' : ` ${o.join(' ')} cm`} /${img.name} Do\n`;
        c.Q();
        break;
      }
      default: throw new Error(`A ${it.t} item does not stream yet`);
    }
    if (it.rotate) c.Q();
    if (inText) c._s += 'EMC\n';
    else if (mark) { c.et(); c.s += 'EMC\n'; }
  }
  c.et();
  return { content: c.s, annots };
}

/**
 * What paintPage draws with: a writer's resource names and glyph records (w), the fonts, shaped glyphs' texts.
 * @param {any} w @param {any} fontStore @param {{ drillBase?: string, pageRef?: (i: number) => any, tags?: any, embedAll?: boolean, pageHeight?: (i: number) => number }} [o]
 *   pageHeight: the height of page i (0-based), when pages differ: where a link to it lands
 */
export function paintEnv(w, fontStore, o = {}) {
  /** @type {Map<string, any>} pdf-lib-like fonts for the shared painter: { key, embedder: { font } } */
  const pfs = new Map();
  /** @type {Map<string, Map<number, string>>} shaped glyphs per font: the text each stands for */
  const shaped = new Map();
  const vm = new Map();
  return {
    shared: { font: (f) => w.fontName(f.key), gs: (ca, CA) => w.gs(ca, CA), image: () => { throw new Error('images do not stream yet'); } },
    pf: (/** @type {string} */ key) => { let f = pfs.get(key); if (!f) pfs.set(key, f = { key, embedder: { font: fontStore.get(key) } }); return f; },
    font: (/** @type {string} */ key) => fontStore.get(key),
    shaped,
    shapedOf: (/** @type {string} */ key) => { let g = shaped.get(key); if (!g) shaped.set(key, g = new Map()); return g; },
    vmetrics: (/** @type {string} */ key) => {
      let m = vm.get(key);
      if (!m) { const f = fontStore.get(key), u = f?.unitsPerEm || 1000; vm.set(key, m = { asc: (f?.ascent ?? u) / u, desc: -(f?.descent ?? 0) / u }); }
      return m;
    },
    literal: (/** @type {string} */ key, /** @type {string} */ text) => w.literal(key, text),
    pageRef: o.pageRef || ((/** @type {number} */ i) => w.pageRef(i)),
    pageHeight: o.pageHeight,
    /** the pictures embedded so far, by source: { img } or { why } (writePagedPdf loads a page's before painting it) @type {Map<string, any>} */
    images: new Map(),
    reserve: () => w.reserve(),
    drillBase: o.drillBase,
    tags: o.tags || null,
    /** PDF/A, PDF/UA: standard fonts drawn in embedded stand-ins; the families that were @type {Set<string>|null} */
    embedded: o.embedAll ? new Set() : null,
  };
}

/**
 * parallel 'auto': the cores but one (the writer's), 4 at most; none below 3 (2 workers did not beat one thread on the
 * README's ledger) or without Node
 */
function autoWorkers() {
  const os = /** @type {any} */ (globalThis).process?.getBuiltinModule?.('node:os');
  const n = Math.min(4, (os ? (os.availableParallelism?.() ?? os.cpus().length) : 1) - 1);
  return n >= 3 ? n : 0;
}

/**
 * Worker threads that lay out and paint windows of pages (pdfstreamworker.js): run(job) answers as paged.js's own
 * layout does, with pages painted and compressed. Started at the first job, each worker given the fonts loaded by then;
 * a font a later row needs is asked of this side (and loaded here too, for the file). A job sent before the pages are
 * counted (job.defer) waits in its worker for total(n). Node only.
 * @param {number} size @param {any} fontStore @param {any} opts @param {any} info
 */
function paintPool(size, fontStore, opts, info) {
  const wt = /** @type {any} */ (globalThis).process?.getBuiltinModule?.('node:worker_threads');
  if (!wt) return null;
  /** @type {any[]} */
  let workers = [];
  let seq = 0, turn = 0, count = /** @type {number|undefined} */ (undefined);
  const waiting = new Map();
  // the row without its groups (paged.js's own): a copy key by key, as fast on a row in dictionary mode (delete r.__g)
  const clean = (/** @type {any} */ r) => { if (!r) return r; const o = /** @type {any} */ ({}); for (const k in r) if (k !== '__i') o[k] = r[k]; return o; };
  const start = async () => {
    const fonts = [...fontStore.bytes];
    if (fontStore.shaper) fonts.push(['harfbuzz', await fontStore.loader('harfbuzz')]);
    workers = Array.from({ length: size }, () => {
      const w = new wt.Worker(new URL('./pdfstreamworker.js', import.meta.url), { workerData: { fonts } });
      w.on('message', (/** @type {any} */ m) => {
        if (m.font !== undefined) { // a font a later row needs: loaded here too (the file embeds it), its bytes sent
          fontStore.load([m.font]).catch(() => {}).then(async () => w.postMessage({ font: m.font, bytes: m.font === 'harfbuzz' ? (fontStore.shaper ? await fontStore.loader(m.font) : undefined) : fontStore.bytes.get(m.font) }));
          return;
        }
        const p = waiting.get(m.id); waiting.delete(m.id); if (m.error) p.fail(Object.assign(new Error(m.error.message), { status: m.error.status, timeout: m.error.timeout })); else p.ok(m); });
      w.on('error', (/** @type {any} */ e) => { for (const p of waiting.values()) p.fail(e); waiting.clear(); });
      return w;
    });
  };
  let started = null;
  const pick = ['parameters', 'now', 'timeZone', 'state', 'target', 'deadline', 'timeoutMs'];
  return {
    size,
    /** @param {any} job */
    async run(job) {
      // the message now, before any wait: the rows go on changing as the pass reads on (a group's totals when it closes)
      const id = ++seq;
      const pw = job.pageWindow;
      const msg = { id, def: job.def, rows: job.rows.map(clean), keep: job.keep, drillBase: opts.drillBase, embedAll: !!opts.pdfa, height: info.height,
        opts: Object.fromEntries(pick.filter(k => opts[k] !== undefined).map(k => [k, opts[k]])), defer: job.defer, rebandDef: job.rebandDef,
        pageWindow: { ...pw, first: clean(pw.first), cont: pw.cont.map((/** @type {any} */ c) => c && { first: clean(c.first), before: c.before }) } };
      await (started ||= start());
      // the count came while the workers started: the job is sent with it
      if (msg.defer && count !== undefined) { msg.defer = false; msg.pageWindow.total = count; }
      const r = await new Promise((ok, fail) => { waiting.set(id, { ok, fail }); workers[turn++ % workers.length].postMessage(msg); });
      if (r.pages.length) { r.pages[0].used = r.used; r.pages[0].shaped = r.shaped; r.pages[0].embedded = r.embedded; }
      return r;
    },
    /** the page count, for the jobs sent before it (each worker's, in order) @param {number} n */
    total(n) { count = n; for (const w of workers) w.postMessage({ total: n }); },
    async close() { await Promise.all(workers.map(w => w.terminate())); },
  };
}
