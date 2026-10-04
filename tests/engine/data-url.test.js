// A REST source's URL template: parameter values are path-segment encoded and may not climb the path with . or ..
import { describe, it, expect } from 'vitest';
import { loadSources } from '../../src/engine/data/index.js';

const load = async (url, params) => {
  const seen = [];
  const f = async (u) => { seen.push(u); return { ok: true, json: async () => ({ rows: [] }) }; };
  await loadSources({ dataSources: [{ name: 'api', type: 'rest', url }] }, { params, fetch: f });
  return seen[0];
};

describe('data source URLs from parameters', () => {
  it('encodes a value as one path segment', async () => {
    expect(await load('/api/items/{Parameters.id}', { id: 'a/b?c#d' })).toBe('/api/items/a%2Fb%3Fc%23d');
    expect(await load('/api/items/{Parameters.id}/x', { id: 'v1.2' })).toBe('/api/items/v1.2/x');
  });

  it('refuses . and .. segments that come from parameters', async () => {
    for (const id of ['..', '.']) await expect(load('/api/items/{Parameters.id}/secret', { id }), id).rejects.toThrow(/path/);
    // an encoded dot is encoded again, so it stays a name
    expect(await load('/api/items/{Parameters.id}', { id: '%2e%2e' })).toBe('/api/items/%252e%252e');
    // a value next to the author's dot
    await expect(load('/api/.{Parameters.a}/x', { a: '.' })).rejects.toThrow(/path/);
    // two values that together make ".."
    await expect(load('/api/{Parameters.a}{Parameters.b}/x', { a: '.', b: '.' })).rejects.toThrow(/path/);
  });

  it('allows dots that are not a whole segment, dots in the query, and the author\'s own ..', async () => {
    expect(await load('/api/{Parameters.id}.json', { id: '..' })).toBe('/api/...json');
    expect(await load('/api/items?q={Parameters.q}', { q: '..' })).toBe('/api/items?q=..');
    expect(await load('/api/v2/../items/{Parameters.id}', { id: '7' })).toBe('/api/v2/../items/7');
  });
});
