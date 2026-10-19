// Designer clipboard in the browser: Ctrl+C / X / V / D on every item type and band, across designers, and pastes
// of text from elsewhere (plain, invalid, hostile).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, Designer, BROWSER } from './harness.mjs';
import { ITEMS } from '../../src/engine/items/index.js';

const CLIP_KIND = 'pagewright/items@1';
const TYPES = Object.keys(ITEMS);
const BODY_ONLY = ['table', 'matrix', 'subreport'];
const OFFSET = 12;
const NOTHING = /Nothing to paste/;

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

/** Poll fn until it returns a truthy value (or time out). */
async function until(fn, { timeout = 5000, step = 25, msg = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${msg}`);
    await new Promise((r) => setTimeout(r, step));
  }
}
/** Every item of a definition, nested ones too: [{ ...item, band, parent }]. */
function allItems(def) {
  const out = [];
  const go = (list, band, parent) =>
    (list || []).forEach((it) => {
      out.push({ ...it, band, parent });
      go(it.items, band, it.name);
    });
  const b = def.sections.body;
  go(def.sections.pageHeader?.items, 'pageHeader');
  (Array.isArray(b) ? b : [b]).forEach((s, i) => go(s.items, i ? `body:${i}` : 'body'));
  go(def.sections.pageFooter?.items, 'pageFooter');
  return out;
}
/** The definition through JSON (Playwright cannot return objects nested ~60 levels deep from page.evaluate). */
const defOf = async (d) => JSON.parse(await d.page.evaluate(() => JSON.stringify(window.h.getDefinition())));
const count = async (d) => allItems(await defOf(d)).length;
const make = (type, name, x = 0, y = 0, more = {}) => ({ ...ITEMS[type].defaults(), name, x, y, ...more });
const twoSections = (bands = {}) =>
  report([], {
    sections: {
      pageHeader: { height: 80, items: bands.pageHeader || [] },
      body: [
        { name: 'Section1', height: 300, items: bands.body || [] },
        { name: 'Section2', height: 200, items: bands['body:1'] || [] },
      ],
      pageFooter: { height: 80, items: bands.pageFooter || [] },
    },
  });
/** Select an item with the mouse: a table by its grip, anything else by its corner. */
async function pick(d, name, modifiers = []) {
  const tbl = d.page.locator(`.tbl[data-item="${name}"]`);
  if (await tbl.count()) {
    for (const m of modifiers) await d.page.keyboard.down(m);
    await tbl.scrollIntoViewIfNeeded();
    await tbl.locator('.grip').click();
    for (const m of modifiers) await d.page.keyboard.up(m);
  } else {
    await d.item(name).scrollIntoViewIfNeeded();
    await d.click(name, modifiers);
  }
}
/** The names selected now, from the store's point of view (tables included). */
const selectedNames = (d) =>
  d.page.evaluate(() => {
    const root = document.querySelector('#d').shadowRoot;
    return [...root.querySelectorAll('.it.sel, .tbl.sel')].map((e) => e.dataset.item);
  });
const message = (d) => d.page.locator('.dmsg [role="status"]');
/** The band label of a band key (click it to select the band). */
async function selectBand(d, key) {
  // the label sits next to the band: find it through the band's parent
  const ok = await d.page.evaluate((k) => {
    const root = document.querySelector('#d').shadowRoot;
    const band = root.querySelector(`.band[data-section="${k}"]`);
    root.querySelectorAll('[data-test-label]').forEach((e) => e.removeAttribute('data-test-label'));
    // the label is drawn just before its band (or before the band's wrapper)
    for (let el = band, i = 0; el && i < 4; el = el.parentElement, i++) {
      for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.classList.contains('band-label')) {
          p.setAttribute('data-test-label', k);
          return true;
        }
        if (p.querySelector('.band')) break;
      }
    }
    return false;
  }, key);
  assert.ok(ok, `band label of ${key}`);
  await d.page.locator(`[data-test-label="${key}"]`).click();
}
/** Wrap navigator.clipboard.writeText so the test sees what a copy wrote (every browser; the write still happens). */
const recordClipboard = (d) =>
  d.page.evaluate(() => {
    window.__clipWrites = [];
    const cb = navigator.clipboard;
    const orig = cb?.writeText?.bind(cb);
    if (cb)
      cb.writeText = async (t) => {
        window.__clipWrites.push(t);
        if (orig) return orig(t);
      };
  });
const lastWrite = (d) => d.page.evaluate(() => window.__clipWrites.at(-1));

test('Ctrl+C / Ctrl+V for every item type: a copy of the same type, 12 pt on, selected', async () => {
  let y = 0;
  const items = TYPES.map((t) => {
    const it = make(t, `X_${t}`, 0, y);
    y += Math.max(it.h, 10) + 40;
    return it;
  });
  const d = await env.open(report(items, { sections: { body: { height: y + 40, items } } }));
  for (const type of TYPES) {
    const name = `X_${type}`;
    await d.press('Escape');
    await pick(d, name);
    assert.deepEqual(await selectedNames(d), [name], `${type} selected`);
    const n = await count(d);
    await d.press('ControlOrMeta+c');
    await d.press('ControlOrMeta+v');
    await until(async () => (await count(d)) === n + 1, { msg: `${type} pasted` });
    const def = await d.def();
    const orig = Designer.find(def, name);
    const [copyName] = await selectedNames(d);
    assert.notEqual(copyName, name);
    const copy = Designer.find(def, copyName);
    assert.equal(copy.type, type);
    assert.equal(copy.band, 'body');
    assert.deepEqual([copy.x, copy.y], [orig.x + OFFSET, orig.y + OFFSET], `${type} offset`);
    assert.notEqual(copy.id, orig.id);
  }
  d.expectClean();
});

test('Ctrl+D duplicates every item type next to its original', async () => {
  let y = 0;
  const items = TYPES.map((t) => {
    const it = make(t, `X_${t}`, 0, y);
    y += Math.max(it.h, 10) + 40;
    return it;
  });
  const d = await env.open(report(items, { sections: { body: { height: y + 40, items } } }));
  for (const type of TYPES) {
    await d.press('Escape');
    await pick(d, `X_${type}`);
    const n = await count(d);
    await d.press('ControlOrMeta+d');
    await until(async () => (await count(d)) === n + 1, { msg: `${type} duplicated` });
    const def = await d.def();
    const copy = Designer.find(def, (await selectedNames(d))[0]);
    assert.equal(copy.type, type);
    assert.equal(copy.x, Designer.find(def, `X_${type}`).x + OFFSET);
  }
  d.expectClean();
});

test('Ctrl+X then Ctrl+V puts every item type back at the same place; two Ctrl+Z restore the original', async () => {
  const types = TYPES;
  let y = 0;
  const items = types.map((t) => {
    const it = make(t, `X_${t}`, 20, y);
    y += Math.max(it.h, 10) + 40;
    return it;
  });
  const d = await env.open(report(items, { sections: { body: { height: y + 40, items } } }));
  for (const type of types) {
    const name = `X_${type}`;
    const start = await d.def();
    const orig = Designer.find(start, name);
    await d.press('Escape');
    await pick(d, name);
    await d.press('ControlOrMeta+x');
    await until(async () => !Designer.find(await d.def(), name), { msg: `${type} cut` });
    await d.press('ControlOrMeta+v');
    await until(async () => (await selectedNames(d)).length === 1, { msg: `${type} pasted` });
    const back = Designer.find(await d.def(), (await selectedNames(d))[0]);
    assert.equal(back.type, type);
    assert.deepEqual([back.band, back.x, back.y], ['body', orig.x, orig.y], `${type} same place`);
    await d.undo();
    await until(async () => (await count(d)) === items.length - 1, { msg: 'paste undone' });
    await d.undo();
    await until(async () => JSON.stringify(await d.def()) === JSON.stringify(start), { msg: `${type} cut undone` });
  }
  d.expectClean();
});

test('paste into every band: the selected band (header, body, footer, second body section)', async () => {
  const d = await env.open(twoSections({ body: [tb('A', 10, 10)] }));
  await d.click('A');
  await d.press('ControlOrMeta+c');
  for (const band of ['pageHeader', 'body:1', 'pageFooter', 'body']) {
    await selectBand(d, band);
    const n = await count(d);
    await d.press('ControlOrMeta+v');
    await until(async () => (await count(d)) === n + 1, { msg: `paste into ${band}` });
    const it = Designer.find(await d.def(), (await selectedNames(d))[0]);
    assert.equal(it.band, band);
  }
  const def = await d.def();
  for (const it of allItems(def))
    assert.ok(
      it.y + it.h <= (it.band.startsWith('body') ? 1e9 : def.sections[it.band].height),
      `${it.name} fits ${it.band}`,
    );
  d.expectClean();
});

test('every item type pasted into the page header, footer and second section (body-only types go to the body)', async () => {
  const d = await env.open(twoSections());
  await recordClipboard(d);
  for (const band of ['pageHeader', 'pageFooter', 'body:1']) {
    for (const type of TYPES) {
      await selectBand(d, band);
      const n = await count(d);
      await d.pasteText(JSON.stringify({ kind: CLIP_KIND, items: [make(type, `P_${type}`)] }));
      await until(async () => (await count(d)) === n + 1, { msg: `${type} → ${band}` });
      const it = Designer.find(await d.def(), (await selectedNames(d))[0]);
      assert.equal(it.type, type);
      assert.equal(it.band, BODY_ONLY.includes(type) && !band.startsWith('body') ? 'body' : band, `${type} → ${band}`);
    }
  }
  d.expectClean();
});

test('multi-selection: Shift+click three items, Ctrl+C, Ctrl+V pastes three in one undo step', async () => {
  const d = await env.open(report([tb('A', 10, 10), tb('B', 200, 10), { ...make('shape', 'S', 10, 60) }]));
  await d.click('A');
  await d.click('B', ['Shift']);
  await d.click('S', ['Shift']);
  assert.equal((await d.selected()).length, 3);
  const before = await d.def();
  await d.press(['ControlOrMeta+c', 'ControlOrMeta+v']);
  await until(async () => (await count(d)) === 6, { msg: '3 pasted' });
  const sel = await d.selected();
  assert.equal(sel.length, 3);
  assert.ok(!sel.some((n) => ['A', 'B', 'S'].includes(n)));
  await d.undo();
  await until(async () => JSON.stringify(await d.def()) === JSON.stringify(before), { msg: 'one undo' });
  d.expectClean();
});

test('nested container children: copy a child, copy the container, duplicate a child', async () => {
  const box = { type: 'container', name: 'Box', x: 0, y: 100, w: 300, h: 80, items: [tb('Kid', 20, 20)] };
  const d = await env.open(report([box]));
  // a child copied and pasted: into the band, not the container
  await d.click('Kid');
  assert.deepEqual(await d.selected(), ['Kid']);
  await d.press(['ControlOrMeta+c', 'ControlOrMeta+v']);
  await until(async () => (await count(d)) === 3);
  let it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.equal(it.parent, undefined);
  // duplicate of a child: stays in its container
  await d.click('Kid');
  await d.press('ControlOrMeta+d');
  await until(async () => (await count(d)) === 4);
  it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.equal(it.parent, 'Box');
  // the container with its children
  await d.click('Box');
  await d.press(['ControlOrMeta+c', 'ControlOrMeta+v']);
  await until(async () => (await count(d)) === 7);
  it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.equal(it.type, 'container');
  assert.equal(it.items.length, 2);
  const names = allItems(await d.def()).map((i) => i.name);
  assert.equal(new Set(names).size, names.length, 'unique names');
  d.expectClean();
});

test('paste offset cascade: repeated Ctrl+V goes 12 pt further each time', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press('ControlOrMeta+c');
  const at = [];
  for (let i = 1; i <= 4; i++) {
    await d.press('ControlOrMeta+v');
    await until(async () => (await count(d)) === i + 1);
    const it = Designer.find(await d.def(), (await d.selected())[0]);
    at.push([it.x, it.y]);
  }
  assert.deepEqual(at, [
    [22, 22],
    [34, 34],
    [46, 46],
    [58, 58],
  ]);
  d.expectClean();
});

test('regression: Ctrl+X then Ctrl+V of a page-header item puts it back in the page header', async () => {
  const d = await env.open(
    report([tb('A', 10, 10)], { sections: { pageHeader: { height: 40, items: [tb('H', 40, 4)] } } }),
  );
  await d.click('H');
  await d.press('ControlOrMeta+x');
  await until(async () => !(await d.get('H')));
  await d.press('ControlOrMeta+v');
  await until(async () => (await count(d)) === 2);
  const it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.deepEqual([it.band, it.x, it.y], ['pageHeader', 40, 4]);
  d.expectClean();
});

test('regression: Ctrl+X then Ctrl+V of a container child puts it back in its container', async () => {
  const box = { type: 'container', name: 'Box', x: 0, y: 100, w: 300, h: 80, items: [tb('Kid', 20, 20)] };
  const d = await env.open(report([box]));
  await d.click('Kid');
  await d.press('ControlOrMeta+x');
  await until(async () => !(await d.get('Kid')));
  await d.press('ControlOrMeta+v');
  await until(async () => (await count(d)) === 2);
  const it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.equal(it.parent, 'Box');
  d.expectClean();
});

test('paste across two designers in two pages: the JSON travels as text', async () => {
  const a = await env.open(report([{ ...make('chart', 'Chart1', 10, 10) }, tb('T', 10, 220)]));
  const b = await env.open(report([tb('T', 0, 0)]));
  await recordClipboard(a);
  await a.click('Chart1');
  await a.click('T', ['Shift']);
  await a.press('ControlOrMeta+c');
  await until(() => lastWrite(a), { msg: 'clipboard write' });
  // chromium: the system clipboard holds it too (permissions granted by the harness)
  let text = await lastWrite(a);
  if (BROWSER === 'chromium') {
    const sys = await a.page.evaluate(() => navigator.clipboard.readText());
    assert.equal(sys, text);
    text = sys;
  }
  assert.equal(JSON.parse(text).kind, CLIP_KIND);
  await b.focusCanvas();
  await b.pasteText(text);
  await until(async () => (await count(b)) === 3, { msg: 'pasted into b' });
  const types = (await b.selected()).map(async (n) => (await b.get(n)).type);
  assert.deepEqual(await Promise.all(types), ['chart', 'textbox']);
  // the taken name T is renamed in b
  assert.ok(!(await b.selected()).includes('T'));
  assert.equal(await count(a), 2);
  a.expectClean();
  b.expectClean();
});

test('two designers on one page: Ctrl+C in one, Ctrl+V in the other pastes into the other only', async () => {
  const a = await env.open(report([tb('A', 10, 10)]));
  // mount a second designer on the same page (same bundle, its own store)
  await a.page.evaluate(async () => {
    const el = document.createElement('div');
    el.id = 'd2';
    document.body.appendChild(el);
    const { mountDesigner } = await import('/pw/designer.js');
    window.h2 = mountDesigner('#d2', {
      definition: {
        $schema: 'reportwright/report@1',
        name: 'Two',
        page: { size: 'A4' },
        dataSources: [],
        dataSets: [],
        sections: {
          pageHeader: { height: 30, items: [] },
          body: { height: 300, items: [{ type: 'textbox', name: 'B', x: 0, y: 0, w: 100, h: 20, value: 'B' }] },
          pageFooter: { height: 30, items: [] },
        },
      },
      height: '600px',
      fontsUrl: '/pw-fonts/',
      warnOnLeave: false,
    });
  });
  const second = a.page.locator('#d2 [data-testid="paper"]');
  await second.waitFor();
  await a.click('A');
  await a.press('ControlOrMeta+c');
  const bItem = a.page.locator('#d2 .it[data-item="B"]');
  await bItem.scrollIntoViewIfNeeded();
  const bb = await bItem.boundingBox();
  await a.page.mouse.click(bb.x + 5, bb.y + 5);
  await a.press('ControlOrMeta+v');
  await until(() => a.page.evaluate(() => window.h2.getDefinition().sections.body.items.length === 2), {
    msg: 'pasted into the second designer',
  });
  assert.equal((await a.def()).sections.body.items.length, 1, 'the first designer is unchanged');
  a.expectClean();
});

test('plain text pasted on the canvas: "Nothing to paste", nothing added', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.focusCanvas();
  await d.pasteText('just some words');
  await message(d).waitFor();
  assert.match(await message(d).innerText(), NOTHING);
  assert.equal(await count(d), 1);
  assert.equal(await d.dirty(), false);
  d.expectClean();
});

test('invalid JSON and JSON of another kind: "Nothing to paste"', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  for (const text of [
    '{"kind":"pagewright/items@1","items":[',
    '{"kind":"other","items":[]}',
    '[1,2,3]',
    'null',
    '{"kind":"pagewright/items@1","items":"x"}',
  ]) {
    await d.focusCanvas();
    await d.pasteText(text);
    await message(d).waitFor();
    assert.match(await message(d).innerText(), NOTHING, text);
  }
  assert.equal(await count(d), 1);
  d.expectClean();
});

test('regression: plain text pasted after an earlier Ctrl+C is "Nothing to paste", not the earlier items', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press('ControlOrMeta+c');
  await d.page.waitForTimeout(100); // the clipboard write ends
  await d.focusCanvas();
  await d.pasteText('text copied in another app');
  await d.page.waitForTimeout(100);
  assert.equal(await count(d), 1, 'the earlier copy was pasted instead');
  d.expectClean();
});

test('valid item JSON from elsewhere pastes into the selected band', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await selectBand(d, 'pageFooter');
  await d.pasteText(
    JSON.stringify({
      kind: CLIP_KIND,
      items: [{ type: 'shape', name: 'Ext', x: 0, y: 0, w: 40, h: 20, shape: 'ellipse' }],
    }),
  );
  await until(async () => (await count(d)) === 2);
  const it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.equal(it.band, 'pageFooter');
  assert.equal(it.shape, 'ellipse');
  d.expectClean();
});

test('hostile JSON never runs script, injects nothing, raises no error', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  const dialogs = [];
  d.page.on('dialog', (dl) => {
    dialogs.push(dl.message());
    dl.dismiss().catch(() => {});
  });
  const evil =
    '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><svg onload="window.__pwned=3"></svg>';
  const items = [
    { type: 'textbox', name: 'T1', x: 0, y: 0, w: 120, h: 20, value: evil },
    { type: 'richtext', name: 'R1', x: 0, y: 30, w: 200, h: 40, value: evil },
    { type: 'image', name: 'I1', x: 0, y: 80, w: 40, h: 40, src: 'javascript:window.__pwned=4' },
    { type: 'checkbox', name: 'C1', x: 0, y: 130, w: 100, h: 14, value: '=True', text: evil },
    {
      type: 'chart',
      name: 'Ch1',
      x: 0,
      y: 150,
      w: 200,
      h: 100,
      chartType: 'column',
      title: evil,
      series: [{ name: evil, value: '' }],
    },
    { type: 'barcode', name: 'Bc1', x: 0, y: 260, w: 100, h: 30, symbology: 'code128', value: evil },
    { type: 'toc', name: 'Toc1', x: 0, y: 300, w: 200, h: 30, title: evil },
    {
      type: 'textbox',
      name: 'S1',
      x: 0,
      y: 340,
      w: 100,
      h: 20,
      value: 'x',
      style: {
        color: 'red;background:url(javascript:window.__pwned=5)',
        fontFamily: '</style><img src=x onerror=window.__pwned=6>',
      },
    },
    { type: 'textbox', name: '"><img src=x onerror=window.__pwned=7>', x: 0, y: 370, w: 100, h: 20, value: 'y' },
  ];
  await d.focusCanvas();
  await d.pasteText(JSON.stringify({ kind: CLIP_KIND, items }));
  await until(async () => (await count(d)) === 1 + items.length, { msg: 'hostile items pasted' });
  // click through them so the Inspector renders each one too
  for (const n of await d.selected()) {
    if (!/^\w+$/.test(n)) continue;
    await d.press('Escape');
    await d.item(n).scrollIntoViewIfNeeded();
    await d.click(n);
  }
  await d.page.locator('[data-testid="tab-preview"]').click();
  await d.page.waitForTimeout(300);
  const out = await d.page.evaluate(() => {
    const root = document.querySelector('#d').shadowRoot;
    const handlers = [...root.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name)));
    return {
      pwned: window.__pwned,
      scripts: root.querySelectorAll('script').length,
      handlers: handlers.map((e) => e.outerHTML.slice(0, 80)),
      imgX: root.querySelectorAll('img[src="x"]').length,
    };
  });
  assert.deepEqual(out, { pwned: undefined, scripts: 0, handlers: [], imgX: 0 });
  assert.deepEqual(dialogs, []);
  d.expectClean();
});

test('hostile numbers: 1e309, strings and negative coordinates give finite places', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.focusCanvas();
  await d.pasteText(
    `{"kind":"${CLIP_KIND}","items":[{"type":"textbox","name":"N1","x":1e309,"y":-1e309,"w":50,"h":20},{"type":"textbox","name":"N2","x":"10","y":"20","w":50,"h":20},{"type":"textbox","name":"N3","x":-40,"y":-40,"w":50,"h":20}]}`,
  );
  await until(async () => (await count(d)) === 4);
  for (const it of allItems(await d.def())) {
    for (const k of ['x', 'y'])
      assert.ok(typeof it[k] === 'number' && Number.isFinite(it[k]), `${it.name}.${k}=${it[k]}`);
  }
  const body = (await d.def()).sections.body;
  assert.ok(Number.isFinite(body.height));
  d.expectClean();
});

test('regression: pasted negative coordinates are clamped into the band (x, y >= 0)', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.focusCanvas();
  await d.pasteText(
    JSON.stringify({ kind: CLIP_KIND, items: [{ type: 'textbox', name: 'Neg', x: -400, y: -400, w: 50, h: 20 }] }),
  );
  await until(async () => (await count(d)) === 2);
  const it = Designer.find(await d.def(), (await d.selected())[0]);
  assert.ok(it.x >= 0 && it.y >= 0, `x=${it.x} y=${it.y}`);
  d.expectClean();
});

test('__proto__ keys and unknown types: nothing polluted, no error', async () => {
  const d = await env.open(report([tb('A', 10, 200)]));
  await d.focusCanvas();
  await d.pasteText(
    `{"kind":"${CLIP_KIND}","items":[{"type":"textbox","name":"P1","x":0,"y":0,"w":50,"h":20,"__proto__":{"polluted":1},"style":{"__proto__":{"polluted":2}}},{"type":"nosuchtype","name":"U1","x":0,"y":40,"w":50,"h":20},{"x":0,"y":80,"w":50,"h":20}]}`,
  );
  await until(async () => (await count(d)) > 1);
  assert.equal(await d.page.evaluate(() => ({}).polluted), undefined);
  // the page still works
  await d.click('A');
  assert.deepEqual(await d.selected(), ['A']);
  d.expectClean();
});

test('deeply nested items (200 levels) paste and render', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  let node = { type: 'textbox', name: 'Leaf', x: 0, y: 0, w: 20, h: 10 };
  for (let i = 0; i < 200; i++)
    node = { type: 'container', name: 'C', x: 1, y: 1, w: 400 - i, h: 300 - i, items: [node] };
  await d.focusCanvas();
  await d.pasteText(JSON.stringify({ kind: CLIP_KIND, items: [node] }));
  await until(async () => (await count(d)) === 202, { timeout: 15000 });
  await d.item('Leaf1').waitFor({ state: 'attached' });
  await d.undo();
  await until(async () => (await count(d)) === 1);
  d.expectClean();
});

test('1000 items paste in one step and the designer stays usable', async () => {
  const d = await env.open(report([tb('A', 0, 0)]));
  const items = Array.from({ length: 1000 }, (_, i) => ({
    type: 'textbox',
    name: `M${i}x`,
    x: (i % 20) * 24,
    y: 40 + Math.floor(i / 20) * 22,
    w: 22,
    h: 20,
    value: String(i),
  }));
  await d.focusCanvas();
  const t0 = Date.now();
  await d.pasteText(JSON.stringify({ kind: CLIP_KIND, items }));
  await until(async () => (await count(d)) === 1001, { timeout: 60000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 30000, `took ${ms} ms`);
  await d.undo();
  await until(async () => (await count(d)) === 1, { timeout: 30000 });
  d.expectClean();
});

test('a paste while typing in an Inspector field goes into the field, not onto the page', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press('ControlOrMeta+c');
  const name = d.page.getByLabel('Report name');
  await name.click();
  await d.pasteText(
    JSON.stringify({ kind: CLIP_KIND, items: [{ type: 'textbox', name: 'Z', x: 0, y: 0, w: 10, h: 10 }] }),
  );
  await d.page.keyboard.press('ControlOrMeta+v');
  await d.page.waitForTimeout(150);
  assert.equal(await count(d), 1);
  d.expectClean();
});

test('paste in the Preview tab and in a read-only designer adds nothing', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press('ControlOrMeta+c');
  await d.page.locator('[data-testid="tab-preview"]').click();
  await d.pasteText(
    JSON.stringify({ kind: CLIP_KIND, items: [{ type: 'textbox', name: 'Z', x: 0, y: 0, w: 10, h: 10 }] }),
  );
  await d.press('ControlOrMeta+v');
  await d.page.waitForTimeout(150);
  assert.equal(await count(d), 1);
  const r = await env.open(report([tb('A', 10, 10)]), { readOnly: true });
  await r.click('A');
  await r.press(['ControlOrMeta+c', 'ControlOrMeta+v', 'ControlOrMeta+d', 'ControlOrMeta+x']);
  await r.pasteText(
    JSON.stringify({ kind: CLIP_KIND, items: [{ type: 'textbox', name: 'Z', x: 0, y: 0, w: 10, h: 10 }] }),
  );
  await r.page.waitForTimeout(150);
  assert.equal(await count(r), 1);
  d.expectClean();
  r.expectClean();
});

test('regression: a container wrapping a table, pasted into the page header, goes to the body', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await selectBand(d, 'pageHeader');
  const wrap = { type: 'container', name: 'Wrap', x: 0, y: 0, w: 400, h: 80, items: [make('table', 'Tbl', 0, 0)] };
  await d.pasteText(JSON.stringify({ kind: CLIP_KIND, items: [wrap] }));
  await until(async () => (await count(d)) === 3);
  const table = allItems(await d.def()).find((i) => i.type === 'table');
  assert.equal(table.band, 'body');
  d.expectClean();
});
