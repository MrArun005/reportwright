// A PDF in the standard fonts embeds nothing, so harfbuzz-subset.wasm is never loaded or compiled (the first subset of
// a cold process costs tens of ms).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const WASM = path.join(import.meta.dirname, '..', '..', 'public', 'harfbuzz-subset.wasm');
let loads = 0;
const subset = createSubsetter(async () => { loads++; return fs.readFileSync(WASM); });
const tick = () => new Promise(r => setTimeout(r, 10));
const invoice = (fontFamily) => report([
  { type: 'textbox', x: 0, y: 0, w: 300, h: 24, value: 'INVOICE', style: { fontFamily, fontSize: 20, fontWeight: 'bold' } },
  { type: 'table', name: 'Lines', dataSet: 'Rows', x: 0, y: 40, w: 400, h: 40, style: { fontFamily }, columns: [{ width: 300 }, { width: 100 }],
    header: [{ height: 16, cells: [{ value: 'Item' }, { value: 'Amount' }] }], detail: [{ height: 16, cells: [{ value: '=Fields.item' }, { value: '=Fields.amount', style: { format: '#,##0.00' } }] }] },
  { type: 'textbox', x: 0, y: 200, w: 300, h: 16, value: 'Thank you', style: { fontFamily, fontStyle: 'italic' } },
], { data: { rows: [{ item: 'Consulting', amount: 1800 }, { item: 'Hosting', amount: 480 }] } });

describe('harfbuzz-subset.wasm and the standard fonts', () => {
  it('a Helvetica-only PDF never loads or compiles the subsetter', async () => {
    const m = await render(invoice('Helvetica'), { fontStore });
    expect(m.warnings).toEqual([]);
    await exportPdf(m, fontStore, { subset });
    await tick();
    expect(loads).toBe(0);
  });

  it('text in an embedded font loads it once, at the first subset', async () => {
    const m = await render(invoice('Inter'), { fontStore });
    expect(loads).toBe(0);
    await exportPdf(m, fontStore, { subset });
    expect(loads).toBe(1);
  });
});
