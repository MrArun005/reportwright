// An image the PDF cannot embed is left out with a warning that names the picture and the reason.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=';
const img = (name, src, y, extra = {}) => ({ type: 'image', name, x: 0, y, w: 60, h: 40, src, alt: name, ...extra });

async function exportWith(items, opt = {}) {
  const warnings = [];
  const model = await render(report(items), { fontStore });
  const bytes = await exportPdf(model, fontStore, { onWarning: (m) => warnings.push(m), ...opt });
  return { bytes, warnings };
}

describe('images that cannot be embedded are named in a warning', () => {
  it('a GIF is left out with a warning naming the picture and the format', async () => {
    const { warnings } = await exportWith([img('Logo', GIF, 40)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"Logo"/);
    expect(warnings[0]).toMatch(/GIF/);
    expect(warnings[0]).toMatch(/left out/);
  });
  it('a URL image with no fetchImage warns with the reason', async () => {
    const { warnings } = await exportWith([img('Remote', 'https://example.test/a.png', 40)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"Remote"/);
    expect(warnings[0]).toMatch(/fetchImage/);
  });
  it('an image that fetchImage cannot load warns', async () => {
    const { warnings } = await exportWith([img('Gone', 'https://example.test/none.png', 40)], { fetchImage: async () => null });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"Gone"/);
    expect(warnings[0]).toMatch(/could not be loaded/);
  });
  it('a damaged PNG warns with the reason', async () => {
    const cut = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf';
    const { warnings } = await exportWith([img('Cut', cut, 40)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"Cut"/);
    expect(warnings[0]).toMatch(/PNG/);
  });
  it('every picture that is left out gets its own warning; a good PNG gets none', async () => {
    const { warnings } = await exportWith([img('Logo', GIF, 40), img('Photo', PNG, 120), img('Logo2', GIF, 200)]);
    expect(warnings.map(w => w.match(/"(\w+)"/)[1])).toEqual(['Logo', 'Logo2']);
  });
});
