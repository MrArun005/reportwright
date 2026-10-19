// Export round trips and goldens for eight reports (a grouped table, a matrix, a subreport, barcodes, a table of
// contents, Hindi/Arabic/Chinese text, an image, charts), each exported to PDF, HTML, XLSX and CSV:
// - PDF: page 1 drawn by pdf.js in Chromium matches tests/fixtures/golden-export/<name>.png (a few pixels may differ:
//   anti-aliasing: at most 0.01%, where one changed digit is 0.03%), and its text comes out in reading order.
// - HTML: fonts subset (a size budget), no request leaves the file, data values cannot inject markup or script.
// - XLSX and CSV: read back, the values and number formats are the report's.
// UPDATE_GOLDEN=1 rewrites the PNGs (look at them before committing). Needs Playwright's Chromium.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { render, FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportHtml } from '../../src/exporters/html.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { createSubsetter } from '../../src/exporters/subset.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'golden-export');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
// the optional CJK fonts are a 40 MB download: the Chinese text here is in the subset font of the fixtures
const CJK_TEXT = '我们的产品很好。服务也很好，价格合理！';
const SCRIPTS = ['नमस्ते दुनिया — क्षत्रिय', 'مرحبا بالعالم ١٢٣', CJK_TEXT];
const fontStore = new FontStore(async (k) =>
  /NotoSans(JP|SC)/.test(k)
    ? fs.readFileSync(path.join(ROOT, 'tests/fixtures/fonts/NotoSansSC-Subset.otf'))
    : fs.readFileSync(path.join(ROOT, 'public/fonts', fontFile(k))),
);
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
const NOW = new Date('2026-03-15T10:00:00Z');
// values a hostile data source could send: they must stay text in every export
const XSS = [
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=2</script>',
  "'><svg onload=window.__xss=3>",
  'javascript:window.__xss=4',
];

/* ---------------------------------------------------------------- the reports */
const rows = [
  { region: 'North', city: 'Asha Nagar', q: 'Q1', amount: 1234.5, units: 12, day: '2026-01-05', sku: 'SKU-1001' },
  { region: 'North', city: 'Bela', q: 'Q2', amount: 80, units: 3, day: '2026-02-11', sku: 'SKU-1002' },
  { region: 'South', city: 'Chera', q: 'Q1', amount: 342.25, units: 7, day: '2026-03-01', sku: 'SKU-2001' },
  { region: 'South', city: XSS[0], q: 'Q2', amount: 10, units: 1, day: '2026-03-02', sku: 'SKU-2002' },
  { region: 'West', city: XSS[1], q: 'Q1', amount: 5000, units: 40, day: '2026-03-03', sku: 'SKU-3001' },
  { region: 'West', city: XSS[2], q: 'Q2', amount: 0.5, units: 2, day: '2026-03-04', sku: 'SKU-3002' },
];
const base = (name, body, extra = {}) => ({
  $schema: 'reportwright/report@1',
  name,
  page: { size: 'A5', margins: [28, 28, 28, 28] },
  dataSources: [{ name: 'src', type: 'json', data: { rows } }],
  dataSets: [
    {
      name: 'Sales',
      source: 'src',
      path: '$.rows',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'city', type: 'string' },
        { name: 'q', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'units', type: 'number' },
        { name: 'day', type: 'date' },
        { name: 'sku', type: 'string' },
      ],
    },
  ],
  sections: {
    pageHeader: {
      height: 24,
      items: [
        {
          type: 'textbox',
          name: 'Title',
          x: 0,
          y: 0,
          w: 300,
          h: 18,
          value: name,
          style: { fontWeight: 'bold', fontSize: 12 },
        },
      ],
    },
    body: { items: body },
    pageFooter: {
      height: 16,
      items: [
        {
          type: 'textbox',
          name: 'Pg',
          x: 0,
          y: 0,
          w: 200,
          h: 14,
          value: '="Page " & Globals.PageNumber & " of " & Globals.TotalPages',
          style: { fontSize: 8 },
        },
      ],
    },
  },
  ...extra,
});
const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 360, h: 18, value, ...extra });
const table = (name, y, extra = {}) => ({
  type: 'table',
  name,
  dataSet: 'Sales',
  x: 0,
  y,
  w: 360,
  h: 72,
  columns: [{ width: 130 }, { width: 80 }, { width: 70 }, { width: 80 }],
  header: [{ height: 18, cells: [{ value: 'City' }, { value: 'Amount' }, { value: 'Units' }, { value: 'Day' }] }],
  groups: [
    {
      name: 'Region',
      expr: '=Fields.region',
      header: [{ height: 18, cells: [{ value: '=Fields.region', style: { fontWeight: 'bold' } }, null, null, null] }],
    },
  ],
  detail: [
    {
      height: 18,
      cells: [
        { value: '=Fields.city' },
        { value: '=Fields.amount', style: { format: 'C2', textAlign: 'right' } },
        { value: '=Fields.units', style: { format: 'N0', textAlign: 'right' } },
        { value: '=Fields.day', style: { format: 'yyyy-MM-dd' } },
      ],
    },
  ],
  footer: [
    {
      height: 18,
      cells: [
        { value: 'Total' },
        { value: '=Sum(Fields.amount)', style: { format: 'C2', textAlign: 'right' } },
        { value: '=Sum(Fields.units)', style: { format: 'N0', textAlign: 'right' } },
        null,
      ],
    },
  ],
  ...extra,
});
const tinyJpg = `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, 'tests/fixtures/images/photo.jpg')).toString('base64')}`;
const child = {
  $schema: 'reportwright/report@1',
  name: 'Child',
  page: { size: 'A5' },
  parameters: [{ name: 'Region', type: 'string' }],
  sections: { body: { items: [tb('C1', '="Subreport for " & Parameters.Region', 0, { w: 300 })] } },
};

const REPORTS = {
  table: {
    def: base('Grouped table', [table('Sales', 0)]),
    text: [
      'Grouped table',
      'City',
      'Amount',
      'North',
      'Asha Nagar',
      '$1,234.50',
      'Bela',
      '$80.00',
      'South',
      'Chera',
      '$342.25',
      'Total',
      '$6,667.25',
      'Page 1 of 1',
    ],
  },
  matrix: {
    def: base('Matrix', [
      {
        type: 'matrix',
        name: 'M',
        dataSet: 'Sales',
        x: 0,
        y: 0,
        w: 360,
        h: 60,
        rowGroup: '=Fields.region',
        columnGroup: '=Fields.q',
        value: '=Sum(Fields.amount)',
        valueFormat: 'N2',
      },
    ]),
    text: ['Matrix', 'Q1', 'Q2', 'North', '1,234.50', '80.00', 'South', '342.25', '10.00', 'West', '5,000.00', '0.50'],
  },
  subreport: {
    def: base('Subreport', [
      tb('Intro', 'Master report', 0),
      { type: 'subreport', name: 'Sub', x: 0, y: 30, w: 360, h: 30, report: 'child', params: { Region: 'North' } },
    ]),
    text: ['Subreport', 'Master report', 'Subreport for North'],
  },
  barcode: {
    def: base('Barcodes', [
      {
        type: 'list',
        name: 'L',
        dataSet: 'Sales',
        x: 0,
        y: 0,
        w: 360,
        h: 60,
        filters: [{ expr: '=Fields.region', op: '=', value: 'North' }],
        items: [
          { type: 'barcode', name: 'BC', x: 0, y: 0, w: 180, h: 50, symbology: 'code128', value: '=Fields.sku' },
          {
            type: 'barcode',
            name: 'QR',
            x: 220,
            y: 0,
            w: 50,
            h: 50,
            symbology: 'qrcode',
            value: '=Fields.sku',
            showText: false,
          },
        ],
      },
    ]),
    text: ['Barcodes', 'SKU-1001', 'SKU-1002'],
  },
  toc: {
    def: base('Contents', [
      { type: 'toc', name: 'Toc', x: 0, y: 0, w: 360, h: 20, title: 'Contents', source: 'headings' },
      tb('H1', 'Introduction', 60, { headingLevel: 1 }),
      tb('H2', 'Regional sales', 90, { headingLevel: 1 }),
      table('Sales', 120),
    ]),
    text: ['Contents', 'Contents', 'Introduction', 'Regional sales', 'Introduction', 'Regional sales', 'City'],
  },
  unicode: {
    def: {
      ...base('Scripts', [
        tb('Hi', 'नमस्ते दुनिया — क्षत्रिय', 0),
        tb('Ar', 'مرحبا بالعالم ١٢٣', 24, { style: { textAlign: 'right' } }),
        tb('Zh', CJK_TEXT, 48),
        table('Sales', 80),
      ]),
      // the same text in the data: the table carries it into XLSX and CSV
      dataSources: [
        {
          name: 'src',
          type: 'json',
          data: {
            rows: [
              ...rows,
              ...SCRIPTS.map((city, i) => ({
                region: 'Script',
                city,
                q: 'Q1',
                amount: i + 1,
                units: 1,
                day: '2026-03-05',
                sku: `S${i}`,
              })),
            ],
          },
        },
      ],
    },
    text: ['Scripts', 'City'],
    // the picture without the Chinese text: pdf.js draws nothing for the fixtures' CFF subset font (poppler draws
    // it), and a golden should not keep a blank in place of text. The text checks below still read it.
    pdfOnly: (d) => ({
      ...d,
      sections: { ...d.sections, body: { items: d.sections.body.items.filter((i) => i.name !== 'Zh') } },
      dataSources: [
        { ...d.dataSources[0], data: { rows: d.dataSources[0].data.rows.filter((r) => r.city !== CJK_TEXT) } },
      ],
    }),
  },
  image: {
    def: base(
      'Image',
      [
        { type: 'image', name: 'Photo', x: 0, y: 0, w: 160, h: 120, src: 'embedded:photo', fit: 'contain' },
        tb('Cap', 'A photo, embedded', 130),
      ],
      { images: { photo: tinyJpg } },
    ),
    text: ['Image', 'A photo, embedded'],
  },
  charts: {
    def: base('Charts', [
      {
        type: 'chart',
        name: 'Bar',
        x: 0,
        y: 0,
        w: 360,
        h: 140,
        dataSet: 'Sales',
        chartType: 'bar',
        category: '=Fields.region',
        series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
      },
      {
        type: 'chart',
        name: 'Line',
        x: 0,
        y: 150,
        w: 360,
        h: 140,
        dataSet: 'Sales',
        chartType: 'line',
        category: '=Fields.q',
        series: [{ name: 'Units', value: '=Sum(Fields.units)' }],
      },
    ]),
    text: ['Charts'],
  },
};

/* ---------------------------------------------------------------- the browser: pdf.js, and the HTML export */
let browser, page;
const PDFJS = path.join(ROOT, 'node_modules/pdfjs-dist/build');
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  await page.route('http://golden.test/**', (r) => {
    const f = new URL(r.request().url()).pathname.slice(1);
    if (!f)
      return r.fulfill({
        body: '<!doctype html><canvas id=c></canvas><canvas id=g></canvas>',
        contentType: 'text/html',
      });
    return r.fulfill({ body: fs.readFileSync(path.join(PDFJS, path.basename(f))), contentType: 'text/javascript' });
  });
  await page.goto('http://golden.test/');
  // a string: vitest would rewrite an import() inside a function
  await page.evaluate(
    `import('/pdf.mjs').then((lib) => { lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'; window.pdfjs = lib; })`,
  );
}, 60000);
afterAll(async () => browser?.close());

/** Page 1 drawn by pdf.js at 1.5×: its PNG, its text items in order, the page count. */
const drawPdf = (bytes) =>
  page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await window.pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: 1.5 });
    const c = document.getElementById('c');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const text = (await p.getTextContent()).items.map((i) => i.str).filter((s) => s.trim());
    return { png: c.toDataURL('image/png'), text, pages: doc.numPages };
  }, Buffer.from(bytes).toString('base64'));
/** How many pixels of the drawn page differ from the golden PNG (any channel by more than 48 of 255), as a share. */
const diffShare = (png, golden) =>
  page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((ok, no) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = no;
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height)
        return { size: `${ia.width}×${ia.height} vs ${ib.width}×${ib.height}`, share: 1 };
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height).data;
      };
      const [pa, pb] = [px(ia), px(ib)];
      let bad = 0;
      for (let i = 0; i < pa.length; i += 4)
        if (
          Math.abs(pa[i] - pb[i]) > 48 ||
          Math.abs(pa[i + 1] - pb[i + 1]) > 48 ||
          Math.abs(pa[i + 2] - pb[i + 2]) > 48
        )
          bad++;
      return { share: bad / (pa.length / 4) };
    },
    [png, golden],
  );
/** Each expected string in order (others may sit between them). */
const inOrder = (got, want) => {
  let i = 0;
  for (const s of got) if (i < want.length && s.includes(want[i])) i++;
  return want.slice(i);
};

const exportsOf = async (def) => {
  const model = await render(def, {
    fontStore,
    now: NOW,
    exportData: true,
    loadReport: async (id) => (id === 'child' ? child : null),
  });
  return { model, pdf: await exportPdf(model, fontStore, { subset, title: def.name }) };
};

describe('PDF: page 1 matches its golden, text in reading order', () => {
  for (const [name, r] of Object.entries(REPORTS)) {
    it(
      name,
      async () => {
        const { model, pdf } = await exportsOf(r.pdfOnly ? r.pdfOnly(r.def) : r.def);
        expect(
          model.warnings.filter((w) => !/^Barcode|^QR/.test(w)),
          'no warnings',
        ).toEqual([]);
        const drawn = await drawPdf(pdf);
        expect(inOrder(drawn.text, r.text), `text in order; got ${JSON.stringify(drawn.text)}`).toEqual([]);
        const file = path.join(GOLDEN, `${name}.png`);
        if (UPDATE || !fs.existsSync(file)) {
          fs.mkdirSync(GOLDEN, { recursive: true });
          fs.writeFileSync(file, Buffer.from(drawn.png.split(',')[1], 'base64'));
          if (!UPDATE) throw new Error(`${file} did not exist: written, look at it and run again`);
          return;
        }
        const d = await diffShare(drawn.png, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
        if (d.share > 0.0001)
          fs.writeFileSync(path.join(GOLDEN, `${name}.actual.png`), Buffer.from(drawn.png.split(',')[1], 'base64'));
        expect(d.size, 'the page size').toBeUndefined();
        expect(
          d.share,
          `${(d.share * 100).toFixed(3)}% of the pixels differ (see ${name}.actual.png)`,
        ).toBeLessThanOrEqual(0.0001); // one changed digit is 0.03%
      },
      60000,
    );
  }
  it('the Hindi, Arabic and Chinese text: shaped, extracted as written', async () => {
    const { pdf } = await exportsOf(REPORTS.unicode.def);
    const t = (await drawPdf(pdf)).text.join(' ');
    expect(t).toMatch(/नमस्ते/);
    expect(t).toMatch(/مرحبا|ابحرم/); // pdf.js gives an RTL run in either order
    expect(t).toContain('我们的产品很好');
  }, 60000);
});

describe('HTML: subset fonts, nothing external, data stays text', () => {
  for (const [name, r] of Object.entries(REPORTS)) {
    it(
      name,
      async () => {
        const { model } = await exportsOf(r.def);
        const html = await exportHtml(model, { fonts: fontStore, subset, title: r.def.name });
        const full = await exportHtml(model, { fonts: fontStore, title: r.def.name });
        // subset: far smaller than with whole fonts, and within a budget (the image report carries its photo)
        const budget = (name === 'image' ? 250 : 0) * 1024 + (name === 'unicode' ? 300 : 160) * 1024;
        expect(html.length, `${name}: ${html.length} bytes`).toBeLessThan(budget);
        if (/@font-face/.test(full)) expect(html.length).toBeLessThan(full.length / 2);
        // no address outside the file
        expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
        expect(html).not.toMatch(/url\(\s*["']?(https?:)?\/\//i);
        expect(html).not.toMatch(/@import/i);
        // opened in a browser: no request goes out, no script of the data runs, no dialog
        const p = await browser.newPage();
        const requests = [];
        p.on('request', (q) => {
          if (!/^(data|blob|about):/.test(q.url())) requests.push(q.url());
        });
        let dialog = false;
        p.on('dialog', (d) => {
          dialog = true;
          d.dismiss();
        });
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        await p.route('**/*', (q) =>
          q.request().url().startsWith('http://html.test/')
            ? q.fulfill({ body: html, contentType: 'text/html' })
            : q.abort(),
        );
        await p.goto('http://html.test/');
        await p.waitForTimeout(300);
        expect(
          requests.filter((u) => u !== 'http://html.test/'),
          'requests',
        ).toEqual([]);
        expect(await p.evaluate(() => window.__xss)).toBeUndefined();
        expect(dialog).toBe(false);
        expect(errors).toEqual([]);
        if (['table', 'toc', 'unicode'].includes(name)) {
          const shown = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
          for (const x of XSS.slice(0, 3)) expect(shown, 'shown as text').toContain(x); // a cell wraps it: compared without line breaks
          // the only scripts: the export's own and its data (JSON, with every < escaped, so a value cannot close the tag)
          const scripts = await p
            .locator('script')
            .evaluateAll((s) => s.map((x) => ({ type: x.type, text: x.textContent })));
          expect(
            scripts.filter((x) => x.type !== 'application/json' && /__xss/.test(x.text)),
            'no data in a script that runs',
          ).toEqual([]);
          for (const x of scripts.filter((x) => x.type === 'application/json')) {
            expect(x.text).not.toContain('<');
            expect(JSON.stringify(JSON.parse(x.text))).toContain('__xss');
          }
          expect(await p.locator('img[onerror], svg[onload], [href^="javascript:"]').count()).toBe(0);
        }
        await p.close();
      },
      60000,
    );
  }
  it('a hyperlink action from data: a javascript: address is not a link', async () => {
    const def = base('Links', [
      {
        type: 'list',
        name: 'L',
        dataSet: 'Sales',
        x: 0,
        y: 0,
        w: 360,
        h: 20,
        items: [
          tb('U', '=Fields.city', 0, {
            action: { type: 'hyperlink', url: '="javascript:window.__xss=5//" & Fields.sku' },
          }),
        ],
      },
    ]);
    const { model } = await exportsOf(def);
    const html = await exportHtml(model, { fonts: fontStore, subset });
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
  }, 60000);
});

describe('XLSX and CSV: values and formats read back', () => {
  const read = async (model) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportXlsx(model, { fontStore }));
    const ws = wb.worksheets[0];
    const cells = [];
    ws.eachRow((row) => row.eachCell((c) => cells.push({ v: c.value, fmt: c.numFmt })));
    return cells;
  };
  const csvRows = (csv) => {
    const out = [];
    let row = [],
      cell = '',
      q = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (q) {
        if (ch === '"' && csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && csv[i + 1] === '\n') i++;
        row.push(cell);
        out.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) {
      row.push(cell);
      out.push(row);
    }
    return out;
  };
  it('table: numbers are numbers with their format, dates are dates, text (also hostile) is text', async () => {
    const { model } = await exportsOf(REPORTS.table.def);
    const cells = await read(model);
    const num = (v) => cells.find((c) => c.v === v || c.v?.result === v);
    expect(num(1234.5)?.fmt, 'C2 → a currency format').toMatch(/\$.*#,##0\.00|#,##0\.00.*\$/);
    expect(num(12)?.fmt, 'N0 → #,##0').toMatch(/#,##0(?!\.)/);
    const total = cells.find((c) => c.v?.formula || c.v?.result === 6667.25 || c.v === 6667.25);
    expect(total, 'the total').toBeTruthy();
    const day = cells.find((c) => c.v instanceof Date);
    expect(day, 'a date cell').toBeTruthy();
    expect(day.fmt).toMatch(/yyyy-mm-dd/i);
    for (const x of XSS.slice(0, 3))
      expect(
        cells.some((c) => c.v === x),
        `${x} as text`,
      ).toBe(true);
    expect(
      cells.some((c) => typeof c.v === 'string' && /^[=+\-@]/.test(c.v) && /\(/.test(c.v)),
      'no cell starts a formula',
    ).toBe(false);
  }, 60000);
  it('matrix: one number per region and quarter', async () => {
    const { model } = await exportsOf(REPORTS.matrix.def);
    const vals = (await read(model))
      .map((c) => (typeof c.v === 'object' && c.v ? c.v.result : c.v))
      .filter((v) => typeof v === 'number');
    for (const v of [1234.5, 80, 342.25, 10, 5000, 0.5]) expect(vals).toContain(v);
  }, 60000);
  it('unicode: the Hindi, Arabic and Chinese text round-trips in XLSX and CSV', async () => {
    const { model } = await exportsOf(REPORTS.unicode.def);
    const cells = (await read(model)).map((c) => c.v);
    const csv = exportCsv(model);
    for (const s of SCRIPTS) {
      expect(
        cells.flat().some((v) => String(v?.richText ? v.richText.map((r) => r.text).join('') : v).includes(s)),
        `xlsx: ${s}`,
      ).toBe(true);
      expect(csv, `csv: ${s}`).toContain(s);
    }
  }, 60000);
  it('table CSV: a row per detail row, values as the data has them, hostile text quoted', async () => {
    const { model } = await exportsOf(REPORTS.table.def);
    const csv = exportCsv(model);
    const t = csvRows(csv.replace(/^﻿/, ''));
    const data = t.filter((r) => rows.some((x) => r.includes(x.city)));
    expect(data.length).toBe(rows.length);
    for (const x of rows) {
      const r = data.find((d) => d.includes(x.city));
      expect(
        r.some(
          (c) => c === String(x.amount) || c === x.amount.toFixed(2) || c.replace(/[$,]/g, '') === x.amount.toFixed(2),
        ),
        `${x.city}: ${x.amount} in ${JSON.stringify(r)}`,
      ).toBe(true);
    }
    // a value that a spreadsheet would read as a formula is defused
    for (const r of t) for (const c of r) expect(/^[=+@]/.test(c) && /\(/.test(c), `cell ${c}`).toBe(false);
  }, 60000);
});
