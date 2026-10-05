// Phase A hardening: bugs found in the 2026-10-04 review. Each test failed before its fix.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { evalValue } from '../../src/engine/expr/evaluate.js';
import { formatValue } from '../../src/engine/expr/format.js';
import { coerce, applyFilters, loadSources } from '../../src/engine/data/index.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { fontStore, texts, report } from '../helpers.js';

const ctx = (extra = {}) => ({ params: {}, globals: {}, dataSets: {}, fields: null, ...extra });
const ev = (src, c = ctx()) => evalValue(src, c);

async function inTz(tz, fn) {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try { return await fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
}
const TZS = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];

describe('dates are calendar dates in every time zone', () => {
  for (const tz of TZS) {
    it(`date-only values keep their day (${tz})`, () => inTz(tz, async () => {
      expect(formatValue(coerce('2024-01-05', 'date'), 'dd MMM yyyy')).toBe('05 Jan 2024');
      expect(formatValue('2024-01-05', 'dd MMM yyyy')).toBe('05 Jan 2024');
      expect(ev('=Day(CDate("2024-01-05"))')).toBe(5);
      expect(ev('=CDate("2026-03-01") = DateSerial(2026, 3, 1)')).toBe(true);
      expect(ev('=CDate("2026-03-01") < DateSerial(2026, 3, 1)')).toBe(false);
    }));

    it(`CSV, drill-through and subreport parameters write the same day (${tz})`, () => inTz(tz, async () => {
      const table = {
        type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows',
        columns: [{ width: 200 }],
        detail: [{ height: 20, cells: [{ value: '=DateSerial(2026, 3, 1)', action: { type: 'report', report: 'x', params: { d: '=DateSerial(2026, 3, 1)' } } }] }],
      };
      const out = await render(report([table], { data: { rows: [{ a: 1 }] } }), { exportData: true, fontStore });
      expect(exportCsv(out)).toContain('2026-03-01');
      const link = out.pages[0].items.find(i => i.t === 'link');
      expect(link.action.params.d).toBe('2026-03-01');
    }));
  }
});

describe('rounding: export and Round() match what the page shows', () => {
  it('Round() is VB Math.Round: half to even on the decimal value', () => {
    expect(ev('=Round(1.005, 2)')).toBe(1);
    expect(ev('=Round(1.015, 2)')).toBe(1.02);
    expect(ev('=Round(-2.5, 0)')).toBe(-2);
    expect(ev('=Round(2.5, 0)')).toBe(2);
    expect(ev('=Round(1234.5678, -2)')).toBe(1200);
    expect(ev('=Round(-0.001, 2)')).toBe(0);
  });
  it('RoundHalfAway() rounds half away from zero, as the page shows numbers', () => {
    expect(ev('=RoundHalfAway(1.005, 2)')).toBe(1.01);
    expect(ev('=RoundHalfAway(-2.5, 0)')).toBe(-3);
    expect(ev('=RoundHalfAway(2.5)')).toBe(3);
  });
  it('F format rounds like N', () => {
    expect(ev('=Format(1.005, "F2")')).toBe('1.01');
  });
  it('CSV numbers equal the shown numbers', async () => {
    const table = {
      type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows',
      columns: [{ width: 200 }],
      detail: [{ height: 20, cells: [{ value: '=Fields.v', style: { format: 'N2' } }] }],
    };
    const out = await render(report([table], { data: { rows: [{ v: 1.005 }, { v: -0.125 }, { v: -1.005 }] } }), { exportData: true, fontStore });
    expect(texts(out.pages[0])).toEqual(['1.01', '-0.13', '-1.01']);
    expect(exportCsv(out).replace('﻿', '').split('\r\n').filter(Boolean)).toEqual(['1.01', '-0.13', '-1.01']);
  });
});

describe('expressions', () => {
  it('chained ternaries group to the right', () => {
    expect(ev('=true ? 1 : false ? 2 : 3')).toBe(1);
    expect(ev('=false ? 1 : true ? 2 : 3')).toBe(2);
    expect(ev('=false ? 1 : false ? 2 : 3')).toBe(3);
  });
});

describe('tables', () => {
  it('RunningValue over a table scope follows the grouped display order', async () => {
    const table = {
      type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows',
      columns: [{ width: 100 }, { width: 100 }],
      groups: [{ name: 'G', expr: '=Fields.k' }],
      detail: [{ height: 20, cells: [{ value: '=Fields.k' }, { value: '=RunningValue(Fields.v, "Sum", "T")' }] }],
    };
    const out = await render(report([table], { data: { rows: [{ k: 'A', v: 1 }, { k: 'B', v: 10 }, { k: 'A', v: 100 }] } }), { exportData: true, fontStore });
    expect(texts(out.pages[0])).toEqual(['A', '1', 'A', '101', 'B', '111']);
  });

  it('a row taller than a page continues on the next pages', async () => {
    const long = 'start ' + 'lorem ipsum dolor '.repeat(1500) + 'END';
    const table = {
      type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows',
      columns: [{ width: 60 }, { width: 240 }],
      detail: [{ height: 20, cells: [{ value: '=Fields.n' }, { value: '=Fields.s' }] }],
    };
    const out = await render(report([table], { data: { rows: [{ n: 1, s: long }, { n: 2, s: 'after' }] } }), { exportData: true, fontStore });
    const bottom = 841.89 - 36;
    expect(out.pages.length).toBeGreaterThan(1);
    for (const pg of out.pages) {
      expect(texts(pg).length).toBeGreaterThan(0);                       // no blank pages
      for (const it of pg.items) if (it.t === 'text') for (const l of it.lines) expect(l.y).toBeLessThanOrEqual(bottom);
    }
    const all = out.pages.flatMap(texts);
    expect(all.join(' ')).toContain('END');
    expect(all).toContain('after');
  });

  it('a hidden expression that returns the text "False" keeps the item visible', async () => {
    const box = { type: 'textbox', name: 'B', x: 0, y: 0, w: 100, h: 18, value: 'shown', hidden: '=IIF(1 = 2, "True", "False")' };
    const out = await render(report([box]), { exportData: true, fontStore });
    expect(texts(out.pages[0])).toContain('shown');
  });

  it('matrix headers show data keys as text, never as expressions', async () => {
    const matrix = { type: 'matrix', name: 'M', x: 0, y: 0, w: 400, h: 60, dataSet: 'Rows', rowGroup: '=Fields.r', columnGroup: '=Fields.c', value: '=Sum(Fields.v)' };
    const out = await render(report([matrix], { data: { rows: [{ r: 'x', c: 'Widget {Pro}', v: 1 }, { r: 'x', c: '=1+1', v: 2 }] } }), { exportData: true, fontStore });
    const t = texts(out.pages[0]);
    expect(t).toContain('Widget {Pro}');
    expect(t).toContain('=1+1');
  });
});

describe('CSV export', () => {
  it('text that a spreadsheet would run as a formula gets a leading quote', async () => {
    const table = {
      type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows',
      columns: [{ width: 200 }],
      detail: [{ height: 20, cells: [{ value: '=Fields.s' }] }],
    };
    const out = await render(report([table], { data: { rows: [{ s: '=HYPERLINK("http://x","c")' }, { s: '@SUM(A1)' }, { s: '+1' }, { s: '-1' }, { s: 'ok' }] } }), { exportData: true, fontStore });
    const lines = exportCsv(out).replace('﻿', '').split('\r\n').filter(Boolean);
    expect(lines).toEqual([`"'=HYPERLINK(""http://x"",""c"")"`, "'@SUM(A1)", "'+1", "'-1", 'ok']);
  });
});

describe('data sources', () => {
  it('a like filter with many wildcards finishes fast', () => {
    const t0 = Date.now();
    const out = applyFilters([{ s: 'a'.repeat(40) }], [{ expr: '=Fields.s', op: 'like', value: 'a*a*a*a*a*a*a*a*a*a*a*a*b' }], ctx());
    expect(out).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(applyFilters([{ s: 'AxxBcD' }], [{ expr: '=Fields.s', op: 'like', value: 'a*b?d' }], ctx())).toHaveLength(1);
    expect(applyFilters([{ s: 'a.c' }, { s: 'abc' }], [{ expr: '=Fields.s', op: 'like', value: 'a.c' }], ctx())).toHaveLength(1);
  });

  const capture = () => {
    const calls = [];
    const f = async (url, init) => { calls.push({ url, init }); return new Response('{"data":{}}', { headers: { 'content-type': 'application/json' } }); };
    return { calls, f };
  };

  it('parameter values are encoded inside REST URLs', async () => {
    const { calls, f } = capture();
    const def = { dataSources: [{ name: 's', type: 'rest', url: 'https://api.example.com/q?name={Parameters.name}&limit=10' }] };
    await loadSources(def, { params: { name: 'A&B #1' }, fetch: f });
    expect(calls[0].url).toBe('https://api.example.com/q?name=A%26B%20%231&limit=10');
  });

  it('a leading template part may hold a base URL', async () => {
    const { calls, f } = capture();
    const def = { dataSources: [{ name: 's', type: 'rest', url: '{Parameters.base}/loans' }] };
    await loadSources(def, { params: { base: 'https://api.example.com' }, fetch: f });
    expect(calls[0].url).toBe('https://api.example.com/loans');
  });

  it('GraphQL variables accept the documented JSON form and keep values as data', async () => {
    const { calls, f } = capture();
    const def = { dataSources: [{ name: 's', type: 'graphql', url: 'https://api.example.com/graphql', query: 'query($id: ID!, $n: Int){x}', variables: '{"id": "{Parameters.accountId}", "n": "{Parameters.n}"}' }] };
    await loadSources(def, { params: { accountId: 'LN-1", "admin": true, "x": "', n: 5 }, fetch: f });
    expect(JSON.parse(calls[0].init.body).variables).toEqual({ id: 'LN-1", "admin": true, "x": "', n: 5 });
  });
});
