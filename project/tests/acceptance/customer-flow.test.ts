import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  const created = createCustomer(db, tenantA, {
    name: ' Acme ',
    email: 'Sales@Acme.test ',
    phone: ' 400-800 9000 ',
    company: ''
  });

  assert.equal(created.tenantId, 'tenant-a');
  assert.equal(created.email, 'sales@acme.test');
  assert.equal(created.company, 'Unknown');

  const tenantACustomers = listCustomers(db, tenantA);
  assert.equal(tenantACustomers.length, 1);
  assert.equal(tenantACustomers[0].name, 'Acme');

  const tenantB = login('tenant-b-admin', 'password');
  const tenantBCustomers = listCustomers(db, tenantB);
  assert.equal(tenantBCustomers.length, 0);
}
