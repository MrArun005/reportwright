// @ts-check
/**
 * Synthetic lending portfolio for the "ReportWright Torture Test" report (reports/torture-test.pw.json).
 * Deterministic: the same seed gives the same output, byte for byte. Fictional borrowers, no real data.
 *
 *   GET /api/sample/torture → { meta, loans, monthly, buckets }
 *
 * Each loan is simulated month by month from its disbursal: interest on the opening balance, then the
 * payment. Before the 12-month window every installment is paid in full; inside it, Overdue and NPA loans
 * pay several partial installments at the end, Closed loans pay a few partials and then settle the balance.
 */

export const TORTURE_CONFIG = Object.freeze({
  title: 'ReportWright Torture Test',
  subtitle: 'Interactive report PDF: every feature a report engine must get right',
  author: 'Generated for Arun / ReportWright',
  demoUrl: 'https://mrarun005.github.io/reportwright-demo/',
  repoUrl: 'https://github.com/MrArun005',
  seed: 20261004,
  nLoans: 180,
  months: 12,
  regions: ['North', 'South', 'East', 'West', 'Central'],
  products: ['Personal', 'Merchant', 'Gold', 'Education', 'Auto'],
  statusWeights: { Current: 0.72, Overdue: 0.16, Closed: 0.09, NPA: 0.03 },
  currency: '₹',
  drillThroughTopN: 6,
  watermark: 'SAMPLE DATA',
  periodEnd: '2026-09-30',
  overdueThresholdDays: 30,
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const r2 = (x) => Math.round(x * 100) / 100;
const pad = (n, w = 2) => String(n).padStart(w, '0');

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

/** Standard amortising EMI. */
export function emiOf(principal, ratePct, tenure) {
  const i = ratePct / 1200;
  return r2((principal * i * (1 + i) ** tenure) / ((1 + i) ** tenure - 1));
}

export function bucketOf(dpd) { return dpd <= 0 ? '0' : dpd <= 30 ? '1–30' : dpd <= 60 ? '31–60' : dpd <= 90 ? '61–90' : '90+'; }

export function sampleTorture(cfg = TORTURE_CONFIG) {
  const r = rng(cfg.seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const between = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const [ey, em] = cfg.periodEnd.split('-').map(Number);
  const windowEnd = ey * 12 + em - 1; // absolute month index of the period end (Sep 2026)
  const windowStart = windowEnd - cfg.months + 1; // Oct 2025
  const label = (abs) => `${MONTHS[abs % 12]} ${Math.floor(abs / 12)}`;
  const statuses = Object.entries(cfg.statusWeights);
  const drawStatus = () => { let u = r(); for (const [s, w] of statuses) { if ((u -= w) < 0) return s; } return statuses[0][0]; };

  const loans = [];
  for (let n = 1; n <= cfg.nLoans; n++) {
    const region = pick(cfg.regions);
    const product = pick(cfg.products);
    const principal = Math.round((20000 + 1480000 * r() ** 3) / 500) * 500; // skewed small
    const rate = r2(9.5 + 14.5 * r());
    const tenure = pick([6, 12, 18, 24, 36, 48]);
    const status = drawStatus();
    // disbursal between Apr 2024 and Aug 2026; troubled and closed loans need some history in the window
    const latest = { Current: windowEnd - 1, Overdue: windowEnd - 6, NPA: windowEnd - 12, Closed: windowEnd - 9 }[status];
    const earliest = 2024 * 12 + 3;
    // a troubled loan must still be inside its tenure in the window, or there is nothing left to be late on
    const lo = status === 'Overdue' || status === 'NPA' || status === 'Closed' ? Math.max(earliest, windowEnd - tenure + 1) : earliest;
    const d0 = between(Math.min(lo, latest), latest);
    const disbursed = `${Math.floor(d0 / 12)}-${pad((d0 % 12) + 1)}-${pad(between(1, 28))}`;
    const emi = emiOf(principal, rate, tenure);
    const dpd = status === 'Overdue' ? between(12, 90) : status === 'NPA' ? between(181, 420) : 0;
    // which window months are partial, and when a Closed loan settles
    const partialCount = status === 'Overdue' ? between(3, 5) : status === 'NPA' ? between(6, 8) : status === 'Closed' ? between(2, 4) : 0;
    const settleAt = status === 'Closed' ? between(Math.max(windowStart + partialCount, d0 + partialCount + 1), windowEnd) : null;
    // partials run up to the last installment that falls due (a short loan may mature inside the window)
    const lastPartial = status === 'Closed' ? /** @type {number} */ (settleAt) - 1 : Math.min(windowEnd, d0 + tenure);
    const i = rate / 1200;

    let bal = principal;
    const history = [], schedule = [];
    for (let abs = d0 + 1; abs <= windowEnd; abs++) {
      const j = abs - d0; // installment number
      const opening = bal;
      const interest = bal > 0 ? r2(bal * i) : 0;
      // the last installment also takes the few paise of rounding left over (not the arrears of a late loan)
      const owed = r2(bal + interest);
      const scheduled = j <= tenure && bal > 0 ? (j === tenure && owed - emi < 1 ? owed : Math.min(emi, owed)) : 0;
      let paid = scheduled;
      if (abs >= windowStart && scheduled > 0) {
        if (settleAt != null && abs === settleAt) paid = r2(bal + interest);
        else if (settleAt != null && abs > settleAt) paid = 0;
        else if (partialCount && abs > lastPartial - partialCount && abs <= lastPartial) paid = r2(scheduled * (0.01 + 0.85 * r()));
      }
      bal = Math.max(0, r2(bal + (bal > 0 ? interest : 0) - paid));
      if (abs >= windowStart) {
        history.push(paid);
        schedule.push({ month: label(abs), ym: `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`, installment: j <= tenure ? j : null, due: scheduled, paid, shortfall: r2(Math.max(0, scheduled - paid)), opening, interest, principalPaid: r2(Math.max(0, paid - interest)), closing: bal });
      }
    }
    // months of the window before the loan existed
    const before = cfg.months - history.length;
    for (let k = 0; k < before; k++) {
      const abs = windowStart + k;
      history.unshift(0);
      schedule.splice(k, 0, { month: label(abs), ym: `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`, installment: null, due: 0, paid: 0, shortfall: 0, opening: 0, interest: 0, principalPaid: 0, closing: abs === d0 ? principal : 0 }); // the disbursal month ends with the full principal
    }
    const outstanding = status === 'Closed' ? 0 : r2(bal);
    loans.push({
      id: `LN-2026-${pad(n, 4)}`, borrower: `Borrower ${pad(n, 3)}`, region, product, principal, rate, tenure, emi, status, dpd, outstanding,
      history, disbursed,
      bucket: bucketOf(dpd), overdue: dpd > cfg.overdueThresholdDays,
      collected: r2(history.reduce((a, b) => a + b, 0)),
      schedule,
    });
  }

  const monthly = [];
  for (let k = 0; k < cfg.months; k++) {
    const abs = windowStart + k;
    const ym = `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`;
    const disbursedAmt = loans.filter(l => l.disbursed.startsWith(ym)).reduce((a, l) => a + l.principal, 0);
    const collected = r2(loans.reduce((a, l) => a + l.schedule[k].paid, 0));
    const dueAmt = r2(loans.reduce((a, l) => a + l.schedule[k].due, 0));
    monthly.push({ month: label(abs), ym, disbursed: disbursedAmt, collected, due: dueAmt, efficiency: dueAmt ? Math.round((collected / dueAmt) * 10000) / 10000 : null });
  }

  const buckets = ['0', '1–30', '31–60', '61–90', '90+'].map((bucket, order) => {
    const inB = loans.filter(l => l.bucket === bucket);
    return { bucket, order, loans: inB.length, outstanding: r2(inB.reduce((a, l) => a + l.outstanding, 0)) };
  });

  return {
    meta: { title: cfg.title, subtitle: cfg.subtitle, author: cfg.author, demoUrl: cfg.demoUrl, repoUrl: cfg.repoUrl, seed: cfg.seed, currency: cfg.currency, watermark: cfg.watermark, periodEnd: cfg.periodEnd, overdueThresholdDays: cfg.overdueThresholdDays, drillThroughTopN: cfg.drillThroughTopN, periodLabel: label(windowStart) + ' – ' + label(windowEnd), generated: cfg.periodEnd, note: 'Synthetic data from a seeded generator (src/sample/torture.js). No real borrowers.' },
    regions: cfg.regions.map(name => ({ name })),
    statuses: statuses.map(([name, weight]) => ({ name, weight })),
    loans,
    monthly,
    buckets,
  };
}
