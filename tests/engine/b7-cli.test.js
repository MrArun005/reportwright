// B7 #22: the CLI prints each warning once (validate() and the render can name the same problem with different labels).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..', '..');
describe('pw render warnings', () => {
  it('each warning is printed once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b7-'));
    const file = path.join(dir, 'w.pw.json');
    // an expression that does not parse: validate() names it "textbox: ...", the render names it "TextBox: ..." (no name)
    fs.writeFileSync(file, JSON.stringify({ $schema: 'pagewright/report@1', name: 'W', page: { size: 'A4' },
      sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: '=Fields.zz.' }] } } }));
    try {
      const out = execFileSync(process.execPath, [path.join(root, 'bin/pw.mjs'), 'render', file, '-f', 'json', '-o', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const warnings = JSON.parse(out).warnings;
      const keys = warnings.map(w => w.toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.filter(k => k.includes('expected a name after'))).toHaveLength(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
