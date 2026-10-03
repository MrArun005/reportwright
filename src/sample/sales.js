// @ts-check
/** Deterministic fictional sales data: 4 regions, 12 cities, 3 product lines, 2 years. */
const CITIES = {
  North: ['Delhi', 'Jaipur', 'Lucknow'], South: ['Bengaluru', 'Chennai', 'Hyderabad'],
  East: ['Kolkata', 'Bhubaneswar', 'Patna'], West: ['Mumbai', 'Pune', 'Ahmedabad'],
};
const PRODUCTS = ['Home loans', 'Personal loans', 'Gold loans'];

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

export function sampleSales(year) {
  const r = rng(Number(year) || 2026);
  const rows = [];
  for (const [region, cities] of Object.entries(CITIES)) {
    for (const city of cities) {
      for (const product of PRODUCTS) {
        for (let m = 1; m <= 12; m++) {
          const base = product === 'Home loans' ? 90 : product === 'Personal loans' ? 40 : 25;
          const disbursed = Math.round(base * (0.6 + r() * 0.8) * (1 + m / 30) * 100000);
          rows.push({ year: Number(year), month: m, region, city, product, loans: Math.round(disbursed / 650000 + r() * 6), disbursed, npa: Math.round(r() * 4.2 * 100) / 100 });
        }
      }
    }
  }
  return { year: Number(year), regions: Object.keys(CITIES).map(name => ({ name, cities: CITIES[name].length })), rows };
}
