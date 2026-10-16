// #23: a report name made into a file name: one dash for each run of other characters, none at the ends
import { describe, it, expect } from 'vitest';
import { fileStem } from '../../src/engine/filename.js';
import { safeName } from '../../src/server/jobs.js';

describe('fileStem', () => {
  it('"Sales - Q1 (draft)" → Sales-Q1-draft', () => {
    expect(fileStem('Sales - Q1 (draft)')).toBe('Sales-Q1-draft');
  });
  it('keeps letters, digits, _, ., @ and -', () => {
    expect(fileStem('loan_statement v1.2 a@b')).toBe('loan_statement-v1.2-a@b');
  });
  it('no leading dots (a hidden file) or dashes', () => {
    expect(fileStem('...secret')).toBe('secret');
    expect(fileStem('--- x ---')).toBe('x');
  });
  it('nothing left: the fallback', () => {
    expect(fileStem('ऋण विवरण')).toBe('report');
    expect(fileStem('')).toBe('report');
    expect(fileStem(null, 'export')).toBe('export');
  });
  it('at most 120 characters, no dash at the cut', () => {
    const s = fileStem(`${'a'.repeat(119)} b`);
    expect(s).toBe('a'.repeat(119));
  });
  it('the batch jobs name their files the same way', () => {
    expect(safeName('Sales - Q1 (draft)')).toBe('Sales-Q1-draft');
  });
});
