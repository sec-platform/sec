import assert from 'node:assert/strict';
import { createDatabase, type TicketRecord } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';
import { exportCustomersToCsv, exportTicketsToCsv } from '../../src/installed/export/customer-csv.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  createCustomer(db, tenantA, {
    name: ' Acme ',
    email: 'Sales@Acme.test ',
    phone: ' 400-800 9000 ',
    company: ''
  });
  const ticket: TicketRecord = {
    id: 1,
    tenantId: tenantA.tenantId,
    title: 'Escalate onboarding issue',
    description: 'Customer cannot finish setup, needs "support"',
    status: 'open',
    assigneeId: 'support-owner',
    createdBy: tenantA.userId,
    updatedAt: new Date(0).toISOString()
  };

  const customerCsv = exportCustomersToCsv(listCustomers(db, tenantA));
  assert.match(customerCsv, /id,tenantId,name,email,phone,company/);
  assert.match(customerCsv, /tenant-a,Acme,sales@acme\.test,4008009000,Unknown/);

  const ticketCsv = exportTicketsToCsv([ticket]);
  assert.match(ticketCsv, /id,tenantId,title,description,status,assigneeId,createdBy,updatedAt/);
  assert.match(ticketCsv, /tenant-a,Escalate onboarding issue,"Customer cannot finish setup, needs ""support""",open,support-owner/);
}
