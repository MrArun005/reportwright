// N19: the removed 0.7 positional form (1.0) is a TypeError that names the replacement.
import { it, expect } from 'vitest';
import { exportPdf, render, blankReport, FontStore } from '../../packages/engine/entry.js';

it('N19: the removed exportPdf(model, fontStore) form says what to use instead', async () => {
  const fonts = new FontStore(() => { throw new Error('none'); });
  const def = blankReport(); def.styles.base.fontFamily = 'Helvetica';
  await expect(exportPdf(await render(def, { fontStore: fonts }), fonts)).rejects.toThrow(/removed in 1\.0: use exportPdf\(model, \{ fonts: fontStore/);
});
