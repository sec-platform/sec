import assert from 'node:assert/strict';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';
import { exportCustomersToCsv, exportTicketSummaryToCsv, exportTicketsToCsv } from '../../src/installed/export/customer-csv.ts';
import type { TicketRecord } from '../../src/runtime/database.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA } = createTenantRuntimeFixture();
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
    dueDate: '2026-04-20',
    createdBy: tenantA.userId,
    updatedAt: new Date(0).toISOString()
  };

  const customerCsv = exportCustomersToCsv(listCustomers(db, tenantA));
  assert.match(customerCsv, /id,tenantId,name,email,phone,company/);
  assert.match(customerCsv, /tenant-a,Acme,sales@acme\.test,4008009000,Unknown/);

  const ticketCsv = exportTicketsToCsv([ticket]);
  assert.match(ticketCsv, /id,tenantId,title,description,status,assigneeId,dueDate,createdBy,updatedAt/);
  assert.match(ticketCsv, /tenant-a,Escalate onboarding issue,"Customer cannot finish setup, needs ""support""",open,support-owner,2026-04-20/);

  const summaryCsv = exportTicketSummaryToCsv({
    total: 2,
    byStatus: {
      open: 1,
      in_progress: 1,
      closed: 0
    },
    sla: {
      overdue: 1,
      dueSoon: 1,
      unscheduled: 0
    },
    byAssignee: [
      { assigneeId: 'renewal-owner', count: 1 },
      { assigneeId: 'support-owner', count: 1 }
    ]
  });
  assert.match(summaryCsv, /section,key,value/);
  assert.match(summaryCsv, /total,tickets,2/);
  assert.match(summaryCsv, /status,in_progress,1/);
  assert.match(summaryCsv, /sla,overdue,1/);
  assert.match(summaryCsv, /sla,dueSoon,1/);
  assert.match(summaryCsv, /assignee,support-owner,1/);
}
