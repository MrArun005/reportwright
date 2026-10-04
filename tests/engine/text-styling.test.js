// Phase 1 text styling: decorations, justify, background images, shrink-to-fit, rotation, locale names.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../../src/exporters/pdf.js';

const box = (style = {}, extra = {}) => report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 20, value: 'Hello world', style, ...extra }]);
const itemsOf = async (def) => (await render(def, { fontStore })).pages[0].items;

describe('text decoration', () => {
  it('underline draws a line under each line of text, in the text colour', async () => {
    const items = await itemsOf(box({ textDecoration: 'underline', color: '#ff0000' }));
    const t = items.find(i => i.t === 'text');
    const lines = items.filter(i => i.t === 'line');
    expect(lines).toHaveLength(1);
    const [u] = lines;
    expect(u.y1).toBeGreaterThan(t.lines[0].y);          // below the baseline
    expect(u.y1).toBe(u.y2);
    expect(u.x1).toBeCloseTo(t.lines[0].x, 3);
    expect(u.x2).toBeCloseTo(t.lines[0].x + t.lines[0].w, 3);
    expect(u.stroke).toBe('#ff0000');
    expect(t.deco).toBe('underline');                    // the Word export reads this
  });

  it('line-through draws through the middle of the x-height; both can combine', async () => {
    const items = await itemsOf(box({ textDecoration: 'underline line-through' }));
    const t = items.find(i => i.t === 'text');
    const ys = items.filter(i => i.t === 'line').map(l => l.y1).sort((a, b) => a - b);
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeLessThan(t.lines[0].y);           // strike above the baseline
    expect(ys[1]).toBeGreaterThan(t.lines[0].y);        // underline below
  });

  it('none and a missing value draw nothing', async () => {
    for (const st of [{}, { textDecoration: 'none' }]) {
      expect((await itemsOf(box(st))).filter(i => i.t === 'line')).toHaveLength(0);
    }
  });

  it('can be set by an expression (conditional formatting)', async () => {
    const items = await itemsOf(box({ textDecoration: "=IIF(1 > 0, 'underline', 'none')" }));
    expect(items.filter(i => i.t === 'line')).toHaveLength(1);
  });
});

describe('justify', () => {
  const para = 'The quick brown fox jumps over the lazy dog while the cat watches from the old stone wall.\nShort line.';
  it('stretches every wrapped line to both edges except the last line of each paragraph', async () => {
    const items = await itemsOf(box({ textAlign: 'justify', padding: 2 }, { w: 140, h: 120, value: para }));
    const t = items.find(i => i.t === 'text');
    const rows = [...new Set(t.lines.map(l => l.y))].sort((a, b) => a - b).map(y => t.lines.filter(l => l.y === y));
    expect(rows.length).toBeGreaterThan(3);
    const right = (row) => Math.max(...row.map(l => l.x + l.w));
    const left = (row) => Math.min(...row.map(l => l.x));
    expect(rows[0].length).toBeGreaterThan(1);
    expect(left(rows[0])).toBeCloseTo(t.clip.x + 2, 1);
    expect(right(rows[0])).toBeCloseTo(t.clip.x + 138, 1);
    const lastOfFirst = rows[rows.length - 2], last = rows[rows.length - 1];
    expect(lastOfFirst).toHaveLength(1);
    expect(last).toHaveLength(1);
    expect(last[0].text).toBe('Short line.');
    expect(right(last)).toBeLessThan(t.clip.x + 120);
  });

  it('keeps the words in order', async () => {
    const items = await itemsOf(box({ textAlign: 'justify' }, { w: 140, h: 120, value: para }));
    const t = items.find(i => i.t === 'text');
    const words = [...t.lines].sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.text).join(' ');
    expect(words).toBe(para.replace('\n', ' '));
  });

  it('does not stretch a line that was cut short with an ellipsis', async () => {
    const items = await itemsOf(box({ textAlign: 'justify' }, { w: 140, h: 12, canGrow: false, value: para }));
    const t = items.find(i => i.t === 'text');
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].text.endsWith('…')).toBe(true);
  });

  it('a blank line between paragraphs keeps the line before it ragged', async () => {
    const items = await itemsOf(box({ textAlign: 'justify' }, { w: 140, h: 200, value: 'One two three four five six seven eight nine ten eleven twelve\n\nNext' }));
    const t = items.find(i => i.t === 'text');
    const ys = [...new Set(t.lines.map(l => l.y))].sort((a, b) => a - b);
    const lastOfFirst = t.lines.filter(l => l.y === ys[ys.length - 2]);
    expect(lastOfFirst).toHaveLength(1);
  });
});

// a 2×1 PNG (red, blue) so cover vs contain differ
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC';

/** The decoded content stream of a PDF's first page. */
async function pageOps(bytes) {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPage(0).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map(r => doc.context.lookup(r)) : [c];
  return streams.map(s => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1')).join('\n');
}

describe('background images', () => {
  it('draws the image over the background colour and under the text', async () => {
    const items = await itemsOf(box({ backgroundColor: '#eeeeee', backgroundImage: PNG, backgroundFit: 'contain' }));
    const kinds = items.map(i => i.t);
    expect(kinds.indexOf('rect')).toBeLessThan(kinds.indexOf('image'));
    expect(kinds.indexOf('image')).toBeLessThan(kinds.indexOf('text'));
    const img = items.find(i => i.t === 'image');
    expect(img).toMatchObject({ w: 200, h: 20, src: PNG, fit: 'contain' });
  });
  it('defaults to cover, and takes an expression', async () => {
    const items = await itemsOf(box({ backgroundImage: `="${PNG}"` }));
    expect(items.find(i => i.t === 'image')).toMatchObject({ fit: 'cover', src: PNG });
  });
  it('no image when the expression is empty', async () => {
    const items = await itemsOf(box({ backgroundImage: '=""' }));
    expect(items.some(i => i.t === 'image')).toBe(false);
  });
  it('an image item draws its own picture above its background image', async () => {
    const BG = 'data:image/png;base64,AAAA';
    const def = report([{ type: 'image', name: 'I', x: 0, y: 0, w: 50, h: 50, src: PNG, style: { backgroundColor: '#eee', backgroundImage: BG } }]);
    const imgs = (await itemsOf(def)).filter(i => i.t === 'image').map(i => i.src);
    expect(imgs).toEqual([BG, PNG]);
  });
});

describe('PDF: cover images are clipped to their box', () => {
  it('wraps a cover image in a clip; contain needs none', async () => {
    const def = (fit) => report([{ type: 'image', name: 'I', x: 0, y: 0, w: 100, h: 100, src: PNG, fit }]);
    const cover = await pageOps(await exportPdf(await render(def('cover'), { fontStore }), fontStore));
    expect(cover).toMatch(/re\s+W\s+n[\s\S]*?Do/);
    const contain = await pageOps(await exportPdf(await render(def('contain'), { fontStore }), fontStore));
    expect(contain).not.toMatch(/W\s+n/);
  });
});

describe('shrink to fit', () => {
  const long = 'Disbursements across four regions and twelve cities, all products';
  it('steps the font down until the text fits the box, and the box does not grow', async () => {
    const items = await itemsOf(box({ fontSize: 12 }, { w: 120, h: 16, value: long, shrinkToFit: true }));
    const t = items.find(i => i.t === 'text');
    expect(t.size).toBeLessThan(12);
    expect(t.size).toBeGreaterThanOrEqual(4);
    expect(t.clip.h).toBe(16);
    expect(t.lines.map(l => l.text).join(' ')).toBe(long);   // nothing cut, no ellipsis
  });
  it('leaves text that already fits alone', async () => {
    const t = (await itemsOf(box({ fontSize: 12 }, { shrinkToFit: true }))).find(i => i.t === 'text');
    expect(t.size).toBe(12);
  });
  it('without it, the box grows instead', async () => {
    const t = (await itemsOf(box({ fontSize: 12 }, { w: 120, h: 16, value: long }))).find(i => i.t === 'text');
    expect(t.size).toBe(12);
    expect(t.clip.h).toBeGreaterThan(16);
  });
  it('stops at 4pt and then ellipsises', async () => {
    const t = (await itemsOf(box({ fontSize: 12 }, { w: 40, h: 6, value: long.repeat(4), shrinkToFit: true }))).find(i => i.t === 'text');
    expect(t.size).toBe(4);
    expect(t.lines[t.lines.length - 1].text.endsWith('…')).toBe(true);
  });
});

import { pageToSvg } from '../../src/exporters/svg.js';
import { shiftItems } from '../../src/engine/items/paint.js';

/** The last `a b c d e f cm` before the first text object, applied to a point. */
function cmApply(ops, x, y) {
  const m = [...ops.slice(0, ops.indexOf('BT')).matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g)].pop().slice(1).map(Number);
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

describe('rotation', () => {
  const tall = (rotate = 270) => box({}, { w: 20, h: 120, value: 'Quarter one revenue', rotate });
  it('lays the text out along the rotated box and tags every item with the rotation centre', async () => {
    const items = await itemsOf(tall());
    const t = items.find(i => i.t === 'text');
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].w).toBeGreaterThan(20);
    expect(t.rotate.a).toBe(270);
    expect(t.rotate.cx).toBeCloseTo(t.clip.x + t.clip.w / 2, 3);
    expect(t.rotate.cy).toBeCloseTo(t.clip.y + t.clip.h / 2, 3);
    expect(t.clip.w).toBe(120);
    expect(t.clip.h).toBe(20);
  });
  it('does not grow', async () => {
    const items = await itemsOf(box({}, { w: 20, h: 60, value: 'A long label that would wrap a lot', rotate: 90 }));
    const t = items.find(i => i.t === 'text');
    expect(t.clip.w).toBe(60);
    expect(t.clip.h).toBe(20);
  });
  it('the item below a rotated box does not move', async () => {
    const def = report([
      { type: 'textbox', name: 'R', x: 0, y: 0, w: 20, h: 60, value: 'A long label that would wrap a lot', rotate: 90 },
      { type: 'textbox', name: 'B', x: 0, y: 70, w: 100, h: 14, value: 'Below' },
    ]);
    const items = (await render(def, { fontStore })).pages[0].items;
    const r = items.find(i => i.t === 'text' && i.rotate), b = items.find(i => i.t === 'text' && i.lines[0].text === 'Below');
    expect(b.clip.y - r.rotate.cy).toBeCloseTo(70 - 30, 3);
  });
  it('SVG wraps rotated items in a rotate transform', async () => {
    const out = await render(tall(), { fontStore });
    const svg = pageToSvg(out.pages[0], out.width, out.height);
    expect(svg).toMatch(/<g transform="rotate\(270 [\d.]+ [\d.]+\)"><text/);
  });
  it('PDF turns 270° text to read upwards, and 90° to read downwards', async () => {
    for (const [a, dy] of [[270, 10], [90, -10]]) {
      const out = await render(tall(a), { fontStore });
      const t = out.pages[0].items.find(i => i.t === 'text');
      const px = t.rotate.cx, py = out.height - t.rotate.cy;
      const ops = await pageOps(await exportPdf(out, fontStore));
      const [x, y] = cmApply(ops, px + 10, py); // a point 10pt along the unrotated baseline
      expect(x).toBeCloseTo(px, 3);
      expect(y).toBeCloseTo(py + dy, 3);           // PDF y is up: +10 = towards the top of the page
    }
  });
  it('moving a rotated item moves its centre', () => {
    const [moved] = shiftItems([{ t: 'text', lines: [{ x: 0, y: 0, text: 'a', w: 1 }], clip: { x: 0, y: 0, w: 1, h: 1 }, rotate: { a: 90, cx: 5, cy: 6 } }], 10, 20);
    expect(moved.rotate).toEqual({ a: 90, cx: 15, cy: 26 });
  });
  it('a rotated box inside a list or container keeps its centre on the text', async () => {
    const def = report([{ type: 'container', name: 'C', x: 0, y: 50, w: 200, h: 140, items: [
      { type: 'textbox', name: 'R', x: 10, y: 10, w: 20, h: 120, value: 'Quarter one revenue', rotate: 270 },
    ] }]);
    const t = (await render(def, { fontStore })).pages[0].items.find(i => i.t === 'text');
    expect(t.rotate.cx).toBeCloseTo(t.clip.x + t.clip.w / 2, 3);
    expect(t.rotate.cy).toBeCloseTo(t.clip.y + t.clip.h / 2, 3);
  });
});

import { formatValue } from '../../src/engine/expr/format.js';
import { evalValue } from '../../src/engine/expr/evaluate.js';

describe('locale names', () => {
  const d = new Date(2026, 2, 5); // Thursday 5 March 2026
  it('English locales keep the English names', () => {
    expect(formatValue(d, 'dddd dd MMMM yyyy', { locale: 'en-IN' })).toBe('Thursday 05 March 2026');
    expect(formatValue(d, 'ddd dd MMM', { locale: 'en-GB' })).toBe('Thu 05 Mar');
  });
  it('other locales use their own month and day names', () => {
    expect(formatValue(d, 'dd MMMM yyyy', { locale: 'hi-IN' })).toBe('05 मार्च 2026');
    expect(formatValue(d, 'dddd', { locale: 'fr-FR' })).toBe('jeudi');
    expect(formatValue(d, 'MMMM', { locale: 'de-DE' })).toBe('März');
  });
  it('a locale the runtime does not know falls back to English instead of failing', () => {
    expect(formatValue(d, 'MMMM', { locale: 'not a locale' })).toBe('March');
  });
  it('MonthName follows the report locale', () => {
    const ctx = { fields: null, params: {}, globals: {}, dataSets: {}, locale: 'fr-FR' };
    expect(evalValue('=MonthName(3)', ctx)).toBe('mars');
    expect(evalValue('=MonthName(3)', { ...ctx, locale: 'en-IN' })).toBe('March');
    expect(evalValue('=MonthName(3, true)', { ...ctx, locale: 'en-IN' })).toBe('Mar');
  });
});

describe('nothing fixed: decoration metrics come from the font, shrink limits from the item', () => {
  it('underline and strike-through follow the font tables, so a different font moves them', async () => {
    const lineYs = async (fontFamily) => {
      const items = await itemsOf(box({ fontFamily, fontSize: 20, textDecoration: 'underline line-through' }, { h: 40 }));
      const t = items.find(i => i.t === 'text');
      return items.filter(i => i.t === 'line').map(l => +(l.y1 - t.lines[0].y).toFixed(2)).sort((a, b) => a - b);
    };
    const inter = await lineYs('Inter'), mono = await lineYs('JetBrains Mono');
    // Inter: post.underlinePosition -348, thickness 140, OS/2 strikeout 671/140, 2048 units per em
    expect(inter[1]).toBeCloseTo(20 * (348 + 70) / 2048, 2);
    expect(inter[0]).toBeCloseTo(-20 * (671 - 70) / 2048, 2);
    expect(mono).not.toEqual(inter);
  });
  it('the decoration colour can differ from the text colour', async () => {
    const items = await itemsOf(box({ color: '#111111', textDecoration: 'underline', textDecorationColor: '#ff0000' }));
    expect(items.find(i => i.t === 'line').stroke).toBe('#ff0000');
  });
  it('a text box sets its own shrink minimum and step', async () => {
    const long = 'Disbursements across four regions and twelve cities, all products'.repeat(4);
    const t = (await itemsOf(box({ fontSize: 12 }, { w: 40, h: 6, value: long, shrinkToFit: true, minFontSize: 7, shrinkStep: 1 }))).find(i => i.t === 'text');
    expect(t.size).toBe(7);
    const t2 = (await itemsOf(box({ fontSize: 12 }, { w: 120, h: 16, value: long.slice(0, 66), shrinkToFit: true, shrinkStep: 1 }))).find(i => i.t === 'text');
    expect(Number.isInteger(t2.size)).toBe(true);
  });
});
