// pw compare's external tools (poppler's pdftotext and pdftoppm), async with a timeout and an output cap: the server's
// event loop never waits on them. Under src/server so the npm CLI (no child processes) gets a stub and compares in
// pure JS (scripts/build-packages.mjs).
import { execFile } from 'node:child_process';

/** @param {string} cmd @param {string[]} args @param {{ timeout: number, maxBuffer: number }} o @returns {Promise<Buffer | null>} null: failed, timed out or too large */
export const run = (cmd, args, o) =>
  new Promise((ok) => {
    execFile(
      cmd,
      args,
      { encoding: 'buffer', timeout: Math.max(1, o.timeout), maxBuffer: o.maxBuffer, killSignal: 'SIGKILL' },
      (e, out) => ok(e ? null : out),
    );
  });
const seen = new Map();
/** @param {string} tool */
export const has = async (tool) => {
  if (!seen.has(tool))
    seen.set(
      tool,
      await new Promise((ok) => execFile(tool, ['-v'], { timeout: 5000 }, (e) => ok(!e || e.code !== 'ENOENT'))),
    );
  return seen.get(tool);
};
