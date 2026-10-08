// Typed render() options and sort entries. Checked by tests/engine/b6g-types.test.js with skipLibCheck: false:
// every @ts-expect-error line must be an error, and every other line must compile.
import { render } from '@reportwright/engine';
import type { RenderOptions } from '@reportwright/engine';
import type { Report, SortSpec, TableCell } from '../../../packages/engine/report.js';

const opts: RenderOptions = {
  parameters: { year: 2026 },
  timeoutMs: 5000,
  unsafeFetch: false,
  allowHosts: ['intranet.example'],
  exportData: true,
  target: 'print',
  firstPages: 2,
};
const sorted: SortSpec[] = [{ by: '=Fields.name', dir: 'desc' }, { by: '=Fields.city' }];
const cell: TableCell = { value: 'Name', sortBy: '=Fields.name' };
export const run = (def: Report) => render(def, opts);

// @ts-expect-error timeoutMs is spelled wrong
const misspelt: RenderOptions = { timeoutMS: 5 };
// @ts-expect-error the target is one of screen, print, export
const badTarget: RenderOptions = { target: 'web' };
// @ts-expect-error a sort direction is asc or desc
const badDir: SortSpec = { by: '=Fields.name', dir: 'up' };
// @ts-expect-error a sort entry has a by
const noBy: SortSpec = { dir: 'asc' };
// @ts-expect-error a sort entry has only by and dir
const extra: SortSpec = { by: '=Fields.name', expr: '=Fields.name' };
// @ts-expect-error fontStore is a FontStore, not a string
const badFont: RenderOptions = { fontStore: 'Inter' };
export { sorted, cell, misspelt, badTarget, badDir, noBy, extra, badFont };
