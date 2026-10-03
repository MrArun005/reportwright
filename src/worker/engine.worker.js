// Runs the engine off the main thread.
import { render, FontStore } from '../engine/index.js';

const store = new FontStore(async (k) => (await fetch(`/fonts/${k}.ttf`)).arrayBuffer());

self.onmessage = async (e) => {
  const { id, def, params, state } = e.data;
  try {
    const model = await render(def, { parameters: params, state, fontStore: store, baseUrl: self.location.origin, loadReport: async (rid) => { const r = await fetch(`/api/reports/${rid}`); if (!r.ok) throw new Error(`Report "${rid}" not found`); return r.json(); } });
    self.postMessage({ id, ok: true, model });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
