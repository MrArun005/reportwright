import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { sampleLoan } from '../../src/sample/loans.js';
import { fontStore, texts } from '../helpers.js';

const def = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'reports', 'loan-statement.pw.json'), 'utf8'));

describe('golden: loan statement', () => {
  it('matches the stored page model', async () => {
    const out = await render(def, { fontStore, sources: { loans: sampleLoan('LN-2026-004417') }, now: new Date('2026-10-03T10:30:00') });
    // page structure: count of pages, and the first/last text of every page
    const shape = out.pages.map((p) => { const t = texts(p); return { items: p.items.length, first: t.slice(0, 6), last: t.slice(-4) }; });
    expect({ pages: out.pages.length, warnings: out.warnings, shape }).toMatchSnapshot();
  });

  it('every line of every page is the same in every time zone', async () => {
    const run = async (tz) => {
      const old = process.env.TZ;
      process.env.TZ = tz;
      try {
        const out = await render(def, { fontStore, sources: { loans: sampleLoan('LN-2026-004417') }, now: new Date('2026-10-03T10:30:00') });
        return out.pages.map(texts);
      } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
    };
    const ist = await run('Asia/Kolkata');
    for (const tz of ['America/New_York', 'Pacific/Auckland', 'UTC']) expect(await run(tz), tz).toEqual(ist);
    expect(ist.map(t => t.join(' | '))).toMatchSnapshot();
  });
});
