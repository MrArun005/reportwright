// /api/sample/hard?account=<id>: only that account's rows come back; the other sets (FX, ...) are untouched.
import { describe, it, expect } from 'vitest';
import { sampleHard, hardForAccount } from '../../src/sample/hard.js';

describe('hardForAccount', () => {
  const data = sampleHard(500);
  const id = data.accounts.find(a => data.transactions.some(t => t.accountId === a.accountId)).accountId;
  const one = hardForAccount(data, id);

  it('keeps only the chosen account and its transactions', () => {
    expect(one.accounts.length).toBe(1);
    expect(one.accounts[0].accountId).toBe(id);
    expect(one.transactions.length).toBeGreaterThan(0);
    expect(one.transactions.every(t => t.accountId === id)).toBe(true);
    expect(one.transactions.length).toBe(data.transactions.filter(t => t.accountId === id).length);
  });

  it('leaves the other sets as they were', () => {
    expect(one.fx).toBe(data.fx);
    expect(one.branches).toBe(data.branches);
  });

  it('an unknown id gives empty lists, not the whole book', () => {
    const none = hardForAccount(data, 'NO-SUCH-ACCOUNT');
    expect(none.accounts).toEqual([]);
    expect(none.transactions).toEqual([]);
  });
});
