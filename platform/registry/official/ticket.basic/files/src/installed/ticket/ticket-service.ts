import type { Database, TicketInput, TicketRecord, TicketStatus } from '../../runtime/database.ts';
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

export function listTicketsByAssignee(db: Database, session: Session, assigneeId: string): TicketRecord[] {
  return listTicketsWithFilters(db, session, { assigneeId });
}
