// External retest of 0.12.1 (B8-C): polar chart warnings, subset font names, deprecation wording, rich text and
// legend messages, silent mistakes in validate(), text in number fields, BIRT number formats.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

describe('N9: a valid polar chart gives no warnings', () => {
  const rows = [{ deg: 0, v: 10, w: 3 }, { deg: 90, v: 20, w: 1 }, { deg: 180, v: 15, w: 4 }, { deg: 270, v: 5, w: 2 }];
  const polar = {
    type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 300, dataSet: 'Rows', chartType: 'polar', xValue: '=Fields.deg', legend: 'bottom',
    series: [{ name: 'V', value: '=Sum(Fields.v)' }, { name: 'W', value: '=Sum(Fields.w)' }],
  };
  it('validate() and render() say nothing about a valid polar chart', async () => {
    const def = report([polar], { data: { rows } });
    expect(validate(def).warnings).toEqual([]);
    const m = await render(def, { fontStore });
    expect(m.warnings).toEqual([]);
  });
  it('a polar chart with a blank series value still draws every row, with no warning', async () => {
    const def = report([{ ...polar, series: [{ name: 'V', value: '=Sum(Fields.v)' }, { name: 'Blank', value: '=Sum(Fields.nope)' }] }], { data: { rows } });
    const m = await render(def, { fontStore });
    expect(m.warnings.filter(w => /not drawn/.test(w))).toEqual([]);
  });
  it('a polar chart with no xValue says what the angle is (validate and render), not "rows have no x or y value"', async () => {
    const { xValue, ...noAngle } = polar;
    const def = report([noAngle], { data: { rows } });
    const w = validate(def).warnings;
    expect(w.some(x => /^C: a polar chart needs xValue/.test(x))).toBe(true);
    const m = await render(def, { fontStore });
    expect(m.warnings.some(x => /^C: a polar chart needs xValue/.test(x))).toBe(true);
    expect(m.warnings.some(x => /rows have no x or y value/.test(x))).toBe(false);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import fontkitModule from '@pdf-lib/fontkit';
import { createSubsetter, sfntTables, buildSfnt, setNameStrings } from '../../src/exporters/subset.js';

describe('N10: a variable font cut at Regular says Regular (names and weight class)', () => {
  const fontkit = fontkitModule.default || fontkitModule;
  const inter = path.join(import.meta.dirname, '..', '..', 'public', 'fonts', 'Inter-Regular.ttf');
  const subset = createSubsetter(async () => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'harfbuzz-subset.wasm')));
  // a variable font in miniature: Inter with an fvar wght axis (100 to 900, default 100) and its names set to Thin
  const variableThin = () => {
    const bytes = new Uint8Array(fs.readFileSync(inter));
    const t = sfntTables(bytes);
    const fvar = new Uint8Array(36), dv = new DataView(fvar.buffer);
    dv.setUint16(0, 1); dv.setUint16(2, 0); dv.setUint16(4, 16); dv.setUint16(6, 2); dv.setUint16(8, 1); dv.setUint16(10, 20);
    fvar.set([...'wght'].map(c => c.charCodeAt(0)), 16);
    dv.setInt32(20, 100 * 65536); dv.setInt32(24, 100 * 65536); dv.setInt32(28, 900 * 65536); dv.setUint16(32, 0); dv.setUint16(34, 256);
    t.set('fvar', fvar);
    t.set('name', setNameStrings(t.get('name'), new Map([[1, 'Inter Thin'], [2, 'Thin'], [4, 'Inter Thin'], [6, 'Inter-Thin'], [17, 'Thin']])));
    const os2 = t.get('OS/2').slice(); new DataView(os2.buffer).setUint16(4, 100); t.set('OS/2', os2);
    return buildSfnt(bytes, t);
  };
  it('the fixture is a Thin face before the subset', () => {
    const f = fontkit.create(Buffer.from(variableThin()));
    expect(f.fvar).toBeTruthy();
    expect(f.fullName).toBe('Inter Thin');
    expect(f['OS/2'].usWeightClass).toBe(100);
  });
  it('the subset is named Regular, its PostScript name follows, and usWeightClass is 400', async () => {
    const cut = fontkit.create(Buffer.from(await subset(variableThin(), [...'AB'].map(c => c.codePointAt(0)), {})));
    expect(cut.fvar).toBeFalsy();
    expect(cut.familyName).toBe('Inter');
    expect(cut.subfamilyName).toBe('Regular');
    expect(cut.fullName).toBe('Inter Regular');
    expect(cut.postscriptName).toBe('Inter-Regular');
    expect(cut['OS/2'].usWeightClass).toBe(400);
  });
  it('a static face keeps its own names and weight class', async () => {
    const bytes = new Uint8Array(fs.readFileSync(inter));
    const cut = fontkit.create(Buffer.from(await subset(bytes, [65], {})));
    expect(cut.fullName).toBe(fontkit.create(Buffer.from(bytes)).fullName);
    expect(cut['OS/2'].usWeightClass).toBe(fontkit.create(Buffer.from(bytes))['OS/2'].usWeightClass);
  });
});

describe('N19: deprecation messages all say the same thing (removed in 1.0)', () => {
  const root = path.join(import.meta.dirname, '..', '..');
  const files = ['src', 'packages', 'bin'].flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true })
    .filter(f => /\.(m?js|jsx|ts|tsx)$/.test(f) && !/node_modules|dist/.test(f)).map(f => path.join(root, d, f)));
  it('no deprecation message string names 0.9 as the removal version', () => {
    const bad = [];
    for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line) || !/deprecat/i.test(line)) return; // comments are not messages
      if (/['"`][^'"`]*\b0\.9\b/.test(line.replace(/\s\/\/\s.*$/, ''))) bad.push(`${path.relative(root, f)}:${i + 1}`);
    });
    expect(bad).toEqual([]);
  });
  it('the exportHtml message says the old form "was removed in 1.0"', () => {
    expect(fs.readFileSync(path.join(root, 'src', 'exporters', 'html.js'), 'utf8')).toMatch(/was removed in 1\.0/);
  });
});

import { richValue as _rv } from '../../src/engine/items/rich.js';
describe('N20: one prefix per warning; the legend warning says what to do', () => {
  const rich = (extra) => ({ type: 'textbox', x: 0, y: 0, w: 300, h: 40, value: '<p>Hi <a href="javascript:alert(1)">x</a></p>', ...extra });
  it('an unnamed rich text item says "Rich text:" once', async () => {
    const m = await render(report([{ ...rich({}), type: 'richtext' }]), { fontStore });
    const hits = m.warnings.filter(w => /link/.test(w));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^Rich text: the link "javascript:alert\(1\)" is not allowed/);
  });
  it('a named rich text item says its name, then the problem, once', async () => {
    const m = await render(report([{ ...rich({ name: 'Hero' }), type: 'richtext' }]), { fontStore });
    const hits = m.warnings.filter(w => /link/.test(w));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^Hero: the link "javascript:alert\(1\)" is not allowed/);
  });
  it('a legend that is an object or another word says what is accepted and where the legend goes', () => {
    const chart = (legend) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 200, dataSet: 'Rows', chartType: 'column', legend, series: [{ name: 'V', value: '=Sum(Fields.v)' }] }]);
    const obj = validate(chart({ position: 'right' })).warnings.filter(w => /legend/.test(w));
    expect(obj).toHaveLength(1);
    expect(obj[0]).toBe('C: "legend" is an object ({"position":"right"}); only "bottom" (show the legend) or "none" (hide it) is supported, and the legend is drawn at the bottom');
    const word = validate(chart('right')).warnings.filter(w => /legend/.test(w));
    expect(word[0]).toBe('C: "legend" is "right"; only "bottom" (show the legend) or "none" (hide it) is supported, and the legend is drawn at the bottom');
  });
});

describe('N-silent: validate() names mistakes that otherwise pass quietly', () => {
  const rows = [{ a: 1 }];
  const tb = (extra) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 18, value: 'x', ...extra });
  const ws = (items, over = {}) => validate({ ...report(items, { data: { rows } }), ...over }).warnings.join('\n');
  it('a misspelt field or parameter is named, with the same words the render uses', () => {
    expect(ws([tb({ value: '=Fields.nope' })])).toContain('The field "nope" does not exist; check the spelling');
    expect(ws([tb({ value: '=Parameters.p' })])).toContain('The parameter "p" does not exist; declare it under parameters');
    expect(ws([tb({ value: '=Fields.a' })])).not.toContain('does not exist');
    // a field of a single-object data set ($.meta) is known
    expect(validate(report([tb({ value: '=First(Fields.title, "Meta")' })], { data: { rows, meta: { title: 't' } } })).warnings.join('\n')).not.toContain('does not exist');
  });
  it('a zero or negative width or height is flagged (a line may be flat)', () => {
    expect(ws([tb({ h: 0 })])).toContain('height is 0');
    expect(ws([{ type: 'line', name: 'L', x: 0, y: 0, w: 100, h: 0 }])).not.toContain('height is');
  });
  it('a missing $schema is flagged', () => {
    const def = report([tb({})], { data: { rows } });
    delete def.$schema;
    expect(validate(def).warnings.join('\n')).toContain('no "$schema"');
  });
});
