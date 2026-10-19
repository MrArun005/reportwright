// The designer's Issues panel lists the check's errors and its item hints: a barcode with no value and a table of
// contents in a page band print nothing, so the panel says so (it said "No issues"), and a click selects the item.
import { describe, it, expect } from 'vitest';
import { checkIssues, checkMessages } from '../../src/designer/issues.js';
import { report } from '../helpers.js';

const bc = { id: 'b1', type: 'barcode', name: 'Barcode1', x: 0, y: 0, w: 160, h: 48, symbology: 'code128', value: '' };
const toc = { id: 't1', type: 'toc', name: 'Toc1', x: 0, y: 0, w: 300, h: 20, title: 'Contents' };
const icons = {
  id: 'i1',
  type: 'iconset',
  name: 'Icons',
  x: 0,
  y: 60,
  w: 20,
  h: 20,
  value: '=1',
  lower: 80,
  upper: 20,
};
const bandsOf = (d) => ['pageHeader', 'body', 'pageFooter'].map((k) => ({ key: k, items: d.sections[k].items }));

describe('the Issues panel shows the item hints', () => {
  it('a barcode with no value, a table of contents in the page header, icon thresholds the wrong way round', () => {
    const d = report([bc, icons], { header: { height: 40, items: [toc] } });
    const issues = checkIssues(bandsOf(d), checkMessages(d));
    expect(issues).toEqual(
      expect.arrayContaining([
        { id: 'b1', name: 'Barcode1', kind: 'check', text: 'Barcode1 has no value: nothing is printed' },
        {
          id: 't1',
          name: 'Toc1',
          kind: 'check',
          text: 'Toc1 is in a page band: a table of contents lists entries only in the body',
        },
        expect.objectContaining({
          id: 'i1',
          kind: 'check',
          text: expect.stringContaining('the high threshold (20) is below the low one (80)'),
        }),
      ]),
    );
  });
  it('a barcode with a value and a table of contents in the body: nothing to say', () => {
    const d = report([
      { ...bc, value: 'SKU-1' },
      { ...toc, y: 60 },
    ]);
    expect(checkMessages(d)).toEqual([]);
  });
  it("the check's errors and a save's missing reports, as before", () => {
    const d = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 10, h: 10, value: '=Nope()' }]);
    expect(checkMessages(d, ['Drill report "x" does not exist'])).toEqual([
      expect.stringContaining('T'),
      'Drill report "x" does not exist',
    ]);
  });
});
