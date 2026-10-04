// Phase 2: rich text and vertical text.
import { describe, it, expect } from 'vitest';
import { parseRich, safeHref, RICH_LIMITS } from '../../src/engine/text/rich.js';

const parse = (h, base = 10) => { const w = []; const r = parseRich(h, { baseSize: base, warn: m => w.push(m) }); return { ...r, w }; };
const flat = (b) => b.runs.map(r => r.text).join('');

describe('rich text: parser', () => {
  it('splits blocks and keeps inline styles', () => {
    const { blocks } = parse('<p>Hello <b>bold <i>both</i></b></p><p style="text-align:center">Two</p>');
    expect(blocks).toHaveLength(2);
    expect(flat(blocks[0])).toBe('Hello bold both');
    const both = blocks[0].runs.find(r => r.text === 'both');
    expect(both.st).toMatchObject({ fontWeight: 'bold', fontStyle: 'italic' });
    expect(blocks[1].align).toBe('center');
  });
  it('collapses white space like HTML and decodes entities', () => {
    const { blocks } = parse('<p>  a \n\t b&nbsp;c &amp; &lt;d&gt; &#65;&#x42;  </p>');
    expect(flat(blocks[0])).toBe('a b c & <d> AB');
  });
  it('br is a line break inside the block; headings scale and bold', () => {
    const { blocks } = parse('<h1>Title</h1>one<br>two');
    expect(blocks[0].runs[0].st).toMatchObject({ fontSize: 20, fontWeight: 'bold' });
    expect(flat(blocks[1])).toBe('one\ntwo');
  });
  it('inline CSS: colour, size (pt, px, em, %), weight, style, decoration, background', () => {
    const { blocks } = parse('<span style="color:#c00; font-size:12pt; font-weight:600; font-style:italic; text-decoration:underline line-through; background-color:rgb(255,255,0)">x</span><span style="font-size:16px">y</span><span style="font-size:2em">z</span><span style="font-size:50%">w</span>');
    const [x, y, z, w] = blocks[0].runs.map(r => r.st);
    expect(x).toMatchObject({ color: '#c00', fontSize: 12, fontWeight: '600', fontStyle: 'italic', underline: true, strike: true, background: 'rgb(255,255,0)' });
    expect(y.fontSize).toBe(12); expect(z.fontSize).toBe(20); expect(w.fontSize).toBe(5);
  });
  it('lists: markers, numbering, nesting level', () => {
    const { blocks } = parse('<ul><li>a</li><li>b<ol><li>c</li><li>d</li></ol></li></ul>');
    expect(blocks.map(b => [b.marker, b.level, flat(b)])).toEqual([['•', 1, 'a'], ['•', 1, 'b'], ['1.', 2, 'c'], ['2.', 2, 'd']]);
  });
  it('sup, sub, u, s, strike, del, strong, em', () => {
    const { blocks } = parse('E=mc<sup>2</sup> H<sub>2</sub>O <u>u</u><s>s</s><strike>k</strike><del>d</del><strong>b</strong><em>i</em>');
    const st = (t) => blocks[0].runs.find(r => r.text === t).st;
    expect(st('2').script).toBe('sup');
    expect(blocks[0].runs.find(r => r.text === '2' && r.st.script === 'sub')).toBeTruthy();
    expect(st('u').underline).toBe(true);
    for (const t of ['s', 'k', 'd']) expect(st(t).strike).toBe(true);
    expect(st('b').fontWeight).toBe('bold'); expect(st('i').fontStyle).toBe('italic');
  });
  it('unknown tags are dropped with one warning, their text kept; script and style content is dropped', () => {
    const { blocks, w } = parse('<p><blink>a</blink><marquee>b</marquee><script>alert(1)</script><style>p{}</style>c</p>');
    expect(flat(blocks[0])).toBe('abc');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/blink.*marquee|marquee.*blink/);
  });
  it('links: safe hrefs only', () => {
    const { blocks, w } = parse('<a href="https://x.com/a?b=1&amp;c=2">ok</a><a href="javascript:alert(1)">bad</a><a href="&#106;avascript:alert(1)">bad2</a><a href="/r/1">rel</a><a href="mailto:a@b.c">m</a>');
    const href = (t) => blocks[0].runs.find(r => r.text === t).st.href;
    expect(href('ok')).toBe('https://x.com/a?b=1&c=2');
    expect(href('bad')).toBeUndefined(); expect(href('bad2')).toBeUndefined();
    expect(href('rel')).toBe('/r/1'); expect(href('m')).toBe('mailto:a@b.c');
    expect(w.join(' ')).toMatch(/link/);
    expect(safeHref(' javascript:x')).toBe(null);
  });
  it('colours outside hex, rgb() and a few names are ignored', () => {
    const { blocks } = parse('<span style="color:url(javascript:x)">a</span><span style="color:red">b</span>');
    expect(blocks[0].runs[0].st.color).toBeUndefined();
    expect(blocks[0].runs[1].st.color).toBe('#ff0000');
  });
  it('is bounded: deep nesting, huge input, unclosed tags and stray brackets', () => {
    const deep = '<span>'.repeat(5000) + 'x' + '</span>'.repeat(5000);
    const t0 = Date.now();
    const a = parse(deep);
    expect(flat(a.blocks[0])).toBe('x');
    expect(a.w.join(' ')).toMatch(/deep/);
    const b = parse('<p>a < b and c > d <b unclosed');
    expect(flat(b.blocks[0])).toBe('a < b and c > d');
    const c = parse('x'.repeat(RICH_LIMITS.maxLength + 10));
    expect(flat(c.blocks[0]).length).toBe(RICH_LIMITS.maxLength);
    expect(c.w.join(' ')).toMatch(/cut/);
    parse('<a href="' + '"'.repeat(50000));
    parse('<'.repeat(50000) + '&'.repeat(50000) + '<!--');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('rich text: hostile input stays bounded', async () => {
  const { TextMeasurer } = await import('../../src/engine/text/measure.js');
  const { fontStore } = await import('../helpers.js');
  const { layoutRich, paintRich, richValue } = await import('../../src/engine/items/rich.js');
  const timed = (fn) => { const t0 = performance.now(); const r = fn(); return { r, ms: performance.now() - t0 }; };
  const runs = (blocks) => blocks.reduce((s, b) => s + b.runs.length, 0);
  const T = { timeout: 5000 };

  it('200k nested <b>', T, () => {
    const { r, ms } = timed(() => parse('<b>'.repeat(200000) + 'x'));
    expect(ms).toBeLessThan(1000);
    expect(r.blocks.length).toBeLessThanOrEqual(1);
    expect(r.w.join(' ')).toMatch(/cut/);
  });
  it('200k </b> closers', T, () => {
    const { r, ms } = timed(() => parse('<b>a' + '</b>'.repeat(200000) + 'z'));
    expect(ms).toBeLessThan(1000);
    expect(r.w.join(' ')).toMatch(/cut/);
  });
  it('one 1 MB tag with 50k attributes', T, () => {
    const tag = '<span ' + Array.from({ length: 50000 }, (_, i) => `a${i}="${'v'.repeat(12)}"`).join(' ') + '>x</span>';
    const { r, ms } = timed(() => parse(tag));
    expect(ms).toBeLessThan(1000);
    expect(r.w.length).toBeGreaterThan(0);
  });
  it('100k <br> make a bounded number of lines', T, async () => {
    await fontStore.load();
    const m = new TextMeasurer(fontStore);
    const { r, ms } = timed(() => {
      const p = parse('a' + '<br>'.repeat(100000) + 'b');
      const rl = layoutRich(p.blocks, { fontSize: 9 }, 300, m);
      const items = paintRich({ x: 0, y: 0, w: 300, h: rl.needed, st: {}, rl, m, id: 'R' });
      return { p, rl, items };
    });
    expect(ms).toBeLessThan(1000);
    expect(r.rl.lines.length).toBeLessThanOrEqual(5000);
    expect(r.p.w.join(' ')).toMatch(/line breaks|cut/);
  });
  it('a style attribute with 50k declarations', T, () => {
    const css = Array.from({ length: 50000 }, () => 'color:#123456').join(';');
    const { r, ms } = timed(() => parse(`<span style="${css}">x</span>`));
    expect(ms).toBeLessThan(1000);
    expect(r.blocks).toHaveLength(0); // cut inside the attribute: nothing readable after it
    expect(r.w.join(' ')).toMatch(/cut/);
    const short = parse(`<span style="${css.slice(0, 30000)}">x</span>`);
    expect(flat(short.blocks[0])).toBe('x');
    expect(short.blocks[0].runs[0].st.color).toBe('#123456'); // only the first declarations are read
  });
  it('interpolating a 5 MB field', T, () => {
    const big = '<b>&'.repeat(5 * 1024 * 1024 / 4);
    const ctx = { fields: { x: big }, params: {}, globals: {}, dataSets: {} };
    const { r, ms } = timed(() => parse(richValue('<i>{Fields.x}</i>', ctx)));
    expect(ms).toBeLessThan(1000);
    expect(flat(r.blocks[0]).length).toBeLessThanOrEqual(RICH_LIMITS.maxLength);
    expect(r.w.join(' ')).toMatch(/cut/);
  });
  it('many short runs and blocks are capped', T, () => {
    const { r, ms } = timed(() => parse('<p><b>a</b><i>b</i></p>'.repeat(30000)));
    expect(ms).toBeLessThan(1000);
    expect(r.blocks.length).toBeLessThanOrEqual(RICH_LIMITS.maxBlocks);
    expect(runs(r.blocks)).toBeLessThanOrEqual(RICH_LIMITS.maxRuns);
    expect(r.w.join(' ')).toMatch(/cut/);
  });
  it('ampersands without a semicolon do not rescan the input', T, () => {
    const { ms } = timed(() => parse('&'.repeat(99000)));
    expect(ms).toBeLessThan(50);
  });
});
