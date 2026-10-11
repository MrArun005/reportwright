// The admin setting for HTML export: saved, validated, read back, and it sits between the report and env.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-hx-'));
const saved = {};
let settings;
beforeAll(async () => {
  process.chdir(dir);
  for (const [k, v] of Object.entries({ PW_STORAGE: 'file', PW_HTML_EXPORT: 'static', PW_HTML_DRILL_LINKS: undefined })) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  settings = await import('../../src/server/settings.js');
});
afterAll(() => { process.chdir(cwd); for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } fs.rmSync(dir, { recursive: true, force: true }); });

describe('htmlExport setting', () => {
  it('unset: env, then the default', async () => {
    expect(await settings.serverHtmlExport()).toEqual({ html: 'static', drillLinks: 'inline' });
  });
  it('round-trips and wins over env', async () => {
    const after = await settings.updateSettings({ htmlExport: { html: 'tables', drillLinks: 'new-tab' } });
    expect(after.htmlExport).toEqual({ html: 'tables', drillLinks: 'new-tab' });
    expect((await settings.getSettings({ fresh: true })).htmlExport).toEqual({ html: 'tables', drillLinks: 'new-tab' });
    expect(await settings.serverHtmlExport()).toEqual({ html: 'tables', drillLinks: 'new-tab' });
    await settings.updateSettings({ htmlExport: { html: '' } }); // back to "not set here"
    expect(await settings.serverHtmlExport()).toEqual({ html: 'static', drillLinks: 'inline' });
  });
  it('rejects unknown values', async () => {
    await expect(settings.updateSettings({ htmlExport: { html: 'pdf' } })).rejects.toThrow(/htmlExport\.html/);
    await expect(settings.updateSettings({ htmlExport: { drillLinks: 'popup' } })).rejects.toThrow(/drillLinks/);
    await expect(settings.updateSettings({ htmlExport: 'x' })).rejects.toThrow(/htmlExport/);
  });
});
