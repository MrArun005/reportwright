// The Node-only rasteriser import in figures.js must not make Vite warn or fail: Vite wants /* @vite-ignore */ on a
// dynamic import whose specifier is a variable (the browser build never runs it).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createServer, createLogger } from 'vite';

describe('bundlers: the sharp import', () => {
  it('Vite transforms src/exporters/figures.js with no "cannot be analyzed" warning', async () => {
    const warnings = [];
    const logger = createLogger('warn', { allowClearScreen: false });
    logger.warn = (msg) => warnings.push(String(msg));
    logger.error = (msg) => warnings.push(String(msg));
    const server = await createServer({ root: process.cwd(), configFile: false, customLogger: logger, logLevel: 'silent',
      server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
    try {
      await server.transformRequest(path.resolve('src/exporters/figures.js'));
    } finally { await server.close(); }
    expect(warnings.filter(w => /cannot be analyzed|sharp/.test(w))).toEqual([]);
  }, 60000);
});
