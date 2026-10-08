// B9 N30: a form field's accessible name (/TU) is its label, not its field name.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../packages/engine/entry.js';
import { fontStore, report } from '../helpers.js';

const field = (extra = {}) => ({ type: 'field', name: 'F', kind: 'checkbox', fieldName: 'agree', x: 0, y: 0, w: 14, h: 14, ...extra });
const pdfBytes = async (items, opt = {}) => (await exportPdf(await render(report(items), { fontStore, exportData: true }), { fonts: fontStore, subset: false, tagged: {}, ...opt }));

describe('N30: form field label', () => {
  it('the model carries the label (item.label, else item.tooltip), expressions evaluated', async () => {
    const m = await render(report([field({ label: 'I agree to the terms' }), field({ fieldName: 'b', tooltip: 'Second', y: 20 }), field({ fieldName: 'c', label: '="Row " & 3', y: 40 })]), { fontStore });
    const fs = m.pages[0].items.filter(i => i.t === 'field');
    expect(fs.map(f => f.label)).toEqual(['I agree to the terms', 'Second', 'Row 3']);
  });
  it('a tagged PDF names the field by its label', async () => {
    const doc = await PDFDocument.load(await pdfBytes([field({ label: 'I agree to the terms' })]));
    expect(doc.getForm().getFields().map(f => f.acroField.dict.get(PDFName.of('TU')).decodeText())).toEqual(['I agree to the terms']);
  });
  it('a tagged PDF warns once per field without a label', async () => {
    const w = [];
    await pdfBytes([field(), field({ label: 'Ok', fieldName: 'b', y: 20 })], { onWarning: (x) => w.push(x) });
    expect(w).toEqual(['Form field "agree" has no label, so a screen reader announces its name; give it a label']);
  });
});
