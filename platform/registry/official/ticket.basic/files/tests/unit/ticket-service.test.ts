import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import {
  addTicketAttachment,
  addTicketComment,
  createTicket,
  listTicketAttachments,
  listTicketComments,
  listTickets,
  listTicketsByAssignee,
  listTicketsWithFilters,
  transitionTicketStatus
} from '../../src/installed/ticket/ticket-service.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  const tenantB = login('tenant-b-admin', 'password');

  const ticket = createTicket(db, tenantA, {
    title: '  Investigate invoice sync  ',
    description: 'Webhook failed',
    assigneeId: 'user-tenant-a-admin'
  });

  assert.equal(ticket.tenantId, 'tenant-a');
  assert.equal(ticket.title, 'Investigate invoice sync');
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.createdBy, 'user-tenant-a-admin');
  assert.equal(listTickets(db, tenantA).length, 1);
  assert.equal(listTicketsByAssignee(db, tenantA, 'user-tenant-a-admin').length, 1);
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'open' }).length, 1);

  const attachment = addTicketAttachment(db, tenantA, {
    ticketId: ticket.id,
    fileName: 'incident.txt',
    contentType: 'text/plain',
    size: 12,
    contentText: 'triage notes'
  });

  assert.equal(attachment.tenantId, 'tenant-a');
  assert.equal(listTicketAttachments(db, tenantA, ticket.id).length, 1);
  assert.throws(() => listTicketAttachments(db, tenantB, ticket.id), /Ticket is not available/);

  const comment = addTicketComment(db, tenantA, {
    ticketId: ticket.id,
    body: 'Customer is waiting for an update'
  });

  assert.equal(comment.authorId, 'user-tenant-a-admin');
  assert.equal(listTicketComments(db, tenantA, ticket.id).length, 1);
  assert.throws(() => listTicketComments(db, tenantB, ticket.id), /Ticket is not available/);
  assert.throws(() => addTicketComment(db, tenantA, { ticketId: ticket.id, body: '   ' }), /Ticket comment is required/);

  const transitioned = transitionTicketStatus(db, tenantA, ticket.id, 'in_progress');
  assert.equal(transitioned.status, 'in_progress');
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'in_progress' }).length, 1);
  assert.equal(listTickets(db, tenantB).length, 0);
  assert.throws(() => transitionTicketStatus(db, tenantB, ticket.id, 'closed'), /Ticket is not available/);
  assert.throws(() => createTicket(db, tenantA, { title: '   ' }), /Ticket title is required/);
}
