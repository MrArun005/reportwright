// scripts/scan-packages.mjs: the Socket-style checks catch what they say they catch.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDir } from '../../scripts/scan-packages.mjs';

const pkg = (files, manifest = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-scan-t-'));
  const base = { name: 'x', version: '1.0.0', license: 'MIT', repository: { type: 'git', url: 'git+https://example.com/x.git' } };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...base, ...manifest }));
  for (const [f, s] of Object.entries({ 'README.md': '# x', LICENSE: 'MIT', ...files })) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); }
  return dir;
};

describe('scan-packages', () => {
  it('a clean package passes', () => {
    expect(scanDir(pkg({ 'index.js': 'export const a = 1;\n' }), 'react').problems).toEqual([]);
  });

  it('flags install scripts, eval, new Function, child_process, long lines and unpinned dependencies', () => {
    const dir = pkg({ 'a.js': "eval('1');\nconst f = new Function('return 1');\nimport cp from 'node:child_process';\n", 'b.css': `a{b:${'x'.repeat(1001)}}`, 'b.js.map': 'x'.repeat(5000) },
      { scripts: { postinstall: 'node x.js' }, dependencies: { a: '^1.0.0', b: '1.2.3' } });
    const p = scanDir(dir, 'engine').problems.join('\n');
    for (const re of [/install script: postinstall/, /eval\/new Function: a\.js:1/, /eval\/new Function: a\.js:2/, /child_process: a\.js:3/, /line over 1000: b\.css:1/, /unpinned: a@\^1\.0\.0/]) expect(p).toMatch(re);
    expect(p).not.toMatch(/b\.js\.map|unpinned: b/); // a source map is one line by design; 1.2.3 is pinned
    expect(p).not.toMatch(/evaluate|\.eval\(/);
  });

  it('flags a missing repository, licence or README', () => {
    const dir = pkg({ 'index.js': '' }, { repository: undefined, license: undefined });
    fs.rmSync(path.join(dir, 'README.md')); fs.rmSync(path.join(dir, 'LICENSE'));
    expect(scanDir(dir, 'react').problems).toEqual(['missing: repository', 'missing: license', 'missing: licence file', 'missing: README']);
  });

  it('network and environment use fail outside engine, cli and viewer (fonts-cjk may download)', () => {
    const files = { 'index.js': "const r = await fetch('https://x');\nconst k = process.env.HOME;\n" };
    expect(scanDir(pkg(files), 'react').problems).toEqual(['network: index.js:1', 'env: index.js:2']);
    expect(scanDir(pkg(files), 'fonts-cjk').problems).toEqual(['env: index.js:2']);
    expect(scanDir(pkg(files), 'engine').problems).toEqual([]);
  });
});
