// The Latin faces a render can use load before layout (one layout pass); the optional CJK and emoji faces (~40 MB)
// load only when text needs them, so a plain English report never requests one
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { FontStore, fontFile, OPTIONAL_KEYS } from '../../src/engine/text/fonts.js';
import { report } from '../helpers.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const bundled = (k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', fontFile(k)));
/** a store whose loader records every key it is asked for */
const recording = () => {
  const asked = [];
  const store = new FontStore(async (k) => { asked.push(k); return bundled(k); });
  return { store, asked };
};

describe('font preload', () => {
  it('a plain English report never requests a CJK or emoji face', async () => {
    const { store, asked } = recording();
    const items = [{ type: 'textbox', x: 0, y: 0, w: 300, h: 40, value: 'Plain English, with bold and italic', style: { fontWeight: 'bold', fontStyle: 'italic' } }];
    await render(report(items), { fontStore: store });
    expect(asked.length).toBeGreaterThan(0);
    for (const k of OPTIONAL_KEYS) expect(asked, k).not.toContain(k);
  });

  it('the Latin faces load before layout: a bold, italic or script-free report lays out once', async () => {
    const { store } = recording();
    const items = [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Totals', style: { fontWeight: 'bold' } }];
    const stats = {};
    await render(report(items), { fontStore: store, stats });
    expect(stats.layoutPasses).toBe(1);
  });

  it('the torture-test report lays out in one pass (its static emoji face is found before layout)', async () => {
    const { store } = recording();
    const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'torture-test.pw.json'), 'utf8'));
    const sources = { torture: JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', '__tests__', 'torture-test.data.json'), 'utf8')) };
    const stats = {};
    await render(def, { fontStore: store, now: new Date('2026-10-04T10:00:00'), sources, stats });
    expect(stats.layoutPasses).toBe(1);
  });
});
