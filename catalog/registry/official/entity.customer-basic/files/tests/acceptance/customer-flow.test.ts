import assert from 'node:assert/strict';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();
  const created = createCustomer(db, tenantA, {
    name: ' Acme ',
    email: 'Sales@Acme.test ',
    phone: ' 400-800 9000 ',
    company: ''
  });

  assert.deepEqual(created, {
    id: 1,
    tenantId: 'tenant-a',
    name: 'Acme',
    email: 'sales@acme.test',
    phone: '4008009000',
    company: 'Unknown'
  });
  assert.throws(() => createCustomer(db, tenantA, { name: '   ' }), /required/);
  assert.equal(db.customers.length, 1);

  const tenantACustomers = listCustomers(db, tenantA);
  assert.equal(tenantACustomers.length, 1);
  assert.equal(tenantACustomers[0].name, 'Acme');

  const tenantBCustomers = listCustomers(db, tenantB);
  assert.equal(tenantBCustomers.length, 0);
}
