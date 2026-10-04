// Image and chart caps that a report could step around (security review of v0.6.0..main). Each test failed before its fix.
import { describe, it, expect } from 'vitest';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { render } from '../../src/engine/index.js';
import { paintVisual } from '../../src/engine/items/visuals.js';
import { fontStore, report } from '../helpers.js';

v8.setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');
/** Heap still held after fn's result is kept alive (MB). */
const retainedMb = async (fn) => {
  gc(); const before = process.memoryUsage().heapUsed;
  const out = await fn();
  gc(); const mb = (process.memoryUsage().heapUsed - before) / 1048576;
  return { out, mb };
};

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAC0lEQVR4nGNoAAMACocDAcTGH2YAAAAASUVORK5CYII=';
const PNG_HEAD = Uint8Array.from(Buffer.from(PNG_B64, 'base64'));
/** A PNG of about `mb` megabytes as bytes from a database driver (the header sniffs as PNG). */
const pngBytes = (mb) => { const b = new Uint8Array(mb * 1048576); b.set(PNG_HEAD); return b; };
/** A distinct data URI of about 9 MB. */
const mb9 = (k) => 'data:image/png;base64,' + PNG_B64.slice(0, 32) + String.fromCharCode(66 + k).repeat(9 * 1048576 * 4 / 3);
const allItems = (m) => m.pages.flatMap(p => p.items.flatMap(i => (i.t === 'field' ? [i, ...i.draw] : [i])));
const big = (rows, b) => ({ ...report([], {}), dataSources: [{ name: 'src', type: 'json', data: { rows, big: [{ b }] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }, { name: 'Big', source: 'src', path: '$.big', fields: [{ name: 'b', type: 'bytes' }] }] });

describe('render caps', () => {
  it('a form field\'s background image obeys the image caps (it is drawn from field.draw, which the image pass skipped)', async () => {
    const huge = 'data:image/png;base64,' + PNG_B64.slice(0, 32) + 'A'.repeat(11 * 1048576 * 4 / 3);
    const def = report([{ type: 'field', name: 'F', kind: 'text', fieldName: 'f', dataSet: 'Rows', x: 0, y: 0, w: 100, h: 20, style: { backgroundImage: '=Fields.big' } }], { data: { rows: [{ big: huge }] } });
    const m = await render(def, { fontStore });
    const imgs = allItems(m).filter(i => i.t === 'image');
    expect(imgs.every(i => i.src.length < 10.5 * 1048576)).toBe(true);
    expect(m.warnings.join('\n')).toMatch(/limited to 10 MB each/);
  });

  it('one image from data used on every row is converted once, not once per row', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ i }));
    const def = { ...big(rows, pngBytes(1)), sections: report([{ type: 'list', name: 'L', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 20, items: [
      { type: 'image', name: 'I', dataSet: 'Big', x: 0, y: 0, w: 20, h: 10, src: '=First(Fields.b, "Big")' },
    ] }]).sections };
    const t = Date.now();
    const { out, mb } = await retainedMb(() => render(def, { fontStore }));
    expect(Date.now() - t).toBeLessThan(2000);
    expect(out.pages.flatMap(p => p.items).filter(i => i.t === 'image')).toHaveLength(120);
    expect(mb).toBeLessThan(40); // was ~160 MB: a fresh 1.3 MB base64 string per row
  });

  it('a background image from bytes becomes a data URI once, not String(bytes) per box', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ i }));
    const def = { ...big(rows, pngBytes(1)), sections: report([{ type: 'list', name: 'L', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 20, items: [
      { type: 'textbox', name: 'T', x: 0, y: 0, w: 20, h: 10, value: 'x', style: { backgroundImage: '=First(Fields.b, "Big")' } },
    ] }]).sections };
    const { out, mb } = await retainedMb(() => render(def, { fontStore }));
    const imgs = out.pages.flatMap(p => p.items).filter(i => i.t === 'image');
    expect(imgs).toHaveLength(120);
    expect(imgs[0].src.startsWith('data:image/png;base64,')).toBe(true); // was "137,80,78,71,…", passed through as a URL
    expect(mb).toBeLessThan(40); // was ~430 MB of "137,80,…" strings
  });

  it('subreports share the render\'s 50 MB image budget during layout', async () => {
    const child = (k) => report([0, 1, 2].map(j => ({ type: 'image', name: `I${j}`, x: 0, y: j * 12, w: 20, h: 10, src: mb9(k * 3 + j) })));
    const kids = { A: child(0), B: child(1) };
    const def = report([
      { type: 'subreport', name: 'SA', report: 'A', x: 0, y: 0, w: 200, h: 40 },
      { type: 'subreport', name: 'SB', report: 'B', x: 0, y: 50, w: 200, h: 40 },
    ]);
    const m = await render(def, { fontStore, loadReport: async (id) => kids[id] });
    // 6 × 9 MB: the second child's third image is over 50 MB in all, and the child itself says so
    expect(m.warnings.join('\n')).toMatch(/^Subreport B: .*pass 50 MB in all/m);
    const total = m.pages.flatMap(p => p.items).filter(i => i.t === 'image').reduce((s, i) => s + i.src.length * 3 / 4, 0);
    expect(total).toBeLessThanOrEqual(50 * 1048576);
  });

});
