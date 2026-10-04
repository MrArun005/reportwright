// Audit events on file storage are appended in groups (storage/file.js): every event lands, once, as one line.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStore } from '../../src/server/storage/file.js';

it('many concurrent audit events land once each, also after the folder is removed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-audit-batch-'));
  try {
    const s = fileStore(root);
    const at = new Date().toISOString();
    await Promise.all(Array.from({ length: 200 }, (_, i) => s.appendAudit({ id: `e${i}`, at, type: 'api.call' })));
    const file = path.join(root, 'data', 'audit', `${at.slice(0, 10)}.jsonl`);
    expect(new Set(fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).id)).size).toBe(200);
    fs.rmSync(path.join(root, 'data', 'audit'), { recursive: true });
    await Promise.all(Array.from({ length: 5 }, (_, i) => s.appendAudit({ id: `f${i}`, at, type: 'api.call' })));
    const lines = fs.readFileSync(path.join(root, 'data', 'audit', `${at.slice(0, 10)}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l).id);
    expect(lines.sort()).toEqual(Array.from({ length: 5 }, (_, i) => `f${i}`).sort());
    expect((await s.queryAudit({ limit: 1000 })).length).toBe(5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
