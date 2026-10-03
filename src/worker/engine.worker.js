// Runs the engine off the main thread.
import { render, FontStore } from '../engine/index.js';
import { fontFile, setCustomFonts } from '../engine/text/fonts.js';

const store = new FontStore(async (k) => {
  const r = await fetch(`/fonts/${fontFile(k)}`);
  if (!r.ok) throw new Error(`Font "${k}" did not load (HTTP ${r.status})`);
  return r.arrayBuffer();
});

self.onmessage = async (e) => {
  const { id, def, params, state, reportId, fonts } = e.data;
  try {
    setCustomFonts(fonts || []);
    const model = await render(def, { parameters: params, state, reportId, fontStore: store, baseUrl: self.location.origin, loadReport: async (rid) => { const r = await fetch(`/api/reports/${rid}`); if (!r.ok) throw new Error(`Report "${rid}" not found`); return r.json(); } });
    self.postMessage({ id, ok: true, model });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
