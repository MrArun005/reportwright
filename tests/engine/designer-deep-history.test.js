// Designer undo/redo, store level: every edit is one reversible step; merging, limits and redo rules.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ITEMS } from '../../src/engine/items/index.js';
import {
  newDesignerStore,
  activateStore,
  findItem,
  secOf,
  addItem,
  deleteSelection,
  moveItems,
  updateItem,
  alignItems,
  addBodySection,
  removeBodySection,
  tableInsertRow,
  tableDeleteRow,
  tableInsertColumn,
  tableDeleteColumn,
  tableMergeRight,
  tableSplit,
  tableMergeDown,
  tableSplitRows,
  tableAddGroup,
  tableRemoveGroup,
  tableSetColumnWidth,
  duplicateSelection,
  copySelection,
  cutSelection,
  pasteItems,
  reorderItem,
  moveOutOfParent,
  moveItemTo,
  growToFit,
} from '../../src/designer/store.js';

const MERGE_MS = 800; // store.js apply(): the same key within this many ms is one step
const LIMIT = 200; // store.js apply(): past.slice(-199) + the new one

const tb = (id, x, y, more = {}) => ({
  ...ITEMS.textbox.defaults(),
  id,
  name: id.toUpperCase(),
  x,
  y,
  value: id,
  ...more,
});
const table = (id) => ({ ...ITEMS.table.defaults(), id, name: 'T1', x: 0, y: 200 });
const report = () => ({
  $schema: 'reportwright/report@1',
  name: 'Start',
  page: { size: 'A4' },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [{ region: 'N', amount: 1 }] } }],
  dataSets: [
    {
      name: 'Rows',
      source: 'src',
      path: '$.rows',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
  ],
  sections: {
    pageHeader: { height: 40, items: [tb('h', 0, 4)] },
    body: {
      height: 400,
      items: [
        tb('a', 10, 10),
        tb('b', 150, 60, { w: 120, h: 30 }),
        tb('c', 300, 120),
        table('t'),
        {
          ...ITEMS.container.defaults(),
          id: 'box',
          name: 'BOX',
          x: 0,
          y: 320,
          w: 240,
          h: 60,
          items: [tb('kid', 4, 4)],
        },
      ],
    },
    pageFooter: { height: 30, items: [] },
  },
});

let st;
const S = () => st.getState();
const json = () => JSON.stringify(S().def);
beforeEach(() => {
  st = newDesignerStore();
  activateStore(st);
  S().init('r', report());
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const sel = (...ids) => S().select({ kind: 'items', ids });

/** Every edit the designer makes, as the UI makes it. Each must be exactly one undo step. */
const ACTIONS = {
  'add item': () => addItem('shape', 'body', 20, 100),
  'add item into a container': () => addItem('textbox', 'body', 0, 30, {}, 'box'),
  'add item to the page header': () => addItem('textbox', 'pageHeader', 0, 20),
  delete: () => {
    sel('a', 'b');
    deleteSelection();
  },
  'delete a child': () => {
    sel('kid');
    deleteSelection();
  },
  'move (drag)': () => moveItems(['a'], 40, 30),
  'move to another band (drag)': () => moveItems(['a'], 0, 0, { to: { section: 'pageFooter', ox: 0, oy: 500 } }),
  nudge: () => moveItems(['a', 'b'], 1, 0, { nudge: true }),
  resize: () =>
    updateItem('a', (it) => {
      it.w = 200;
      it.h = 40;
    }),
  'resize past the band bottom grows the band': () =>
    updateItem('c', (it, d, _s, f) => {
      it.h = 600;
      growToFit(d, f);
    }),
  ...Object.fromEntries(
    ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom', 'width', 'height'].map((h) => [
      `align ${h}`,
      () => alignItems(['a', 'b', 'c'], h),
    ]),
  ),
  'align to page': () => alignItems(['a'], 'right', true),
  'distribute horizontally': () => alignItems(['a', 'b', 'c'], 'hdist'),
  'distribute vertically': () => alignItems(['a', 'b', 'c'], 'vdist'),
  'property edit (Inspector)': () =>
    updateItem(
      'a',
      (it) => {
        it.value = 'changed';
      },
      'a.value',
    ),
  'style edit (Inspector)': () =>
    updateItem(
      'a',
      (it) => {
        it.style ||= {};
        it.style.color = '#ff0000';
      },
      'a.style.color',
    ),
  rename: () =>
    S().apply((d) => {
      findItem(d, 'a').item.name = 'Renamed';
    }, 'a.name'),
  'band height': () =>
    S().apply((d) => {
      secOf(d, 'body').height = 600;
    }, 'sec.body.height'),
  'page header height': () =>
    S().apply((d) => {
      secOf(d, 'pageHeader').height = 80;
    }, 'sec.pageHeader.height'),
  'add body section': () => addBodySection(),
  'remove body section': null, // needs two sections: below
  'table: insert row': () => tableInsertRow('t', 'detail', 1),
  'table: delete row': () => tableDeleteRow('t', 'header', 0),
  'table: insert column': () => tableInsertColumn('t', 1),
  'table: delete column': () => tableDeleteColumn('t', 0),
  'table: merge right': () => tableMergeRight('t', 'detail', 0, 0),
  'table: merge down': () => {
    tableInsertRow('t', 'detail', 1);
    S().lastKey = null;
    tableMergeDown('t', 'detail', 0, 0);
  },
  'table: column width': () => tableSetColumnWidth('t', 0, 200),
  'table: add group': () => tableAddGroup('t', 'region', [[2, 'amount']]),
  'data set add': () =>
    S().apply((d) => {
      d.dataSets.push({ name: 'More', source: 'src', path: '$' });
    }),
  'data set remove': () =>
    S().apply((d) => {
      d.dataSets.splice(0, 1);
    }),
  'data source remove': () =>
    S().apply((d) => {
      d.dataSets = [];
      d.dataSources.splice(0, 1);
    }),
  'report name': () =>
    S().apply((d) => {
      d.name = 'Renamed report';
    }, 'name'),
  duplicate: () => {
    sel('a');
    duplicateSelection();
  },
  paste: async () => {
    sel('a');
    await copySelection();
    pasteItems('body');
  },
  cut: async () => {
    sel('b');
    await cutSelection();
  },
  reorder: () => reorderItem('a', 1),
  'move out of container': () => moveOutOfParent('kid'),
  'move into container (outline)': () => moveItemTo('a', 'box', 0),
};
// steps the action itself is made of (a merge-down needs a row first)
const STEPS = { 'table: merge down': 2, paste: 1 };

describe('every action is one undo step and redo puts it back', () => {
  for (const [name, act] of Object.entries(ACTIONS)) {
    if (!act) continue;
    it(name, async () => {
      const before = json();
      const n = S().past.length;
      await act();
      const after = json();
      expect(after).not.toBe(before);
      expect(S().past.length - n).toBe(STEPS[name] || 1);
      for (let i = 0; i < (STEPS[name] || 1); i++) S().undo();
      expect(json()).toBe(before);
      for (let i = 0; i < (STEPS[name] || 1); i++) S().redo();
      expect(json()).toBe(after);
    });
  }
  it('remove body section', () => {
    addBodySection();
    S().apply((d) => {
      d.sections.body[1].items.push(tb('s2', 0, 0));
    });
    const before = json();
    removeBodySection('body:1');
    expect(Array.isArray(S().def.sections.body)).toBe(false);
    S().undo();
    expect(json()).toBe(before);
    S().redo();
    expect(Array.isArray(S().def.sections.body)).toBe(false);
  });
  it('table split (after merge right) and split rows (after merge down)', () => {
    tableMergeRight('t', 'detail', 0, 0);
    const merged = json();
    tableSplit('t', 'detail', 0, 0);
    S().undo();
    expect(json()).toBe(merged);
    tableInsertRow('t', 'detail', 1);
    tableMergeDown('t', 'detail', 0, 2);
    const down = json();
    tableSplitRows('t', 'detail', 0, 2);
    expect(json()).not.toBe(down);
    S().undo();
    expect(json()).toBe(down);
  });
  it('table remove group', () => {
    tableAddGroup('t', 'region');
    const g = json();
    tableRemoveGroup('t', 0);
    S().undo();
    expect(json()).toBe(g);
  });
});

describe('undo × n then redo × n', () => {
  it('returns the identical definition at every step', async () => {
    const snaps = [json()];
    for (const name of [
      'add item',
      'move (drag)',
      'nudge',
      'resize',
      'align left',
      'distribute vertically',
      'property edit (Inspector)',
      'band height',
      'add body section',
      'table: insert row',
      'table: insert column',
      'table: merge right',
      'table: add group',
      'data set add',
      'report name',
      'duplicate',
      'paste',
      'cut',
      'move out of container',
    ]) {
      S().lastKey = null; // separate steps, as separate gestures are
      await ACTIONS[name]();
      snaps.push(json());
    }
    const n = snaps.length - 1;
    expect(S().past.length).toBe(n);
    for (let i = n - 1; i >= 0; i--) {
      S().undo();
      expect(json()).toBe(snaps[i]);
    }
    expect(S().past.length).toBe(0);
    for (let i = 1; i <= n; i++) {
      S().redo();
      expect(json()).toBe(snaps[i]);
    }
    expect(S().future.length).toBe(0);
  });
  it('undo with nothing to undo and redo with nothing to redo change nothing', () => {
    const before = json();
    S().undo();
    S().redo();
    expect(json()).toBe(before);
    expect(S().saved).toBe(true);
  });
});

describe('typing merges within 800 ms (same key)', () => {
  const type = (text, key = 'a.value') => {
    for (let i = 1; i <= text.length; i++)
      updateItem(
        'a',
        (it) => {
          it.value = text.slice(0, i);
        },
        key,
      );
  };
  it('keystrokes 100 ms apart are one step', () => {
    vi.useFakeTimers();
    const n = S().past.length;
    for (const ch of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      updateItem(
        'a',
        (it) => {
          it.value = ch;
        },
        'a.value',
      );
      vi.advanceTimersByTime(100);
    }
    expect(S().past.length).toBe(n + 1);
    S().undo();
    expect(findItem(S().def, 'a').item.value).toBe('a');
  });
  it('a pause of 800 ms or more starts a new step', () => {
    vi.useFakeTimers();
    type('ab');
    vi.advanceTimersByTime(MERGE_MS);
    type('abcd');
    expect(S().past.length).toBe(2);
    S().undo();
    expect(findItem(S().def, 'a').item.value).toBe('ab');
  });
  it('799 ms still merges', () => {
    vi.useFakeTimers();
    type('ab');
    vi.advanceTimersByTime(MERGE_MS - 1);
    type('abc');
    expect(S().past.length).toBe(1);
  });
  it('the window slides: keystrokes every 700 ms for 7 s stay one step', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      updateItem(
        'a',
        (it) => {
          it.value = `v${i}`;
        },
        'a.value',
      );
      vi.advanceTimersByTime(700);
    }
    expect(S().past.length).toBe(1);
  });
  it('another key (another property, another item) is another step', () => {
    vi.useFakeTimers();
    type('x', 'a.value');
    type('y', 'a.style.color');
    updateItem(
      'b',
      (it) => {
        it.value = 'z';
      },
      'b.value',
    );
    expect(S().past.length).toBe(3);
  });
  it('no key never merges', () => {
    vi.useFakeTimers();
    updateItem('a', (it) => {
      it.w = 50;
    });
    updateItem('a', (it) => {
      it.w = 60;
    });
    expect(S().past.length).toBe(2);
  });
  it('a selection change in between breaks the merge', () => {
    vi.useFakeTimers();
    type('x');
    sel('b');
    type('xy');
    expect(S().past.length).toBe(2);
  });
  it('an undo in between breaks the merge (the next keystroke is a new step)', () => {
    vi.useFakeTimers();
    type('x');
    vi.advanceTimersByTime(MERGE_MS);
    type('xy');
    S().undo();
    type('xyz');
    expect(S().past.length).toBe(2);
    S().undo();
    expect(findItem(S().def, 'a').item.value).toBe('x');
  });
  it('an edit that changes nothing adds no step', () => {
    updateItem(
      'a',
      (it) => {
        it.value = 'a';
      },
      'a.value',
    );
    S().apply(() => {});
    expect(S().past.length).toBe(0);
  });
});

describe('history rules', () => {
  it('a new edit clears redo', () => {
    moveItems(['a'], 10, 0);
    moveItems(['a'], 10, 0);
    S().undo();
    expect(S().future.length).toBe(1);
    moveItems(['b'], 4, 0);
    expect(S().future.length).toBe(0);
    const now = json();
    S().redo();
    expect(json()).toBe(now);
  });
  it('history survives selection changes', () => {
    moveItems(['a'], 10, 0);
    moveItems(['b'], 10, 0);
    sel('c');
    S().select({ kind: 'section', section: 'pageHeader' });
    S().select({ kind: 'report' });
    S().select({ kind: 'cell', id: 't', part: 'detail', row: 0, col: 0 });
    expect(S().past.length).toBe(2);
    S().undo();
    S().undo();
    expect(findItem(S().def, 'a').item.x).toBe(10);
    expect(findItem(S().def, 'b').item.x).toBe(150);
  });
  it(`limit: after 250 edits only ${LIMIT} undos; the oldest kept state is the one after edit 50`, () => {
    const snaps = [json()];
    for (let i = 1; i <= 250; i++) {
      updateItem('a', (it) => {
        it.x = i;
      });
      snaps.push(json());
    }
    expect(S().past.length).toBe(LIMIT);
    let n = 0;
    while (S().past.length) {
      S().undo();
      n++;
    }
    expect(n).toBe(LIMIT);
    expect(json()).toBe(snaps[250 - LIMIT]);
    S().undo();
    expect(json()).toBe(snaps[250 - LIMIT]);
    expect(S().future.length).toBe(LIMIT);
    for (let i = 0; i < LIMIT; i++) S().redo();
    expect(json()).toBe(snaps[250]);
  });
  it('read-only: undo and redo do nothing', () => {
    moveItems(['a'], 10, 0);
    S().setUi({ readOnly: true });
    const now = json();
    S().undo();
    expect(json()).toBe(now);
  });
  it('undo of a delete restores the very same items (ids, names, place in the list)', () => {
    const before = json();
    sel('kid', 'a');
    deleteSelection();
    S().undo();
    expect(json()).toBe(before);
    expect(S().sel).toEqual({ kind: 'items', ids: ['a', 'kid'] });
  });
  it('undo marks the report unsaved; init clears the history', () => {
    moveItems(['a'], 10, 0);
    S().setUi({ saved: true });
    S().undo();
    expect(S().saved).toBe(false);
    S().init('r', report());
    expect([S().past.length, S().future.length]).toEqual([0, 0]);
  });
});
