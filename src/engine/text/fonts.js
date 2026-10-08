// @ts-check
import fontkitModule from '@pdf-lib/fontkit';
import { createShaper } from './shaper.js';

/** @type {any} */
const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

/** @typedef {{ key: string, family: string, weight: number, style: 'normal'|'italic', file: string }} Face */

/** Bundled fonts (OFL), in /public/fonts: [family, key, weight, style]. The key is the file name without ".ttf". */
const BUNDLED = [
  ['Inter', 'Inter-Regular', 400], ['Inter', 'Inter-Italic', 400, 'italic'], ['Inter', 'Inter-SemiBold', 600],
  ['Inter', 'Inter-Bold', 700], ['Inter', 'Inter-BoldItalic', 700, 'italic'],
  ['JetBrains Mono', 'JetBrainsMono-Regular', 400], ['JetBrains Mono', 'JetBrainsMono-Bold', 700],
  ['Noto Sans Devanagari', 'NotoSansDevanagari-Regular', 400], ['Noto Sans Devanagari', 'NotoSansDevanagari-Bold', 700],
  ['Noto Sans Arabic', 'NotoSansArabic-Regular', 400], ['Noto Sans Arabic', 'NotoSansArabic-Bold', 700],
  ['Noto Sans Hebrew', 'NotoSansHebrew-Regular', 400], ['Noto Sans Hebrew', 'NotoSansHebrew-Bold', 700],
  // fallbacks loaded only when text uses the script (docs/TEXT.md has the sizes)
  ...['Thai', 'Lao', 'Khmer', 'Myanmar', 'Tamil', 'Bengali', 'Telugu', 'Kannada', 'Gujarati'].flatMap(s => [
    [`Noto Sans ${s}`, `NotoSans${s}-Regular`, 400], [`Noto Sans ${s}`, `NotoSans${s}-Bold`, 700]]),
  // optional, about 40 MB (npm run fonts:cjk fetches them into /fonts/cjk): variable fonts drawn at their default
  // (regular) weight. Without them the text shows as boxes, and the warning says how to add them.
  ['Noto Sans JP', 'NotoSansJP', 400, 'normal', 'cjk/NotoSansJP.ttf'], ['Noto Sans KR', 'NotoSansKR', 400, 'normal', 'cjk/NotoSansKR.ttf'],
  ['Noto Sans SC', 'NotoSansSC', 400, 'normal', 'cjk/NotoSansSC.ttf'], ['Noto Emoji', 'NotoEmoji', 400, 'normal', 'cjk/NotoEmoji.ttf'],
];
/** The optional families (scripts/fetch-fonts-cjk.mjs). */
export const OPTIONAL_KEYS = ['NotoSansJP', 'NotoSansKR', 'NotoSansSC', 'NotoEmoji'];

/** family → its faces: the bundled families, then the fonts uploaded to the server (setCustomFonts). @type {Record<string, Face[]>} */
export const FONT_FAMILIES = {};
/** @type {Map<string, Face>} */
const FACES = new Map();
const addFace = (/** @type {Face} */ f) => { (FONT_FAMILIES[f.family] ||= []).push(f); FACES.set(f.key, f); };
for (const [family, key, weight, style = 'normal', file] of BUNDLED) {
  addFace({ family: String(family), key: String(key), weight: Number(weight), style: style === 'italic' ? 'italic' : 'normal', file: String(file || `${key}.ttf`) });
}
export const BUNDLED_FAMILIES = Object.keys(FONT_FAMILIES);

export const DEFAULT_FAMILY = 'Inter';
/** Loaded before every render. Fallback and uploaded fonts load when a report needs them. */
export const ALL_FONT_KEYS = [...FONT_FAMILIES.Inter, ...FONT_FAMILIES['JetBrains Mono']].map(f => f.key);
/** The one face a render cannot do without: the fallback for every other face that is missing or failed. */
export const CORE_FONT_KEY = 'Inter-Regular';
/** The HarfBuzz shaper (WASM). FontStore loads it like a font, from /fonts/harfbuzz.wasm, once text needs shaping. */
export const SHAPER = 'harfbuzz';

/** The file behind a key, relative to /fonts: what the FontStore loader reads or fetches. */
export function fontFile(key) {
  if (key === SHAPER) return 'harfbuzz.wasm';
  return FACES.get(key)?.file || `${key}.ttf`;
}

/**
 * Fonts uploaded to this server: [{ id, family, weight, style }], key "u-<id>", file "custom/<id>".
 * Replaces the previous list. A family named like a bundled one is skipped (the server refuses those).
 * @param {{ id: string, family: string, weight?: number, style?: string }[]} list
 */
export function setCustomFonts(list) {
  for (const [k, f] of FACES) if (k.startsWith('u-')) {
    FACES.delete(k);
    const left = FONT_FAMILIES[f.family].filter(x => x.key !== k);
    if (left.length) FONT_FAMILIES[f.family] = left; else delete FONT_FAMILIES[f.family];
  }
  for (const f of list || []) {
    if (BUNDLED_FAMILIES.includes(f.family) || !/^[a-f0-9]{8,64}$/.test(String(f.id))) continue;
    addFace({ key: `u-${f.id}`, family: String(f.family), weight: Number(f.weight) || 400, style: f.style === 'italic' ? 'italic' : 'normal', file: `custom/${f.id}` });
  }
}

/**
 * The face for a family, weight and style, matched as CSS does: style first (italic faces when asked
 * and there are some), then the nearest weight (CSS Fonts 4, §5.2). Unknown families use Inter.
 * @param {string} [family] @param {string|number} [weight] @param {string} [style]
 */
export function resolveFontKey(family, weight, style) {
  const faces = FONT_FAMILIES[family || DEFAULT_FAMILY] || FONT_FAMILIES[DEFAULT_FAMILY];
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight) || 400;
  const italic = faces.filter(f => f.style === 'italic');
  const list = style === 'italic' && italic.length ? italic : faces.filter(f => f.style !== 'italic').length ? faces.filter(f => f.style !== 'italic') : faces;
  const rank = (/** @type {Face} */ f) => {
    const fw = f.weight;
    if (w >= 400 && w <= 500) return fw >= w && fw <= 500 ? fw - w : fw < w ? 1000 + w - fw : 2000 + fw - w;
    if (w < 400) return fw <= w ? w - fw : 1000 + fw - w;
    return fw >= w ? fw - w : 1000 + w - fw;
  };
  return list.reduce((best, f) => (rank(f) < rank(best) ? f : best)).key;
}

/** CSS description of a font key, for SVG/HTML output. */
export function fontCss(key) {
  const f = FACES.get(key);
  return f ? { family: f.family, weight: f.weight, style: f.style } : { family: DEFAULT_FAMILY, weight: 400, style: 'normal' };
}

/** Bundled fonts for scripts the chosen font may not have, by Unicode block. */
const FALLBACK = [
  [0x0590, 0x05ff, 'Noto Sans Hebrew'], [0xfb1d, 0xfb4f, 'Noto Sans Hebrew'],
  [0x0600, 0x08ff, 'Noto Sans Arabic'], [0xfb50, 0xfdff, 'Noto Sans Arabic'], [0xfe70, 0xfefe, 'Noto Sans Arabic'],
  [0x0900, 0x097f, 'Noto Sans Devanagari'], [0xa8e0, 0xa8ff, 'Noto Sans Devanagari'], [0x1cd0, 0x1cff, 'Noto Sans Devanagari'],
  [0x0980, 0x09ff, 'Noto Sans Bengali'], [0x0a80, 0x0aff, 'Noto Sans Gujarati'], [0x0b80, 0x0bff, 'Noto Sans Tamil'],
  [0x11fc0, 0x11fff, 'Noto Sans Tamil'], [0x0c00, 0x0c7f, 'Noto Sans Telugu'], [0x0c80, 0x0cff, 'Noto Sans Kannada'],
  [0x0e00, 0x0e7f, 'Noto Sans Thai'], [0x0e80, 0x0eff, 'Noto Sans Lao'], [0x1000, 0x109f, 'Noto Sans Myanmar'],
  [0xa9e0, 0xa9ff, 'Noto Sans Myanmar'], [0xaa60, 0xaa7f, 'Noto Sans Myanmar'], [0x1780, 0x17ff, 'Noto Sans Khmer'],
  [0x19e0, 0x19ff, 'Noto Sans Khmer'],
  // CJK (optional fonts): kana and Han in the Japanese face (Han shapes differ a little from Chinese; a report can
  // set fontFamily "Noto Sans SC"), Hangul in the Korean one; emoji in Noto Emoji (monochrome)
  [0x3040, 0x30ff, 'Noto Sans JP'], [0x31f0, 0x31ff, 'Noto Sans JP'], [0x3000, 0x303f, 'Noto Sans JP'], [0x3400, 0x4dbf, 'Noto Sans JP'],
  [0x4e00, 0x9fff, 'Noto Sans JP'], [0xf900, 0xfaff, 'Noto Sans JP'], [0xff00, 0xffef, 'Noto Sans JP'],
  [0x1100, 0x11ff, 'Noto Sans KR'], [0x3130, 0x318f, 'Noto Sans KR'], [0xac00, 0xd7af, 'Noto Sans KR'],
  [0x1f000, 0x1faff, 'Noto Emoji'], [0x2600, 0x27bf, 'Noto Emoji'], [0x2b00, 0x2bff, 'Noto Emoji'],
];
/** Every registered key: bundled and uploaded. */
export const allFontKeys = () => [...FACES.keys()];

/** The bundled fallback faces for `key` (one per script), for CSS font-family lists. */
export function fallbackKeys(key) {
  const c = fontCss(key);
  return [...new Set(FALLBACK.map(f => String(f[2])))].map(family => resolveFontKey(family, c.weight, c.style));
}

/**
 * CSS unicode-range for a bundled fallback face, else null: its script's blocks plus the marks, joiners and
 * dotted circle a run in that font can carry. A browser then downloads the face only for text in that script
 * (without it, a font-family list of fallbacks fetches every face before the one that has the glyph).
 * @param {string} key
 */
export function unicodeRange(key) {
  const family = FACES.get(key)?.family;
  const r = FALLBACK.filter(f => f[2] === family).map(([a, b]) => `U+${Number(a).toString(16)}-${Number(b).toString(16)}`);
  return r.length ? [...r, 'U+300-36F', 'U+2000-206F', 'U+25CC', 'U+FE00-FE0F'].join(',') : null;
}

/** The bundled fallback face for a code point, in the weight and style of `key`; null when there is none. */
export function fallbackKey(cp, key) {
  for (const [a, b, family] of FALLBACK) {
    if (cp >= /** @type {number} */ (a) && cp <= /** @type {number} */ (b)) { const c = fontCss(key); return resolveFontKey(String(family), c.weight, c.style); }
  }
  return null;
}

const SIMPLE_FALLBACK = new Set(['Noto Sans JP', 'Noto Sans KR', 'Noto Emoji']); // scripts drawn without the shaper
const BEYOND_LATIN = /[^\u0000-\u024f\u1e00-\u1eff\u2000-\u20cf\u2100-\u218f]/;
/**
 * The fallback faces (regular and bold, one per script) and the shaper that text in these strings will need. render()
 * loads them before the layout: a face found missing during the layout means laying everything out again.
 * ponytail: regular and bold only (italic text in a fallback script uses them too, see resolveFontKey).
 * @param {Iterable<any>} texts
 * @returns {string[]}
 */
export function fontsFor(texts) {
  const keys = new Set(), seen = new Set();
  let shaper = false;
  for (const t of texts) {
    if (typeof t !== 'string' || !BEYOND_LATIN.test(t)) continue;
    for (const ch of t) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      if (cp < 0x0250 || seen.has(cp)) continue;
      seen.add(cp);
      for (const [a, b, family] of FALLBACK) {
        if (cp < /** @type {number} */ (a) || cp > /** @type {number} */ (b)) continue;
        keys.add(resolveFontKey(String(family), 400, 'normal')).add(resolveFontKey(String(family), 700, 'normal'));
        if (!SIMPLE_FALLBACK.has(String(family))) shaper = true;
        break;
      }
    }
  }
  if (shaper) keys.add(SHAPER);
  return [...keys];
}

/**
 * Loads font files once and keeps the parsed fontkit objects; SHAPER loads the HarfBuzz shaper.
 * The loader returns the bytes of fontFile(key) under /fonts.
 */
export class FontStore {
  /** @param {(key: string) => Promise<ArrayBuffer|Uint8Array>} loader */
  constructor(loader) {
    this.loader = loader;
    /** @type {Map<string, any>} */ this.fonts = new Map();
    /** @type {Map<string, Uint8Array>} */ this.bytes = new Map();
    /** @type {Map<string, Promise<void>>} */ this.pending = new Map();
    /** keys that did not load: their text falls back to the default font @type {Set<string>} */ this.failed = new Set();
    /** @type {any} */ this.shaper = null;
    /** @type {Map<string, any>} HarfBuzz fonts by key */ this.hb = new Map();
  }
  /** @param {string[]} keys */
  async load(keys = ALL_FONT_KEYS) {
    await Promise.all(keys.map((k) => {
      if (this.fonts.has(k) || this.failed.has(k) || (k === SHAPER && this.shaper)) return null;
      if (!this.pending.has(k)) {
        this.pending.set(k, (async () => {
          try {
            const b = await this.loader(k);
            const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
            if (k === SHAPER) { this.shaper = await createShaper(u8); return; }
            this.fonts.set(k, fontkit.create(u8));
            this.bytes.set(k, u8);
          } catch (e) {
            // the core face must load; any other font falls back, and the report warns
            this.pending.delete(k);
            if (k === CORE_FONT_KEY) throw e;
            this.failed.add(k);
          }
        })());
      }
      return this.pending.get(k);
    }));
  }
  /** @param {string} key */
  has(key) { return this.fonts.has(key); }
  /** The HarfBuzz font for a loaded key (the shaper must be loaded). @param {string} key */
  hbFont(key) {
    let f = this.hb.get(key);
    if (!f) { f = this.shaper.font(this.bytes.get(key)); this.hb.set(key, f); }
    return f;
  }
  /** @param {string} key */
  get(key) {
    const f = this.fonts.get(key);
    if (!f) throw new Error(`Font "${key}" is not loaded`);
    return f;
  }
}
