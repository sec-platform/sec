import { addTicketCommentDelegate, listTicketCommentsDelegate } from '../../../custom/ticket_comment_delegate.ts';
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
import { NEXT_TICKET_STATUS } from './ticket-semantic-contract.ts';

export const TICKET_BLOCK_VERSION = '0.1.1';

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

type IdentifiedRecord = { id: number };

type TicketScopedRecord = IdentifiedRecord & {
  tenantId: string;
  ticketId: number;
};

function sortById<TRecord extends IdentifiedRecord>(records: TRecord[]): TRecord[] {
  return records.sort((left, right) => left.id - right.id);
}

export function assertTenantTicket(db: Database, ticketId: number, tenantId: string): TicketRecord {
  const ticket = db.tickets.find((entry) => entry.id === ticketId);
  if (!ticket || ticket.tenantId !== tenantId) {
    throw new Error('Ticket is not available for this tenant');
  }
  return ticket;
}

export function listTenantTickets(db: Database, tenantId: string): TicketRecord[] {
  return sortById(db.tickets.filter((ticket) => ticket.tenantId === tenantId));
}

export function listTicketScopedRecords<TRecord extends TicketScopedRecord>(
  records: TRecord[],
  tenantId: string,
  ticketId: number
): TRecord[] {
  return sortById(records.filter((record) => record.tenantId === tenantId && record.ticketId === ticketId));
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
    dueDate: input.dueDate?.trim() ?? '',
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
  const ticket = assertTenantTicket(db, ticketId, tenantId);
  const expectedStatus = NEXT_TICKET_STATUS[ticket.status];
  if (status !== expectedStatus) {
    throw new Error(`Invalid ticket status transition: ${ticket.status} -> ${status}`);
  }
  ticket.status = status;
  ticket.updatedAt = new Date(0).toISOString();
  return ticket;
}

export function listTickets(db: Database, session: Session): TicketRecord[] {
  const tenantId = currentTenant(session);
  return listTenantTickets(db, tenantId);
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
  assertTenantTicket(db, input.ticketId, tenantId);

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
  assertTenantTicket(db, ticketId, tenantId);
  return listTicketScopedRecords(db.ticketAttachments, tenantId, ticketId);
}

export function addTicketComment(db: Database, session: Session, input: TicketCommentInput): TicketCommentRecord {
  return addTicketCommentDelegate(db, session, input);
}

export function listTicketComments(db: Database, session: Session, ticketId: number): TicketCommentRecord[] {
  return listTicketCommentsDelegate(db, session, ticketId);
}

export function listTicketsByAssignee(db: Database, session: Session, assigneeId: string): TicketRecord[] {
  return listTicketsWithFilters(db, session, { assigneeId });
}
