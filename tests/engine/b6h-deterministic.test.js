// Deterministic output: two renders of one report give the same page model (tag ids restart per render), and two
// exports with a fixed date give byte-identical PDFs (dates and the document ID come from the date and the content).
import { describe, it, expect, afterEach } from 'vitest';
import { loadPdf } from '@reportwright/pdf';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
const def = () => report([
  tb('H1', 'Intro', 40, { headingLevel: 1 }),
  tb('H2', 'Results', 100, { headingLevel: 2, alt: 'Results heading' }),
]);

describe('deterministic output', () => {
  const env = process.env.SOURCE_DATE_EPOCH;
  afterEach(() => { if (env === undefined) delete process.env.SOURCE_DATE_EPOCH; else process.env.SOURCE_DATE_EPOCH = env; });

  it('two renders of one report give the same page model', async () => {
    const a = await render(def(), { fontStore });
    const b = await render(def(), { fontStore });
    expect(JSON.stringify({ ...b, stats: undefined })).toBe(JSON.stringify({ ...a, stats: undefined })); // stats.ms is the render's time
  });

  it('two exports with a fixed creationDate are byte-identical, and the date is the one given', async () => {
    const when = new Date('2026-01-02T03:04:05Z');
    const m = await render(def(), { fontStore });
    const a = Buffer.from(await exportPdf(m, fontStore, { creationDate: when }));
    const b = Buffer.from(await exportPdf(await render(def(), { fontStore }), fontStore, { creationDate: when }));
    expect(a.equals(b)).toBe(true);
    expect((await loadPdf(a)).info.creationDate?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('SOURCE_DATE_EPOCH fixes the date when no creationDate is given', async () => {
    process.env.SOURCE_DATE_EPOCH = '1767323045';
    const m = await render(def(), { fontStore });
    const a = Buffer.from(await exportPdf(m, fontStore, {}));
    await new Promise(r => setTimeout(r, 1100));
    const b = Buffer.from(await exportPdf(m, fontStore, {}));
    expect(a.equals(b)).toBe(true);
    expect((await loadPdf(a)).info.creationDate?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
