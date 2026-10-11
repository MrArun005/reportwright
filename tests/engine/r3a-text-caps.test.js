// R3-A safety: every string builder refuses a result over 1,000,000 characters before it builds it. The review's
// expression asked Replace for 400,000,000 characters (about 1 GB); it must fail fast with #Error and a warning.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const one = async (value) => {
  const t0 = performance.now();
  const m = await render({ $schema: 'reportwright/report@1', page: { size: 'A4' }, sections: { body: { height: 40, items: [
    { type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 12, value }] } } }, { fontStore });
  return { text: m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text).join(''), warnings: m.warnings.join(' '), ms: performance.now() - t0 };
};

describe('1M-character cap on every string builder', () => {
  it.each([
    ['=Len(Replace(Replace(Space(10000)," ",Space(10000))," ",Space(4)))'], // 400 million characters asked for
    ['=Replace(Space(2000), " ", StrDup(1000, "x"))'],
    ['=StrDup(2000000, "x")'], ['=Space(1000001)'], ['=PadLeft("a", 5000000)'], ['=PadRight("a", 5000000, "-")'],
    ['=StrDup(600000, "x") & StrDup(600000, "y")'], ['=StrDup(600000, "x") + StrDup(600000, "y")'],
    ['=Join(Split(StrDup(900000, ","), ","), "ab")'], ['=JavaFormat("%s%s", StrDup(600000, "x"), StrDup(600000, "y"))'],
  ])('%s', async (value) => {
    const r = await one(value);
    expect(r.text).toBe('#Error');
    expect(r.warnings).toMatch(/longer than 1,000,000 characters/);
    expect(r.ms).toBeLessThan(1500);
  });
  it('Replace under the cap still works, with VB start and count', async () => {
    expect((await one('=Replace("banana", "a", "o")')).text).toBe('bonono');
    expect((await one('=Replace("banana", "a", "o", 1, 1)')).text).toBe('bonana');
    expect((await one('=Replace("banana", "a", "o", 3)')).text).toBe('nono'); // VB drops the text before start
    expect((await one('=Len(StrDup(999999, "ab"))')).text).toBe('999999');
  });
});
