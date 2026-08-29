import assert from 'node:assert/strict';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { addTicketComment, listTicketComments } from '../../src/installed/comment/comment-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();
  const ticket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    assigneeId: 'support-owner'
  });

  addTicketComment(db, tenantA, {
    ticketId: ticket.id,
    body: 'Initial comment'
  });
  addTicketComment(db, tenantA, {
    ticketId: ticket.id,
    body: 'Second comment'
  });

  assert.deepEqual(
    listTicketComments(db, tenantA, ticket.id).map((comment) => comment.body),
    ['Initial comment', 'Second comment']
  );
  assert.throws(() => listTicketComments(db, tenantB, ticket.id), /Ticket is not available/);
}
