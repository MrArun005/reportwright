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

import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';
import { textRows } from '../../src/exporters/regions.js';
import { RICH_DEFAULTS } from '../../src/engine/items/rich.js';

const rich = (value, extra = {}, data) => report([{ type: 'richtext', name: 'R', x: 0, y: 0, w: 300, h: 20, value, ...extra }], { data });
const out = async (def) => render(def, { fontStore });

describe('rich text: layout', () => {
  it('mixed styles on one line share a baseline and sit side by side', async () => {
    const m = await out(rich('Hello <b>bold</b> and <span style="font-size:18pt;color:#c00">big</span>'));
    const t = m.pages[0].items.filter(i => i.t === 'text');
    expect(t.map(i => i.lines[0].text)).toEqual(['Hello ', 'bold', ' and ', 'big']);
    expect(new Set(t.map(i => i.lines[0].y)).size).toBe(1);
    for (let k = 1; k < t.length; k++) expect(t[k].lines[0].x).toBeCloseTo(t[k - 1].lines[0].x + t[k - 1].lines[0].w, 3);
    expect(t[1].font).toBe('Inter-Bold');
    expect(t[3]).toMatchObject({ size: 18, color: '#c00' });
    expect(textRows(m.pages[0].items)).toEqual(['Hello bold and big']);
  });
  it('wraps across styles, never wider than the box; a word split by styles stays whole', async () => {
    const m = await out(rich('<p>' + 'alpha <i>beta</i> gam<b>ma</b> '.repeat(12) + '</p>', { w: 120 }));
    const rows = textRows(m.pages[0].items);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(r.endsWith(' gam')).toBe(false);
    for (const i of m.pages[0].items.filter(i => i.t === 'text')) expect(i.lines[0].x + i.lines[0].w).toBeLessThanOrEqual(36 + 120 + 0.01); // page margin 36
  });
  it('grows to fit; canGrow false clips to the box', async () => {
    const long = '<p>' + 'word '.repeat(200) + '</p>';
    const a = await out(rich(long, { w: 100 }));
    const b = await out(rich(long, { w: 100, canGrow: false }));
    const bottom = (m) => Math.max(...m.pages[0].items.filter(i => i.t === 'text').map(i => i.lines[0].y));
    expect(bottom(a)).toBeGreaterThan(200);
    expect(bottom(b)).toBeLessThan(20 + 36 + 1);
  });
  it('splits across pages by whole lines', async () => {
    const m = await out(rich('<p>' + 'line of text '.repeat(1500) + '</p>', { w: 200 }));
    expect(m.pages.length).toBeGreaterThan(1);
    expect(textRows(m.pages[1].items).length).toBeGreaterThan(10);
  });
  it('interpolates fields escaped; a whole =expression is escaped too unless htmlFromData', async () => {
    const data = { rows: [{ name: '<b>Ann</b> & co' }] };
    const m1 = await out(rich('<i>{Fields.name}</i>', { dataSet: 'Rows' }, data));
    expect(textRows(m1.pages[0].items)).toEqual(['<b>Ann</b> & co']);
    const m2 = await out(rich('="<b>" & "Ann" & "</b>"'));
    expect(textRows(m2.pages[0].items)).toEqual(['<b>Ann</b>']);
    const m3 = await out(rich('="<b>" & "Ann" & "</b>"', { htmlFromData: true }));
    expect(m3.pages[0].items.find(i => i.t === 'text').font).toBe('Inter-Bold');
  });
  it('decorations, span backgrounds, sup and sub', async () => {
    const items = (await out(rich('<u>u</u> <s>s</s> <span style="background-color:#ff0">bg</span> x<sup>2</sup> y<sub>3</sub>'))).pages[0].items;
    expect(items.filter(i => i.t === 'line')).toHaveLength(2);
    expect(items.find(i => i.t === 'rect' && i.fill === '#ff0')).toBeTruthy();
    const t = (s) => items.find(i => i.t === 'text' && i.lines[0].text.trim() === s);
    expect(t('2').size).toBeLessThan(t('x').size);
    expect(t('2').lines[0].y).toBeLessThan(t('x').lines[0].y);
    expect(t('3').lines[0].y).toBeGreaterThan(t('y').lines[0].y);
    expect(t('u').deco).toBe('underline');
  });
  it('lists indent and number', async () => {
    const items = (await out(rich('<ol><li>one</li><li>two<ul><li>deep</li></ul></li></ol>'))).pages[0].items;
    const x = (s) => items.find(i => i.t === 'text' && i.lines[0].text === s).lines[0].x;
    expect(x('1.')).toBeLessThan(x('one'));
    expect(x('deep')).toBeGreaterThan(x('two'));
  });
  it('text-align centre and right per block', async () => {
    const items = (await out(rich('<p style="text-align:right">r</p><p style="text-align:center">c</p>'))).pages[0].items;
    const r = items.find(i => i.lines?.[0].text === 'r').lines[0];
    expect(r.x + r.w).toBeCloseTo(36 + 300 - 2, 1);
  });
  it('links become url link items; unsafe ones do not', async () => {
    const items = (await out(rich('<a href="https://example.com">go</a> <a href="javascript:alert(1)">no</a>'))).pages[0].items;
    const links = items.filter(i => i.t === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].action).toEqual({ type: 'url', href: 'https://example.com' });
    expect(JSON.stringify(items)).not.toMatch(/javascript/);
  });
  it('box action, bookmark and unknown-tag warning', async () => {
    const m = await out(rich('<blink>x</blink>', { bookmark: 'Here', action: { type: 'url', url: 'https://a.b' } }));
    expect(m.bookmarks.map(b => b.label)).toContain('Here');
    expect(m.pages[0].items.some(i => i.t === 'link' && i.w === 300)).toBe(true);
    expect(m.warnings.join(' ')).toMatch(/blink/);
  });
});

import { exportCsv } from '../../src/exporters/csv.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { unzipSync, strFromU8 } from 'fflate';

describe('rich text: exports', () => {
  const def = rich('<p>Plain <b>bold</b> <i>it</i><u>under</u> <s>gone</s> <span style="color:#ff0000;font-size:14pt">red</span></p><p>Second</p>');
  it('CSV gets whole plain lines', async () => {
    expect(exportCsv(await out(def)).split('\r\n')).toEqual(['Plain bold itunder gone red', 'Second']);
  });
  it('Word keeps one paragraph per rich paragraph with per-run bold, italic, underline, strike, colour and size', async () => {
    const doc = strFromU8(unzipSync(await exportDocx(await out(def)))['word/document.xml']);
    const run = (t) => doc.split('<w:r>').find(r => r.includes(`>${t}<`));
    expect(run('bold')).toContain('<w:b/>');
    expect(run('it')).toContain('<w:i/>');
    expect(run('under')).toContain('<w:u w:val="single"/>');
    expect(run('gone')).toContain('<w:strike/>');
    expect(run('red')).toContain('<w:color w:val="FF0000"/>');
    expect(run('red')).toContain('<w:sz w:val="28"/>');
    expect(doc.split('<w:p>').filter(p => p.includes('Plain')).length).toBe(1);
    expect(doc.split('<w:p>').find(p => p.includes('Plain'))).toContain('>bold<');
  });
});

describe('rich text: data is escaped unless the item trusts it', () => {
  const one = (value, x, extra = {}) => out(rich(value, { dataSet: 'Rows', ...extra }, { rows: [{ x }] }));
  const bold = (m) => m.pages[0].items.filter(i => i.t === 'text' && /Bold/.test(i.font));
  it('a quote in a field stays inside its href attribute', async () => {
    const m = await one('<a href="/c?q={Fields.x}">go</a>', '"style="font-size:500px');
    const link = m.pages[0].items.find(i => i.t === 'link');
    expect(link.action.href).toBe('/c?q="style="font-size:500px');
    // with a space the whole href is refused (src/engine/url.js), still with no attribute added
    const m2 = await one('<a href="/c?q={Fields.x}">go</a>', '" style="font-size:500px');
    expect(m2.pages[0].items.some(i => i.t === 'link')).toBe(false);
    expect(m2.pages[0].items.filter(i => i.t === 'text').every(i => i.size === 9)).toBe(true);
    expect(m.pages[0].items.filter(i => i.t === 'text').every(i => i.size === 9)).toBe(true);
  });
  it('a quote or semicolon in a field stays inside its style value', async () => {
    const m = await one('<span style="color:{Fields.x}">t</span>', 'red;font-size:500px" title="x');
    const t = m.pages[0].items.find(i => i.t === 'text');
    expect(t.size).toBe(9);
    expect(t.color).not.toBe('#ff0000');
  });
  it('=Fields.x holding markup is shown as text by default', async () => {
    const m = await one('=Fields.x', '<a href="https://evil">click</a><b>x</b>');
    expect(m.pages[0].items.some(i => i.t === 'link')).toBe(false);
    expect(bold(m)).toHaveLength(0);
    expect(textRows(m.pages[0].items)).toEqual(['<a href="https://evil">click</a><b>x</b>']);
  });
  it('htmlFromData: true parses it, through the same allow-list', async () => {
    const m = await one('=Fields.x', '<a href="https://evil">click</a><b>x</b><a href="javascript:alert(1)">j</a>', { htmlFromData: true });
    const links = m.pages[0].items.filter(i => i.t === 'link');
    expect(links.map(l => l.action.href)).toEqual(['https://evil']);
    expect(bold(m).map(i => i.lines[0].text)).toEqual(['x']);
    expect(JSON.stringify(m.pages)).not.toMatch(/javascript/);
  });
  it('a template keeps the markup in a field as text inside the author\'s tags', async () => {
    const m = await one('<b>{Fields.x}</b>', '<i>not italic</i>');
    expect(textRows(m.pages[0].items)).toEqual(['<i>not italic</i>']);
    expect(bold(m)).toHaveLength(1);
    expect(m.pages[0].items.some(i => i.t === 'text' && /Italic/.test(i.font))).toBe(false);
  });
});

describe('rich text: hostile layout stays bounded', () => {
  const T = { timeout: 5000 };
  const run = async (value, extra) => { const t0 = performance.now(); const m = await out(rich(value, extra)); return { m, ms: performance.now() - t0 }; };
  const count = (m) => m.pages.reduce((s, p) => s + p.items.filter(i => i.t === 'text').length, 0);
  it('a 1 MB word in a 2pt-wide box', T, async () => {
    const { m, ms } = await run('x'.repeat(1 << 20), { w: 2 });
    expect(ms).toBeLessThan(1500);
    expect(count(m)).toBeLessThanOrEqual(RICH_DEFAULTS.maxLines);
    expect(m.warnings.join(' ')).toMatch(/lines.*cut|cut/);
  });
  it('200k characters that change style every character', T, async () => {
    const { m, ms } = await run('<b>a</b><i>b</i>'.repeat(100000));
    expect(ms).toBeLessThan(1500);
    expect(count(m)).toBeLessThanOrEqual(RICH_DEFAULTS.maxFragments);
    expect(m.warnings.join(' ')).toMatch(/cut/);
  });
  it('font-size: 1e9 is clamped', T, async () => {
    const { m, ms } = await run('<span style="font-size:1e9pt">big</span><h1><h1><h1><h1><h1><h1><h1><h1><h1><h1>deep</h1></h1></h1></h1></h1></h1></h1></h1></h1></h1>', { style: { lineHeight: 1e6 } });
    expect(ms).toBeLessThan(1000);
    const t = m.pages.flatMap(p => p.items.filter(i => i.t === 'text'));
    for (const i of t) expect(i.size).toBeLessThanOrEqual(400);
    expect(m.pages.length).toBeLessThan(10);
  });
});
