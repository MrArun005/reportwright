// A CSV or XML response is read in the charset its Content-Type names (UTF-8 by default; a BOM is stripped)
import { describe, it, expect } from 'vitest';
import { loadSources } from '../../src/engine/data/index.js';

const bytesOf = (s) => Uint8Array.from(s, c => c.charCodeAt(0)); // one byte per char: Latin-1 / windows-1252 bytes
const csvWith = async (bytes, contentType) => {
  const f = async () => new Response(bytes, { status: 200, headers: contentType ? { 'content-type': contentType } : {} });
  const out = await loadSources({ dataSources: [{ name: 'd', type: 'csv', url: 'https://data.example.test/a.csv' }] }, { params: {}, fetch: f });
  return JSON.stringify(out.d);
};

describe('CSV sources and the response charset', () => {
  it('reads ISO-8859-1 when the Content-Type says so', async () => {
    expect(await csvWith(bytesOf('name\nCaf\xe9\n'), 'text/csv; charset=ISO-8859-1')).toContain('Café');
  });

  it('reads windows-1252 (the euro sign is 0x80)', async () => {
    expect(await csvWith(bytesOf('price\n\x80 5\n'), 'text/csv; charset="windows-1252"')).toContain('€ 5');
  });

  it('defaults to UTF-8 and strips a byte order mark', async () => {
    const utf8 = new TextEncoder().encode('﻿name\nCafé\n');
    expect(await csvWith(utf8, undefined)).toBe('[{"name":"Café"}]');
    expect(await csvWith(utf8, 'text/csv; charset=utf-8')).toBe('[{"name":"Café"}]');
  });
});
