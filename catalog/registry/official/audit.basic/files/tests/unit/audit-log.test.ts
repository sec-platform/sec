import assert from 'node:assert/strict';
import { login } from '../../src/installed/auth/session.ts';
import { appendAuditEntry, createAuditEntry } from '../../src/installed/audit/logger.ts';

export async function runSuite() {
  const tenantA = login('tenant-a-admin', 'password');
  const entry = createAuditEntry(tenantA, 'customer.created', 'customer', 'customer-1');
  assert.equal(entry.actorId, 'user-tenant-a-admin');
  assert.equal(entry.tenantId, 'tenant-a');
  assert.equal(entry.occurredAt, '1970-01-01T00:00:00.000Z');

  const entries = appendAuditEntry([], entry);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], entry);
}
