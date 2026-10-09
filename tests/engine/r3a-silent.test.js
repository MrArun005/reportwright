// R3-A: silent blank output warns (EXTERNAL-REVIEW-3 §3.6, §3.7).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore } from '../helpers.js';

const def = (src, ds, items = []) => ({ $schema: 'reportwright/report@1', page: { size: 'A4' }, dataSources: [src], dataSets: [ds],
  sections: { body: { height: 40, items: items.length ? items : [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 12, value: '=First(Fields.a, "D")' }] } } });
const warns = async (d) => (await render(d, { fontStore })).warnings.join('\n');

describe('data that yields blanks', () => {
  it('declared fields that no row has', async () => {
    expect(await warns(def({ name: 'S', type: 'json', data: [{ x: 1 }] }, { name: 'D', source: 'S', path: '$', fields: [{ name: 'a' }, { name: 'b' }] }))).toMatch(/no row has the fields "a", "b".*"x"/);
  });
  it('a CSV read with the wrong separator', async () => {
    const w = await warns(def({ name: 'S', type: 'csv', data: 'a;b\n1;2' }, { name: 'D', source: 'S', path: '$', fields: [{ name: 'a' }, { name: 'b' }] }));
    expect(w).toMatch(/one column.*separator ";"/);
  });
  it('a JSON path that matches nothing', async () => {
    expect(await warns(def({ name: 'S', type: 'json', data: { rows: [{ a: 1 }] } }, { name: 'D', source: 'S', path: '$.items', fields: [{ name: 'a' }] }))).toMatch(/\$\.items matches nothing/);
  });
  it('fields that match (any case) do not warn', async () => {
    expect(await warns(def({ name: 'S', type: 'json', data: [{ A: 1, b: 2 }] }, { name: 'D', source: 'S', path: '$', fields: [{ name: 'a' }, { name: 'b' }] }))).toBe('');
  });
});

describe('unknown or mistyped properties', () => {
  const base = { $schema: 'reportwright/report@1', page: { size: 'A4' }, dataSources: [], dataSets: [], sections: { body: { height: 40, items: [] } } };
  const with_ = (it, top = {}) => validate({ ...base, ...top, sections: { body: { height: 40, items: [{ x: 0, y: 0, w: 10, h: 10, ...it }] } } }).warnings.join('\n');
  it.each([
    [{ type: 'textbox', name: 'T', vale: '=1' }, /T: unknown property "vale" \(did you mean "value"\?\)/],
    [{ type: 'table', name: 'Tb', columns: [{ width: 10 }], noRows: 'none' }, /Tb: unknown property "noRows" \(did you mean "noRowsText"\?\)/],
    [{ type: 'textbox', name: 'T', canGorw: true }, /did you mean "canGrow"/],
    [{ type: 'list', name: 'L', gropuBy: '=Fields.a' }, /did you mean "groupBy"/],
  ])('%j', (it, re) => expect(with_(it)).toMatch(re));
  it('report-level typos', () => expect(with_({ type: 'textbox' }, { lcoale: 'de-DE' })).toMatch(/Unknown report property "lcoale" \(did you mean "locale"\?\)/));
  it('known properties pass', () => expect(with_({ type: 'textbox', name: 'T', value: '=1', canGrow: true, style: {}, shrinkToFit: true, _note: 'x' })).toBe(''));
});

describe('N9: items past the right page edge warn', () => {
  const page = (items) => ({ $schema: 'reportwright/report@1', page: { size: 'A4' }, sections: { body: { height: 60, items } } });
  it.each([
    [[{ type: 'textbox', name: 'FarRight', x: 600, y: 0, w: 80, h: 12, value: 'x' }], /FarRight: it reaches 680pt/],
    [[{ type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 20, items: [{ type: 'textbox', name: 'Inner', x: 700, y: 0, w: 40, h: 12, value: 'y' }] }], /Inner: it reaches 740pt/],
    [[{ type: 'textbox', name: 'Edge', x: 500, y: 0, w: 40, h: 12, value: 'z' }], /Edge: it reaches 540pt/],
  ])('%#', async (items, re) => expect((await render(page(items), { fontStore })).warnings.join('\n')).toMatch(re));
  it('an item inside the page does not', async () => expect((await render(page([{ type: 'textbox', name: 'Ok', x: 0, y: 0, w: 500, h: 12, value: 'ok' }]), { fontStore })).warnings).toEqual([]));
});
