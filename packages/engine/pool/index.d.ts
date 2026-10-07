// @reportwright/engine/pool (Node only): render many reports in parallel on worker threads.
import type { Report } from '../report.js';
export interface PoolRenderOptions {
  /** default pdf */
  format?: 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'csv' | 'html';
  parameters?: Record<string, unknown>;
  timeZone?: string;
  timeoutMs?: number;
  /** passed to the exporter: exportPdf's title, pdfa, … */
  options?: Record<string, unknown>;
}
export interface Pool {
  /** the file's bytes */
  render(definition: Report | object, opts?: PoolRenderOptions): Promise<Uint8Array>;
  /** stops the workers; renders still waiting are rejected */
  close(): Promise<void>;
  readonly size: number;
  /** renders waiting or running */
  readonly pending: number;
}
/** workers: default the CPU count less one. fontsDir: a folder of the fonts (default @reportwright/fonts).
 *  heapMB: each worker's heap limit (default 1024). timeoutMs: stop a render past it with status 504 (default 0: no limit). */
export function createPool(opt?: { workers?: number; fontsDir?: string; maxQueue?: number; heapMB?: number; timeoutMs?: number }): Pool;
