// #3: a newly inserted item (its defaults) does not warn at once
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { ITEMS } from '../../src/engine/items/index.js';

const inBody = (item) => ({
  $schema: 'reportwright/report@1',
  name: 'T',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { body: { items: [{ name: 'Item1', x: 0, y: 0, ...item }] } },
});

describe('item defaults', () => {
  for (const type of ['richtext', 'sparkline', 'barcode']) {
    it(`a new ${type} in the body has no warnings`, () => {
      const v = validate(inBody(ITEMS[type].defaults()));
      expect(v.warnings).toEqual([]);
      expect(v.errors).toEqual([]);
    });
  }
  it('the rich text default does not use page globals (they work only in the page header and footer)', () => {
    expect(ITEMS.richtext.defaults().value).not.toMatch(/PageNumber|TotalPages/);
  });
});
