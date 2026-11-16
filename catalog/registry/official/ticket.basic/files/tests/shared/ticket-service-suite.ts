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

export async function runTicketFlowSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();

  const firstTicket = createTicket(db, tenantA, {
    title: '  Escalate onboarding issue  ',
    description: 'Customer cannot finish setup',
    assigneeId: 'user-tenant-a-admin',
    dueDate: '2026-05-01'
  });
  assert.equal(firstTicket.tenantId, 'tenant-a');
  assert.equal(firstTicket.title, 'Escalate onboarding issue');
  assert.equal(firstTicket.status, 'open');
  assert.equal(firstTicket.dueDate, '2026-05-01');
  assert.equal(firstTicket.createdBy, 'user-tenant-a-admin');
  assert.equal(listTickets(db, tenantB).length, 0);
  assert.throws(() => createTicket(db, tenantA, { title: '   ' }), /Ticket title is required/);
  assert.deepEqual(listTickets(db, tenantA).map(({ id }) => id), [firstTicket.id]);
  const secondTicket = createTicket(db, tenantA, {
    title: 'Prepare renewal checklist',
    assigneeId: 'renewal-owner'
  });
  const otherTenantTicket = createTicket(db, tenantB, {
    title: 'Tenant B support ticket',
    assigneeId: 'user-tenant-b-admin'
  });

  assert.deepEqual(listTickets(db, tenantA).map(({ id }) => id).sort((a, b) => a - b),
    [firstTicket.id, secondTicket.id].sort((a, b) => a - b));
  assert.deepEqual(listTickets(db, tenantB).map(({ id }) => id), [otherTenantTicket.id]);
  assert.deepEqual(listTicketsByAssignee(db, tenantA, 'user-tenant-a-admin').map(({ id }) => id), [firstTicket.id]);
  assert.deepEqual(listTicketsWithFilters(db, tenantA, { status: 'open' }).map(({ id }) => id).sort((a, b) => a - b),
    [firstTicket.id, secondTicket.id].sort((a, b) => a - b));

  const attachment = addTicketAttachment(db, tenantA, {
    ticketId: firstTicket.id,
    fileName: 'evidence.png',
    contentType: 'image/png',
    size: 24,
    contentText: 'base64-placeholder'
  });

  assert.equal(attachment.tenantId, 'tenant-a');
  assert.equal(attachment.ticketId, firstTicket.id);
  assert.equal(attachment.fileName, 'evidence.png');
  assert.equal(attachment.contentType, 'image/png');
  assert.equal(attachment.size, 24);
  assert.equal(attachment.contentText, 'base64-placeholder');
  assert.deepEqual(listTicketAttachments(db, tenantA, firstTicket.id).map(({ fileName, contentText }) => [fileName, contentText]),
    [['evidence.png', 'base64-placeholder']]);
  assert.throws(() => listTicketAttachments(db, tenantB, firstTicket.id), /Ticket is not available/);

  const comment = addTicketComment(db, tenantA, {
    ticketId: firstTicket.id,
    body: 'Customer confirmed the issue is intermittent'
  });

  assert.equal(comment.authorId, 'user-tenant-a-admin');
  assert.equal(comment.ticketId, firstTicket.id);
  assert.equal(comment.body, 'Customer confirmed the issue is intermittent');
  assert.deepEqual(listTicketComments(db, tenantA, firstTicket.id).map(({ body }) => body),
    ['Customer confirmed the issue is intermittent']);
  assert.throws(() => listTicketComments(db, tenantB, firstTicket.id), /Ticket is not available/);
  assert.throws(() => addTicketComment(db, tenantA, { ticketId: firstTicket.id, body: '   ' }), /Ticket comment is required/);

  assert.throws(
    () => transitionTicketStatus(db, tenantA, firstTicket.id, 'closed'),
    /Invalid ticket status transition: open -> closed/
  );
  assert.equal(firstTicket.status, 'open');
  const inProgress = transitionTicketStatus(db, tenantA, firstTicket.id, 'in_progress');
  assert.equal(inProgress.status, 'in_progress');
  assert.deepEqual(listTicketsWithFilters(db, tenantA, { status: 'in_progress' }).map(({ id }) => id), [firstTicket.id]);
  assert.throws(() => transitionTicketStatus(db, tenantB, firstTicket.id, 'closed'), /Ticket is not available/);
  const transitioned = transitionTicketStatus(db, tenantA, firstTicket.id, 'closed');
  assert.equal(transitioned.status, 'closed');
  assert.deepEqual(listTicketsWithFilters(db, tenantA, { status: 'closed' }).map(({ id }) => id), [firstTicket.id]);
  assert.equal(listTickets(db, tenantA).find((candidate) => candidate.id === firstTicket.id)?.status, 'closed');
  assert.equal(listTickets(db, tenantB).some((candidate) => candidate.id === firstTicket.id), false);
}
