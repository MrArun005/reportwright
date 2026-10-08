// Streaming phase B: on the shipped reports (reports/*.pw.json), every one that streams writes exactly the data CSV the
// model path writes. Data that needs a server (fetched, SQL) is left out; inline data runs through both paths.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { planStream } from '../../src/engine/stream.js';
import { exportCsv, writeCsvStream } from '../../src/exporters/csv.js';
import { fontStore } from '../helpers.js';

const dir = path.join(import.meta.dirname, '../../reports');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pw.json')).sort();
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const loadReport = async (id) => read(`${id}.pw.json`);
const local = (def) => (def.dataSources || []).every(s => s.type === 'json' || ((s.type === 'csv' || s.type === 'xml') && s.data));

describe('streaming CSV on the shipped reports', () => {
  it('byte for byte the model path wherever a report streams', async () => {
    let streamed = 0, checked = 0;
    const why = {};
    for (const f of files) {
      const def = read(f);
      if (!local(def)) continue;
      checked++;
      const plan = await planStream(def, { format: 'csv', loadReport });
      if (plan.why) { why[plan.why] = (why[plan.why] || 0) + 1; continue; }
      let model;
      try { model = await render(def, { fontStore, dataOnly: true, loadReport }); } catch { continue; }
      if (!model.regions.length) continue; // the model path falls back to page text: so would the server
      const want = exportCsv(model, { locale: def.locale, currency: def.currency });
      let got = '';
      await writeCsvStream(plan, (s) => { got += s; }, { locale: def.locale, currency: def.currency });
      expect(got, f).toBe(want);
      streamed++;
    }
    console.log(`[stream] ${streamed} of ${checked} local-data reports stream; the rest fall back:`, why);
    expect(streamed).toBeGreaterThan(3);
  }, 120000);
});
