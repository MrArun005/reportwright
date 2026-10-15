// Designer: an item added to a container grows its band (#1b).
import { describe, it, expect, beforeEach } from 'vitest';
import { addItem, findItem, secOf } from '../../src/designer/store.js';
import { S, load } from './designer-bands.fixture.js';

beforeEach(load);

describe('#1b: an item added to a container grows the band too', () => {
  it('the container grows past the band: the band grows with it', () => {
    addItem('textbox', 'body', 0, 40, {}, 'box');
    const box = findItem(S().def, 'box').item;
    expect(box.h).toBeGreaterThan(30);
    expect(secOf(S().def, 'body').height).toBeGreaterThanOrEqual(box.y + box.h);
  });
});
