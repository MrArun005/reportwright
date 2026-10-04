// Runs the engine off the main thread.
import { render, FontStore } from '../engine/index.js';
import { fontFile, setCustomFonts } from '../engine/text/fonts.js';
import { reportFetch } from '../viewer/dataFetch.js';

const store = new FontStore(async (k) => {
  const r = await fetch(`/fonts/${fontFile(k)}`);
  if (!r.ok) throw new Error(`Font "${k}" did not load (HTTP ${r.status})`);
  return r.arrayBuffer();
});

self.onmessage = async (e) => {
  const { id, def, params, state, reportId, fonts, firstPages, exportData } = e.data;
  try {
    setCustomFonts(fonts || []);
    const opts = { parameters: params, state, reportId, ...(exportData ? {} : { exportData: false }), fontStore: store, baseUrl: self.location.origin, fetch: reportFetch(self.location.origin), loadReport: async (rid) => { const r = await fetch(`/api/reports/${encodeURIComponent(rid)}`, { redirect: 'error' }); if (!r.ok) throw new Error(`Report "${rid}" not found`); return r.json(); } };
    // the first pages first, so a long report shows at once; then the whole report
    let sources;
    if (firstPages) {
      const part = await render(def, { ...opts, firstPages, onSources: (s) => { sources = s; } });
      if (!part.partial) { self.postMessage({ id, ok: true, model: part }); return; }
      self.postMessage({ id, ok: true, partial: true, model: part });
    }
    const model = await render(def, { ...opts, sources }); // the data the first pages loaded, not fetched again
    self.postMessage({ id, ok: true, model });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
