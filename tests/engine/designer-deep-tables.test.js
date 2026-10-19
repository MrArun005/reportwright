// Designer table commands at the store level: after any sequence of column and row inserts and deletes, merges and
// splits, every row of every part has one entry per column (a cell, or null under a merge), each column of each row is
// covered by exactly one cell, no span runs past the table, and tableSync keeps w and h equal to the columns and rows.
// Also: the bands' structure commands, and what validate() says about TOCs, barcodes and subreports.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  newDesignerStore,
  activateStore,
  tableInsertColumn,
  tableDeleteColumn,
  tableMergeRight,
  tableMergeDown,
  tableSplit,
  tableSplitRows,
  tableInsertRow,
  tableDeleteRow,
  tableAddGroup,
  tableRemoveGroup,
  tableSetColumnWidth,
  tableParts,
  rowsOf,
  addBodySection,
  removeBodySection,
  sectionList,
  secOf,
  addItem,
  insertSpot,
} from '../../src/designer/store.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { SYMBOLOGIES, BARCODE_TYPES, loadBarcodes, paintBarcode } from '../../src/engine/items/barcode.js';
import { fontStore, texts } from '../helpers.js';

let st;
const S = () => st.getState();
const T = () => S().def.sections.body.items[0];
const grid = (n, rows) =>
  Array.from({ length: rows }, (_, r) => ({
    height: 18,
    cells: Array.from({ length: n }, (_, c) => ({ value: `${r}${c}` })),
  }));
const doc = (table) => ({
  $schema: 'reportwright/report@1',
  name: 'x',
  page: { size: 'A4' },
  sections: { body: { height: 300, items: [table] } },
});
function load(more = {}, n = 3, rows = 3) {
  st = newDesignerStore();
  activateStore(st);
  S().init(
    'x',
    doc({
      type: 'table',
      id: 't',
      name: 'T',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      columns: Array.from({ length: n }, () => ({ width: 60 })),
      detail: grid(n, rows),
      ...more,
    }),
  );
}
const vals = (row) =>
  row.cells.map((c) =>
    c == null ? null : c.value + (c.colSpan > 1 ? `/c${c.colSpan}` : '') + (c.rowSpan > 1 ? `/r${c.rowSpan}` : ''),
  );

/** Everything wrong with a table's cell grid and size ([] when it is consistent). */
export function problems(t) {
  const n = t.columns.length,
    bad = [];
  for (const { part } of tableParts(t)) {
    const rows = rowsOf(t, part) || [];
    const cover = rows.map(() => new Array(n).fill(0));
    rows.forEach((row, r) => {
      if (!Array.isArray(row.cells) || row.cells.length !== n)
        bad.push(`${part}${r}: ${row.cells?.length} cells for ${n} columns`);
      for (let c = 0; c < n; c++) {
        const cell = row.cells?.[c];
        if (!cell) continue;
        const cs = cell.colSpan || 1,
          rs = cell.rowSpan || 1;
        if (c + cs > n) bad.push(`${part}${r}c${c}: colSpan ${cs} past column ${n}`);
        if (r + rs > rows.length) bad.push(`${part}${r}c${c}: rowSpan ${rs} past row ${rows.length}`);
        for (let i = 0; i < rs; i++) for (let k = 0; k < cs; k++) if (cover[r + i] && c + k < n) cover[r + i][c + k]++;
      }
    });
    cover.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v !== 1) bad.push(`${part}${r}c${c} covered ${v}x`);
      }),
    );
  }
  const w = Math.round(t.columns.reduce((s, c) => s + c.width, 0) * 100) / 100;
  if (t.w !== w) bad.push(`w ${t.w} != ${w}`);
  const h = tableParts(t)
    .flatMap((p) => rowsOf(t, p.part) || [])
    .reduce((a, r) => a + (r.height || 18), 0);
  if (t.h !== Math.max(1, h)) bad.push(`h ${t.h} != ${h}`); // an item is at least 1 pt (minSize)
  return bad;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Run random command sequences; return the first failing one (or null). ops: which commands may run.
 * Targets are cells the UI offers: a cell that is there (not null), at a row and column of its part.
 */
function fuzz(ops, { seeds = 300, steps = 30, start = () => load({ header: grid(3, 1) }) } = {}) {
  for (let seed = 1; seed <= seeds; seed++) {
    start();
    const R = rng(seed),
      pick = (a) => a[Math.floor(R() * a.length)];
    const log = [];
    for (let step = 0; step < steps; step++) {
      const t = T();
      const parts = tableParts(t)
        .map((p) => p.part)
        .filter((p) => (rowsOf(t, p) || []).length);
      const part = pick(parts),
        rows = rowsOf(t, part),
        row = Math.floor(R() * rows.length);
      const owners = rows[row].cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      const col = owners.length ? pick(owners) : 0;
      const op = pick(ops);
      const at = Math.floor(R() * (t.columns.length + 1)),
        rowAt = Math.floor(R() * (rows.length + 1));
      log.push(
        `${op} ${part} r${row} c${col}${op === 'insertColumn' ? ` at ${at}` : op === 'insertRow' ? ` at ${rowAt}` : ''}`,
      );
      try {
        if (op === 'insertColumn') tableInsertColumn('t', at);
        else if (op === 'deleteColumn') tableDeleteColumn('t', col);
        else if (op === 'insertRow') tableInsertRow('t', part, rowAt);
        else if (op === 'deleteRow') tableDeleteRow('t', part, row);
        else if (op === 'width') tableSetColumnWidth('t', col % t.columns.length, 5 + R() * 200);
        else if (op === 'group') {
          if ((t.groups || []).length < 2) tableAddGroup('t', 'f', [[1, 'amount']]);
        } else if (op === 'ungroup') {
          if ((t.groups || []).length) tableRemoveGroup('t', 0);
        } else if (owners.length)
          ({ mergeRight: tableMergeRight, mergeDown: tableMergeDown, split: tableSplit, splitRows: tableSplitRows })[
            op
          ]('t', part, row, col);
      } catch (e) {
        return { seed, steps: log, problems: [`throws: ${e.message}`] };
      }
      const bad = problems(T());
      if (bad.length) return { seed, steps: log, problems: bad };
    }
  }
  return null;
}

describe('table commands keep every row consistent with the columns', () => {
  it('columns: random inserts, deletes and widths over merged header and group rows', () => {
    const start = () =>
      load({
        header: [
          { height: 18, cells: [{ value: 'A' }, { value: 'BC', colSpan: 2, rowSpan: 2 }, null] },
          { height: 18, cells: [{ value: 'a' }, null, null] },
        ],
        groups: [
          {
            name: 'G',
            expr: '=Fields.g',
            header: [{ height: 18, cells: [{ value: '=Fields.g', colSpan: 3 }, null, null] }],
            footer: [{ height: 18, cells: [{ value: 'Sub' }, { value: '=Sum(Fields.x)', colSpan: 2 }, null] }],
          },
        ],
      });
    expect(fuzz(['insertColumn', 'deleteColumn', 'width', 'group', 'ungroup'], { start })).toBeNull();
  });
  it('rows and columns: random row and column inserts, deletes and widths (no merges)', () => {
    expect(fuzz(['insertRow', 'deleteRow', 'insertColumn', 'deleteColumn', 'width'])).toBeNull();
  });
  it('regression: random sequences of every table command (merge right and down, split, rows, columns, groups)', () => {
    const r = fuzz([
      'insertColumn',
      'deleteColumn',
      'mergeRight',
      'mergeDown',
      'split',
      'splitRows',
      'insertRow',
      'deleteRow',
      'group',
      'ungroup',
    ]);
    expect(r, r && `seed ${r.seed}: ${r.steps.slice(-6).join(' → ')}\n${r.problems.slice(0, 4).join('\n')}`).toBeNull();
  });
});

describe('merges and splits (each one alone)', () => {
  beforeEach(() => load());
  it('merge right, then split: back to three cells', () => {
    tableMergeRight('t', 'detail', 0, 0);
    expect(vals(T().detail[0])).toEqual(['00/c2', null, '02']);
    tableMergeRight('t', 'detail', 0, 0);
    expect(vals(T().detail[0])).toEqual(['00/c3', null, null]);
    tableMergeRight('t', 'detail', 0, 0); // at the last column: nothing
    expect(vals(T().detail[0])).toEqual(['00/c3', null, null]);
    tableSplit('t', 'detail', 0, 0);
    expect(vals(T().detail[0])).toEqual(['00', '', '']);
    expect(problems(T())).toEqual([]);
  });
  it('merge down twice, split rows', () => {
    tableMergeDown('t', 'detail', 0, 1);
    tableMergeDown('t', 'detail', 0, 1);
    expect(T().detail.map((r) => vals(r)[1])).toEqual(['01/r3', null, null]);
    tableMergeDown('t', 'detail', 0, 1); // at the last row: nothing
    expect(T().detail[0].cells[1].rowSpan).toBe(3);
    tableSplitRows('t', 'detail', 0, 1);
    expect(T().detail.map((r) => vals(r)[1])).toEqual(['01', '', '']);
    expect(problems(T())).toEqual([]);
  });
  it('a 2×2 merge (right, then down) is consistent', () => {
    tableMergeRight('t', 'detail', 0, 0);
    tableMergeDown('t', 'detail', 0, 0);
    expect(vals(T().detail[0])).toEqual(['00/c2/r2', null, '02']);
    expect(vals(T().detail[1])).toEqual([null, null, '12']);
    expect(problems(T())).toEqual([]);
  });
  it('a column added inside a 2×2 merge widens it on both rows; deleting it shrinks it back', () => {
    tableMergeRight('t', 'detail', 0, 0);
    tableMergeDown('t', 'detail', 0, 0);
    tableInsertColumn('t', 1);
    expect(vals(T().detail[0])).toEqual(['00/c3/r2', null, null, '02']);
    expect(vals(T().detail[1])).toEqual([null, null, null, '12']);
    tableDeleteColumn('t', 0);
    expect(vals(T().detail[0])).toEqual(['00/c2/r2', null, '02']);
    expect(problems(T())).toEqual([]);
  });
  it('the last column cannot be deleted; the last detail row neither (no groups)', () => {
    load({}, 1, 1);
    const before = S().def;
    tableDeleteColumn('t', 0);
    tableDeleteRow('t', 'detail', 0);
    expect(S().def).toBe(before);
  });
  it('with a group the last detail row can go (group header and footer still print)', () => {
    load({}, 2, 1);
    tableAddGroup('t', 'region');
    tableDeleteRow('t', 'detail', 0);
    expect(T().detail).toEqual([]);
    expect(problems(T())).toEqual([]);
  });
  it('tableSync: width and height follow columns, rows and groups', () => {
    tableSetColumnWidth('t', 0, 5); // at least 12
    expect(T().columns[0].width).toBe(12);
    expect(T().w).toBe(132);
    tableAddGroup('t', 'region', [[2, 'amount']]);
    expect(T().h).toBe(18 * 5);
    expect(T().groups[0].footer[0].cells[2].value).toBe('=Sum(Fields.amount)');
    tableInsertRow('t', 'g0h', 1);
    expect(T().h).toBe(18 * 6);
    tableRemoveGroup('t', 0);
    expect(T().h).toBe(18 * 3);
    expect(problems(T())).toEqual([]);
  });
});

describe('regression: merges and splits that leave a hole or an overlap', () => {
  beforeEach(() => load());
  it('regression: delete the top row of a vertical merge: the rows below keep nulls nobody covers', () => {
    tableMergeDown('t', 'detail', 0, 0);
    tableDeleteRow('t', 'detail', 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: delete a row covered by a vertical merge: the merge still spans the deleted row', () => {
    tableMergeDown('t', 'detail', 1, 0);
    tableDeleteRow('t', 'detail', 2);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it("regression: insert a row inside a vertical merge: the new row's cell lies under the merge", () => {
    tableMergeDown('t', 'detail', 0, 0);
    tableInsertRow('t', 'detail', 1);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: merge down onto a cell that a merge of the row below covers', () => {
    tableMergeRight('t', 'detail', 1, 0);
    tableMergeDown('t', 'detail', 0, 1);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: merge right onto a merged neighbour: its other columns are left uncovered', () => {
    tableMergeRight('t', 'detail', 0, 1);
    tableMergeRight('t', 'detail', 0, 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: merge right onto a vertically merged neighbour: the rows it covered are left uncovered', () => {
    tableMergeDown('t', 'detail', 0, 1);
    tableMergeRight('t', 'detail', 0, 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: merge right of a vertically merged cell: the rows below are not cleared', () => {
    tableMergeDown('t', 'detail', 0, 0);
    tableMergeRight('t', 'detail', 0, 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: split a 2×2 merge: the second row keeps a null nobody covers', () => {
    tableMergeRight('t', 'detail', 0, 0);
    tableMergeDown('t', 'detail', 0, 0);
    tableSplit('t', 'detail', 0, 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: split rows of a 2×2 merge: the second column of the lower row stays uncovered', () => {
    tableMergeRight('t', 'detail', 0, 0);
    tableMergeDown('t', 'detail', 0, 0);
    tableSplitRows('t', 'detail', 0, 0);
    expect(problems(T()), JSON.stringify(T().detail.map(vals))).toEqual([]);
  });
  it('regression: merge right on a column a short row does not list throws', () => {
    load({
      groups: [
        { name: 'G', expr: '=Fields.g', header: [{ height: 18, cells: [{ value: 'g', colSpan: 2 }] }], footer: [] },
      ],
    });
    expect(() => tableMergeRight('t', 'g0h', 0, 2)).not.toThrow();
  });
});

describe('bands and body sections', () => {
  beforeEach(() => load());
  it('add, then remove body sections; keys and labels in page order', () => {
    addBodySection();
    addBodySection();
    expect(sectionList(S().def).map((s) => s.key)).toEqual(['pageHeader', 'body', 'body:1', 'body:2', 'pageFooter']);
    expect(S().sel).toEqual({ kind: 'section', section: 'body:2' });
    removeBodySection('body:1');
    expect(S().def.sections.body.map((b) => b.name)).toEqual(['Section1', 'Section3']);
    removeBodySection('body');
    expect(Array.isArray(S().def.sections.body)).toBe(false);
    expect(S().def.sections.body.items).toEqual([]);
    removeBodySection('body'); // the only one: nothing
    expect(S().def.sections.body).toBeTruthy();
  });
  it('one undo step per section added or removed', () => {
    addBodySection();
    removeBodySection('body:1');
    S().undo();
    expect(S().def.sections.body.length).toBe(2);
    S().undo();
    expect(Array.isArray(S().def.sections.body)).toBe(false);
  });
  it('a 0 pt band takes an item and grows to it (4 pt of room in a page band)', () => {
    S().apply((d) => {
      d.sections.pageHeader = { height: 0, items: [] };
    });
    addItem('textbox', 'pageHeader', 0, 0);
    const h = secOf(S().def, 'pageHeader');
    expect(h.height).toBe(Math.ceil(h.items[0].h + 4));
  });
  it("a table for an own page header goes to its section's body, not the shared body", () => {
    addBodySection();
    S().apply((d) => {
      d.sections.body[1].pageHeader = { height: 30, items: [] };
    });
    expect(insertSpot(S().def, { kind: 'section', section: 'body:1:pageHeader' }, 'table').section).toBe('body');
  });
});

describe('report check (validate) and the engine: TOC, barcode, subreport', () => {
  const rep = (sections) => ({
    $schema: 'reportwright/report@1',
    name: 'R',
    page: { size: 'A4' },
    dataSources: [],
    dataSets: [],
    sections: {
      pageHeader: { height: 40, items: [] },
      body: { height: 200, items: [] },
      pageFooter: { height: 20, items: [] },
      ...sections,
    },
  });
  const toc = { type: 'toc', name: 'Toc', x: 0, y: 0, w: 300, h: 30, title: 'Contents' };
  it('a TOC in the body: no warning; in a page header or an own page footer: a warning', () => {
    expect(
      validate(rep({ body: { height: 200, items: [toc] } })).warnings.filter((w) => /table of contents/.test(w)),
    ).toEqual([]);
    expect(
      validate(rep({ pageHeader: { height: 40, items: [toc] } })).warnings.some((w) => /Toc is in a page band/.test(w)),
    ).toBe(true);
    expect(
      validate(rep({ body: [{ height: 100, items: [], pageFooter: { height: 40, items: [toc] } }] })).warnings.some(
        (w) => /Toc is in a page band/.test(w),
      ),
    ).toBe(true);
  });
  it('a TOC in a page header renders (its title) without an error', async () => {
    const m = await render(
      rep({
        pageHeader: { height: 40, items: [toc] },
        body: {
          height: 200,
          items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 200, h: 20, value: 'Intro', headingLevel: 1 }],
        },
      }),
      { fontStore },
    );
    expect(texts(m.pages[0])).toContain('Contents');
  });
  it('an empty barcode value: a warning, not an error', () => {
    const v = validate(
      rep({
        body: {
          height: 200,
          items: [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 100, h: 40, symbology: 'ean13', value: '' }],
        },
      }),
    );
    expect(v.errors).toEqual([]);
    expect(v.warnings).toContain('B has no value: nothing is printed');
  });
  it('an unknown symbology: an error with the id that was meant', () => {
    const v = validate(
      rep({
        body: {
          height: 200,
          items: [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 100, h: 40, symbology: 'ean', value: '1' }],
        },
      }),
    );
    expect(v.errors.join()).toMatch(/"ean" is not a barcode symbology \(did you mean "ean13"\?\)/);
  });
  it('every symbology the designer offers draws its sample; invalid data is an error, not a throw', async () => {
    await loadBarcodes();
    expect(BARCODE_TYPES).toEqual(SYMBOLOGIES.map((s) => s.id));
    for (const s of SYMBOLOGIES) {
      const r = paintBarcode({ type: s.id, text: s.sample, x: 0, y: 0, w: 200, h: 80 });
      expect([s.id, r.error || null, r.items.length > 0]).toEqual([s.id, null, true]);
    }
    for (const [type, text] of [
      ['ean13', 'ABCDEFGHIJKLM'],
      ['ean13', '123'],
      ['upca', 'HELLO'],
      ['postnet', 'abc'],
      ['ean8', '1234567890123'],
      ['pharmacode', '9999999'],
    ]) {
      const r = paintBarcode({ type, text, x: 0, y: 0, w: 200, h: 80 });
      expect([type, text, typeof r.error]).toEqual([type, text, 'string']);
    }
  });
  it('a subreport with no report: no designer check; the engine warns and keeps the space', async () => {
    const def = rep({
      body: {
        height: 200,
        items: [{ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 200, h: 40, report: '', params: {} }],
      },
    });
    expect(validate(def).errors).toEqual([]);
    const m = await render(def, { fontStore });
    expect(m.warnings.join('\n')).toMatch(/Sub has no report/);
  });
});
