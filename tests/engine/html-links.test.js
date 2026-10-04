// Static HTML export: bookmark jumps and TOC entries are anchors at the target page and height; drill-through
// opens the Pagewright viewer (or is shown disabled without a server); URLs stay as they were.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportHtml } from '../../src/exporters/html.js';
import { fontStore, report } from '../helpers.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
const def = () => report([
  { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
  tb('Jump', 'Go to the results', 60, { action: { type: 'bookmark', target: 'Results here' } }),
  tb('Nowhere', 'Missing', 80, { action: { type: 'bookmark', target: 'No such bookmark' } }),
  tb('Drill', 'Open the loan', 100, { action: { type: 'report', report: 'loan-statement', params: { loan: '="LN 1"', year: '=2026' } } }),
  tb('Sort', 'Sort me', 120, { action: { type: 'params', params: { x: '=1' } } }),
  tb('H1', 'Intro', 140, { headingLevel: 1 }),
  tb('H2', 'Results', 180, { headingLevel: 1, bookmark: 'Results here', pageBreakBefore: true }),
]);
const links = (html) => [...html.matchAll(/<a href="([^"]+)"[^>]*>/g)].map(m => m[1]);
const anchors = (html) => Object.fromEntries([...html.matchAll(/<a class="pw-at" id="([^"]+)" style="top:([\d.]+)%"><\/a>/g)].map(m => [m[1], Number(m[2])]));

describe('static HTML export links', () => {
  it('a bookmark jump and the TOC entries go to anchors on the target page', async () => {
    const m = await render(def(), { fontStore });
    const html = await exportHtml(m, fontStore, { drillBase: 'https://reports.example.com/' });
    const hrefs = links(html);
    const jump = hrefs.find(h => h.startsWith('#at-2-'));
    expect(jump).toBeTruthy(); // "Results here" is on page 2
    const a = anchors(html);
    expect(Object.keys(a)).toContain(jump.slice(1));
    // the anchor sits inside page 2's section, near the heading's height
    const sec2 = html.slice(html.indexOf('id="page-2"'));
    expect(sec2.indexOf(`id="${jump.slice(1)}"`)).toBeGreaterThan(-1);
    expect(a[jump.slice(1)]).toBeGreaterThan(0);
    // TOC entries: one per heading, each to its own anchor
    expect(hrefs.filter(h => h.startsWith('#at-1-')).length).toBeGreaterThanOrEqual(1);
    // a jump to a bookmark that does not exist is not a link
    expect(html).not.toContain('No such bookmark');
  });
  it('drill-through opens the report in the viewer, parameters in the query', async () => {
    const html = await exportHtml(await render(def(), { fontStore }), fontStore, { drillBase: 'https://reports.example.com/' });
    expect(links(html)).toContain('https://reports.example.com/viewer/loan-statement?loan=LN+1&amp;year=2026');
    expect(html).toMatch(/<a href="https:\/\/reports\.example\.com\/viewer\/loan-statement[^"]*" target="_blank" rel="noopener">/);
  });
  it('without a server, drill-through is shown disabled; actions that need a re-run are not links', async () => {
    const html = await exportHtml(await render(def(), { fontStore }), fontStore);
    expect(links(html).some(h => h.includes('/viewer/'))).toBe(false);
    expect(html).toContain('<g class="pw-off">');
    expect(html).toContain('Opens the report &quot;loan-statement&quot; in the Pagewright viewer'.replace(/&quot;/g, '"'));
    expect(html).not.toContain('data-action');
  });
});
