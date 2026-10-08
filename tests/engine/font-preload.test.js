// Every face a render can draw with loads before layout, so a report lays out once; a face that fails falls back
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { FontStore, fontFile } from '../../src/engine/text/fonts.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const bundled = (k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', fontFile(k)));

describe('font preload', () => {
  it('the torture-test report lays out in one pass (its emoji and italic faces load up front)', async () => {
    const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'torture-test.pw.json'), 'utf8'));
    const sources = { torture: JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', '__tests__', 'torture-test.data.json'), 'utf8')) };
    const stats = {};
    await render(def, { fontStore: new FontStore(async (k) => bundled(k)), now: new Date('2026-10-04T10:00:00'), sources, stats });
    expect(stats.layoutPasses).toBe(1);
  });
});
