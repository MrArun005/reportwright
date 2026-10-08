// A parameter with fixed options AND optionsFrom keeps its fixed options (e.g. "All") first, then the fetched list, no duplicates.
import { describe, it, expect } from 'vitest';
import { paramChoices } from '../../src/viewer/logic.js';

const def = {
  parameters: [
    { name: 'region', options: [{ value: 'ALL', label: 'All' }], optionsFrom: { dataSet: 'Regions', value: '=Fields.r' } },
    { name: 'year', options: ['2025', '2026'] }, // fixed only: the fixed list is what the engine returns
    { name: 'city', optionsFrom: { dataSet: 'Cities', value: '=Fields.c' } },
  ],
};

describe('viewer parameter choices', () => {
  it('fixed options come first, then the fetched ones, without duplicates', () => {
    const fetched = { region: [{ value: 'North', label: 'North' }, { value: 'ALL', label: 'ALL' }, { value: 'South', label: 'South' }], city: [{ value: 'Pune', label: 'Pune' }] };
    const out = paramChoices(def, { ...fetched, year: [{ value: '2025', label: '2025' }, { value: '2026', label: '2026' }] });
    expect(out.region.map(o => o.value)).toEqual(['ALL', 'North', 'South']);
    expect(out.region[0].label).toBe('All');
    expect(out.city.map(o => o.value)).toEqual(['Pune']);
  });

  it('an empty fetched list still leaves the fixed options', () => {
    expect(paramChoices(def, { region: [] }).region).toEqual([{ value: 'ALL', label: 'All' }]);
  });
});
