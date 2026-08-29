import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';

export function createTenantRuntimeFixture() {
  const db = createDatabase();
  return {
    db,
    tenantA: login('tenant-a-admin', 'password'),
    tenantB: login('tenant-b-admin', 'password')
  };
}
