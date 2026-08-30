import assert from 'node:assert/strict';
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
import { createTenantRuntimeFixture } from './tenant-runtime-fixture.ts';

export async function runTicketServiceSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();

  const ticket = createTicket(db, tenantA, {
    title: '  Investigate invoice sync  ',
    description: 'Webhook failed',
    assigneeId: 'user-tenant-a-admin',
    dueDate: '2026-05-01'
  });

  assert.equal(ticket.tenantId, 'tenant-a');
  assert.equal(ticket.title, 'Investigate invoice sync');
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.dueDate, '2026-05-01');
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

  assert.throws(
    () => transitionTicketStatus(db, tenantA, ticket.id, 'closed'),
    /Invalid ticket status transition: open -> closed/
  );
  assert.equal(ticket.status, 'open');
  const transitioned = transitionTicketStatus(db, tenantA, ticket.id, 'in_progress');
  assert.equal(transitioned.status, 'in_progress');
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'in_progress' }).length, 1);
  assert.equal(listTickets(db, tenantB).length, 0);
  assert.throws(() => transitionTicketStatus(db, tenantB, ticket.id, 'closed'), /Ticket is not available/);
  assert.throws(() => createTicket(db, tenantA, { title: '   ' }), /Ticket title is required/);
}

export async function runTicketFlowSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();

  const firstTicket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    description: 'Customer cannot finish setup',
    assigneeId: 'user-tenant-a-admin',
    dueDate: '2026-05-01'
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
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'open' }).length, 2);

  const attachment = addTicketAttachment(db, tenantA, {
    ticketId: firstTicket.id,
    fileName: 'evidence.png',
    contentType: 'image/png',
    size: 24,
    contentText: 'base64-placeholder'
  });

  assert.equal(attachment.fileName, 'evidence.png');
  assert.equal(listTicketAttachments(db, tenantA, firstTicket.id).length, 1);
  assert.throws(() => listTicketAttachments(db, tenantB, firstTicket.id), /Ticket is not available/);

  const comment = addTicketComment(db, tenantA, {
    ticketId: firstTicket.id,
    body: 'Customer confirmed the issue is intermittent'
  });

  assert.equal(comment.authorId, 'user-tenant-a-admin');
  assert.equal(listTicketComments(db, tenantA, firstTicket.id).length, 1);
  assert.throws(() => listTicketComments(db, tenantB, firstTicket.id), /Ticket is not available/);

  assert.throws(
    () => transitionTicketStatus(db, tenantA, firstTicket.id, 'closed'),
    /Invalid ticket status transition: open -> closed/
  );
  assert.equal(firstTicket.status, 'open');
  transitionTicketStatus(db, tenantA, firstTicket.id, 'in_progress');
  const transitioned = transitionTicketStatus(db, tenantA, firstTicket.id, 'closed');
  assert.equal(transitioned.status, 'closed');
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'closed' }).length, 1);
  assert.equal(listTickets(db, tenantA).find((candidate) => candidate.id === firstTicket.id)?.status, 'closed');
  assert.equal(listTickets(db, tenantB).some((candidate) => candidate.id === firstTicket.id), false);
}
