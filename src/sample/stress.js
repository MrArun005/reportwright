// @ts-check
/** Deterministic rows for the scale stress test: 8 cities × 3 products × 12 months, as many rows as asked. */
const CITIES = ['Bengaluru', 'Pune', 'Delhi', 'Mumbai', 'Chennai', 'Kolkata', 'Jaipur', 'Patna'];
const PRODUCTS = ['Home', 'Gold', 'Personal'];
export const STRESS_MAX_ROWS = 200000;

/** @param {number} n */
export function sampleStress(n) {
  // a seeded generator, so every run gives the same rows, without the patterns of i % 8 (every Mumbai gold row in August)
  let seed = 20261004;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return { rows: Array.from({ length: n }, (_, i) => {
    const city = CITIES[Math.floor(r() * 8)], product = PRODUCTS[Math.floor(r() * 3)], month = 1 + Math.floor(r() * 12);
    const base = product === 'Home' ? 900 : product === 'Gold' ? 250 : 400;
    return { n: i + 1, city, product, month, amt: Math.round(base * (0.5 + r()) * (1 + month / 24) * 100) / 100, npa: Math.round(r() * 50) / 10 };
  }) };
}
