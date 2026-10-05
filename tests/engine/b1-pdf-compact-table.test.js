// A table page draws its cell borders after the text of the cells (one text object, relative moves) and joins
// collinear border segments: a 100k-row PDF went from 13.9 MB to under 6.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const subset = createSubsetter(() => fs.promises.readFile(path.join(import.meta.dirname, '../../public/harfbuzz-subset.wasm')));
const streams = (pdf) => { const s = Buffer.from(pdf).toString('latin1'), out = []; for (const m of s.matchAll(/stream\r?\n/g)) { const e = s.indexOf('endstream', m.index); try { out.push(zlib.inflateSync(Buffer.from(s.slice(m.index + m[0].length, e), 'latin1')).toString('latin1')); } catch { /* not flate */ } } return out; };

describe('compact table pages', () => {
  it('one text object per table page and one border path per row', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: `A${i}`, b: i * 1.5, c: 'x' }));
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 36, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
      detail: [{ height: 18, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [{ value: '=Fields.a' }, { value: '=Fields.b', style: { format: 'N2' } }, { value: '=Fields.c' }] }] }], { data: { rows } });
    def.dataSets[0].fields = [{ name: 'a', type: 'string' }, { name: 'b', type: 'number' }, { name: 'c', type: 'string' }];
    const m = await render(def, { fontStore });
    const page = streams(await exportPdf(m, fontStore, { subset })).find(s => s.includes(' Tj'));
    expect(page.match(/\bBT\b/g).length).toBeLessThanOrEqual(2);
    expect(page.match(/ l\b/g).length).toBeLessThanOrEqual(31); // a row's three segments are one line
  });
});
