import assert from 'node:assert/strict';
import { addTicketComment, listTicketComments } from '../../src/installed/comment/comment-service.ts';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();
  const ticket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    assigneeId: 'support-owner'
  });

  const comment = addTicketComment(db, tenantA, {
    ticketId: ticket.id,
    body: 'Customer confirmed the issue is intermittent'
  });

  assert.equal(comment.authorId, 'user-tenant-a-admin');
  assert.equal(comment.body, 'Customer confirmed the issue is intermittent');
  assert.equal(listTicketComments(db, tenantA, ticket.id).length, 1);
  assert.throws(() => listTicketComments(db, tenantB, ticket.id), /Ticket is not available/);
  assert.throws(() => addTicketComment(db, tenantA, { ticketId: ticket.id, body: '   ' }), /Ticket comment is required/);
}
