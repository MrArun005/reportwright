// A large report's PDF button uses the server route (much faster than pdf-lib in the browser); small reports,
// unsaved designs and a viewer with no server keep the browser path.
import { describe, it, expect } from 'vitest';
import { serverPdfUrl } from '../../src/viewer/logic.js';

const big = { pages: new Array(10).fill({}), stats: { rows: { Tx: 100000 } } };
const small = { pages: new Array(10).fill({}), stats: { rows: { Tx: 500 } } };

describe('server PDF for large reports', () => {
  it('over 20,000 rows: the server route with the parameters and the viewer time zone', () => {
    const u = new URL(serverPdfUrl(big, { reportId: 'st 100k', params: { rows: 100000, region: 'North', when: new Date('2026-01-02T00:00:00Z') }, origin: 'https://x.test', timeZone: 'Asia/Kolkata' }));
    expect(u.origin + u.pathname).toBe('https://x.test/api/reports/st%20100k/pdf');
    expect(Object.fromEntries(u.searchParams)).toEqual({ rows: '100000', region: 'North', when: '2026-01-02T00:00:00.000Z', timeZone: 'Asia/Kolkata' });
  });
  it('over 800 pages also counts', () => expect(serverPdfUrl({ pages: new Array(801).fill({}) }, { reportId: 'r', params: {}, origin: 'https://x.test' })).toMatch(/\/api\/reports\/r\/pdf/));
  it('small, unsaved or no server: null (the browser makes the PDF)', () => {
    expect(serverPdfUrl(small, { reportId: 'r', params: {}, origin: 'https://x.test' })).toBeNull();
    expect(serverPdfUrl(big, { reportId: undefined, params: {}, origin: 'https://x.test' })).toBeNull();
    expect(serverPdfUrl(big, { reportId: 'r', params: {}, origin: 'https://x.test', dirty: true })).toBeNull();
    expect(serverPdfUrl(big, { reportId: 'r', params: { region: ['North', 'South'] }, origin: 'https://x.test' })).toBeNull(); // a multi-value parameter: the query string cannot carry it
  });
});
