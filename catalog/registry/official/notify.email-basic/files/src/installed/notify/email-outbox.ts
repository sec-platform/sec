import type { CustomerRecord, Database, EmailNotificationRecord, TicketRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

function recordEntityEmail(
  db: Database,
  session: Session,
  input: {
    entity: string;
    entityId: string;
    eventType: string;
    subject: string;
    body: string;
  }
): EmailNotificationRecord {
  const tenantId = currentTenant(session);
  const notification: EmailNotificationRecord = {
    id: db.nextEmailNotificationId++,
    tenantId,
    entity: input.entity,
    entityId: input.entityId,
    eventType: input.eventType,
    recipient: `${tenantId}-admin@example.test`,
    subject: input.subject,
    body: input.body,
    createdAt: new Date(0).toISOString()
  };

  db.emailNotifications.push(notification);
  return notification;
}

export function recordCustomerCreatedEmail(
  db: Database,
  session: Session,
  customer: CustomerRecord
): EmailNotificationRecord {
  const tenantId = currentTenant(session);
  if (customer.tenantId !== tenantId) {
    throw new Error('Cannot notify for a customer outside the current tenant');
  }

  return recordEntityEmail(db, session, {
    entity: 'customer',
    entityId: String(customer.id),
    eventType: 'customer.created',
    subject: `Customer created: ${customer.name}`,
    body: `Customer ${customer.name} was created for tenant ${tenantId}.`
  });
}

export function recordTicketCreatedEmail(db: Database, session: Session, ticket: TicketRecord): EmailNotificationRecord {
  const tenantId = currentTenant(session);
  if (ticket.tenantId !== tenantId) {
    throw new Error('Cannot notify for a ticket outside the current tenant');
  }

  return recordEntityEmail(db, session, {
    entity: 'ticket',
    entityId: String(ticket.id),
    eventType: 'ticket.created',
    subject: `Ticket created: ${ticket.title}`,
    body: `Ticket ${ticket.title} was created for tenant ${tenantId}.`
  });
}

export function listEmailNotifications(db: Database, session: Session): EmailNotificationRecord[] {
  const tenantId = currentTenant(session);
  return db.emailNotifications
    .filter((notification) => notification.tenantId === tenantId)
    .sort((left, right) => left.id - right.id);
}
