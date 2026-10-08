// Word export: headings are Heading 1..6 paragraphs (the outline and the navigation pane), and the document language
// is the report's locale by default (w:lang in the styles), not only when opt.lang is given.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { fontStore, report } from '../helpers.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
async function parts(def, opt = {}) {
  const model = await render(def, { fontStore, exportData: true });
  const files = unzipSync(await exportDocx(model, { fontStore, ...opt }));
  return { doc: strFromU8(files['word/document.xml']), styles: strFromU8(files['word/styles.xml']) };
}

describe('Word headings and language', () => {
  it('a heading item is a Heading 1..6 paragraph, and the style exists', async () => {
    const { doc, styles } = await parts(report([
      tb('Title', 'Sales', 40, { headingLevel: 1 }),
      tb('Sub', 'By region', 70, { headingLevel: 2 }),
      tb('Body', 'Plain text', 100),
    ]));
    const paraWith = (t) => doc.split('<w:p>').find(p => p.includes(t));
    expect(paraWith('Sales')).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    expect(paraWith('By region')).toMatch(/<w:pStyle w:val="Heading2"\/>/);
    const plain = doc.split('<w:p>').find(p => p.includes('Plain text'));
    expect(plain).toBeDefined();
    expect(plain).not.toMatch(/pStyle/);
    expect(styles).toMatch(/w:styleId="Heading1"/);
    expect(styles).toMatch(/w:styleId="Heading2"/);
  });
  it('the language is the report locale when no opt.lang is passed', async () => {
    const { styles } = await parts({ ...report([tb('Body', 'Hi', 40)]), locale: 'en-IN' });
    expect(styles).toMatch(/<w:lang w:val="en-IN"\/>/);
  });
  it('opt.lang still wins over the locale', async () => {
    const { styles } = await parts({ ...report([tb('Body', 'Hi', 40)]), locale: 'en-IN' }, { lang: 'de-DE' });
    expect(styles).toMatch(/<w:lang w:val="de-DE"\/>/);
  });
  it('no locale: en-US', async () => {
    const { styles } = await parts(report([tb('Body', 'Hi', 40)]));
    expect(styles).toMatch(/<w:lang w:val="en-US"\/>/);
  });
});
