import type { Database, TicketCommentInput, TicketCommentRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';
import { assertTenantTicket } from '../ticket/ticket-service.ts';

export function addTicketComment(db: Database, session: Session, input: TicketCommentInput): TicketCommentRecord {
  const tenantId = currentTenant(session);
  assertTenantTicket(db, input.ticketId, tenantId);
  const body = input.body.trim();
  if (!body) {
    throw new Error('Ticket comment is required');
  }

  const comment: TicketCommentRecord = {
    id: db.nextTicketCommentId++,
    tenantId,
    ticketId: input.ticketId,
    body,
    authorId: session.userId,
    createdAt: new Date(0).toISOString()
  };

  db.ticketComments.push(comment);
  return comment;
}

export function listTicketComments(db: Database, session: Session, ticketId: number): TicketCommentRecord[] {
  const tenantId = currentTenant(session);
  assertTenantTicket(db, ticketId, tenantId);
  return db.ticketComments
    .filter((comment) => comment.tenantId === tenantId && comment.ticketId === ticketId)
    .sort((left, right) => left.id - right.id);
}
