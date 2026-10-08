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
});
