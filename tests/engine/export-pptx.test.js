// PowerPoint export: one slide per page, text boxes and shapes native and editable, figures as pictures.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportPptx } from '../../src/exporters/pptx.js';
import { fontKeysOf } from '../../src/exporters/svg.js';
import { render } from '../../src/engine/index.js';
import { model, fontStore } from './export-fixture.js';
import { report } from '../helpers.js';

const pptx = async (m) => {
  await fontStore.load(fontKeysOf(m));
  return unzipSync(await exportPptx(m, { title: 'Sales', fontStore }));
};

describe('PowerPoint export', () => {
  it('is a package PowerPoint opens: one slide per page, every relationship target present', async () => {
    const m = await model();
    const files = await pptx(m);
    const slides = Object.keys(files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(m.pages.length);
    const types = strFromU8(files['[Content_Types].xml']);
    for (const s of slides) expect(types).toContain(`/${s}`);
    for (const f of Object.keys(files).filter(f => f.endsWith('.rels'))) {
      const base = f.replace(/_rels\/[^/]*\.rels$/, '');
      for (const [, target, mode] of strFromU8(files[f]).matchAll(/Target="([^"]+)"( TargetMode="External")?/g)) {
        if (mode) continue;
        const p = new URL(target, `http://x/${base}`).pathname.slice(1);
        expect(files[p], `${f} → ${target}`).toBeTruthy();
      }
    }
    const pres = strFromU8(files['ppt/presentation.xml']);
    expect(pres).toContain(`<p:sldSz cx="${Math.round(m.width * 12700)}" cy="${Math.round(m.height * 12700)}"/>`);
  });

  it('text is editable text boxes; shapes are shapes; charts, pictures and barcodes are pictures with alt text', async () => {
    const s = strFromU8((await pptx(await model()))['ppt/slides/slide1.xml']);
    expect(s).toContain('<a:t>Sales by region</a:t>');
    expect(s).toContain('<a:t>Delhi</a:t>'); // a table cell
    expect(s).toContain('b="1"'); // the heading is bold
    expect(s).toContain('prst="roundRect"'); // the rounded shape
    expect(s).toContain('<a:srgbClr val="FEF3C7"/>'); // the text box's background
    expect(s).toContain('descr="Column chart: Kochi has the highest amount"');
    expect(s).toContain('descr="Company logo"');
    expect(s).toContain('asvg:svgBlip');
    // the chart's own labels are inside its picture
    expect((s.match(/<a:t>Kochi<\/a:t>/g) || []).length).toBe(1);
  });

  it('a URL link stays a link on its text', async () => {
    const m = await render(report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 18, value: 'Our site', action: { type: 'url', url: 'https://example.com/' } }]), { fontStore });
    const files = await pptx(m);
    expect(strFromU8(files['ppt/slides/slide1.xml'])).toMatch(/<a:hlinkClick r:id="rId\d+"\/>/);
    expect(strFromU8(files['ppt/slides/_rels/slide1.xml.rels'])).toContain('Target="https://example.com/" TargetMode="External"');
  });
});
