// Docs that ship in the npm packages must not claim what the repository cannot yet prove (B7 docs drift).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PUBLIC_DOCS = [
  ...fs.readdirSync(path.join(ROOT, 'packages')).map(p => `packages/${p}/README.md`),
  'docs/RELEASING.md', 'SECURITY.md', 'README.md',
];

describe('package docs', () => {
  it('claim no npm provenance until the repository is public (N11)', () => {
    for (const f of PUBLIC_DOCS) {
      expect({ file: f, provenance: /provenance/i.test(read(f)) && /shields\.io\/badge\/npm-provenance/.test(read(f)) }).toEqual({ file: f, provenance: false });
    }
  });
});
