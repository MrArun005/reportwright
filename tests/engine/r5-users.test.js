// R5 #11: an admin cannot disable, demote or delete their own account (the last admin was already kept).
import { it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let users;
beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r5u-'));
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r'.repeat(40), PW_STORAGE: `sqlite:${path.join(tmp, 'u.db')}` });
  users = await import('../../src/server/users.js');
  await users.createUser({ email: 'a1@x.test', role: 'admin', password: 'first admin pw 1' });
  await users.createUser({ email: 'a2@x.test', role: 'admin', password: 'second admin pw 2' });
});

it('own account: no disable, demote or delete; another admin can', async () => {
  const me = { email: 'a1@x.test' };
  await expect(users.updateUser('a1@x.test', { disabled: true }, { by: me })).rejects.toMatchObject({ status: 409 });
  await expect(users.updateUser('a1@x.test', { role: 'designer' }, { by: me })).rejects.toMatchObject({ status: 409 });
  await expect(users.deleteUser('a1@x.test', { by: me })).rejects.toMatchObject({ status: 409 });
  expect((await users.updateUser('a1@x.test', { groups: ['g'] }, { by: me })).groups).toEqual(['g']); // other changes are fine
  expect((await users.updateUser('a1@x.test', { disabled: true }, { by: { email: 'a2@x.test' } })).disabled).toBe(true);
  // a2 is now the last active admin: it cannot be disabled by anyone
  await expect(users.updateUser('a2@x.test', { disabled: true })).rejects.toMatchObject({ status: 409 });
});
