import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';
import { exportCustomersToCsv } from '../../src/installed/export/customer-csv.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  createCustomer(db, tenantA, {
    name: ' Acme ',
    email: 'Sales@Acme.test ',
    phone: ' 400-800 9000 ',
    company: ''
  });

  const csv = exportCustomersToCsv(listCustomers(db, tenantA));
  assert.match(csv, /id,tenantId,name,email,phone,company/);
  assert.match(csv, /tenant-a,Acme,sales@acme\.test,4008009000,Unknown/);
}
