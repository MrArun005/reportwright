// Runs the engine off the main thread.
import { render, FontStore } from '../engine/index.js';

const store = new FontStore(async (k) => (await fetch(`/fonts/${k}.ttf`)).arrayBuffer());

self.onmessage = async (e) => {
  const { id, def, params, state, reportId, firstPages } = e.data;
  try {
    const opts = { parameters: params, state, reportId, fontStore: store, baseUrl: self.location.origin, loadReport: async (rid) => { const r = await fetch(`/api/reports/${rid}`); if (!r.ok) throw new Error(`Report "${rid}" not found`); return r.json(); } };
    // the first pages first, so a long report shows at once; then the whole report
    if (firstPages) {
      const part = await render(def, { ...opts, firstPages });
      if (!part.partial) { self.postMessage({ id, ok: true, model: part }); return; }
      self.postMessage({ id, ok: true, partial: true, model: part });
    }
    const model = await render(def, opts);
    self.postMessage({ id, ok: true, model });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
