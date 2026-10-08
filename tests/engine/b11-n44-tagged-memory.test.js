// N44: a streamed, tagged PDF holds nothing per structure element once its page is written. The writer keeps where each
// object is (the cross-reference) in blocks it deflates once written past, and the tagger lets go of a page's elements
// when the page ends: memory stays flat with millions of elements, and the file reads the same.
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { createPdfStream } from '../../src/exporters/pdfstream.js';
import { createStreamTagger } from '../../src/exporters/pdfstreamtags.js';
import { fontStore } from '../helpers.js';

const sink = () => { const chunks = []; return { write: async (u8) => { chunks.push(Buffer.from(u8)); }, bytes: () => Buffer.concat(chunks) }; };

describe('a streamed tagged PDF holds nothing per element (N44)', () => {
  it('the cross-reference of 400,000 objects is held in a few hundred KB, not 7 bytes an object', async () => {
    const s = sink();
    const w = createPdfStream(s, { fontStore });
    const late = w.reserve(); // written at the end, as the structure tree's root is
    const held = [];
    for (let i = 0; i < 400000; i++) {
      // a cell's element: reserved when its text is drawn, written when its page ends (in an object stream)
      await w.objectAt(w.reserve(), `<< /S /TD /P ${late} 0 R /K [${i % 50}] >>`);
      if (i % 100000 === 99999) held.push(w.xrefBytes);
    }
    await w.objectAt(late, '<< /S /Document >>');
    await w.finish();
    expect(held[3]).toBeLessThan(600000); // 7 bytes × 400,000 = 2.8 MB before
    expect(held[3] - held[1]).toBeLessThan(150000); // flat: what 200,000 more objects add
    const pdf = s.bytes();
    expect(pdf.subarray(-6).toString()).toBe('%%EOF\n');
    // the cross-reference stream points at every object: "n 0 obj" at each offset, each other in an object stream
    const at = Number(/startxref\n(\d+)/.exec(pdf.subarray(-40).toString())[1]);
    const head = pdf.subarray(at, at + 400).toString('latin1');
    const size = Number(/\/Size (\d+)/.exec(head)[1]), len = Number(/\/Length (\d+)/.exec(head)[1]);
    const start = at + head.indexOf('stream\n') + 7;
    const raw = zlib.inflateSync(pdf.subarray(start, start + len));
    expect(raw.length).toBe(size * 8);
    const prev = new Uint8Array(7), row = new Uint8Array(7);
    let inStreams = 0;
    const bad = [];
    for (let n = 0; n < size; n++) {
      for (let k = 0; k < 7; k++) prev[k] = row[k] = (prev[k] + raw[n * 8 + 1 + k]) & 255;
      const off = row[1] * 2 ** 24 + row[2] * 65536 + row[3] * 256 + row[4];
      if (n === 0 ? row[0] !== 0 : row[0] === 1 ? !pdf.subarray(off, off + 20).toString('latin1').startsWith(`${n} 0 obj`) : row[0] !== 2) bad.push(n);
      if (row[0] === 2) inStreams++;
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(inStreams).toBeGreaterThan(400000);
  }, 60000);

  it('the tagger lets go of a page\'s elements when the page ends', async () => {
    const w = createPdfStream(sink(), { fontStore });
    const tags = createStreamTagger(w);
    const cols = [0, 1, 2];
    for (let p = 0; p < 3; p++) {
      tags.page(0);
      for (let row = 0; row < 40; row++) for (const col of cols) tags.open({ t: 'text', lines: [{ text: 'x' }], cell: { kind: 'detail', row: p * 40 + row, col, cols, span: 1 } });
      expect(tags.held).toBeGreaterThan(0);
      await tags.end(w.pageRef(p));
      expect(tags.held).toBe(0);
    }
    expect(tags.count).toBe(3 * 40 * 4);
  });
});
