// R1-A item 7: a thumbnail lays out page 1 only (a 100k-row report drew every page to show one).
import { it, expect } from 'vitest';
import { drawThumb } from '../../src/server/thumbs.js';

it('a thumbnail of a 100k-row report renders page 1 only, fast', async () => {
  const rows = Array.from({ length: 100000 }, (_, i) => ({ id: i }));
  const def = { $schema: 'reportwright/report@1', name: 'Big', sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }] }] }] } },
    dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }] };
  const t = Date.now();
  const r = await drawThumb({ def, principal: { kind: 'service' }, base: 'http://x' });
  expect(r.svg).toMatch(/^<svg/);
  expect(r.pages).toBe(0); // cut short: the count is not known
  expect(Date.now() - t).toBeLessThan(5000);
});
