import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { fontStore, report } from '../helpers.js';

const field = (name, extra) => ({ type: 'field', name, x: 0, y: 0, w: 200, h: 18, ...extra });
const body = [
  field('Name', { kind: 'text', fieldName: 'customerName', value: '=Parameters.who', required: true }),
  field('Notes', { kind: 'multiline', fieldName: 'notes', value: 'Line one', y: 24, h: 40 }),
  field('Agree', { kind: 'checkbox', fieldName: 'agree', value: '=1 = 1', y: 70, w: 14, h: 14 }),
  field('Plan', { kind: 'choice', fieldName: 'plan', options: 'Basic, Plus, Pro', value: 'Plus', y: 90, readOnly: true }),
  { type: 'list', name: 'L', x: 0, y: 120, w: 300, h: 22, dataSet: 'Rows', items: [field('Qty', { kind: 'text', fieldName: 'qty', value: '=Fields.n', x: 0, y: 0 })] },
];
const def = () => {
  const d = report(body, { data: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] } });
  d.parameters = [{ name: 'who', type: 'string', default: 'Zoë Ünlü' }];
  return d;
};

describe('fillable form fields', () => {
  it('become real PDF form fields with their values and flags', async () => {
    const out = await render(def(), { fontStore });
    const doc = await PDFDocument.load(await exportPdf(out, fontStore, {}));
    const form = doc.getForm();
    const byName = Object.fromEntries(form.getFields().map(f => [f.getName(), f]));
    expect(Object.keys(byName).sort()).toEqual(['agree', 'customerName', 'notes', 'plan', 'qty', 'qty_2', 'qty_3']);
    expect(byName.customerName).toBeInstanceOf(PDFTextField);
    expect(byName.customerName.getText()).toBe('Zoë Ünlü');
    expect(byName.customerName.isRequired()).toBe(true);
    expect(byName.notes.isMultiline()).toBe(true);
    expect(byName.agree).toBeInstanceOf(PDFCheckBox);
    expect(byName.agree.isChecked()).toBe(true);
    expect(byName.plan).toBeInstanceOf(PDFDropdown);
    expect(byName.plan.getOptions()).toEqual(['Basic', 'Plus', 'Pro']);
    expect(byName.plan.getSelected()).toEqual(['Plus']);
    expect(byName.plan.isReadOnly()).toBe(true);
    expect([byName.qty, byName.qty_2, byName.qty_3].map(f => f.getText())).toEqual(['1', '2', '3']);
  });

  it('repeat at the right place in a list', async () => {
    const out = await render(def(), { fontStore });
    const qty = out.pages[0].items.filter(i => i.t === 'field' && i.name === 'qty');
    expect(qty).toHaveLength(3);
    expect(qty[1].y - qty[0].y).toBeCloseTo(22, 5);
    // each copy's drawing stays inside its own box
    for (const q of qty) for (const d of q.draw) {
      const y = d.y ?? d.y1 ?? d.lines[0].y;
      expect(y).toBeGreaterThanOrEqual(q.y - 0.01);
      expect(y).toBeLessThanOrEqual(q.y + q.h + 0.01);
    }
  });

  it('are drawn in the viewer (SVG) with their values', async () => {
    const out = await render(def(), { fontStore });
    const svg = pageToSvg(out.pages[0], out.width, out.height);
    expect(svg).toContain('Zoë Ünlü');
    expect(svg).toContain('Plus');
  });
});
