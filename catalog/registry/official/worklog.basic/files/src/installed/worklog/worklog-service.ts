import type { Database, WorklogInput, WorklogRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { assertTenantTicket } from '../ticket/ticket-service.ts';
import { currentTenant } from '../tenant/context.ts';

export function recordWorklog(db: Database, session: Session, input: WorklogInput): WorklogRecord {
  const tenantId = currentTenant(session);
  assertTenantTicket(db, input.ticketId, tenantId);
  const minutes = Math.trunc(input.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Worklog minutes must be positive');
  }

  const worklog: WorklogRecord = {
    id: db.nextWorklogId++,
    tenantId,
    ticketId: input.ticketId,
    minutes,
    note: input.note?.trim() ?? '',
    authorId: session.userId,
    createdAt: new Date(0).toISOString()
  };

  db.worklogs.push(worklog);
  return worklog;
}

export function listWorklogs(db: Database, session: Session, ticketId: number): WorklogRecord[] {
  const tenantId = currentTenant(session);
  assertTenantTicket(db, ticketId, tenantId);
  return db.worklogs
    .filter((worklog) => worklog.tenantId === tenantId && worklog.ticketId === ticketId)
    .sort((left, right) => left.id - right.id);
}

export function summarizeWorklogMinutes(db: Database, session: Session, ticketId: number): number {
  return listWorklogs(db, session, ticketId).reduce((total, worklog) => total + worklog.minutes, 0);
}
