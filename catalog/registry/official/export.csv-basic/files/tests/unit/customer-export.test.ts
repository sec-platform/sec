import assert from 'node:assert/strict';
import { createCustomer, listCustomers } from '../../src/installed/entity/customer-service.ts';
import { exportCustomersToCsv, exportTicketSummaryToCsv, exportTicketsToCsv } from '../../src/installed/export/customer-csv.ts';
import type { TicketRecord } from '../../src/runtime/database.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

// These fixed records contain no embedded newlines; accept either CSV record
// terminator and an optional final terminator without weakening field boundaries.
function csvLines(csv: string): string[] {
  return csv.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n');
}

export async function runSuite() {
  const { db, tenantA } = createTenantRuntimeFixture();
  const customer = createCustomer(db, tenantA, {
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
  assert.deepEqual(csvLines(customerCsv), [
    'id,tenantId,name,email,phone,company',
    `${customer.id},tenant-a,Acme,sales@acme.test,4008009000,Unknown`
  ]);

  const ticketCsv = exportTicketsToCsv([ticket]);
  assert.deepEqual(csvLines(ticketCsv), [
    'id,tenantId,title,description,status,assigneeId,dueDate,createdBy,updatedAt',
    '1,tenant-a,Escalate onboarding issue,"Customer cannot finish setup, needs ""support""",open,support-owner,2026-04-20,user-tenant-a-admin,1970-01-01T00:00:00.000Z'
  ]);

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
  const [header, ...summaryRows] = csvLines(summaryCsv);
  assert.equal(header, 'section,key,value');
  assert.deepEqual(summaryRows.sort(), [
    'total,tickets,2',
    'status,open,1',
    'status,in_progress,1',
    'status,closed,0',
    'sla,overdue,1',
    'sla,dueSoon,1',
    'sla,unscheduled,0',
    'assignee,renewal-owner,1',
    'assignee,support-owner,1'
  ].sort());
}
