// A warning names the item by its type and place when it has no name, and a warning is never repeated in a render
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

describe('warnings', () => {
  it('names an unnamed barcode by type and position, not "undefined"', async () => {
    const out = await render(report([{ type: 'barcode', x: 10, y: 20, w: 120, h: 40, symbology: 'ean13', value: 'abc' }]), { fontStore });
    const w = out.warnings.filter(x => /ean|checksum|digit|Barcode/i.test(x));
    expect(w.length).toBeGreaterThan(0);
    expect(w.join('\n')).not.toMatch(/undefined/);
    expect(w.join('\n')).toContain('Barcode at (10, 20)');
  });

  it('a render never repeats a warning', async () => {
    const def = report([
      { type: 'barcode', x: 10, y: 20, w: 120, h: 40, symbology: 'ean13', value: 'abc' },
      { type: 'barcode', x: 10, y: 20, w: 120, h: 40, symbology: 'ean13', value: 'abc' },
    ]);
    const out = await render(def, { fontStore });
    expect(new Set(out.warnings).size).toBe(out.warnings.length);
  });
});
