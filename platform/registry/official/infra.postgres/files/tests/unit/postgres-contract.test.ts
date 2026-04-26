import assert from 'node:assert/strict';
import { listPostgresContractTables, POSTGRES_CONTRACT } from '../../src/installed/infra/postgres-contract.ts';

export async function runSuite() {
  assert.equal(POSTGRES_CONTRACT.provider, 'postgres');
  assert.equal(POSTGRES_CONTRACT.persistenceMode, 'contract-only');
  assert.deepEqual(listPostgresContractTables(), [
    'customers',
    'customer_attachments',
    'email_notifications',
    'audit_entries',
    'tickets'
  ]);
  assert.equal(POSTGRES_CONTRACT.tables.every((table) => table.tenantScoped), true);
}
