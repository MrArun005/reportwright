// Runs the engine off the main thread: the viewer posts a definition, its data and parameters, and gets the page model
// back (src/viewer/engineClient.js). Fonts come from the page (one download, shared with the page's FontFace), so the
// worker needs no font URL. Shipped next to the viewer bundle in @reportwright/viewer (scripts/build-embed.mjs).
import { render, FontStore } from '../engine/index.js';
import { setCustomFonts } from '../engine/text/fonts.js';
import { reportFetch, setFetchPolicy } from '../viewer/dataFetch.js';

let fid = 0;
const fontWait = new Map();
const store = new FontStore((key) => new Promise((resolve, reject) => {
  const n = ++fid;
  fontWait.set(n, { resolve, reject });
  self.postMessage({ font: key, fid: n });
}));

/**
 * A page model to the page in parts of PART pages: each message is read (deserialized) in its own task on the main
 * thread, so a report of thousands of pages arrives without one long freeze. The last message has the rest of the model.
 */
const PART = 50;
function send(id, msg, model) {
  const { pages, ...rest } = model;
  if (!Array.isArray(pages)) { self.postMessage({ id, ...msg, model }); return; }
  for (let i = 0; i < pages.length; i += PART) self.postMessage({ id, pagesPart: pages.slice(i, i + PART) });
  self.postMessage({ id, ...msg, model: rest, inParts: true });
}

self.onmessage = async (e) => {
  if (e.data.fid) { // a font the page fetched for us
    const w = fontWait.get(e.data.fid);
    fontWait.delete(e.data.fid);
    if (e.data.error) w?.reject(new Error(e.data.error)); else w?.resolve(e.data.buf);
    return;
  }
  const { id, def, params, state, reportId, fonts, firstPages, exportData, dataOnly, env = {} } = e.data;
  try {
    setCustomFonts(fonts || []);
    setFetchPolicy(env.fetchPolicy); // the host page's mountViewer options (never the definition's)
    const origin = env.origin || self.location.origin;
    const loadReport = async (rid) => {
      if (env.reports && Object.hasOwn(env.reports, rid)) return structuredClone(env.reports[rid]);
      if (env.standalone) throw new Error(`Report "${rid}" is not loaded: pass it in reports: { "${rid}": definition }, or set server (a self-hosted ReportWright server)`);
      const r = await fetch(`${origin}/api/reports/${encodeURIComponent(rid)}`, { redirect: 'error' });
      if (!r.ok) throw new Error(`Report "${rid}" not found`);
      return r.json();
    };
    const opts = { parameters: params, state, reportId, exportData: !!exportData, dataOnly: !!dataOnly, fontStore: store, lazyFonts: true, baseUrl: origin, fetch: reportFetch(origin, undefined, { onRetry: (retry) => self.postMessage({ id, retry }) }), loadReport };
    // the first pages first, so a long report shows at once; then the whole report
    let sources;
    if (firstPages) {
      const part = await render(def, { ...opts, firstPages, onSources: (s) => { sources = s; } });
      if (!part.partial) { send(id, { ok: true }, part); return; }
      send(id, { ok: true, partial: true }, part);
    }
    const model = await render(def, { ...opts, sources }); // the data the first pages loaded, not fetched again
    send(id, { ok: true }, model);
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
