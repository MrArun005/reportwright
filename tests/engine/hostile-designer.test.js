// Hostile and malformed report JSON, imported into the designer (readReportFile, then init), pasted into it, checked
// and rendered: no crash (only a clear message), no hang, no change to Object.prototype, no code run from an
// expression. Each case has its own time limit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readReportFile } from '../../src/designer/importFile.js';
import { newDesignerStore, activateStore, pasteItems, walk } from '../../src/designer/store.js';
import { validate } from '../../src/engine/schema/validate.js';
import { shapeErrors, MAX_NESTING } from '../../src/engine/schema/shape.js';
import { render, ReportError } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const head = '{"$schema":"reportwright/report@1","name":"H","page":{"size":"A4"},"sections":{"body":{"items":[';
const tail = ']}}}';
const tb = (extra = {}) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: 'x', ...extra });
const def = (items, extra = {}) => ({
  $schema: 'reportwright/report@1',
  name: 'H',
  page: { size: 'A4' },
  sections: { body: { items } },
  ...extra,
});
const nested = (n) =>
  head +
  '{"type":"container","x":0,"y":0,"w":100,"h":100,"items":['.repeat(n) +
  JSON.stringify(tb()) +
  ']}'.repeat(n) +
  tail;
const clip = (items) => JSON.stringify({ kind: 'pagewright/items@1', items });

let st;
beforeEach(() => {
  st = newDesignerStore();
  activateStore(st);
  st.getState().init('r', def([tb({ id: 'a', name: 'A' })]));
});
afterEach(() => {
  expect(Object.prototype, 'Object.prototype untouched').toEqual({});
  expect({}.polluted).toBeUndefined();
  expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('polluted');
});

/** Import as the designer does; @returns the error message, or null when it opened. */
function open(text) {
  const r = readReportFile('hostile.pw.json', text);
  if (r.error) return r.error;
  st.getState().init('r', r.definition);
  return null;
}
/** Render, and say how it ended: 'ok' or the ReportError's message (any other error fails the test). */
async function renders(d) {
  try {
    await render(d, { fontStore });
    return 'ok';
  } catch (e) {
    expect(e, `a ReportError, not ${e?.constructor?.name}: ${e?.message}`).toBeInstanceOf(ReportError);
    return e.message;
  }
}

describe('wrong shapes are refused with a clear message', () => {
  const cases = {
    'items is a string': [def('x'), 'body: "items" must be a list'],
    'an item is null': [def([null]), 'body: item 1 is not an object'],
    'an item is a number': [def([tb(), 7]), 'body: item 2 is not an object'],
    'an item is an array': [def([[tb()]]), 'body: item 1 is not an object'],
    'sections is a list': [
      { ...def([]), sections: [] },
      '"sections" must be an object, such as { "body": { "items": [] } }',
    ],
    'the body is a string': [{ ...def([]), sections: { body: 'x' } }, 'body: a band must be an object with "items"'],
    'a page header is a number': [
      { ...def([tb()]), sections: { body: { items: [tb()] }, pageHeader: 3 } },
      'pageHeader: a band must be an object with "items"',
    ],
    "a container's items is an object": [
      def([{ type: 'container', name: 'Box', x: 0, y: 0, w: 10, h: 10, items: { 0: tb() } }]),
      'Box: "items" must be a list',
    ],
    'a body section is null': [
      { ...def([]), sections: { body: [{ items: [] }, null] } },
      'Body section 2 is not an object',
    ],
    'content is an object': [
      { ...def([tb()]), sections: { body: { items: [] }, content: {} } },
      '"sections.content" must be a list of placeholders',
    ],
  };
  for (const [name, [d, msg]] of Object.entries(cases)) {
    it(
      name,
      async () => {
        expect(shapeErrors(d)).toContain(msg);
        expect(open(JSON.stringify(d))).toBe(
          `hostile.pw.json is not a report definition the designer can open: ${msg}`,
        );
        expect(() => st.getState().init('r', d)).toThrow(`The report cannot be opened: ${msg}`);
        expect(validate(d).errors).toContain(msg);
        expect(await renders(d)).toBe(shapeErrors(d)[0]);
        // the designer keeps the report it had
        expect(st.getState().def.sections.body.items.map((i) => i.name)).toEqual(['A']);
      },
      10000,
    );
  }
  it('not JSON, an array, no sections', () => {
    expect(open('{"sections":')).toMatch(/^hostile\.pw\.json is not valid JSON/);
    expect(open('[]')).toBe('hostile.pw.json is not a report definition (it has no sections)');
    expect(open('"x"')).toBe('hostile.pw.json is not a report definition (it has no sections)');
    expect(validate([]).errors).toEqual(['The report definition is not an object']);
  });
});

describe('coordinates that are not numbers', () => {
  it('NaN, Infinity and strings: errors that name the item, the render stops with the first', async () => {
    const d = def([tb({ x: NaN, y: Infinity, w: -Infinity, h: '20' })]);
    const v = validate(d);
    expect(v.errors).toEqual(expect.arrayContaining(['T: "x" must be a number', 'T: "h" must be a number']));
    expect(await renders(d)).toBe('T: "x" must be a number');
    st.getState().init('r', d); // the designer opens it, so the user can fix it
  }, 10000);
  it('1e309 (Infinity once parsed) and 1e308: opens, renders, a paste puts it at 0', async () => {
    const text = head + '{"type":"textbox","name":"T","x":1e309,"y":-1e309,"w":1e308,"h":1e308,"value":"x"}' + tail;
    expect(open(text)).toBeNull();
    expect(await renders(JSON.parse(text))).toBe('ok');
    st.getState().init('r', def([tb({ id: 'a', name: 'A' })]));
    expect(pasteItems('body', clip([JSON.parse(text).sections.body.items[0]]))).toBe(1);
    const pasted = st.getState().def.sections.body.items.at(-1);
    expect([pasted.x, pasted.y]).toEqual([0, 0]);
  }, 10000);
});

describe('deep nesting', () => {
  it(`10,000 nested containers: refused at once, no stack overflow`, async () => {
    const t0 = Date.now();
    const text = nested(10000);
    expect(open(text)).toBe(
      `hostile.pw.json is not a report definition the designer can open: body: items are nested more than ${MAX_NESTING} deep`,
    );
    const d = JSON.parse(text);
    expect(validate(d).errors).toEqual([`body: items are nested more than ${MAX_NESTING} deep`]);
    expect(await renders(d)).toBe(`body: items are nested more than ${MAX_NESTING} deep`);
    // the clipboard text as another tab would have it (JSON.stringify of so deep an object overflows here too)
    expect(
      pasteItems('body', '{"kind":"pagewright/items@1","items":[' + text.slice(head.length, -tail.length) + ']}'),
    ).toBe(0); // nothing to paste
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10000);
  it(`${MAX_NESTING} deep, the most allowed: opens, checks, renders and pastes`, async () => {
    const text = nested(MAX_NESTING);
    expect(open(text)).toBeNull();
    let n = 0;
    walk(st.getState().def, () => n++);
    expect(n).toBe(MAX_NESTING + 1);
    const d = JSON.parse(text);
    expect(validate(d).errors).toEqual([]);
    expect(await renders(d)).toBe('ok');
    expect(pasteItems('body', clip(d.sections.body.items))).toBe(1);
  }, 20000);
});

describe('large strings', () => {
  it('a 1 MB text value: opens, checks and renders in time (many pages), pastes', async () => {
    const big = 'A'.repeat(1 << 20);
    const d = def([tb({ value: big })]);
    expect(open(JSON.stringify(d))).toBeNull();
    expect(validate(d).errors).toEqual([]);
    const t0 = Date.now();
    const m = await render(d, { fontStore });
    expect(m.pages.length).toBeGreaterThan(100);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(pasteItems('body', clip([d.sections.body.items[0]]))).toBe(1);
  }, 30000);
  it('a 1 MB name and a 1 MB expression: no hang, a message', async () => {
    const d = def([tb({ name: 'N'.repeat(1 << 20), value: '=' + '('.repeat(1 << 20) })]);
    const t0 = Date.now();
    const v = validate(d);
    expect(v.errors.length).toBeGreaterThan(0);
    expect(
      v.errors.every((e) => e.length <= 1000),
      'messages stay short',
    ).toBe(true);
    expect(typeof (await renders(d))).toBe('string');
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);
});

describe('prototype pollution', () => {
  const text =
    '{"$schema":"reportwright/report@1","name":"H","page":{"size":"A4"},"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},' +
    '"sections":{"__proto__":{"polluted":3},"body":{"items":[{"type":"textbox","name":"T","x":0,"y":0,"w":10,"h":10,"value":"=Fields.__proto__","__proto__":{"polluted":4},' +
    '"style":{"__proto__":{"polluted":5},"constructor":{"prototype":{"polluted":6}}}}]}},' +
    '"dataSources":[{"name":"s","type":"json","data":{"rows":[{"__proto__":{"polluted":7},"constructor":{"prototype":{"polluted":8}}}]}}],' +
    '"dataSets":[{"name":"D","source":"s","path":"$.rows"}],"parameters":[{"name":"__proto__","type":"string","default":"x"}]}';
  it('imported, edited, pasted, checked and rendered: Object.prototype untouched', async () => {
    expect(open(text)).toBeNull();
    st.getState().apply((d) => {
      d.sections.body.items[0].style.color = 'red';
    });
    expect(
      pasteItems(
        'body',
        '{"kind":"pagewright/items@1","items":[{"type":"textbox","x":0,"y":0,"w":9,"h":9,"__proto__":{"polluted":9}}],"__proto__":{"polluted":10}}',
      ),
    ).toBe(1);
    st.getState().undo();
    st.getState().redo();
    validate(JSON.parse(text));
    expect(typeof (await renders(JSON.parse(text)))).toBe('string');
  }, 10000);
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`an item of type "${type}" is unknown: a warning, the render skips it`, async () => {
      const d = def([tb({ type, name: 'U' }), tb({ name: 'K', value: 'kept', y: 30 })]);
      expect(validate(d).warnings).toContain(`Unknown item type "${type}"`);
      const m = await render(d, { fontStore });
      expect(texts(m.pages[0])).toEqual(['kept']);
      expect(open(JSON.stringify(d))).toBeNull();
    }, 10000);
  }
});

describe('expressions that try to run code', () => {
  const attempts = [
    '=constructor.constructor("return process")().exit(7)',
    '=Fields.constructor.constructor("globalThis.__pwned = 1")()',
    '=Code.constructor("globalThis.__pwned = 1")()',
    '="a" & (function(){ globalThis.__pwned = 1 })()',
    '=Globals.__proto__.constructor.constructor("globalThis.__pwned = 1")()',
    '=Parameters.__proto__.polluted',
    '=eval("globalThis.__pwned = 1")',
    '=import("node:fs")',
    '=`${globalThis.__pwned = 1}`',
    '=Fields["__proto__"]["polluted"] = 1',
  ];
  for (const value of attempts) {
    it(
      value,
      async () => {
        const d = def([tb({ value, w: 300 })], {
          dataSources: [{ name: 's', type: 'json', data: { rows: [{ a: 1 }] } }],
          dataSets: [{ name: 'D', source: 's', path: '$.rows' }],
        });
        validate(d);
        const r = await renders(d);
        if (r === 'ok') {
          const m = await render(d, { fontStore });
          expect(texts(m.pages[0]).join(' ')).not.toMatch(/function|native code|process/);
        }
        expect(globalThis.__pwned).toBeUndefined();
        expect(open(JSON.stringify(d))).toBeNull();
      },
      10000,
    );
  }
});

describe('hostile clipboard JSON', () => {
  const pastes = {
    'not JSON': '{"kind":',
    'another kind': '{"kind":"other","items":[]}',
    'items not a list': '{"kind":"pagewright/items@1","items":{"0":{}}}',
    'a null item': '{"kind":"pagewright/items@1","items":[null]}',
    'a string item': '{"kind":"pagewright/items@1","items":["x"]}',
    'a child that is not an object':
      '{"kind":"pagewright/items@1","items":[{"type":"container","x":0,"y":0,"w":9,"h":9,"items":[1]}]}',
  };
  for (const [name, text] of Object.entries(pastes)) {
    it(`${name}: nothing to paste, the report unchanged`, () => {
      const before = JSON.stringify(st.getState().def);
      expect(pasteItems('body', text)).toBe(0);
      expect(JSON.stringify(st.getState().def)).toBe(before);
    });
  }
  it('an item of no known type, with odd keys: pasted as data, the report still checks', () => {
    expect(
      pasteItems(
        'body',
        clip([{ type: 'constructor', x: '1', y: null, w: {}, h: [], name: 'x'.repeat(5000), toString: 1 }]),
      ),
    ).toBe(1);
    expect(() => validate(st.getState().def)).not.toThrow();
  });
});
