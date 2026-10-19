// The designer store's own state: history (merged steps, the 200-step cap, read-only), what undo and redo select, the
// selection kept valid, and save to a host or a server (revision, conflict, take theirs), with exact results.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDesignerStore, activateStore, activeStore, findItem } from '../../src/designer/store.js';

let st;
const S = () => st.getState();
const tb = (id, y = 0) => ({ id, type: 'textbox', name: id.toUpperCase(), x: 0, y, w: 100, h: 20, value: id });
const table = {
  id: 't',
  type: 'table',
  name: 'Tab',
  x: 0,
  y: 100,
  w: 100,
  h: 36,
  columns: [{ width: 50 }, { width: 50 }],
  header: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
  detail: [{ height: 18, cells: [{ value: 'c' }, { value: 'd' }] }],
};
const report = () => ({
  name: 'S',
  page: { size: 'A4' },
  sections: {
    pageHeader: { height: 0, items: [] },
    body: {
      height: 400,
      items: [
        tb('a'),
        tb('b', 30),
        { id: 'box', type: 'container', name: 'Box', x: 0, y: 200, w: 200, h: 60, items: [tb('kid')] },
        table,
      ],
    },
    pageFooter: { height: 0, items: [] },
  },
});
beforeEach(() => {
  st = newDesignerStore();
  activateStore(st);
  S().init('r1', report());
});
afterEach(() => vi.unstubAllGlobals());
const setY = (id, y, key) =>
  S().apply((d) => {
    findItem(d, id).item.y = y;
  }, key);

describe('history', () => {
  it('init: clean, no history, the report selected', () => {
    expect([S().id, S().saved, S().past.length, S().future.length]).toEqual(['r1', true, 0, 0]);
    expect(S().sel).toEqual({ kind: 'report' });
    expect(activeStore()).toBe(st);
  });
  it('apply: a step each; no change, no step; the future goes', () => {
    setY('a', 5);
    expect([S().past.length, S().saved]).toEqual([1, false]);
    S().apply(() => {});
    expect(S().past.length).toBe(1);
    S().undo();
    expect(S().future.length).toBe(1);
    setY('a', 7);
    expect(S().future).toEqual([]);
  });
  it('the same key within 800 ms is one step; another key or later, a new one', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    setY('a', 1, 'a.y');
    now.mockReturnValue(1500);
    setY('a', 2, 'a.y');
    expect(S().past.length).toBe(1);
    now.mockReturnValue(2400);
    setY('a', 3, 'a.y');
    expect(S().past.length).toBe(2);
    now.mockReturnValue(2500);
    setY('a', 4, 'b.y');
    expect(S().past.length).toBe(3);
    now.mockReturnValue(2600);
    setY('a', 5);
    setY('a', 6);
    expect(S().past.length).toBe(5); // no key: never merged
    S().undo();
    now.mockReturnValue(2700);
    setY('a', 9, 'b.y'); // an undo forgets the key
    expect(S().past.length).toBe(5);
    now.mockRestore();
  });
  it('at most 200 steps back', () => {
    for (let i = 0; i < 230; i++) setY('a', i + 1);
    expect(S().past.length).toBe(200);
    for (let i = 0; i < 250; i++) S().undo();
    expect(findItem(S().def, 'a').item.y).toBe(30); // the oldest kept: the state after step 30
    expect(S().future.length).toBe(200);
  });
  it('read-only: no edit, no undo or redo, no save', async () => {
    setY('a', 5);
    S().setUi({ readOnly: true });
    setY('a', 9);
    expect(findItem(S().def, 'a').item.y).toBe(5);
    S().undo();
    expect(findItem(S().def, 'a').item.y).toBe(5);
    S().setUi({ readOnly: false });
    S().undo();
    S().setUi({ readOnly: true });
    S().redo();
    expect(findItem(S().def, 'a').item.y).toBe(0);
    const onSave = vi.fn();
    S().setUi({ embed: { onSave } });
    await S().save();
    expect(onSave).not.toHaveBeenCalled();
  });
  it('undo and redo with nothing there do nothing', () => {
    const d = S().def;
    S().undo();
    S().redo();
    expect(S().def).toBe(d);
    expect(S().saved).toBe(true);
  });
});

describe('what undo and redo select', () => {
  it('an undone move selects the item moved back', () => {
    setY('b', 50);
    S().select({ kind: 'report' });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['b'] });
  });
  it('an undone delete selects what came back (the container, not its child)', () => {
    S().apply((d) => {
      d.sections.body.items.splice(2, 1);
    });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['box'] });
  });
  it('a child that changed is selected, not its container', () => {
    S().apply((d) => {
      findItem(d, 'kid').item.value = 'z';
    });
    S().select({ kind: 'report' });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['kid'] });
    S().redo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['kid'] });
  });
  it('a redone insert selects the new item', () => {
    S().apply((d) => {
      d.sections.body.items.push(tb('n', 300));
    });
    S().undo();
    expect(S().sel).toEqual({ kind: 'report' }); // what it selected is gone
    S().redo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['n'] });
  });
  it("a cell edit undone while that table's cell is selected keeps the cell", () => {
    S().apply((d) => {
      findItem(d, 't').item.detail[0].cells[1].value = 'x';
    });
    const cell = { kind: 'cell', id: 't', part: 'detail', row: 0, col: 1 };
    S().select(cell);
    S().undo();
    expect(S().sel).toEqual(cell);
  });
  it('a step that changed no item keeps the selection', () => {
    S().apply((d) => {
      d.name = 'Renamed';
    });
    S().select({ kind: 'items', ids: ['a'] });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['a'] });
  });
});

describe('fixSelection', () => {
  it('items that are gone leave the selection; none left: the report', () => {
    S().select({ kind: 'items', ids: ['a', 'gone'] });
    S().fixSelection();
    expect(S().sel).toEqual({ kind: 'items', ids: ['a'] });
    S().select({ kind: 'items', ids: ['gone'] });
    S().fixSelection();
    expect(S().sel).toEqual({ kind: 'report' });
  });
  it('a cell: its row gone, the table; the table gone, the report; cells that are gone leave the list', () => {
    S().select({ kind: 'cell', id: 't', part: 'footer', row: 0, col: 0 });
    S().fixSelection();
    expect(S().sel).toEqual({ kind: 'items', ids: ['t'] });
    S().select({ kind: 'cell', id: 'gone', part: 'detail', row: 0, col: 0 });
    S().fixSelection();
    expect(S().sel).toEqual({ kind: 'report' });
    const cells = [
      { part: 'detail', row: 0, col: 0 },
      { part: 'detail', row: 0, col: 5 },
      { part: 'header', row: 0, col: 1 },
    ];
    S().select({ kind: 'cell', id: 't', part: 'detail', row: 0, col: 0, cells });
    S().fixSelection();
    expect(S().sel.cells).toEqual([
      { part: 'detail', row: 0, col: 0 },
      { part: 'header', row: 0, col: 1 },
    ]);
    S().select({ kind: 'cell', id: 't', part: 'detail', row: 0, col: 0, cells: cells.slice(0, 2) });
    S().fixSelection();
    expect(S().sel.cells).toBeUndefined(); // one left: a single cell
    S().select({ kind: 'section', section: 'body' });
    S().fixSelection();
    expect(S().sel).toEqual({ kind: 'section', section: 'body' });
  });
  it('select forgets the merge key', () => {
    S().apply((d) => {
      d.name = 'x';
    }, 'k');
    S().select({ kind: 'report' });
    expect(S().lastKey).toBeNull();
  });
});

describe('save', () => {
  it('to the host: a plain copy, saved; an edit during the save stays unsaved', async () => {
    let got;
    S().setUi({
      embed: {
        onSave: async (d) => {
          got = d;
          setY('a', 77);
        },
      },
    });
    setY('a', 5);
    await S().save();
    expect(got.sections.body.items[0].y).toBe(5);
    expect(Object.isFrozen(got)).toBe(false);
    expect([S().saved, S().saving]).toEqual([false, false]);
    S().setUi({ embed: { onSave: async () => {} } });
    await S().save();
    expect(S().saved).toBe(true);
  });
  it("the host's error is shown", async () => {
    S().setUi({
      embed: {
        onSave: async () => {
          throw new Error('disk full');
        },
      },
    });
    await S().save();
    expect([S().saveError, S().saving, S().saved]).toEqual(['disk full', false, true]);
  });
  it('no id and no host: an error', async () => {
    S().init(null, report());
    await S().save();
    expect(S().saveError).toBe('This report has no id to save to');
  });
  it('to the server: PUT with If-Match, the new revision, the missing drill reports', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, o) => {
      calls.push([url, o]);
      return { ok: true, status: 200, json: async () => ({ rev: 'r2', missing: ['Drill'] }) };
    });
    S().setUi({ rev: 'r1', embed: { server: 'https://pw.test' } });
    setY('a', 5);
    await S().save();
    expect(calls[0][0]).toBe('https://pw.test/api/reports/r1');
    expect(calls[0][1].method).toBe('PUT');
    expect(calls[0][1].headers).toEqual({ 'content-type': 'application/json', 'if-match': '"r1"' });
    expect(JSON.parse(calls[0][1].body).sections.body.items[0].y).toBe(5);
    expect([S().rev, S().saved, S().conflict]).toEqual(['r2', true, null]);
    expect(S().saveCheck).toEqual({ missing: ['Drill'] });
  });
  it('a new report: no If-Match; a reply without missing: none', async () => {
    let headers;
    vi.stubGlobal('fetch', async (_u, o) => {
      headers = o.headers;
      return { ok: true, status: 200, json: async () => ({}) };
    });
    S().init('new one', report());
    await S().save();
    expect(headers).toEqual({ 'content-type': 'application/json' });
    expect([S().rev, S().saveCheck]).toEqual([null, { missing: [] }]);
  });
  it("someone else's save: a conflict, nothing overwritten; overwrite on purpose uses their revision", async () => {
    const seen = [];
    let status = 409;
    vi.stubGlobal('fetch', async (_u, o) => {
      seen.push(o.headers['if-match']);
      return {
        ok: status === 200,
        status,
        json: async () => (status === 200 ? { rev: 'r4' } : { rev: 'r3', error: 'changed' }),
      };
    });
    S().setUi({ rev: 'r1' });
    setY('a', 5);
    await S().save();
    expect(S().conflict).toEqual({ rev: 'r3', error: 'changed' });
    expect(S().saved).toBe(false);
    status = 200;
    await S().save({ overwrite: true });
    expect(seen).toEqual(['"r1"', '"r3"']);
    expect([S().rev, S().conflict, S().saved]).toEqual(['r4', null, true]);
  });
  it('a 428 is a conflict too; other errors say their message or status', async () => {
    let reply = { ok: false, status: 428, json: async () => ({}) };
    vi.stubGlobal('fetch', async () => reply);
    await S().save();
    expect(S().conflict).toEqual({ rev: null, error: '' });
    reply = { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    await S().save();
    expect(S().saveError).toBe('boom');
    reply = {
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    };
    await S().save();
    expect(S().saveError).toBe('HTTP 503');
  });
  it('take theirs: the report as the server has it, its revision from the ETag', async () => {
    const theirs = { ...report(), name: 'Theirs' };
    vi.stubGlobal('fetch', async (url, o) => ({
      ok: true,
      status: 200,
      json: async () => theirs,
      headers: { get: (h) => (h === 'etag' ? 'W/"r9"' : null) },
      url,
      o,
    }));
    S().setUi({ conflict: { rev: 'r9' } });
    setY('a', 5);
    await S().takeTheirs();
    expect([S().def.name, S().rev, S().conflict, S().saved, S().past.length]).toEqual(['Theirs', 'r9', null, true, 0]);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    await S().takeTheirs();
    expect(S().saveError).toBe('HTTP 404');
  });
});
