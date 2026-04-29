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

  const transitioned = transitionTicketStatus(db, tenantA, firstTicket.id, 'closed');
  assert.equal(transitioned.status, 'closed');
  assert.equal(listTicketsWithFilters(db, tenantA, { status: 'closed' }).length, 1);
  assert.equal(listTickets(db, tenantA).find((ticket) => ticket.id === firstTicket.id)?.status, 'closed');
  assert.equal(listTickets(db, tenantB).some((ticket) => ticket.id === firstTicket.id), false);
}
