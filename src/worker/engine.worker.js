// Runs the engine off the main thread.
import { render, FontStore } from '../engine/index.js';

const store = new FontStore(async (k) => (await fetch(`/fonts/${k}.ttf`)).arrayBuffer());

self.onmessage = async (e) => {
  const { id, def, params } = e.data;
  try {
    const model = await render(def, { parameters: params, fontStore: store, baseUrl: self.location.origin });
    self.postMessage({ id, ok: true, model });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { message: err.message, missingParameters: err.missingParameters || null } });
  }
};
