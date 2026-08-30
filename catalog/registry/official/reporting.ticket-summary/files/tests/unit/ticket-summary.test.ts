import assert from 'node:assert/strict';
import { summarizeTickets } from '../../src/installed/reporting/ticket-summary.ts';
import { createTicket, listTickets, transitionTicketStatus } from '../../src/installed/ticket/ticket-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();

  const first = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    assigneeId: 'support-owner',
    dueDate: '2026-04-20'
  });
  createTicket(db, tenantA, {
    title: 'Prepare renewal checklist',
    assigneeId: 'renewal-owner',
    dueDate: '2026-05-01'
  });
  createTicket(db, tenantB, {
    title: 'Tenant B support ticket',
    assigneeId: 'support-owner'
  });
  transitionTicketStatus(db, tenantA, first.id, 'in_progress');

  const summary = summarizeTickets(listTickets(db, tenantA));
  assert.equal(summary.total, 2);
  assert.equal(summary.byStatus.open, 1);
  assert.equal(summary.byStatus.in_progress, 1);
  assert.equal(summary.byStatus.closed, 0);
  assert.deepEqual(summary.sla, {
    overdue: 1,
    dueSoon: 1,
    unscheduled: 0
  });
  assert.deepEqual(summary.byAssignee, [
    { assigneeId: 'renewal-owner', count: 1 },
    { assigneeId: 'support-owner', count: 1 }
  ]);
}
