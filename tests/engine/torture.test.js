import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { sampleTorture, emiOf, TORTURE_CONFIG } from '../../src/sample/torture.js';
import { fontStore, texts } from '../helpers.js';

const def = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../reports/torture-test.pw.json'), 'utf8'));
const run = (parameters = {}) => render(def, { fontStore, sources: { torture: sampleTorture() }, parameters, now: new Date('2026-10-04T10:00:00') });
// one string per text box (wrapped lines joined)
const allText = (model) => model.pages.flatMap(p => p.items.filter(i => i.t === 'text').map(i => i.lines.map(l => l.text).join(' ')));

describe('torture-test data generator', () => {
  it('is deterministic: the same seed gives the same output', () => {
    expect(JSON.stringify(sampleTorture())).toBe(JSON.stringify(sampleTorture()));
    expect(JSON.stringify(sampleTorture({ ...TORTURE_CONFIG, seed: 1 }))).not.toBe(JSON.stringify(sampleTorture()));
  });

  it('makes 180 loans with a status mix close to the configured weights', () => {
    const { loans } = sampleTorture();
    expect(loans).toHaveLength(180);
    expect(new Set(loans.map(l => l.id)).size).toBe(180);
    for (const [status, weight] of Object.entries(TORTURE_CONFIG.statusWeights)) {
      const share = loans.filter(l => l.status === status).length / loans.length;
      expect(Math.abs(share - weight)).toBeLessThan(0.05);
    }
  });

  it('keeps every loan internally consistent', () => {
    for (const l of sampleTorture().loans) {
      expect(l.principal % 500).toBe(0);
      expect(l.principal).toBeGreaterThanOrEqual(20000);
      expect(l.principal).toBeLessThanOrEqual(1500000);
      expect(l.rate).toBeGreaterThanOrEqual(9.5);
      expect(l.rate).toBeLessThanOrEqual(24);
      expect([6, 12, 18, 24, 36, 48]).toContain(l.tenure);
      expect(l.emi).toBe(emiOf(l.principal, l.rate, l.tenure));
      expect(l.history).toHaveLength(12);
      expect(l.disbursed >= '2024-04-01' && l.disbursed <= '2026-08-31').toBe(true);
      if (l.status === 'Current' || l.status === 'Closed') expect(l.dpd).toBe(0);
      if (l.status === 'Overdue') expect(l.dpd).toBeGreaterThanOrEqual(12);
      if (l.status === 'NPA') expect(l.dpd).toBeGreaterThan(180);
      if (l.status === 'Closed') expect(l.outstanding).toBe(0);
      if (l.status === 'Overdue' || l.status === 'NPA') expect(l.history.filter(p => p > 0 && p < l.emi * 0.9).length).toBeGreaterThanOrEqual(2);
      expect(l.overdue).toBe(l.dpd > 30);
      // the schedule closes where the loan says it does
      const last = l.schedule[11];
      if (l.status !== 'Closed') expect(last.closing).toBe(l.outstanding);
      for (const r of l.schedule) if (r.opening > 0) expect(Math.abs(r.opening + r.interest - r.paid - r.closing)).toBeLessThan(0.02);
    }
  });

  it('hand-checked book totals', () => {
    const { loans, monthly } = sampleTorture();
    expect(loans.reduce((a, l) => a + l.principal, 0)).toBe(68077500);
    expect(Math.round(loans.reduce((a, l) => a + l.outstanding, 0) * 100) / 100).toBe(27895710.96);
    expect(loans.filter(l => l.status === 'NPA').length).toBe(5);
    expect(monthly.map(m => m.month)).toEqual(['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']);
  });
});

describe('torture-test report', () => {
  it('renders without warnings and shows the hand-checked totals', async () => {
    const model = await run();
    expect(model.warnings).toEqual([]);
    const t = allText(model);
    expect(t).toContain('180'); // KPI: loans
    expect(t.filter(s => s === '₹6,80,77,500').length).toBeGreaterThanOrEqual(2); // KPI and the register's grand total
    expect(t.filter(s => s === '₹2,78,95,711').length).toBeGreaterThanOrEqual(2);
    expect(t).toContain('5 loans · gross NPA ratio');
    expect(t).toContain('5.0%'); // NPA: 14,03,876.70 / 2,78,95,710.96
    expect(t).toContain('Whole book · 180 loans');
  });

  it('has a cover with live links, numbered contents, an outline and one detail page per drill-through loan', async () => {
    const model = await run();
    const p1 = model.pages[0].items;
    const urls = p1.filter(i => i.t === 'link' && i.action?.type === 'url').map(i => i.action.href);
    expect(urls).toEqual(expect.arrayContaining([TORTURE_CONFIG.demoUrl, TORTURE_CONFIG.repoUrl]));
    expect(texts(model.pages[1])).toEqual(expect.arrayContaining(['Contents', '1 Methodology and data', '4 Drill-through: loan details']));
    const labels = model.bookmarks.map(b => b.label);
    const top = sampleTorture().loans.filter(l => l.status === 'Overdue' || l.status === 'NPA').sort((a, b) => b.outstanding - a.outstanding).slice(0, 6);
    for (const l of top) expect(labels).toContain(`${l.id} · ${l.borrower}`);
    // every drill-through link lands on a bookmark that exists
    // (TOC entries from headings carry their own place instead)
    const targets = model.pages.flatMap(p => p.items.filter(i => i.t === 'link' && i.action?.type === 'bookmark' && !i.action.page).map(i => i.action.target));
    expect(targets.length).toBeGreaterThanOrEqual(18); // 12 watchlist jumps, 6 back links
    for (const t of targets) expect(labels, t).toContain(t); // each one jumps to a bookmark, in the viewer and the PDF
    // the last six pages are the detail pages, one loan each, in outstanding order
    const detail = model.pages.slice(-6).map(p => texts(p).find(s => /^LN-2026-\d{4} · /.test(s)));
    expect(detail).toEqual(top.map(l => `${l.id} · ${l.borrower}`));
  });

  it('parameters filter the book', async () => {
    const north = sampleTorture().loans.filter(l => l.region === 'North' && l.status !== 'Closed');
    const model = await run({ region: ['North'], status: ['Current', 'Overdue', 'NPA'] });
    expect(allText(model)).toContain(`Whole book · ${north.length} loans`);
    expect(allText(model)).not.toContain('South region');
  });
});
