// The chart gallery speaks every UI language: each string it asks for is in all 9 tables.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS, LANGUAGES } from '../../src/i18n/index.js';

it('every chart gallery string exists in every language', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../../src/designer/ChartWizard.jsx'), 'utf8');
  const types = JSON.parse(/const TYPES = (\[[^\]]+\])/.exec(src)[1].replace(/'/g, '"'));
  const aggs = [.../const AGGS = \[([^\]]+)\]/.exec(src)[1].matchAll(/value: '(\w+)'/g)].map(m => m[1]);
  const keys = [
    ...[...src.matchAll(/tr\('(\w+)'/g)].map(m => m[1]),
    ...[...src.matchAll(/tr\([^)]*\? '(\w+)' : '(\w+)'/g)].flatMap(m => [m[1], m[2]]),
    ...types.flatMap(ty => [`t_${ty}`, `w_${ty}`]), ...aggs.map(a => `agg_${a}`),
  ].map(k => `cw_${k}`);
  expect(types.length).toBe(16);
  expect(keys.length).toBeGreaterThan(70);
  for (const lang of LANGUAGES) for (const k of keys) expect(STRINGS[lang][k], `${lang}.${k}`).toBeTruthy();
  expect(src).not.toMatch(/label="[A-Z]/); // no English labels left in the JSX
});
