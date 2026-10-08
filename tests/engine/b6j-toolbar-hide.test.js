// toolbar.hide keys: group keys, sidebar, and every per-format id (the table in packages/viewer/README.md).
import { describe, it, expect } from 'vitest';
import { arrangeToolbar } from '../../src/viewer/logic.js';

// the built-ins as the viewer lists them (ids, groups, and the format items of the Export menu)
const fmt = (id) => ({ id, group: 'export', format: true });
const builtIns = [
  { id: 'thumbnails', group: 'panels' }, { id: 'parameters', group: 'panels' }, { id: 'documentMap', group: 'panels' }, { id: 'run', group: 'panels' },
  { id: 'firstPage', group: 'paging' }, { id: 'pageNumber', group: 'paging' }, { id: 'nextPage', group: 'paging' },
  { id: 'zoomOut', group: 'zoom' }, { id: 'fitPage', group: 'zoom' },
  { id: 'viewMode', group: 'view' },
  { id: 'search', group: 'search' },
  { id: 'print', group: 'export' }, fmt('pdf'), fmt('excel'), fmt('word'), fmt('powerpoint'), fmt('html'), fmt('csv'), fmt('json'),
  { id: 'exportOptions', group: 'export' },
];
const ids = (hide) => arrangeToolbar(builtIns, { hide }).map(i => i.id);
const ALL_FORMATS = ['pdf', 'excel', 'word', 'powerpoint', 'html', 'csv', 'json'];

describe('toolbar.hide keys', () => {
  it.each([
    ['search', ['search']],
    ['zoom', ['zoomOut', 'fitPage']],
    ['navigation', ['firstPage', 'pageNumber', 'nextPage']],
    ['sidebar', ['thumbnails', 'documentMap']],
    ['print', ['print']],
    ['parameters', ['parameters']],
  ])('"%s" hides %j and leaves the rest', (key, gone) => {
    const left = ids([key]);
    for (const id of gone) expect(left).not.toContain(id);
    expect(left.length).toBe(builtIns.length - gone.length);
  });

  it('"export" hides every format and the options gear, but not Print', () => {
    const left = ids(['export']);
    for (const f of ALL_FORMATS) expect(left).not.toContain(f);
    expect(left).not.toContain('exportOptions');
    expect(left).toContain('print');
  });

  it.each(ALL_FORMATS)('the format id "%s" hides that format only', (f) => {
    const left = ids([f]);
    expect(left).not.toContain(f);
    expect(left.filter(id => ALL_FORMATS.includes(id))).toHaveLength(ALL_FORMATS.length - 1);
    expect(left).toContain('exportOptions'); // other formats remain, so the menu and its gear stay
  });

  it('hiding every format hides the Export menu and its options gear (no empty gear)', () => {
    const left = ids(ALL_FORMATS);
    for (const f of ALL_FORMATS) expect(left).not.toContain(f);
    expect(left).not.toContain('exportOptions');
    expect(left).toContain('print'); // Print is not an export format
  });

  it('a custom item in the export group stays when the formats are hidden', () => {
    const out = arrangeToolbar(builtIns, { hide: ['export'], add: [{ id: 'mine', label: 'Mine', after: 'pdf' }] });
    expect(out.map(i => i.id)).toContain('mine');
    expect(out.map(i => i.id)).not.toContain('exportOptions');
  });

  it('an unknown key hides nothing', () => {
    expect(ids(['nope'])).toEqual(builtIns.map(i => i.id));
  });
});
