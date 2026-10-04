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

});
