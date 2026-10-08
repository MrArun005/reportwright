// N19: every console warning and deprecation starts with "[reportwright]".
import { it, expect, vi } from 'vitest';
import { exportPdf, render, blankReport, FontStore } from '../../packages/engine/entry.js';

it('N19: a deprecation warning uses the [reportwright] prefix', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fonts = new FontStore(() => { throw new Error('none'); });
  const def = blankReport(); def.styles.base.fontFamily = 'Helvetica';
  await exportPdf(await render(def, { fontStore: fonts }), fonts); // the 0.7 positional form
  expect(warn.mock.calls.map(c => String(c[0])).find(m => m.includes('DEPRECATED'))).toMatch(/^\[reportwright\] DEPRECATED: exportPdf\(model, fontStore/);
  warn.mockRestore();
});
