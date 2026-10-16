// Designer: Insert goes to the selected band (#12).
import { describe, it, expect, beforeEach } from 'vitest';
import { insertSpot, addItem, findItem, secOf } from '../../src/designer/store.js';
import { S, load, where } from './designer-bands.fixture.js';

beforeEach(load);

describe('#12: Insert goes to the selected band', () => {
  it('a band selected: into that band, below its items', () => {
    expect(insertSpot(S().def, { kind: 'section', section: 'pageFooter' })).toEqual({
      section: 'pageFooter',
      parentId: null,
      y: 32,
    });
    expect(insertSpot(S().def, { kind: 'section', section: 'pageHeader' }).section).toBe('pageHeader');
  });
  it('an item selected: into its own band', () => {
    expect(insertSpot(S().def, { kind: 'items', ids: ['f1'] })).toEqual({
      section: 'pageFooter',
      parentId: null,
      y: 32,
    });
    expect(insertSpot(S().def, { kind: 'items', ids: ['h1'] }).section).toBe('pageHeader');
    // an item inside a container: into that container
    expect(insertSpot(S().def, { kind: 'items', ids: ['kid'] })).toMatchObject({ section: 'body', parentId: 'box' });
  });
  it('a table goes to the body when the band selected is a page header or footer', () => {
    expect(insertSpot(S().def, { kind: 'section', section: 'pageFooter' }, 'table').section).toBe('body');
  });
  it('the inserted item lands in the footer, which grows to hold it', () => {
    const at = insertSpot(S().def, { kind: 'items', ids: ['f1'] });
    const id = addItem('textbox', at.section, 0, at.y, {}, at.parentId);
    expect(where(id).section).toBe('pageFooter');
    expect(secOf(S().def, 'pageFooter').height).toBeGreaterThanOrEqual(
      findItem(S().def, id).item.y + findItem(S().def, id).item.h,
    );
  });
});
