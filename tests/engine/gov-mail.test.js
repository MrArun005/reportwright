// Batch 5, item 5: scheduled reports by email: attached, or a signed link when large or asked; recipients only in the
// allowed domains, capped; schedules made on the Schedules page run as their (signed-in) owner as they are now.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSmtp } from '../fixtures/mock-smtp.js';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-mail-'));
const saved = {};
let smtp, jobs, schedules, perms;
const def = { $schema: 'reportwright/report@1', name: 'Mailed', page: { size: 'A4', margins: [36, 36, 36, 36] }, parameters: [{ name: 'n', type: 'string' }], dataSources: [], dataSets: [], sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Item {Parameters.n}' }] } } };

beforeAll(async () => {
  smtp = await startSmtp();
  fs.symlinkSync(path.join(cwd, 'public'), path.join(dir, 'public'));
  process.chdir(dir);
  const ENV = { PW_SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, PW_MAIL_FROM: 'Reports <reports@pw.test>', PW_MAIL_ALLOWED_DOMAINS: 'corp.test', PW_BASE_URL: 'https://pw.example', PW_SESSION_SECRET: 'm'.repeat(40), PW_STORAGE: `sqlite:${path.join(dir, 'm.db')}` };
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  jobs = await import('../../src/server/jobs.js');
  schedules = await import('../../src/server/schedules.js');
  perms = await import('../../src/server/perms.js');
});
afterAll(async () => {
  process.chdir(cwd);
  await smtp.close();
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(dir, { recursive: true, force: true });
});
const runAll = async () => { while (await jobs.workOnce('T')); };
const qp = (s) => s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

describe('email delivery', () => {
  it('one item: the file attached, to the allowed recipients', async () => {
    const job = await jobs.createBatch({ template: def, items: [{ name: 'only', parameters: { n: '1' } }], format: 'pdf', email: { to: ['Ann@corp.test', 'bob@corp.test'], subject: 'Monthly\r\nBcc: x@evil.test' } }, null);
    await runAll();
    const m = smtp.messages.at(-1);
    expect(m.to).toEqual(['ann@corp.test', 'bob@corp.test']);
    expect(m.data).toMatch(/^Subject: Monthly Bcc: x@evil\.test$/m);
    expect(m.data).toMatch(/Content-Type: application\/pdf; name=only\.pdf/);
    expect((await jobs.getJob(job.id)).mail).toMatchObject({ status: 'sent', how: 'attached', recipients: 2 });
  });
  it('several items: the zip; too large, or attach: false: a signed download link instead', async () => {
    await jobs.createBatch({ template: def, items: [1, 2].map(n => ({ parameters: { n: String(n) } })), format: 'json', email: { to: 'ann@corp.test' } }, null);
    await runAll();
    expect(smtp.messages.at(-1).data).toMatch(/application\/zip; name=Mailed\.zip/);
    process.env.PW_MAIL_MAX_ATTACHMENT_MB = '0.0001';
    try {
      const job = await jobs.createBatch({ template: def, items: [1, 2].map(n => ({ parameters: { n: String(n) } })), format: 'json', email: { to: ['ann@corp.test'] } }, null);
      await runAll();
      const text = qp(smtp.messages.at(-1).data);
      expect(text).not.toMatch(/application\/zip/);
      expect(text).toMatch(new RegExp(`https://pw\\.example/api/v1/batches/${job.id}/download\\?exp=\\d+&sig=[\\w-]+`));
      expect((await jobs.getJob(job.id)).mail).toMatchObject({ status: 'sent', how: 'link' });
    } finally { delete process.env.PW_MAIL_MAX_ATTACHMENT_MB; }
    await jobs.createBatch({ template: def, items: [{ parameters: { n: '3' } }], format: 'pdf', email: { to: ['ann@corp.test'], attach: false, body: 'Here it is.' } }, null);
    await runAll();
    const t2 = qp(smtp.messages.at(-1).data);
    expect(t2).toMatch(/^Here it is\./m);
    expect(t2).toMatch(/\/download\?exp=/);
  });
  it('refuses other domains, too many recipients and bad addresses when the batch or schedule is made', async () => {
    const mk = (to) => jobs.createBatch({ template: def, items: [{ parameters: {} }], email: { to } }, null);
    await expect(mk(['eve@evil.test'])).rejects.toMatchObject({ status: 403 });
    await expect(mk(['a@sub.corp.test'])).rejects.toMatchObject({ status: 403 });
    await expect(mk(['a@corp.test\r\nBcc: e@evil.test'])).rejects.toMatchObject({ status: 400 });
    await expect(mk(Array.from({ length: 21 }, (_, i) => `u${i}@corp.test`))).rejects.toThrow(/At most 20/);
    await expect(schedules.createSchedule({ template: def, cron: '0 7 * * *', items: [{ parameters: {} }], email: { to: ['eve@evil.test'] } })).rejects.toMatchObject({ status: 403 });
    const url = process.env.PW_SMTP_URL; delete process.env.PW_SMTP_URL;
    try { await expect(mk(['a@corp.test'])).rejects.toThrow(/not set up/); } finally { process.env.PW_SMTP_URL = url; }
  });
  it('a schedule mails on its run', async () => {
    const s = await schedules.createSchedule({ template: def, cron: '0 7 * * *', items: [{ name: 'daily', parameters: { n: 'd' } }], format: 'pdf', email: { to: ['ann@corp.test'] } });
    await schedules.runSchedule(s);
    await runAll();
    expect(smtp.messages.at(-1).data).toMatch(/name=daily\.pdf/);
  });
});

describe('schedules made on the Schedules page', () => {
  it('run as their owner as they are now; a body cannot claim it', async () => {
    process.env.PW_AUTH = 'users';
    try {
      const users = await import('../../src/server/users.js');
      await users.createUser({ email: 'dee@corp.test', role: 'designer', password: 'designer pass 1' });
      expect(await perms.principalFromId('user:dee@corp.test', null)).toEqual(perms.NOBODY); // keyless, not from a session
      const since = (await users.getUser('dee@corp.test')).createdAt;
      const as = () => perms.principalFromId('user:dee@corp.test', null, { session: true, since });
      expect((await as()).email).toBe('dee@corp.test');
      expect(await perms.principalFromId('user:dee@corp.test', null, { session: true })).toEqual(perms.NOBODY); // no account stamp
      expect((await perms.principalFromId('user:dee@corp.test', null, { session: true, madeAt: new Date(Date.now() + 1000).toISOString() })).email).toBe('dee@corp.test'); // an older record, made after the account
      expect(await perms.principalFromId('user:dee@corp.test', null, { session: true, madeAt: '2000-01-01T00:00:00.000Z' })).toEqual(perms.NOBODY); // made before this account existed
      await users.updateUser('dee@corp.test', { role: 'viewer' });
      expect(await as()).toEqual(perms.NOBODY); // no longer a designer: the schedule stops
      await users.updateUser('dee@corp.test', { role: 'designer', disabled: true });
      expect(await as()).toEqual(perms.NOBODY);
      await users.deleteUser('dee@corp.test');
      await new Promise(r => setTimeout(r, 5));
      await users.createUser({ email: 'dee@corp.test', role: 'designer', password: 'another person 1' });
      expect(await as()).toEqual(perms.NOBODY); // a new account with the same email is someone else
      const s = await schedules.createSchedule({ template: def, cron: '0 7 * * *', items: [{ parameters: {} }], ownerSession: true }, { kind: 'service', key: undefined });
      const { store } = await import('../../src/server/storage/index.js');
      expect(JSON.parse(await store().get('schedules', s.id)).ownerSession).toBe(false);
    } finally { delete process.env.PW_AUTH; }
  });
});
