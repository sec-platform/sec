import assert from 'node:assert/strict';

import { login } from '../../src/installed/auth/session.ts';

export async function runSuite() {
  const session = login('tenant-a-admin', 'password');
  assert.deepEqual(session, {
    userId: 'user-tenant-a-admin',
    username: 'tenant-a-admin',
    tenantId: 'tenant-a',
    role: 'admin'
  });
  assert.throws(() => login('tenant-a-admin', 'wrong'), /Invalid credentials/);
  assert.throws(() => login('missing-user', 'password'), /Invalid credentials/);
}
