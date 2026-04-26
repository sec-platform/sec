import type {
  Database,
  TicketAttachmentInput,
  TicketAttachmentRecord,
  TicketCommentInput,
  TicketCommentRecord,
  TicketInput,
  TicketRecord,
  TicketStatus
} from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

export interface TicketFilters {
  assigneeId?: string;
  status?: TicketStatus;
}

function normalizeTicketTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error('Ticket title is required');
  }
  return normalized;
}

function assertTicketTenant(ticket: TicketRecord | undefined, tenantId: string): TicketRecord {
  if (!ticket || ticket.tenantId !== tenantId) {
    throw new Error('Ticket is not available for this tenant');
  }
  return ticket;
}

export function createTicket(db: Database, session: Session, input: TicketInput): TicketRecord {
  const tenantId = currentTenant(session);
  const ticket: TicketRecord = {
    id: db.nextTicketId++,
    tenantId,
    title: normalizeTicketTitle(input.title),
    description: input.description?.trim() ?? '',
    status: input.status ?? 'open',
    assigneeId: input.assigneeId?.trim() || session.userId,
    createdBy: session.userId,
    updatedAt: new Date(0).toISOString()
  };

  db.tickets.push(ticket);
  return ticket;
}

export function transitionTicketStatus(
  db: Database,
  session: Session,
  ticketId: number,
  status: TicketStatus
): TicketRecord {
  const tenantId = currentTenant(session);
  const ticket = assertTicketTenant(db.tickets.find((entry) => entry.id === ticketId), tenantId);
  ticket.status = status;
  ticket.updatedAt = new Date(0).toISOString();
  return ticket;
}

export function listTickets(db: Database, session: Session): TicketRecord[] {
  const tenantId = currentTenant(session);
  return db.tickets.filter((ticket) => ticket.tenantId === tenantId).sort((left, right) => left.id - right.id);
}

export function listTicketsWithFilters(db: Database, session: Session, filters: TicketFilters): TicketRecord[] {
  return listTickets(db, session).filter((ticket) => {
    if (filters.assigneeId && ticket.assigneeId !== filters.assigneeId) {
      return false;
    }
    if (filters.status && ticket.status !== filters.status) {
      return false;
    }
    return true;
  });
}

export function addTicketAttachment(
  db: Database,
  session: Session,
  input: TicketAttachmentInput
): TicketAttachmentRecord {
  const tenantId = currentTenant(session);
  assertTicketTenant(db.tickets.find((entry) => entry.id === input.ticketId), tenantId);

  const attachment: TicketAttachmentRecord = {
    id: db.nextTicketAttachmentId++,
    tenantId,
    ticketId: input.ticketId,
    fileName: input.fileName.trim() || 'attachment',
    contentType: input.contentType || 'application/octet-stream',
    size: input.size,
    contentText: input.contentText,
    createdAt: new Date(0).toISOString()
  };

  db.ticketAttachments.push(attachment);
  return attachment;
}

export function listTicketAttachments(
  db: Database,
  session: Session,
  ticketId: number
): TicketAttachmentRecord[] {
  const tenantId = currentTenant(session);
  assertTicketTenant(db.tickets.find((entry) => entry.id === ticketId), tenantId);
  return db.ticketAttachments
    .filter((attachment) => attachment.tenantId === tenantId && attachment.ticketId === ticketId)
    .sort((left, right) => left.id - right.id);
}

export function addTicketComment(db: Database, session: Session, input: TicketCommentInput): TicketCommentRecord {
  const tenantId = currentTenant(session);
  assertTicketTenant(db.tickets.find((entry) => entry.id === input.ticketId), tenantId);
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
  assertTicketTenant(db.tickets.find((entry) => entry.id === ticketId), tenantId);
  return db.ticketComments
    .filter((comment) => comment.tenantId === tenantId && comment.ticketId === ticketId)
    .sort((left, right) => left.id - right.id);
}

export function listTicketsByAssignee(db: Database, session: Session, assigneeId: string): TicketRecord[] {
  return listTicketsWithFilters(db, session, { assigneeId });
}
