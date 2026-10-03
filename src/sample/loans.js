// @ts-check
/** Deterministic sample data for the loan statement report. All people and numbers are fictional. */

const BORROWERS = {
  'LN-2026-004417': { name: 'Priya Raghavan', city: 'Bengaluru', principal: 1200000, rate: 10.5, months: 300, start: '2024-01-05', product: 'Home loan' },
  'LN-2025-001982': { name: 'Arjun Mehta', city: 'Pune', principal: 450000, rate: 13.25, months: 36, start: '2025-03-10', product: 'Personal loan' },
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function listSampleAccounts() {
  return Object.entries(BORROWERS).map(([id, b]) => ({ id, name: b.name, product: b.product }));
}

/** @param {string} id @param {Date} [asOf] */
export function sampleLoan(id, asOf = new Date('2026-10-03T00:00:00')) {
  const b = BORROWERS[id];
  if (!b) return null;
  const r = b.rate / 1200;
  const emi = Math.round((b.principal * r * (1 + r) ** b.months) / ((1 + r) ** b.months - 1));
  let bal = b.principal;
  const start = new Date(b.start + 'T00:00:00');
  const schedule = [];
  for (let i = 1; i <= b.months; i++) {
    const due = new Date(start); due.setMonth(start.getMonth() + i - 1);
    const interest = Math.round(bal * r * 100) / 100;
    const principal = i === b.months ? bal : Math.round((emi - interest) * 100) / 100;
    bal = Math.max(0, Math.round((bal - principal) * 100) / 100);
    const days = (asOf.getTime() - due.getTime()) / 86400000;
    // the 31st installment is the one the borrower missed (demo of the "Overdue" state)
    const status = days < 0 ? 'Upcoming' : (i === 31 && days > 0 ? 'Overdue' : 'Paid');
    schedule.push({
      installment: i,
      dueDate: ymd(due),
      emi: i === b.months ? Math.round((principal + interest) * 100) / 100 : emi,
      principal, interest, balance: bal, status,
    });
  }
  const paid = schedule.filter(s => s.status === 'Paid');
  const next = schedule.find(s => s.status !== 'Paid');
  return {
    loan: {
      accountId: id, name: b.name, city: b.city, product: b.product,
      principal: b.principal, rate: b.rate, months: b.months, emi,
      disbursedOn: b.start, paidCount: paid.length,
      outstanding: paid.length ? paid[paid.length - 1].balance : b.principal,
      nextDue: next ? next.dueDate : null,
    },
    schedule,
  };
}
