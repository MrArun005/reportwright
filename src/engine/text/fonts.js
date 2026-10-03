// @ts-check
import fontkitModule from '@pdf-lib/fontkit';

/** @type {any} */
const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

/**
 * Bundled fonts. Key = file name without ".ttf" in /public/fonts.
 * Only OFL fonts ship with the product.
 */
export const FONT_FAMILIES = {
  'Inter': { regular: 'Inter-Regular', italic: 'Inter-Italic', semibold: 'Inter-SemiBold', bold: 'Inter-Bold', boldItalic: 'Inter-BoldItalic' },
  'JetBrains Mono': { regular: 'JetBrainsMono-Regular', bold: 'JetBrainsMono-Bold' },
};
export const DEFAULT_FAMILY = 'Inter';
export const ALL_FONT_KEYS = [...new Set(Object.values(FONT_FAMILIES).flatMap(f => Object.values(f)))];

/** @param {string} [family] @param {string|number} [weight] @param {string} [style] */
export function resolveFontKey(family, weight, style) {
  const fam = FONT_FAMILIES[family || DEFAULT_FAMILY] || FONT_FAMILIES[DEFAULT_FAMILY];
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight) || 400;
  const it = style === 'italic';
  if (w >= 650) return (it && fam.boldItalic) || fam.bold || fam.regular;
  if (w >= 550) return (it && fam.boldItalic) || fam.semibold || fam.bold || fam.regular;
  return (it && fam.italic) || fam.regular;
}

/** CSS description of a font key, for SVG/HTML output. */
export function fontCss(key) {
  for (const [family, faces] of Object.entries(FONT_FAMILIES)) {
    for (const [face, k] of Object.entries(faces)) {
      if (k === key) {
        const weight = face === 'bold' || face === 'boldItalic' ? 700 : face === 'semibold' ? 600 : 400;
        const style = face === 'italic' || face === 'boldItalic' ? 'italic' : 'normal';
        return { family, weight, style };
      }
    }
  }
  return { family: DEFAULT_FAMILY, weight: 400, style: 'normal' };
}

/**
 * Loads font files once and keeps the parsed fontkit objects.
 * The loader returns the bytes of "<key>.ttf".
 */
export class FontStore {
  /** @param {(key: string) => Promise<ArrayBuffer|Uint8Array>} loader */
  constructor(loader) {
    this.loader = loader;
    /** @type {Map<string, any>} */ this.fonts = new Map();
    /** @type {Map<string, Uint8Array>} */ this.bytes = new Map();
    /** @type {Map<string, Promise<void>>} */ this.pending = new Map();
  }
  /** @param {string[]} keys */
  async load(keys = ALL_FONT_KEYS) {
    await Promise.all(keys.map((k) => {
      if (this.fonts.has(k)) return null;
      if (!this.pending.has(k)) {
        this.pending.set(k, (async () => {
          const b = await this.loader(k);
          const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
          this.bytes.set(k, u8);
          this.fonts.set(k, fontkit.create(u8));
        })());
      }
      return this.pending.get(k);
    }));
  }
  /** @param {string} key */
  get(key) {
    const f = this.fonts.get(key);
    if (!f) throw new Error(`Font "${key}" is not loaded`);
    return f;
  }
}
