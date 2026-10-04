# Phase 1: Text and styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close audit rows "Underline, strike-through, justify, background images", "Shrink-to-fit, rotation, condensed text" (both behind) and "Locale-aware formatting" (partial). See `2026-10-04-arjs-parity-roadmap.md`, Phase 1.

**Architecture:**
- The engine already turns every report into a page model of `text`, `line`, `rect`, `image` and `link` items, and every exporter (PDF, SVG/viewer, HTML) draws those items.
- So most features here are new items emitted by the engine:
  - Underline and strike-through are `line` items.
  - Justify places each word as its own text run.
  - A background image is an `image` item.
- That gives every output the features without per-exporter code.
- Exporter changes are needed only where the page model gains something new:
  - Rotation (`rotate` on an item): SVG and PDF.
  - Clipping of `cover` images in PDF: an existing bug that background images would expose.
  - Word run properties.

**Tech Stack:** plain JS with JSDoc (`// @ts-check`), Vitest, pdf-lib (PDF), hand-written WordprocessingML (docx), Next.js 16 designer (React).

---

## Conventions for whoever runs this plan

- Work in a worktree off `main` on branch `feat/p1-text-styling`. Node 22: prefix commands with `PATH=/usr/local/bin:$PATH`. Set `TZ=Asia/Kolkata` for tests.
- Run one test file: `npx vitest run tests/engine/text-styling.test.js`. Run everything: `npx vitest run`.
- The engine must stay framework-free. After engine edits, run `node scripts/check-engine-boundary.mjs`.
- Commit after every task. The message uses `feat(engine): …` / `feat(designer): …` / `fix(pdf): …`. **No `Co-Authored-By` trailer** (repository owner's rule).
- Test helpers live in `tests/helpers.js`:
  - `fontStore`
  - `texts(page)` returns every text line string on a page
  - `report(bodyItems, {data, def})` builds a minimal A4 report whose data set `Rows` comes from `data.rows`
- `render(def, {fontStore})` returns `{pages:[{items}], warnings}`. Items carry final page coordinates, in points.

## File map

| File | Change |
|---|---|
| `src/engine/text/measure.js` | `wrap()` marks the last line of each paragraph with `end: true` (needed by justify) |
| `src/engine/items/paint.js` | `paintBox`: decorations, justify, background image; `shiftItems`: move `rotate` centres |
| `src/engine/items/index.js` | `paintTextbox`: shrink-to-fit and rotation layout; textbox `layout`: rotation; textbox props; `TEXT_STYLE_PROPS` |
| `src/engine/expr/format.js` | `formatDate(d, fmt, locale)`: locale month and day names |
| `src/engine/expr/evaluate.js` | `MonthName` follows `ctx.locale` |
| `src/exporters/svg.js` | `<g transform="rotate(…)">` around rotated items |
| `src/exporters/pdf.js` | rotation via `cm`; clip `cover` images to their box |
| `src/exporters/docx.js` | `<w:u>`, `<w:strike>`, justified paragraphs |
| `src/designer/Canvas.jsx` | canvas preview of decoration, justify, background image |
| `src/importers/rdlx.js` | map TextDecoration, Justify, BackgroundImage (static URL), ShrinkToFit, Angle instead of warning |
| `tests/engine/text-styling.test.js` | new: all engine and exporter tests for this phase |
| `tests/engine/rdlx.test.js` | importer mapping test |
| `reports/style-showcase.pw.json` + `reports/__tests__/style-showcase.test.json` | new: a report that uses every feature, for snapshots and eyeballing |

---

### Task 1: Underline and strike-through

**Files:**
- Modify: `src/engine/items/paint.js` (`paintBox`, the block that pushes the `text` item)
- Create: `tests/engine/text-styling.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/text-styling.test.js`:

```js
// Phase 1 text styling: decorations, justify, background images, shrink-to-fit, rotation, locale names.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

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
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: FAIL. The decoration tests find 0 `line` items, and `t.deco` is undefined.

- [ ] **Step 3: Implement**

In `src/engine/items/paint.js`, replace this line in `paintBox`:

```js
    if (out.length) items.push({ t: 'text', font: key, size, color: st.color || '#000', lines: out, clip: { x, y, w, h } });
```

with:

```js
    if (out.length) {
      const deco = String(st.textDecoration || '').toLowerCase();
      const text = { t: 'text', font: key, size, color: st.color || '#000', lines: out, clip: { x, y, w, h } };
      if (/underline|line-through/.test(deco)) text.deco = deco;
      items.push(text);
      // decorations are plain lines, so every exporter draws them without special code
      const th = Math.max(0.5, size / 14);
      for (const l of out) {
        if (deco.includes('underline')) items.push({ t: 'line', x1: l.x, y1: l.y + size * 0.12, x2: l.x + l.w, y2: l.y + size * 0.12, stroke: st.color || '#000', strokeWidth: th, dash: null });
        if (deco.includes('line-through')) items.push({ t: 'line', x1: l.x, y1: l.y - size * 0.28, x2: l.x + l.w, y2: l.y - size * 0.28, stroke: st.color || '#000', strokeWidth: th, dash: null });
      }
    }
```

Then add `textDecoration: 'none',` to `BASE_STYLE` in `src/engine/style.js`, after `wrap: true,`. That documents the key, and named styles can then reset it.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 4 passed.

- [ ] **Step 5: Run everything (snapshots must not change: no existing report sets textDecoration)**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports`
Expected: all pass, and `pw test` reports `0 failed`.

`reports/sales-explorer.pw.json` and its siblings set `textDecoration: 'underline'` on their drill links. Those snapshots only hold text, so they do not change, but the links now render underlined. That is intended.

- [ ] **Step 6: Commit**

```bash
git add src/engine/items/paint.js src/engine/style.js tests/engine/text-styling.test.js
git commit -m "feat(engine): underline and strike-through (textDecoration)"
```

---

### Task 2: Justified text

**Files:**
- Modify: `src/engine/text/measure.js` (`wrap`, the final `push()` of each paragraph)
- Modify: `src/engine/items/paint.js` (`paintBox`, the `lines.map(...)` that positions lines)
- Test: `tests/engine/text-styling.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/engine/text-styling.test.js`)

```js
describe('justify', () => {
  const para = 'The quick brown fox jumps over the lazy dog while the cat watches from the old stone wall.\nShort line.';
  it('stretches every wrapped line to both edges except the last line of each paragraph', async () => {
    const items = await itemsOf(box({ textAlign: 'justify', padding: 2 }, { w: 140, h: 120, value: para }));
    const t = items.find(i => i.t === 'text');
    const rows = [...new Set(t.lines.map(l => l.y))].sort((a, b) => a - b).map(y => t.lines.filter(l => l.y === y));
    expect(rows.length).toBeGreaterThan(3);
    const right = (row) => Math.max(...row.map(l => l.x + l.w));
    const left = (row) => Math.min(...row.map(l => l.x));
    // first row: one run per word, flush to both edges (box 140 wide, padding 2)
    expect(rows[0].length).toBeGreaterThan(1);
    expect(left(rows[0])).toBeCloseTo(t.clip.x + 2, 1);
    expect(right(rows[0])).toBeCloseTo(t.clip.x + 138, 1);
    // the last row of each paragraph stays left-aligned, as one run
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
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js -t justify`
Expected: FAIL. `rows[0]` has length 1, because lines are not split into words.

- [ ] **Step 3: Implement**

(a) In `src/engine/text/measure.js`, `wrap()` fast path: mark the paragraph's last line. Replace the `push();` that follows the `for (let wi …)` loop (the last statement inside `for (const para …)` before its closing brace) with:

```js
      push();
      out[out.length - 1].end = true; // the last line of a paragraph: justify leaves it ragged
```

Complex scripts (`wrapComplex`) are not marked, and justify skips lines that have `dir`, so right-to-left and shaped text keep their alignment. That is deliberate: inter-word stretching in shaped scripts needs per-cluster positioning.

(b) In `src/engine/items/paint.js` `paintBox`, change `const out = lines.map((ln, i) => {` … `}).filter(l => l.text !== '');` to:

```js
    const out = lines.flatMap((ln, i) => {
      // auto: numbers right, text by its paragraph direction (Arabic and Hebrew right)
      const align = auto ? (numeric || ln.dir === 'rtl' ? 'right' : 'left') : st.textAlign;
      const ly = top + i * lh + half + ascent;
      // justify: each word becomes its own run, spread across the line; a paragraph's last line and
      // shaped or right-to-left lines stay as they are
      if (align === 'justify' && !ln.end && !ln.dir && i < tl.lines.length - 1) {
        const words = ln.text.split(' ').filter(Boolean);
        if (words.length > 1) {
          const ws = words.map(wd => m.width(wd, key, size));
          const gap = (tl.inner - ws.reduce((s, v) => s + v, 0)) / (words.length - 1);
          let wx = x + pad[3];
          return words.map((wd, k) => { const o = { x: wx, y: ly, text: wd, w: ws[k] }; wx += ws[k] + gap; return o; });
        }
      }
      let lx = x + pad[3];
      if (align === 'right') lx = x + w - pad[1] - ln.width;
      else if (align === 'center') lx = x + pad[3] + (tl.inner - ln.width) / 2;
      const o = { x: lx, y: ly, text: ln.text, w: ln.width };
      if (ln.dir) o.dir = ln.dir;
      return [o];
    }).filter(l => l.text !== '');
```

Underlines (Task 1) now draw per word for justified lines, leaving the gaps between words plain. That matches Word's default "underline words only" look closely enough, and is accepted.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 6 passed.

- [ ] **Step 5: Run everything**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports`
Expected: all pass. The `end` flag is an extra property, so nothing else reads it.

- [ ] **Step 6: Commit**

```bash
git add src/engine/text/measure.js src/engine/items/paint.js tests/engine/text-styling.test.js
git commit -m "feat(engine): justified text"
```

---

### Task 3: Background images, and clip `cover` images in PDF

**Files:**
- Modify: `src/engine/items/paint.js` (`paintBox`, right after the background `rect`)
- Modify: `src/engine/style.js` (`BASE_STYLE`)
- Modify: `src/exporters/pdf.js` (`case 'image'`)
- Test: `tests/engine/text-styling.test.js`

- [ ] **Step 1: Write the failing tests** (append)

```js
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../../src/exporters/pdf.js';

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
```

(That data URI was generated and checked: pdf-lib embeds it as a 2×1 image.)

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js -t "background|cover"`
Expected:
- The background tests FAIL (no `image` item).
- The PDF cover test FAILS (no clip before `Do`).

- [ ] **Step 3: Implement**

(a) `src/engine/style.js` `BASE_STYLE`: add after `backgroundColor: null,`:

```js
  backgroundImage: null,  // URL or data URI (an expression is fine)
  backgroundFit: 'cover', // cover | contain | fill
```

(b) `src/engine/items/paint.js` `paintBox`: after `if (st.backgroundColor) items.push({ t: 'rect', x, y, w, h, fill: st.backgroundColor });` add:

```js
  if (st.backgroundImage) items.push({ t: 'image', x, y, w, h, src: String(st.backgroundImage), fit: st.backgroundFit || 'cover' });
```

`resolveStyle` already evaluates `=expressions` and drops failures to `undefined`. An empty-string result is falsy, so no image is drawn.

(c) `src/exporters/pdf.js` `case 'image'`: replace the final `p.drawImage(img, { x, y: H - y - h, width: w, height: h });` with:

```js
          // cover overflows its box by design: clip it, as SVG's preserveAspectRatio slice does
          if (it.fit === 'cover') p.pushOperators(pushGraphicsState(), rectangle(it.x, H - it.y - it.h, it.w, it.h), clip(), endPath());
          p.drawImage(img, { x, y: H - y - h, width: w, height: h });
          if (it.fit === 'cover') p.pushOperators(popGraphicsState());
```

`pushGraphicsState`, `rectangle`, `clip`, `endPath` and `popGraphicsState` are already imported at the top of `pdf.js`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 10 passed.

- [ ] **Step 5: Run everything**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/style.js src/engine/items/paint.js src/exporters/pdf.js tests/engine/text-styling.test.js
git commit -m "feat(engine): background images on any box; fix(pdf): clip cover images to their box"
```

---

### Task 4: Shrink-to-fit

**Files:**
- Modify: `src/engine/items/index.js` (`paintTextbox`, about line 45; the textbox `props`)
- Test: `tests/engine/text-styling.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
describe('shrink to fit', () => {
  const long = 'Disbursements across four regions and twelve cities, all products';
  it('steps the font down until the text fits the box, and the box does not grow', async () => {
    const items = await itemsOf(box({ fontSize: 12 }, { w: 120, h: 16, value: long, shrinkToFit: true }));
    const t = items.find(i => i.t === 'text');
    expect(t.size).toBeLessThan(12);
    expect(t.size).toBeGreaterThanOrEqual(4);
    expect(t.clip.h).toBe(16);
    const words = t.lines.map(l => l.text).join(' ');
    expect(words).toBe(long);                                  // nothing cut, no ellipsis
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
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js -t "shrink"`
Expected: FAIL. The size stays 12 and the box grows.

- [ ] **Step 3: Implement**

Replace `paintTextbox` in `src/engine/items/index.js` with:

```js
const MIN_SHRINK_SIZE = 4;
function paintTextbox(item, lc, ctx, forcedH) {
  let st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
  const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'TextBox');
  const text = textOf(r.v, st, ctx);
  let tl = layoutTextLines(text, st, item.w, lc.m);
  // shrink to fit: step the font down (0.5pt at a time, not below 4pt) until the text fits the designed height
  if (item.shrinkToFit) {
    let size = Number(st.fontSize) || 9;
    while (tl.needed > item.h + GROW_TOLERANCE && size > MIN_SHRINK_SIZE) {
      size = Math.max(MIN_SHRINK_SIZE, size - 0.5);
      st = { ...st, fontSize: size };
      tl = layoutTextLines(text, st, item.w, lc.m);
    }
  }
  let h = item.h;
  if (forcedH == null) {
    // Growth under 1pt is ignored: it would only push items below by a hair. Shrink-to-fit never grows.
    if (item.canGrow !== false && !item.shrinkToFit && tl.needed > h + GROW_TOLERANCE) h = tl.needed;
    if (item.canShrink && tl.needed < h) h = tl.needed;
  } else h = forcedH;
  return { st, tl, h, numeric: typeof r.v === 'number' };
}
```

Add to the textbox `props` array, after the `canShrink` entry:

```js
    { key: 'shrinkToFit', label: 'Shrink text to fit', type: 'bool', category: 'Layout' },
```

The roadmap says "condensed text" is folded in. ActiveReportsJS's MinCondenseRate squeezes text horizontally, and shrink-to-fit is the closest output we produce. The importer (Task 8) maps both to `shrinkToFit`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 14 passed.

- [ ] **Step 5: Run everything**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/items/index.js tests/engine/text-styling.test.js
git commit -m "feat(engine): shrink text to fit"
```

---

### Task 5: Rotated text boxes

**Files:**
- Modify: `src/engine/items/index.js` (`paintTextbox` layout width; textbox `layout`; textbox `props`)
- Modify: `src/engine/items/paint.js` (`shiftItems`)
- Modify: `src/exporters/svg.js` (`pageToSvg` loop)
- Modify: `src/exporters/pdf.js` (page item loop; import `concatTransformationMatrix`)
- Test: `tests/engine/text-styling.test.js`

**Model:**
- A rotated text box keeps its designed rectangle on the page.
- Its text is laid out in a box of the same size rotated by `rotate` degrees, clockwise as on screen, about the rectangle's centre.
- For ±90° and ±270° the layout box swaps width and height, so a tall narrow box reads bottom-to-top (270) or top-to-bottom (90).
- Every page-model item the box produces carries `rotate: {a, cx, cy}`, and the exporters wrap it in a rotation transform.
- A rotated box never grows or splits across pages. Its link hit area stays the unrotated rectangle.

- [ ] **Step 1: Write the failing tests** (append)

```js
import { pageToSvg } from '../../src/exporters/svg.js';
import { shiftItems } from '../../src/engine/items/paint.js';

describe('rotation', () => {
  const tall = () => box({}, { w: 20, h: 120, value: 'Quarter one revenue', rotate: 270 });
  it('lays the text out along the rotated box and tags every item with the rotation centre', async () => {
    const items = await itemsOf(tall());
    const t = items.find(i => i.t === 'text');
    expect(t.lines).toHaveLength(1);                         // 120pt of run length: one line
    expect(t.lines[0].w).toBeGreaterThan(20);
    expect(t.rotate.a).toBe(270);
    expect(t.rotate.cx).toBeCloseTo(t.clip.x + t.clip.w / 2, 3);
    expect(t.rotate.cy).toBeCloseTo(t.clip.y + t.clip.h / 2, 3);
    expect(t.clip.w).toBe(120);                              // the layout box is the swapped one
    expect(t.clip.h).toBe(20);
  });
  it('does not grow', async () => {
    const items = await itemsOf(box({}, { w: 20, h: 60, value: 'A long label that would wrap a lot', rotate: 90 }));
    const t = items.find(i => i.t === 'text');
    expect(t.clip.w).toBe(60);
    expect(t.clip.h).toBe(20);
  });
  it('SVG wraps rotated items in a rotate transform', async () => {
    const out = await render(tall(), { fontStore });
    const svg = pageToSvg(out.pages[0], out.width, out.height);
    expect(svg).toMatch(/<g transform="rotate\(270 [\d.]+ [\d.]+\)"><text/);
  });
  it('PDF applies a transformation matrix around rotated items', async () => {
    const ops = await pageOps(await exportPdf(await render(tall(), { fontStore }), fontStore));
    expect(ops).toMatch(/q\s+[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ cm/);
  });
  it('moving a rotated item moves its centre', () => {
    const [moved] = shiftItems([{ t: 'text', lines: [{ x: 0, y: 0, text: 'a', w: 1 }], clip: { x: 0, y: 0, w: 1, h: 1 }, rotate: { a: 90, cx: 5, cy: 6 } }], 10, 20);
    expect(moved.rotate).toEqual({ a: 90, cx: 15, cy: 26 });
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js -t rotation`
Expected: FAIL. `t.rotate` is undefined, and the text wraps into many lines.

- [ ] **Step 3: Implement**

(a) `src/engine/items/index.js`: at the top of `paintTextbox`, compute the layout box for a rotation. Replace the start of `paintTextbox`, from `let st = …` through `let tl = layoutTextLines(text, st, item.w, lc.m);`, with:

```js
  let st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
  const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'TextBox');
  const text = textOf(r.v, st, ctx);
  const rot = rotationOf(item);
  const layoutW = rot?.swap ? item.h : item.w;
  let tl = layoutTextLines(text, st, layoutW, lc.m);
```

In the shrink loop, use `layoutTextLines(text, st, layoutW, lc.m)`. Then change the growth block so a rotated box keeps its size:

```js
  if (forcedH == null) {
    if (item.canGrow !== false && !item.shrinkToFit && !rot && tl.needed > h + GROW_TOLERANCE) h = tl.needed;
    if (item.canShrink && !rot && tl.needed < h) h = tl.needed;
  } else h = forcedH;
  return { st, tl, h, numeric: typeof r.v === 'number', rot };
```

Add above `paintTextbox`:

```js
/** A text box's rotation: degrees clockwise (any angle); swap = the layout box is turned on its side. */
function rotationOf(item) {
  const a = ((Number(item.rotate) || 0) % 360 + 360) % 360;
  if (!a) return null;
  return { a, swap: a === 90 || a === 270 };
}
```

(b) In the textbox `layout`, use the returned `rot`. Change `const { st, tl, h, numeric } = paintTextbox(...)` to `const { st, tl, h, numeric, rot } = paintTextbox(item, lc, ctx, lc.fixed ? item.h : null);`. Change the split condition to `if (!rot && !lc.fixed && h > lc.maxUnitHeight && tl.lines.length > 1) {`. Then replace `const items = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl, numeric, m: lc.m });` with:

```js
    let items;
    if (rot) {
      // lay out in the turned box, centred on the item's centre, then rotate every piece about that centre
      const cx = item.x + item.w / 2, cy = h / 2;
      const bw = rot.swap ? h : item.w, bh = rot.swap ? item.w : h;
      items = paintBox({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, st, tl, numeric, m: lc.m }).map(i => ({ ...i, rotate: { a: rot.a, cx, cy } }));
    } else items = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl, numeric, m: lc.m });
```

Add to the textbox `props`, after `shrinkToFit`:

```js
    { key: 'rotate', label: 'Rotate (degrees clockwise)', type: 'number', category: 'Layout' },
```

(c) `src/engine/items/paint.js` `shiftItems`: make the rotation centre move with the item. Replace the whole function with:

```js
/** Move page-model items by (dx, dy). Returns new objects. */
export function shiftItems(items, dx, dy) {
  return items.map((it) => {
    let o;
    switch (it.t) {
      case 'text': o = { ...it, lines: it.lines.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })), clip: it.clip && { ...it.clip, x: it.clip.x + dx, y: it.clip.y + dy } }; break;
      case 'line': o = { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy }; break;
      case 'ellipse': o = { ...it, cx: it.cx + dx, cy: it.cy + dy }; break;
      case 'field': o = { ...it, x: it.x + dx, y: it.y + dy, draw: shiftItems(it.draw, dx, dy) }; break;
      default: o = { ...it, x: it.x + dx, y: it.y + dy };
    }
    if (it.rotate) o.rotate = { ...it.rotate, cx: it.rotate.cx + dx, cy: it.rotate.cy + dy };
    return o;
  });
}
```

Before relying on `shiftItems` alone, check that nothing else moves items: `grep -rn "\.y + \|y: it.y" src/engine/paginate src/engine/index.js`. Any other place that rebuilds items with new coordinates must also shift `rotate`. If one is found, route it through `shiftItems`, or add the same `rotate` line there.

(d) `src/exporters/svg.js` `pageToSvg`: wrap each rotated item. At the top of the `for (const it of …)` loop body add:

```js
    if (it.rotate) out.push(`<g transform="rotate(${n(it.rotate.a)} ${n(it.rotate.cx)} ${n(it.rotate.cy)})">`);
```

and after the `switch (…) { … }` closing brace, still inside the loop, add:

```js
    if (it.rotate) out.push('</g>');
```

(e) `src/exporters/pdf.js`:
- Add `concatTransformationMatrix` to the pdf-lib import list on line 2–3.
- In the page loop (`for (const it of pg.items) {`), add at the top of the loop body:

```js
      if (it.rotate) {
        // screen rotation is clockwise with y down; PDF's y is up, so the angle flips
        const t = -it.rotate.a * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
        const px = it.rotate.cx, py = H - it.rotate.cy;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(c, s, -s, c, px - px * c + py * s, py - px * s - py * c));
      }
```

and after the `switch (it.t) { … }` closing brace, still inside the loop:

```js
      if (it.rotate) p.pushOperators(popGraphicsState());
```

Check that no `case` returns or `continue`s out of the loop. Every case ends in `break`; if one uses `continue`, change it to `break` so the pop always runs.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 19 passed.

- [ ] **Step 5: Look at it**

Render the PDF and the SVG and check that the text reads bottom-to-top inside the 20×120 box:

```bash
cat > /tmp/rot.pw.json <<'EOF'
{"$schema":"pagewright/report@1","name":"Rot","page":{"size":"A4","margins":[36,36,36,36]},"dataSources":[],"dataSets":[],
 "sections":{"pageHeader":{"height":0,"items":[]},"body":{"items":[
  {"type":"shape","name":"Frame","shape":"rect","x":0,"y":0,"w":20,"h":120,"style":{"fill":null,"stroke":"#999"}},
  {"type":"textbox","name":"T","x":0,"y":0,"w":20,"h":120,"value":"Quarter one revenue","rotate":270,"style":{"textAlign":"center","verticalAlign":"middle"}}]},
 "pageFooter":{"height":0,"items":[]}}}
EOF
PATH=/usr/local/bin:$PATH node bin/pw.mjs render /tmp/rot.pw.json -f pdf -o /tmp/rot.pdf && open /tmp/rot.pdf
```

Expected: the label is centred in the frame and reads upwards. If it reads downwards, the PDF sign is wrong: flip `t` to `+it.rotate.a …` and re-run the tests and the look.

- [ ] **Step 6: Run everything**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports && node scripts/check-engine-boundary.mjs`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/engine/items/index.js src/engine/items/paint.js src/exporters/svg.js src/exporters/pdf.js tests/engine/text-styling.test.js
git commit -m "feat(engine): rotated text boxes (SVG, PDF and viewer)"
```

---

### Task 6: Month and day names in the report's language

**Files:**
- Modify: `src/engine/expr/format.js` (`formatValue`, `formatDate`)
- Modify: `src/engine/expr/evaluate.js:303` (`monthname`)
- Test: `tests/engine/text-styling.test.js`

**Rule:**
- Locales starting with `en` keep today's English names, so snapshots do not move and `MMM` stays a three-letter cut.
- Any other locale uses `Intl.DateTimeFormat(locale)` names.

- [ ] **Step 1: Write the failing test** (append)

```js
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
  it('MonthName follows the report locale', () => {
    const ctx = { fields: null, params: {}, globals: {}, dataSets: {}, locale: 'fr-FR' };
    expect(evalValue('=MonthName(3)', ctx)).toBe('mars');
    expect(evalValue('=MonthName(3)', { ...ctx, locale: 'en-IN' })).toBe('March');
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js -t "locale names"`
Expected: FAIL. You get `'05 March 2026'` for hi-IN.

- [ ] **Step 3: Implement**

`src/engine/expr/format.js`:
- In `formatValue`, change the date branch to pass the locale:

```js
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : formatDate(value, fmt || 'dd MMM yyyy', locale);
```

- Replace `formatDate`'s signature and the four name cases:

```js
const dtfCache = new Map();
/** Month or weekday name in a non-English locale (English keeps the fixed tables, so output never shifts). */
function localName(locale, kind, style, d) {
  const key = `${locale}|${kind}|${style}`;
  let f = dtfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { [kind]: style }); dtfCache.set(key, f); }
  return f.format(d);
}
const english = (locale) => !locale || /^en\b/i.test(locale);

/** @param {Date} d @param {string} fmt @param {string} [locale] */
export function formatDate(d, fmt, locale) {
  if (fmt === 'd') return formatDate(d, 'dd/MM/yyyy', locale);
  if (fmt === 'D') return formatDate(d, 'dddd, dd MMMM yyyy', locale);
  if (fmt === 'g') return formatDate(d, 'dd/MM/yyyy HH:mm', locale);
  const en = english(locale);
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt|'[^']*'/g, (tok) => {
    switch (tok) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return String(d.getFullYear()).slice(-2);
      case 'MMMM': return en ? MONTHS[d.getMonth()] : localName(locale, 'month', 'long', d);
      case 'MMM': return en ? MONTHS[d.getMonth()].slice(0, 3) : localName(locale, 'month', 'short', d);
      case 'MM': return String(d.getMonth() + 1).padStart(2, '0');
      case 'M': return String(d.getMonth() + 1);
      case 'dddd': return en ? DAYS[d.getDay()] : localName(locale, 'weekday', 'long', d);
      case 'ddd': return en ? DAYS[d.getDay()].slice(0, 3) : localName(locale, 'weekday', 'short', d);
      case 'dd': return String(d.getDate()).padStart(2, '0');
      case 'd': return String(d.getDate());
      case 'HH': return String(d.getHours()).padStart(2, '0');
      case 'H': return String(d.getHours());
      case 'hh': return String(((d.getHours() + 11) % 12) + 1).padStart(2, '0');
      case 'h': return String(((d.getHours() + 11) % 12) + 1);
      case 'mm': return String(d.getMinutes()).padStart(2, '0');
      case 'ss': return String(d.getSeconds()).padStart(2, '0');
      case 'tt': return d.getHours() < 12 ? 'AM' : 'PM';
      default: return tok.slice(1, -1);
    }
  });
}
```

`isoDate` calls `formatDate(d, 'yyyy-MM-dd')` and stays unchanged; it has no names.

`src/engine/expr/evaluate.js` line 303: replace the `monthname` entry with:

```js
  monthname: (ctx, m, abbr) => {
    const d = new Date(2000, Number(m) - 1, 1);
    const en = !ctx.locale || /^en\b/i.test(ctx.locale);
    const s = d.toLocaleString(en ? 'en' : ctx.locale, { month: 'long' });
    return truthy(abbr) ? (en ? s.slice(0, 3) : d.toLocaleString(ctx.locale, { month: 'short' })) : s;
  },
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/text-styling.test.js`
Expected: 22 passed. If the `hi-IN` assertion differs only in how Node's ICU spells the month, print the actual value with `node -e "console.log(new Intl.DateTimeFormat('hi-IN',{month:'long'}).format(new Date(2026,2,5)))"` and use that exact string. The assertion is about the locale being used, not the spelling.

- [ ] **Step 5: Run everything, including the Hindi sample report's snapshot**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run && node bin/pw.mjs test reports`

Expected: all pass. If `loan-statement-hindi` has `locale: 'hi-IN'` and formats dates with `MMM`, its PDF changes (Hindi month names, which is the point). It has no `pw test` case, so no snapshot fails. Render it once and look:

```bash
node bin/pw.mjs render reports/loan-statement-hindi.pw.json -d loans=reports/__tests__/loan-statement.data.json -f pdf -o /tmp/hi.pdf && open /tmp/hi.pdf
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/expr/format.js src/engine/expr/evaluate.js tests/engine/text-styling.test.js
git commit -m "feat(engine): month and day names follow the report locale"
```

---

### Task 7: Word export: underline, strike-through, justify

**Files:**
- Modify: `src/exporters/docx.js` (`rPr`, `alignOf`)
- Test: `tests/engine/docx.test.js`

- [ ] **Step 1: Write the failing test** (append inside `describe('Word export', …)` in `tests/engine/docx.test.js`)

```js
  it('keeps underline, strike-through and justify', async () => {
    const { report } = await import('../helpers.js');
    const def = report([
      { type: 'textbox', name: 'U', x: 0, y: 0, w: 200, h: 20, value: 'Underlined', style: { textDecoration: 'underline' } },
      { type: 'textbox', name: 'S', x: 0, y: 30, w: 200, h: 20, value: 'Struck', style: { textDecoration: 'line-through' } },
      { type: 'textbox', name: 'J', x: 0, y: 60, w: 140, h: 120, value: 'The quick brown fox jumps over the lazy dog while the cat watches.', style: { textAlign: 'justify' } },
    ]);
    const doc = strFromU8(unzipSync(await exportDocx(await render(def, { fontStore })))['word/document.xml']);
    const runOf = (text) => doc.split('<w:r>').find(r => r.includes(`>${text}<`));
    expect(runOf('Underlined')).toContain('<w:u w:val="single"/>');
    expect(runOf('Struck')).toContain('<w:strike/>');
    expect(doc).toContain('<w:jc w:val="both"/>');
  });
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/docx.test.js`
Expected: FAIL on `<w:u w:val="single"/>`.

The justified box exports as many one-word runs, each its own paragraph. That is why `alignOf` needs to know about justify. A justified box must stay one paragraph, so step 3(b) merges a justified text item's runs back into lines.

- [ ] **Step 3: Implement**

(a) `rPr(it)`: add decorations. Replace the `<w:color …/>` segment's surroundings so the function reads:

```js
function rPr(it) {
  const f = String(it.font || '');
  const family = /mono/i.test(f) ? 'JetBrains Mono' : f.split('-')[0] || 'Inter';
  const deco = String(it.deco || '');
  return `<w:rPr><w:rFonts w:ascii="${esc(family)}" w:hAnsi="${esc(family)}" w:cs="${esc(family)}"/>${/bold/i.test(f) ? '<w:b/>' : ''}${/italic/i.test(f) ? '<w:i/>' : ''}${deco.includes('line-through') ? '<w:strike/>' : ''}<w:color w:val="${hex(it.color)}"/><w:sz w:val="${Math.round((it.size || 9) * 2)}"/>${deco.includes('underline') ? '<w:u w:val="single"/>' : ''}</w:rPr>`;
}
```

The element order inside `w:rPr` follows the schema: rFonts, b, i, strike, color, sz, u.

(b) Justified items: in the engine, a justified text item has several runs on the same `y`. In `textOf(it)`, join the runs of one visual line with a single space, in x order, and lines with a space. Replace `const textOf = …` with:

```js
const textOf = (it) => {
  const rows = new Map();
  for (const l of it.lines) (rows.get(l.y) || rows.set(l.y, []).get(l.y)).push(l);
  return [...rows.keys()].sort((a, b) => a - b).map(y => rows.get(y).sort((a, b) => a.x - b.x).map(l => l.text).join(' ')).join(' ');
};
/** True when a text item is justified: some visual line has several runs. */
const justified = (it) => new Set(it.lines.map(l => l.y)).size < it.lines.length;
```

In `alignOf(it)`, return `'both'` first: add `if (justified(it)) return 'both';` as the first line of the function. `w:jc` with `both` is Word's justify.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/docx.test.js`
Expected: 5 passed (4 old, 1 new). The textutil test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/exporters/docx.js tests/engine/docx.test.js
git commit -m "feat(docx): underline, strike-through and justified paragraphs"
```

---

### Task 8: ActiveReports importer maps the new properties

**Files:**
- Modify: `src/importers/rdlx.js` (`ALIGN` at line 68; `textStyle` deco and background lines; `textbox()`)
- Test: `tests/engine/rdlx.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/engine/rdlx.test.js`)

```js
describe('text styling (phase 1)', () => {
  const one = (Item) => importRdlx({ Body: { ReportItems: [{ Type: 'textbox', Name: 'T', Value: 'Hi', Width: '2in', Height: '0.25in', ...Item }] } });
  it('maps decoration, justify, background image, shrink-to-fit and angle without warnings', () => {
    const r = one({ Style: { TextDecoration: 'Underline', TextAlign: 'Justify', BackgroundImage: { Source: 'External', Value: 'https://example.com/bg.png' } }, ShrinkToFit: 'true', Angle: '90' });
    const t = r.definition.sections.body.items[0];
    expect(t.style).toMatchObject({ textDecoration: 'underline', textAlign: 'justify', backgroundImage: 'https://example.com/bg.png' });
    expect(t.shrinkToFit).toBe(true);
    expect(t.rotate).toBe(90);
    expect(r.warnings.join(' ')).not.toMatch(/underline|background image|justify/i);
  });
  it('maps LineThrough and MinCondenseRate', () => {
    const t = one({ Style: { TextDecoration: 'LineThrough' }, MinCondenseRate: '80' }).definition.sections.body.items[0];
    expect(t.style.textDecoration).toBe('line-through');
    expect(t.shrinkToFit).toBe(true);
  });
  it('still warns about embedded or database background images', () => {
    const r = one({ Style: { BackgroundImage: { Source: 'Database', Value: '=Fields!Logo.Value' } } });
    expect(r.warnings.join(' ')).toMatch(/background image/);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/rdlx.test.js -t "phase 1"`
Expected: FAIL. `textDecoration` is undefined, and the warnings mention underline.

- [ ] **Step 3: Implement**

- Line 68: change `justify: 'left'` to `justify: 'justify'`.
- In `textStyle`, replace the two lines that warn about decoration with:

```js
    const deco = String(st.TextDecoration || '').toLowerCase();
    if (deco === 'underline' || deco === 'doubleunderline') set('textDecoration', 'underline');
    else if (deco === 'linethrough') set('textDecoration', 'line-through');
    else if (deco === 'overline') t.approx('its overline is not drawn.');
```

- Replace `if (st.BackgroundImage?.Value) t.approx('its background image is not drawn.');` with:

```js
  const bg = st.BackgroundImage;
  if (bg?.Value) {
    // an external URL works as is; embedded and database images need Phase 7's image sources
    if (/^external$/i.test(String(bg.Source || 'External')) && !isExpr(bg.Value)) set('backgroundImage', String(bg.Value));
    else t.approx('its background image is not drawn.');
  }
```

- In `textbox()`, after `if (isTrue(ar.CanShrink)) it.canShrink = true;` add:

```js
  if (isTrue(ar.ShrinkToFit) || Number(ar.MinCondenseRate) > 0 && Number(ar.MinCondenseRate) < 100) it.shrinkToFit = true;
  const angle = Number(ar.Angle);
  if (angle && !isExpr(ar.Angle)) it.rotate = angle;
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata npx vitest run tests/engine/rdlx.test.js`
Expected: all pass, including the 40 existing ones. If an existing fixture test asserted a "not drawn" warning for a decoration or justify, update it: that loss is now handled. Note this in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/importers/rdlx.js tests/engine/rdlx.test.js
git commit -m "feat(importer): map text decoration, justify, background URL, shrink-to-fit and angle"
```

---

### Task 9: Designer controls and canvas preview, showcase report, phase gate

**Files:**
- Modify: `src/engine/items/index.js` (`TEXT_STYLE_PROPS`)
- Modify: `src/designer/Canvas.jsx` (`textCss`)
- Create: `reports/style-showcase.pw.json`, `reports/__tests__/style-showcase.test.json`

- [ ] **Step 1: Inspector props**

In `TEXT_STYLE_PROPS` (`src/engine/items/index.js`):
- Change the `textAlign` options to `['auto', 'left', 'center', 'right', 'justify']`.
- After the `lineHeight` entry add:

```js
  { key: 'textDecoration', label: 'Decoration', type: 'select', options: ['none', 'underline', 'line-through', 'underline line-through'], category: 'Text' },
```

- After the `backgroundColor` entry add:

```js
  { key: 'backgroundImage', label: 'Background image (URL or =expression)', type: 'text', category: 'Box' },
  { key: 'backgroundFit', label: 'Background fit', type: 'select', options: ['cover', 'contain', 'fill'], category: 'Box' },
```

- [ ] **Step 2: Canvas preview**

In `src/designer/Canvas.jsx` `textCss`:
- Add to the `box` object:

```js
      backgroundImage: st.backgroundImage && !String(st.backgroundImage).startsWith('=') ? `url("${String(st.backgroundImage).replace(/"/g, '%22')}")` : undefined,
      backgroundSize: st.backgroundFit === 'fill' ? '100% 100%' : st.backgroundFit || 'cover',
      backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
```

- Add to the `text` object:

```js
      textDecoration: st.textDecoration && st.textDecoration !== 'none' && !String(st.textDecoration).startsWith('=') ? st.textDecoration : undefined,
```

`textAlign: align` already passes `justify` through. CSS `text-align: justify` matches the engine except on the last line, which CSS also leaves ragged.

Rotation is **not** previewed on the canvas: the designer shows the box upright, with its value, and the Preview tab shows the real rotation. Add `title="Rotated {n}° in the preview"` to the item's wrapper element where the canvas renders text items, if the item has `rotate`. Find the element with `grep -n "data-item=" src/designer/Canvas.jsx`.

- [ ] **Step 3: A showcase report and its snapshot**

Create `reports/style-showcase.pw.json`. It has one A4 page with:
- a heading,
- an underlined link-style textbox,
- a struck-through "Was ₹1,200" next to "Now ₹999",
- a justified paragraph (3 sentences),
- a shrink-to-fit 120×14 box holding a long label,
- a 270° rotated label in a 20×120 framed box,
- a box with a background image (`data:` URI from Task 3 at `backgroundFit: 'cover'`) with text over it,
- a date formatted `dddd dd MMMM yyyy` with `locale: 'hi-IN'`, in a textbox whose expression is `=Format(DateSerial(2026,3,5), "dddd dd MMMM yyyy")`.

Set the report's `locale: 'hi-IN'` and `currency: 'INR'`. Then create `reports/__tests__/style-showcase.test.json`:

```json
{ "report": "../style-showcase.pw.json", "cases": [{ "name": "default", "now": "2026-10-04T10:00:00" }] }
```

Run: `PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata node bin/pw.mjs test reports`
Expected: `… passed, 0 failed, 1 snapshot written`.

Open the snapshot and check the Hindi date reads `गुरुवार 05 मार्च 2026`. The justified paragraph's words appear one per line in the snapshot, because a snapshot lists text runs.

- [ ] **Step 4: Look at every output**

```bash
for f in pdf html docx; do PATH=/usr/local/bin:$PATH node bin/pw.mjs render reports/style-showcase.pw.json -f $f -o /tmp/showcase.$f; done
open /tmp/showcase.pdf /tmp/showcase.html /tmp/showcase.docx
```

Expected:
- PDF and HTML look identical: underline, strike, justify, the shrunk label, the upward label inside its frame, a cropped background image.
- Word shows underline, strike and the justified paragraph; it leaves out the rotation and the image.

- [ ] **Step 5: Phase gate**

Run the gate from the roadmap: unit tests, engine boundary, `pw test`, production build, then all e2e suites, including `drilldown` (its links are now underlined). Expected: all pass. Stop the server on :3200 afterwards.

- [ ] **Step 6: Commit, merge, update the audit**

```bash
git add src/engine/items/index.js src/designer/Canvas.jsx reports/style-showcase.pw.json reports/__tests__/style-showcase.test.json reports/__tests__/style-showcase.default.snap.txt
git commit -m "feat(designer): text decoration, justify, background image controls; style showcase report"
```

Then:
- Fast-forward `main` to the branch.
- Push only if the owner has asked for pushes in this session.
- In the audit artifact, move these rows to `parity`:
  - "Underline, strike-through, justify, background images"
  - "Shrink-to-fit, rotation, condensed text"
  - "Locale-aware formatting"

---

## Self-review

- **Coverage:** each audit row has its tasks.
  - Decoration, justify, background images: Tasks 1, 2, 3, 7, 8, 9.
  - Shrink, rotate, condense: Tasks 4, 5, 8, 9.
  - Locale names: Task 6.
- **Known limits, stated in the tasks:**
  - Justify skips shaped and right-to-left lines.
  - Rotated boxes do not grow, split or rotate their link hit area.
  - The canvas does not preview rotation.
  - Word leaves out rotation and background images.
  - Viewer search does not match a phrase across justified word runs, because each word is its own run. A Phase 6 search task (results list) must join same-baseline runs before matching.
- **Name consistency:** these names are used the same way across the engine, exporters, importer and designer:
  - `textDecoration` (style)
  - `deco` (text item → docx)
  - `end` (wrap line)
  - `backgroundImage` / `backgroundFit`
  - `shrinkToFit`
  - `rotate` (item prop: a number; page-model item: `{a, cx, cy}`)
  - `rotationOf`
  - `MIN_SHRINK_SIZE`
