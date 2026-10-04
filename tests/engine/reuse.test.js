// Phase 8: stylesheets, themes, master reports, part libraries, layers, overflow placeholders.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { REUSE_LIMITS, flattenNamed, reuseRefs } from '../../src/engine/reuse.js';
import { fontStore, texts, report } from '../helpers.js';

const tb = (name, value, x = 0, y = 0, extra = {}) => ({ type: 'textbox', name, x, y, w: 200, h: 14, value, ...extra });
const allTexts = (m) => m.pages.flatMap(texts);
const loader = (lib) => { const calls = []; const f = async (id) => { calls.push(id); if (!(id in lib)) throw new Error(`Report "${id}" not found`); return structuredClone(lib[id]); }; f.calls = calls; return f; };
const textItem = (m, s) => m.pages.flatMap(p => p.items).find(i => i.t === 'text' && i.lines.some(l => l.text === s));

describe('stylesheets and style inheritance (#42)', () => {
  it('parent chains: the child wins, the grandparent is reached', () => {
    const f = flattenNamed({ Base: { fontSize: 8, color: '#111111' }, Mid: { parent: 'Base', fontWeight: 'bold' }, Top: { parent: 'Mid', color: '#ff0000' } });
    expect(f.Top).toMatchObject({ fontSize: 8, fontWeight: 'bold', color: '#ff0000' });
    expect(f.Top.parent).toBeUndefined();
  });
  it('a cycle is cut, with a warning', async () => {
    const def = report([tb('A', 'cyc', 0, 0, { styleName: 'A' })], { def: { styles: { named: { A: { parent: 'B', color: '#ff0000' }, B: { parent: 'A', fontSize: 12 } } } } });
    const m = await render(def, { fontStore });
    expect(textItem(m, 'cyc').color).toBe('#ff0000');
    expect(m.warnings.join(' ')).toMatch(/style.*A.*itself|cycle/i);
  });
  it('styles.sheet: the sheet’s named styles sit under the report’s own', async () => {
    const sheet = report([], { def: { styles: { base: { fontFamily: 'Inter' }, named: { Title: { fontSize: 20, color: '#0000ff' }, Note: { fontSize: 7 } } } } });
    const def = report([tb('T', 'title', 0, 0, { styleName: 'Title' }), tb('N', 'note', 0, 20, { styleName: 'Note' })], { def: { styles: { sheet: 'house', named: { Title: { parent: 'Note', color: '#00ff00' } } } } });
    const m = await render(def, { fontStore, loadReport: loader({ house: sheet }) });
    expect(textItem(m, 'title')).toMatchObject({ color: '#00ff00', size: 7 }); // own Title replaces the sheet's, and inherits the sheet's Note
    expect(textItem(m, 'note').size).toBe(7);
  });
  it('a missing sheet warns and renders', async () => {
    const m = await render(report([tb('A', 'x')], { def: { styles: { sheet: 'nope' } } }), { fontStore, loadReport: loader({}) });
    expect(allTexts(m)).toContain('x');
    expect(m.warnings.join(' ')).toMatch(/nope/);
  });
  it(`at most ${REUSE_LIMITS.reports} reports per render`, async () => {
    const lib = {};
    const parts = [];
    for (let i = 0; i < REUSE_LIMITS.reports + 5; i++) {
      lib[`l${i}`] = report([tb('P', `p${i}`)], { def: { parts: [{ name: 'p', item: 'P' }] } });
      parts.push({ type: 'part', name: `I${i}`, library: `l${i}`, part: 'p', x: 0, y: i * 16, w: 200, h: 14 });
    }
    const f = loader(lib);
    const m = await render(report(parts), { fontStore, loadReport: f });
    expect(f.calls.length).toBeLessThanOrEqual(REUSE_LIMITS.reports);
    expect(m.warnings.join(' ')).toMatch(/more than \d+ reports/);
  });
});

describe('themes (#43)', () => {
  const theme = (accent, font) => report([], { def: { themeDef: { colors: { Accent1: accent }, fonts: { major: { family: font, size: 16, weight: 'bold' } }, constants: { Company: 'Acme' } } } });
  it('Theme.Colors / Fonts / Constants in values and styles', async () => {
    const def = report([tb('A', '=Theme.Constants.Company & " " & Theme.Fonts.MajorFont.Family', 0, 0, { style: { color: '=Theme.Colors.Accent1', fontSize: '=Theme.Fonts.MajorFont.Size' } })], { def: { theme: 'blue' } });
    const m = await render(def, { fontStore, loadReport: loader({ blue: theme('#1d4ed8', 'Inter') }) });
    const it = textItem(m, 'Acme Inter');
    expect(it).toMatchObject({ color: '#1d4ed8', size: 16 });
  });
  it('chosen by expression at run time', async () => {
    const def = report([tb('A', '=Theme.Colors.Accent1')], { def: { theme: '=IIf(Parameters.Dark, "dark", "light")', parameters: [{ name: 'Dark', type: 'boolean', default: false }] } });
    const lib = { dark: theme('#000000', 'Inter'), light: theme('#ffffff', 'Inter') };
    expect(allTexts(await render(def, { fontStore, loadReport: loader(lib) }))).toContain('#ffffff');
    expect(allTexts(await render(def, { fontStore, loadReport: loader(lib), parameters: { Dark: true } }))).toContain('#000000');
  });
  it('the report’s own theme; no theme → the default palette; an unknown one warns', async () => {
    const own = report([tb('A', '=Theme.Colors.Accent1')], { def: { themeDef: { colors: { Accent1: '#123456' } } } });
    expect(allTexts(await render(own, { fontStore }))).toContain('#123456');
    const none = report([tb('A', '=Theme.Colors.Accent2')]);
    expect(allTexts(await render(none, { fontStore }))[0]).toMatch(/^#[0-9a-f]{6}$/i);
    const bad = await render(report([tb('A', '=Theme.Colors.Accent1')], { def: { theme: 'gone' } }), { fontStore, loadReport: loader({}) });
    expect(bad.warnings.join(' ')).toMatch(/gone/);
  });
});

describe('master reports (#44)', () => {
  const master = () => report([
    tb('MasterTop', 'MASTER TOP', 0, 0),
    { type: 'placeholder', name: 'Content', x: 20, y: 30, w: 400, h: 50 },
    tb('MasterBottom', 'MASTER BOTTOM', 0, 90),
  ], {
    header: { height: 20, items: [tb('MH', 'Acme Corp header')] },
    footer: { height: 20, items: [tb('MF', 'Page {Globals.PageNumber} of {Globals.TotalPages}')] },
    data: { rows: Array.from({ length: 120 }, (_, i) => ({ n: i + 1 })) },
    def: { page: { size: 'A5', margins: [20, 20, 20, 20] }, parameters: [{ name: 'Who', type: 'string', default: 'Asha' }], styles: { named: { Brand: { color: '#ff0000' } } } },
  });
  const content = (extra = {}) => ({ ...report([tb('C', 'Hello {Parameters.Who}', 0, 0, { styleName: 'Brand' })], { header: { height: 16, items: [tb('CH', 'content header', 250, 0)] } }), master: 'm', ...extra });

  it('content at the placeholder, master header and footer, inherited page, parameters and styles', async () => {
    const m = await render(content(), { fontStore, loadReport: loader({ m: master() }) });
    const hello = textItem(m, 'Hello Asha');
    expect(hello.color).toBe('#ff0000');
    const top = textItem(m, 'MASTER TOP'), bottom = textItem(m, 'MASTER BOTTOM');
    expect(hello.lines[0].x - top.lines[0].x).toBeCloseTo(20, 0);
    expect(hello.lines[0].y).toBeGreaterThan(top.lines[0].y + 25);
    expect(bottom.lines[0].y).toBeGreaterThan(hello.lines[0].y);
    expect(m.width).toBeCloseTo(419.53, 1); // A5 from the master
    expect(allTexts(m)).toEqual(expect.arrayContaining(['Acme Corp header', 'Page 1 of 1']));
    expect(allTexts(m)).not.toContain('content header'); // ActiveReports: the master's header and footer replace the content's
  });
  it('a long table in the content splits across pages and pushes the master items below it', async () => {
    const tbl = { type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 36, columns: [{ width: 200 }], header: [{ height: 18, cells: [{ value: 'N' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.n' }] }] };
    const c = { ...report([tbl], { data: { rows: Array.from({ length: 120 }, (_, i) => ({ n: i + 1 })) } }), master: 'm' };
    const m = await render(c, { fontStore, loadReport: loader({ m: master() }) });
    expect(m.pages.length).toBeGreaterThan(3);
    const all = allTexts(m);
    for (const n of [1, 60, 120]) expect(all).toContain(String(n));
    const last = m.pages[m.pages.length - 1];
    expect(texts(last)).toContain('MASTER BOTTOM');
    expect(texts(m.pages[0])).not.toContain('MASTER BOTTOM');
  });
  it('the content wins a name clash; changes to the master show on the next render', async () => {
    const mm = master();
    const c = content({ parameters: [{ name: 'Who', type: 'string', default: 'Ravi' }] });
    expect(allTexts(await render(c, { fontStore, loadReport: loader({ m: mm }) }))).toContain('Hello Ravi');
    mm.sections.pageHeader.items[0].value = 'Acme Ltd header';
    expect(allTexts(await render(c, { fontStore, loadReport: loader({ m: mm }) }))).toContain('Acme Ltd header');
  });
  it('a master of itself, and a cycle, render the content with a warning', async () => {
    const self = { ...master(), master: 'm' };
    const r1 = await render(content(), { fontStore, loadReport: loader({ m: self }) });
    expect(allTexts(r1)).toContain('MASTER TOP');
    expect(r1.warnings.join(' ')).toMatch(/itself/);
    const a = { ...master(), master: 'b' }, b = { ...master(), master: 'm' };
    const r2 = await render(content(), { fontStore, loadReport: loader({ m: a, b }) });
    expect(r2.warnings.join(' ')).toMatch(/itself/);
  });
  it(`masters nest at most ${REUSE_LIMITS.depth} levels`, async () => {
    const lib = {};
    for (let i = 0; i < 8; i++) lib[`m${i}`] = { ...master(), master: `m${i + 1}` };
    lib.m8 = master();
    const r = await render({ ...content(), master: 'm0' }, { fontStore, loadReport: loader(lib) });
    expect(r.warnings.join(' ')).toMatch(/levels/);
  });
  it('no loader: renders the content alone, with a warning', async () => {
    const r = await render(content(), { fontStore });
    expect(allTexts(r)).toContain('content header'); // no master: the content's own header
    expect(r.warnings.join(' ')).toMatch(/master/i);
  });
});

describe('report part libraries (#45)', () => {
  const lib = () => report([
    { type: 'container', name: 'KpiCard', x: 0, y: 0, w: 180, h: 40, style: { border: '1 solid #cccccc' }, items: [
      tb('KpiTitle', '=PartProperties.Title', 4, 4, { w: 170 }),
      tb('KpiValue', '=Format(Sum(Fields.amount) * PartProperties.Factor, "N0")', 4, 20, { w: 170, dataSet: 'Sales' }),
    ] },
  ], { def: {
    dataSources: [{ name: 'salesSrc', type: 'json', data: { rows: [{ amount: 10 }, { amount: 20 }] } }],
    dataSets: [{ name: 'Sales', source: 'salesSrc', path: '$.rows' }],
    parts: [{ name: 'Kpi', item: 'KpiCard', label: 'KPI card', properties: [{ name: 'Title', type: 'string', default: 'Total' }, { name: 'Factor', type: 'number', default: 1 }] }],
  } });
  const inst = (name, y, props = {}) => ({ type: 'part', name, library: 'kit', part: 'Kpi', properties: props, x: 10, y, w: 180, h: 40 });

  it('a linked instance: the library item at the instance, with defaults and the instance’s values; library data sets merged', async () => {
    const m = await render(report([inst('A', 0), inst('B', 60, { Title: 'Doubled', Factor: 2 })]), { fontStore, loadReport: loader({ kit: lib() }) });
    expect(allTexts(m)).toEqual(expect.arrayContaining(['Total', '30', 'Doubled', '60']));
    expect(textItem(m, 'Doubled').lines[0].x).toBeGreaterThan(36 + 10);
  });
  it('a change to the library shows in the instance', async () => {
    const l = lib();
    l.sections.body.items[0].items[0].value = '=UCase(PartProperties.Title)';
    expect(allTexts(await render(report([inst('A', 0)]), { fontStore, loadReport: loader({ kit: l }) }))).toContain('TOTAL');
  });
  it('a detached copy (partProps) renders the same without the library', async () => {
    const card = structuredClone(lib().sections.body.items[0]);
    const def = report([{ ...card, x: 10, partProps: { Title: 'Copy', Factor: 3 } }], { def: { dataSources: lib().dataSources, dataSets: lib().dataSets } });
    expect(allTexts(await render(def, { fontStore }))).toEqual(expect.arrayContaining(['Copy', '90']));
  });
  it('a part that inserts itself warns; 1,000 instances load the library once', async () => {
    const l = lib();
    l.sections.body.items[0].items.push({ type: 'part', name: 'Again', library: 'kit', part: 'Kpi', x: 0, y: 30, w: 10, h: 10 });
    const f = loader({ kit: l });
    const many = Array.from({ length: 1000 }, (_, i) => inst(`I${i}`, i * 44));
    const t0 = Date.now();
    const m = await render(report(many), { fontStore, loadReport: f });
    expect(f.calls).toEqual(['kit']);
    expect(m.warnings.join(' ')).toMatch(/itself/);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
  it('unknown part and missing library: a placeholder and a warning', async () => {
    const m = await render(report([{ ...inst('A', 0), part: 'Nope' }, { ...inst('B', 60), library: 'gone' }]), { fontStore, loadReport: loader({ kit: lib() }) });
    expect(m.warnings.join(' ')).toMatch(/Nope/);
    expect(m.warnings.join(' ')).toMatch(/gone/);
  });
});

describe('layers (#46)', () => {
  const def = () => report([
    tb('Always', 'always'),
    tb('Screen', 'screen only', 0, 20, { layer: 'OnScreen' }),
    tb('Print', 'print only', 0, 40, { layer: 'Paper' }),
    tb('Export', 'export only', 0, 60, { layer: 'Files' }),
    tb('Design', 'design note', 0, 80, { layer: 'Notes' }),
    tb('Off', 'hidden layer', 0, 100, { layer: 'Off' }),
    { type: 'container', name: 'Box', x: 0, y: 120, w: 200, h: 20, items: [tb('Inner', 'inner screen', 0, 0, { layer: 'OnScreen' })] },
  ], { def: { layers: [{ name: 'OnScreen', target: 'screen' }, { name: 'Paper', target: 'print' }, { name: 'Files', target: 'export' }, { name: 'Notes', target: 'design' }, { name: 'Off', visible: false }] } });
  it('each target shows its own layers; design and hidden layers never', async () => {
    const at = async (o) => allTexts(await render(def(), { fontStore, ...o }));
    const screen = await at({ target: 'screen' });
    expect(screen).toEqual(expect.arrayContaining(['always', 'screen only', 'inner screen']));
    expect(screen).not.toContain('print only');
    const print = await at({ state: { target: 'print' } });
    expect(print).toContain('print only');
    expect(print).not.toContain('screen only');
    const exp = await at({});
    expect(exp).toEqual(expect.arrayContaining(['always', 'export only']));
    for (const t of [screen, print, exp]) { expect(t).not.toContain('design note'); expect(t).not.toContain('hidden layer'); }
  });
});

describe('overflow placeholders (#47)', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ n: `row${i + 1}` }));
  const table = (extra = {}) => ({ type: 'table', name: 'Lines', dataSet: 'Rows', x: 0, y: 30, w: 200, h: 100, columns: [{ width: 200 }], header: [{ height: 18, cells: [{ value: 'Item' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.n' }] }], overflowTo: 'More', ...extra });
  const form = (sections) => ({ ...report([]), dataSources: [{ name: 'src', type: 'json', data: { rows } }], sections: { pageHeader: { height: 0, items: [] }, pageFooter: { height: 0, items: [] }, body: sections } });
  it('rows that do not fit the frame continue in the placeholder on the next section, header repeated; the last placeholder repeats', async () => {
    const def = form([
      { items: [tb('F1', 'Invoice page 1'), table(), tb('Below', 'below the frame', 0, 140)] },
      { items: [tb('F2', 'Continuation'), { type: 'overflow', name: 'More', x: 0, y: 30, w: 200, h: 200 }] },
    ]);
    const m = await render(def, { fontStore });
    const p1 = texts(m.pages[0]);
    expect(p1).toEqual(expect.arrayContaining(['Invoice page 1', 'Item', 'row1', 'row4', 'below the frame']));
    expect(p1).not.toContain('row5');
    expect(textItem({ pages: [m.pages[0]] }, 'below the frame').lines[0].y).toBeLessThan(36 + 160); // the frame did not grow
    const later = m.pages.slice(1);
    expect(later.length).toBeGreaterThanOrEqual(3);
    for (const p of later) expect(texts(p)).toEqual(expect.arrayContaining(['Continuation', 'Item']));
    const seen = m.pages.flatMap(texts).filter(t => /^row\d+$/.test(t));
    expect(seen).toEqual(rows.map(r => r.n)); // every row once, in order
  });
  it('a chain: Overflow1 → Overflow2 on the same continuation page', async () => {
    const def = form([
      { items: [table({ overflowTo: 'O1' })] },
      { items: [{ type: 'overflow', name: 'O1', x: 0, y: 0, w: 150, h: 200, overflowTo: 'O2' }, { type: 'overflow', name: 'O2', x: 200, y: 0, w: 150, h: 200 }] },
    ]);
    const m = await render(def, { fontStore });
    const seen = m.pages.flatMap(texts).filter(t => /^row\d+$/.test(t));
    expect(seen).toEqual(rows.map(r => r.n));
    const p2 = m.pages[1].items.filter(i => i.t === 'text' && /^row/.test(i.lines[0].text));
    expect(p2.some(i => i.lines[0].x > 36 + 190)).toBe(true); // O2 used on the same page
  });
  it('a missing target warns; the table is cut at its frame', async () => {
    const m = await render(form([{ items: [table({ overflowTo: 'Nowhere' })] }]), { fontStore });
    expect(m.warnings.join(' ')).toMatch(/Nowhere/);
  });
});

describe('reuseRefs', () => {
  it('lists fixed ids of masters, sheets, themes and libraries', () => {
    const def = report([{ type: 'part', library: 'kit', part: 'x', x: 0, y: 0, w: 1, h: 1 }], { def: { master: 'm', theme: 't', styles: { sheet: 's' } } });
    expect([...reuseRefs(def)].sort()).toEqual(['kit', 'm', 's', 't']);
    expect([...reuseRefs({ ...def, theme: '=Parameters.x' })]).not.toContain('=Parameters.x');
  });
});
