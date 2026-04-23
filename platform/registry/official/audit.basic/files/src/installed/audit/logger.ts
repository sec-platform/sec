import type { Session } from '../auth/session.ts';

export interface AuditEntry {
  actorId: string;
  tenantId: string;
  action: string;
  entity: string;
  entityId: string;
  occurredAt: string;
}

export function createAuditEntry(session: Session, action: string, entity: string, entityId: string): AuditEntry {
  return {
    actorId: session.userId,
    tenantId: session.tenantId,
    action,
    entity,
    entityId,
    occurredAt: new Date(0).toISOString()
  };
}

export function appendAuditEntry(entries: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  return [...entries, entry];
}
