import assert from 'node:assert/strict';
import type { CustomerRecord } from '../../src/runtime/database.ts';
import { filterCustomers, listCustomerCompanies } from '../../src/installed/table/customer-filter.ts';

export async function runSuite() {
  const customers: CustomerRecord[] = [
    { id: 1, tenantId: 'tenant-a', name: 'Acme', email: 'sales@acme.test', phone: '1', company: 'Acme' },
    { id: 2, tenantId: 'tenant-a', name: 'Beta', email: 'ops@beta.test', phone: '2', company: 'Beta' }
  ];

  assert.deepEqual(filterCustomers(customers, { search: 'SALE' }).map((customer) => customer.id), [1]);
  assert.deepEqual(filterCustomers(customers, { company: 'Beta' }).map((customer) => customer.id), [2]);
  assert.deepEqual(listCustomerCompanies(customers), ['Acme', 'Beta']);
}
