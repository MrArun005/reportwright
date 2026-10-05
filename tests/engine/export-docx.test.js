// Word export, batch 2: charts, pictures, barcodes, shapes and in-cell visuals as pictures (SVG + PNG fallback),
// text boxes' backgrounds and borders as paragraph shading and borders, cell borders as cell borders.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { exportDocx } from '../../src/exporters/docx.js';
import { figures, pathBox } from '../../src/exporters/figures.js';
import { fontKeysOf } from '../../src/exporters/svg.js';
import { model, fontStore, items } from './export-fixture.js';
import { render } from '../../src/engine/index.js';
import { report } from '../helpers.js';

const docx = async (opt = {}) => {
  const m = await model();
  await fontStore.load(fontKeysOf(m));
  return unzipSync(await exportDocx(m, { title: 'T', fontStore, ...opt }));
};

describe('Word export: figures', () => {
  it('a chart, a picture, a barcode and a shape are pictures; an SVG with a PNG fallback; alt text as descr', async () => {
    const files = await docx();
    const doc = strFromU8(files['word/document.xml']);
    const media = Object.keys(files).filter(f => f.startsWith('word/media/'));
    expect(media.some(f => f.endsWith('.png'))).toBe(true);
    expect(media.some(f => f.endsWith('.svg'))).toBe(true);
    expect(doc).toContain('descr="Column chart: Kochi has the highest amount"');
    expect(doc).toContain('descr="Company logo"');
    expect(doc).toContain('descr="Barcode"');
    expect(doc).toContain('descr="Shape"');
    expect(doc).toContain('asvg:svgBlip');
    // the chart's axis labels are in the picture, not stray paragraphs
    expect(doc).not.toMatch(/<w:t xml:space="preserve">Kochi<\/w:t>[\s\S]*<w:t xml:space="preserve">Kochi<\/w:t>[\s\S]*<w:t xml:space="preserve">Kochi<\/w:t>/);
    // every relationship target exists, and every picture rel is used
    const rels = strFromU8(files['word/_rels/document.xml.rels']);
    for (const [, id, target] of rels.matchAll(/Id="(rIdm\d+)"[^>]*Target="([^"]+)"/g)) {
      expect(files[`word/${target}`]).toBeTruthy();
      expect(doc).toContain(`r:embed="${id}"`);
    }
    // the picture file is a real PNG; the logo keeps its own bytes
    const png = files[media.find(f => f.endsWith('.png'))];
    expect([...png.slice(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
  });

  it('text and tables stay editable Word content; a sparkline is a picture in its cell', async () => {
    const doc = strFromU8((await docx())['word/document.xml']);
    expect(doc).toContain('>Sales by region<');
    expect(doc).toContain('>Delhi<');
    const rows = doc.split('<w:tr>');
    const delhi = rows.find(r => r.includes('>Delhi<'));
    expect(delhi).toContain('<w:drawing>'); // the sparkline in its own cell of that row
    expect(delhi).toContain('130.00');
  });

  it('a text box\'s background and border become paragraph shading and borders; cells keep their borders', async () => {
    const doc = strFromU8((await docx())['word/document.xml']);
    const intro = doc.split('<w:p>').find(p => p.includes('Amounts in lakh'));
    expect(intro).toContain('w:fill="FEF3C7"');
    expect(intro).toMatch(/<w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="F59E0B"\/>/);
    expect(doc).toMatch(/<w:tcBorders><w:bottom w:val="single" w:sz="6" w:space="0" w:color="94A3B8"\/><\/w:tcBorders>/);
  });

  it('KPI tiles: text boxes side by side are one row of a layout table; the tile shape behind them is the cell shading', async () => {
    const tile = (x, label) => [
      { type: 'shape', name: `S${x}`, x, y: 0, w: 120, h: 40, shape: 'rect', style: { fill: '#f1f5f9', stroke: 'none' } },
      { type: 'textbox', name: `T${x}`, x: x + 6, y: 6, w: 108, h: 16, value: label },
    ];
    const m = await render(report([...tile(0, 'Products'), ...tile(130, 'Brands')]), { exportData: true, fontStore });
    const files = unzipSync(await exportDocx(m, { fontStore }));
    const doc = strFromU8(files['word/document.xml']);
    const row = doc.split('<w:tr>').find(r => r.includes('>Products<'));
    expect(row).toContain('>Brands<'); // the same row
    expect(row).toContain('w:fill="F1F5F9"');
    expect(Object.keys(files).some(f => f.startsWith('word/media/'))).toBe(false); // no pictures of the tiles
  });

  it('figures: false gives the text-only document of before', async () => {
    const files = await docx({ figures: false });
    expect(Object.keys(files).some(f => f.startsWith('word/media/'))).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('macOS textutil reads it', async () => {
    const m = await model();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-docx2-')), 'f.docx');
    fs.writeFileSync(file, await exportDocx(m, { fontStore }));
    const txt = execFileSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8' });
    expect(txt).toContain('Sales by region');
    expect(txt).toContain('Chennai');
  });
});

describe('export tags (engine)', () => {
  it('one shared tag per figure, alt text capped, header and footer items are artifacts', async () => {
    const long = 'x'.repeat(50000);
    const m = await render(report([{ ...items[2], alt: long }], { data: { rows: [{ city: 'A', amt: 1 }] }, header: { height: 20, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 100, h: 14, value: 'Head' }] } }), { exportData: true, fontStore });
    const tagged = m.pages[0].items.filter(i => i.tag);
    expect(new Set(tagged.map(i => i.tag)).size).toBe(1); // one object, not one per item
    expect(tagged[0].tag.alt.length).toBe(2000);
    expect(m.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === 'Head').art).toBe(1);
    // a JSON copy (the API's json format) still groups the chart as one figure
    const copy = JSON.parse(JSON.stringify(m));
    expect(figures(copy.pages[0].items).length).toBe(1);
  });
  it('exportData: false (a view, a plain PDF) leaves out the table data and cell tags; the pages are the same', async () => {
    const full = await model(), lean = await model({ exportData: false });
    expect(lean.regions).toBeNull();
    expect(lean.pages[0].items.some(i => i.cell)).toBe(false);
    expect(full.pages[0].items.some(i => i.cell)).toBe(true);
    const strip = (m) => JSON.stringify(m.pages, (k, v) => (k === 'cell' || k === 'tag' || k === 'xchart' ? undefined : v)); // tag ids count up per process; xchart: a chart's data for Excel
    expect(strip(lean)).toBe(strip(full));
    await expect(exportDocx(lean)).rejects.toThrow(/table data/); // a file without its tables would be wrong
  });
  it('pathBox: an arc is bounded by where it turns, not its radius in every direction', () => {
    expect(pathBox('M0 0 A10 10 0 0 1 20 0')).toEqual({ x0: 0, y0: -10, x1: 20, y1: expect.closeTo(0, 6) });
    expect(pathBox('M0 0 L10 5 l5 5 H2 V-3 Z')).toEqual({ x0: 0, y0: -3, x1: 15, y1: 10 });
  });
});
