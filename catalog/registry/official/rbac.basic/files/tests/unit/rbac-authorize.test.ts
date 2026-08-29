import assert from 'node:assert/strict';
import { login } from '../../src/installed/auth/session.ts';
import { assertAdmin, canAccessWorkspace } from '../../src/installed/auth/authorize.ts';

export async function runSuite() {
  const tenantA = login('tenant-a-admin', 'password');
  assert.doesNotThrow(() => assertAdmin(tenantA));

  assert.deepEqual(canAccessWorkspace(tenantA, 'tenant-a'), {
    allowed: true,
    reason: 'allowed'
  });
  assert.deepEqual(canAccessWorkspace(tenantA, 'tenant-b'), {
    allowed: false,
    reason: 'tenant-mismatch'
  });
}
