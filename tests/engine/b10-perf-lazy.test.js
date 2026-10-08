// B10 A1.1: pdf-lib and fontkit load on first use (src/engine/lazylibs.js), not when the engine is imported.
import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const HEAVY = /^(pdf-lib|@pdf-lib\/fontkit)$/;
/** the bare packages a file imports at its top level (import … from 'x' / import 'x'; not import('x')) */
const staticImports = (src) => [...src.matchAll(/^\s*import\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1]);

describe('B10 A1.1 cold start: pdf-lib and fontkit are not top-level imports', () => {
  it('no engine or exporter source imports them statically (only lazylibs.js, by import())', () => {
    const files = ['src/engine', 'src/exporters'].flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true }).map(f => path.join(d, String(f))))
      .filter(f => f.endsWith('.js'));
    const bad = files.filter(f => staticImports(fs.readFileSync(path.join(root, f), 'utf8')).some(s => HEAVY.test(s)));
    expect(bad).toEqual([]);
  });

  it('the built engine bundle (as build-packages.mjs builds it) imports them only dynamically', async () => {
    const r = await build({ entryPoints: [path.join(root, 'packages/engine/entry.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
      write: false, external: ['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'bidi-js'], logLevel: 'silent', mainFields: ['module', 'main'] });
    const src = r.outputFiles[0].text;
    expect(staticImports(src).filter(s => HEAVY.test(s))).toEqual([]);
    expect(src).toMatch(/import\("pdf-lib"\)/);
    expect(src).toMatch(/import\("@pdf-lib\/fontkit"\)/);
  }, 60000);

  it('importing the engine loads neither; render loads fontkit only; exportPdf loads pdf-lib', async () => {
    const { execFileSync } = await import('node:child_process');
    // a new process: the test runner may already have them loaded
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { createRequire } from 'node:module';
      const cache = createRequire(import.meta.url).cache; // CommonJS packages imported from ES modules land here too
      const has = (re) => Object.keys(cache).some(k => re.test(k));
      const FK = /[\\/]@pdf-lib[\\/]fontkit[\\/]/, PL = /[\\/]node_modules[\\/]pdf-lib[\\/]/;
      const m = await import(${JSON.stringify(path.join(root, 'packages/engine/entry.js'))});
      const s = [!has(FK) && !has(PL)];
      const fonts = new m.FontStore((k) => fs.readFileSync(${JSON.stringify(path.join(root, 'public/fonts'))} + '/' + m.fontFile(k)));
      const model = await m.render(m.blankReport(), { fontStore: fonts });
      s.push(!has(PL) && has(FK));
      const pdf = await m.exportPdf(model, { fonts, subset: false });
      s.push(has(PL), String.fromCharCode(...pdf.slice(0, 5)));
      console.log(JSON.stringify(s));`], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(out.trim().split('\n').pop())).toEqual([true, true, true, '%PDF-']);
  }, 60000);

  it('a report drawn only in Helvetica renders and exports with neither: no font file is read, the engine writes the PDF', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { createRequire } from 'node:module';
      const cache = createRequire(import.meta.url).cache;
      const has = (re) => Object.keys(cache).some(k => re.test(k));
      const m = await import(${JSON.stringify(path.join(root, 'packages/engine/entry.js'))});
      const read = [];
      const fonts = new m.FontStore(async (k) => { read.push(k); throw new Error('no font files here'); });
      const st = { fontFamily: 'Helvetica' };
      const def = { $schema: 'reportwright/report@1', name: 'Invoice', page: { size: 'A4' },
        dataSources: [{ name: 's', type: 'json', data: { rows: [{ item: 'Bolt', amount: 2.5 }, { item: 'Nut', amount: 0.75 }] } }],
        dataSets: [{ name: 'L', source: 's', path: '$.rows' }],
        sections: { body: { height: 300, items: [
          { type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 20, value: 'INVOICE — total €', style: { ...st, fontWeight: 'bold' } },
          { type: 'table', name: 'Items', dataSet: 'L', x: 0, y: 40, w: 300, h: 40, columns: [{ width: 200 }, { width: 100 }],
            detail: [{ height: 16, cells: [{ value: '=Fields.item', style: st }, { value: '=Fields.amount', style: { ...st, format: 'N2' } }] }],
            footer: [{ height: 16, cells: [{}, { value: '=Sum(Fields.amount)', style: st }] }] }] } } };
      const model = await m.render(def, { fontStore: fonts });
      const pdf = Buffer.from(await m.exportPdf(model, { fonts }));
      const FK = /[\/]@pdf-lib[\/]fontkit[\/]/, PL = /[\/]node_modules[\/]pdf-lib[\/]/;
      console.log(JSON.stringify([read, has(FK), has(PL), model.warnings, pdf.toString('latin1', 0, 5), pdf.toString('latin1').trimEnd().endsWith('%%EOF')]));`], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(out.trim().split('\n').pop())).toEqual([[], false, false, [], '%PDF-', true]);
  }, 60000);
});
