// render(def, { fetch }): every fetched data source goes through the caller's fetch; globalThis.fetch is only the fallback.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const def = () => report([], { def: { dataSources: [{ name: 'src', type: 'rest', url: 'https://api.example.com/rows' }] } });
const reply = (seen) => async (u) => { seen.push(String(u)); return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ rows: [] }), text: async () => '{"rows":[]}' }; };

describe('render(def, { fetch })', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the injected fetch, not globalThis.fetch', async () => {
    const global = [], mine = [];
    vi.stubGlobal('fetch', reply(global));
    await render(def(), { fontStore, fetch: reply(mine) });
    expect(mine).toEqual(['https://api.example.com/rows']);
    expect(global).toEqual([]);
  });

  it('falls back to globalThis.fetch, and says so when there is none', async () => {
    const global = [];
    vi.stubGlobal('fetch', reply(global));
    await render(def(), { fontStore });
    expect(global).toEqual(['https://api.example.com/rows']);
    vi.stubGlobal('fetch', undefined);
    await expect(render(def(), { fontStore })).rejects.toThrow(/No fetch\(\) available: pass render\(def, \{ fetch \}\)/);
  });
});
