// esbuild's lineLimit splits long string literals with a backslash line continuation ("Ar\<newline>menian"). A Vite 7
// production build turned one in the render worker into a tab, so /\p{Script=Armenian}/u threw and the viewer fell back
// to the main thread. splitContinuations rewrites each into a concatenation, keeping the lines short.
import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { splitContinuations, findContinuations } from '../../scripts/line-continuations.mjs';
import { common, workerMin, WORKER, bwipApart } from '../../scripts/embed-options.mjs';

const run = (code) => new Function(`${code}; return out;`)(); // eslint-disable-line no-new-func
describe('line continuations in built code', () => {
  it('rewrites a continuation in an expression, a key, a member access and a template, keeping each value', () => {
    const src = 'const k = "Ar\\\nmenian", o = { "%Ar\\\nray%": 1 }, n = \'ab\\\ncd\'.length, t = `x\\\ny${1}z\\\nw`, e = "a\\\\\\\nb";\nvar out = [k, Object.keys(o)[0], n, t, e];';
    const fixed = splitContinuations(src);
    expect(findContinuations(fixed)).toEqual([]);
    expect(fixed.split('\n').length).toBe(src.split('\n').length);
    expect(run(fixed)).toEqual(run(src));
    expect(run(fixed)).toEqual(['Armenian', '%Array%', 4, 'xy1zw', 'a\\b']);
  });
  it('leaves a backslash at the end of a comment or in a regex class alone', () => {
    const src = '// a path C:\\\nvar out = /[\\\\]/.test("\\\\");';
    expect(findContinuations(src)).toEqual([]);
    expect(splitContinuations(src)).toBe(src);
  });
  it('refuses a tagged template (its raw text would change)', () => {
    expect(() => splitContinuations('var out = String.raw`a\\\nb`;')).toThrow(/tagged template/);
  });
  it('the render worker build has no continuation left, and its Unicode script regexes compile', async () => {
    const w = await build({ ...common, entryPoints: [WORKER], format: 'esm', ...workerMin, sourcemap: false, splitting: false, write: false, outfile: '/x/engine.worker.js', plugins: [...common.plugins, bwipApart] });
    const text = splitContinuations(w.outputFiles[0].text);
    expect(findContinuations(text)).toEqual([]);
    expect(Math.max(...text.split('\n').map(l => l.length))).toBeLessThan(1000);
  }, 120000);
});
