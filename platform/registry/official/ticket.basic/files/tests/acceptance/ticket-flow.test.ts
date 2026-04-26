import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import {
  createTicket,
  listTickets,
  listTicketsByAssignee,
  transitionTicketStatus
} from '../../src/installed/ticket/ticket-service.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  const tenantB = login('tenant-b-admin', 'password');

  const firstTicket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    description: 'Customer cannot finish setup',
    assigneeId: 'user-tenant-a-admin'
  });
  createTicket(db, tenantA, {
    title: 'Prepare renewal checklist',
    assigneeId: 'renewal-owner'
  });
  createTicket(db, tenantB, {
    title: 'Tenant B support ticket',
    assigneeId: 'user-tenant-b-admin'
  });

  assert.equal(listTickets(db, tenantA).length, 2);
  assert.equal(listTickets(db, tenantB).length, 1);
  assert.equal(listTicketsByAssignee(db, tenantA, 'user-tenant-a-admin').length, 1);

  const transitioned = transitionTicketStatus(db, tenantA, firstTicket.id, 'closed');
  assert.equal(transitioned.status, 'closed');
  assert.equal(listTickets(db, tenantA).find((ticket) => ticket.id === firstTicket.id)?.status, 'closed');
  assert.equal(listTickets(db, tenantB).some((ticket) => ticket.id === firstTicket.id), false);
}
