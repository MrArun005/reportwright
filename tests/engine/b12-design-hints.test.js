// #4: the design hints of an empty subreport and table of contents are not printed; the render warns instead
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const texts = (m) =>
  m.pages.flatMap((p) => p.items.filter((i) => i.t === 'text').flatMap((i) => i.lines.map((l) => l.text))).join(' ');

describe('design hints stay out of the output', () => {
  it('a subreport without a report prints nothing and warns', async () => {
    const m = await render(
      report([{ type: 'subreport', name: 'Subreport1', x: 0, y: 0, w: 300, h: 60, report: '', params: {} }]),
      { fontStore },
    );
    expect(texts(m)).not.toContain('Pick a report');
    expect(m.pages[0].items.filter((i) => i.t === 'rect' || i.t === 'text')).toEqual([]);
    expect(m.warnings).toContain('Subreport1 has no report: nothing is printed');
  });
  it('a table of contents without entries prints its title only and warns', async () => {
    const m = await render(
      report([{ type: 'toc', name: 'Toc1', x: 0, y: 0, w: 400, h: 40, title: 'Contents', levels: 3 }]),
      { fontStore },
    );
    expect(texts(m)).not.toContain('Entries appear here');
    expect(texts(m)).toContain('Contents');
    expect(m.warnings.some((w) => w.startsWith('Toc1 has no entries'))).toBe(true);
  });
  it('a table of contents with entries does not warn', async () => {
    const m = await render(
      report([
        { type: 'toc', name: 'Toc1', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
        { type: 'textbox', name: 'H1', x: 0, y: 40, w: 300, h: 18, value: 'Intro', headingLevel: 1 },
      ]),
      { fontStore },
    );
    expect(texts(m)).toContain('Intro');
    expect(m.warnings.some((w) => w.includes('has no entries'))).toBe(false);
  });
  it('a first-pages render warns too', async () => {
    const m = await render(report([{ type: 'toc', name: 'Toc1', x: 0, y: 0, w: 400, h: 40, title: 'Contents' }]), {
      fontStore,
      firstPages: 1,
    });
    expect(texts(m)).not.toContain('Entries appear here');
  });
});
