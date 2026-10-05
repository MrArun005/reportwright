// Batch 5, item 9: the report list counts the items in a body section's own page header and footer too.
import { it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listReports, writeReport } from '../../src/server/reports.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-items-'));
const home = process.cwd();
afterAll(() => { process.chdir(home); fs.rmSync(tmp, { recursive: true, force: true }); });

it('counts items in each section, its own header and footer, and nested containers', async () => {
  process.chdir(tmp);
  const t = () => ({ type: 'text' });
  await writeReport('sections', {
    name: 'S',
    sections: {
      pageHeader: { height: 20, items: [t()] },
      body: [
        { items: [t(), { type: 'container', items: [t(), t()] }], pageHeader: { height: 20, items: [t(), t()] }, pageFooter: { height: 20, items: [t()] } },
        { items: [t()], pageFooter: { height: 10, items: [{ type: 'container', items: [t()] }] } },
      ],
      pageFooter: { height: 20, items: [t()] },
    },
  });
  const [r] = await listReports();
  // shared header 1 + footer 1; section 1: body 4, own header 2, own footer 1; section 2: body 1, own footer 2
  expect(r.items).toBe(12);
});
