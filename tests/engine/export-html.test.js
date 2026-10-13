// HTML export, batch 2: the Tables view (sort on interactive-sort columns, open/close groups, filter) from data in
// the file, one inline script allowed by the file's own CSP hash; static: true is the old file exactly.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { render } from '../../src/engine/index.js';
import { exportHtml } from '../../src/exporters/html.js';
import { tablesData, DATA_SCRIPT } from '../../src/exporters/htmldata.js';
import { def, fontStore } from './export-fixture.js';

const sorted = () => {
  const d = def();
  const t = d.sections.body.items.find(i => i.type === 'table');
  t.header[0].cells[1].sortBy = '=Fields.amt';
  return d;
};

describe('HTML export: Tables view', () => {
  it('embeds the tables, their sortable columns and formatted values', async () => {
    const m = await render(sorted(), { exportData: true, fontStore });
    const data = tablesData(m, { locale: 'en-IN' });
    expect(data[0].name).toBe('Sales');
    expect(data[0].sort).toEqual([1]);
    const delhi = data[0].rows.find(r => r.c.some(c => c[1] === 'Delhi'));
    expect(delhi.c.find(c => c[0] === 1).slice(1, 3)).toEqual(['130.00', 130]);
  });
  it('the script runs under the file\'s own CSP (its hash), data cannot close the script tag, no inline handlers', async () => {
    const m = await render(sorted(), { exportData: true, fontStore });
    m.regions[0].rows[1].cells[0].value = '</script><script>alert(1)</script>';
    const html = await exportHtml(m, { fonts: fontStore, title: 'T' });
    const hash = crypto.createHash('sha256').update(DATA_SCRIPT).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain(`<script>${DATA_SCRIPT}</script>`);
    expect(html.match(/<script/g).length).toBe(2); // the data (JSON) and the script
    expect(html).not.toMatch(/ on[a-z]+="/);
    expect(html).toContain('\\u003c/script>');
  });
  it('static: true leaves the view out', async () => {
    const m = await render(sorted(), { exportData: true, fontStore });
    const html = await exportHtml(m, { fonts: fontStore, title: 'T', static: true });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('Content-Security-Policy');
  });
});
