import fs from 'node:fs';
import path from 'node:path';
import { FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
export const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'fonts', fontFile(k))));
export const texts = (page) => page.items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text));
export const report = (body, extra = {}) => ({
  $schema: 'reportwright/report@1', name: 'T', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: extra.data || { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { pageHeader: extra.header || { height: 0, items: [] }, body: { items: body }, pageFooter: extra.footer || { height: 0, items: [] } },
  ...extra.def,
});
