import assert from 'node:assert/strict';
import { createCustomer } from '../../src/installed/entity/customer-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA } = createTenantRuntimeFixture();
  const customer = createCustomer(db, tenantA, {
    name: '  Alice Example  ',
    email: 'Alice@Example.COM ',
    phone: ' 138-0013 8000 ',
    company: ''
  });

  assert.deepEqual(customer, {
    id: 1,
    tenantId: 'tenant-a',
    name: 'Alice Example',
    email: 'alice@example.com',
    phone: '13800138000',
    company: 'Unknown'
  });

  assert.throws(() => createCustomer(db, tenantA, { name: '   ' }), /required/);
  assert.equal(db.customers.length, 1);
}
