import type { CustomerRecord, Database, EmailNotificationRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

export function recordCustomerCreatedEmail(
  db: Database,
  session: Session,
  customer: CustomerRecord
): EmailNotificationRecord {
  const tenantId = currentTenant(session);
  if (customer.tenantId !== tenantId) {
    throw new Error('Cannot notify for a customer outside the current tenant');
  }

  const notification: EmailNotificationRecord = {
    id: db.nextEmailNotificationId++,
    tenantId,
    customerId: customer.id,
    eventType: 'customer.created',
    recipient: `${tenantId}-admin@example.test`,
    subject: `Customer created: ${customer.name}`,
    body: `Customer ${customer.name} was created for tenant ${tenantId}.`,
    createdAt: new Date(0).toISOString()
  };

  db.emailNotifications.push(notification);
  return notification;
}

export function listEmailNotifications(db: Database, session: Session): EmailNotificationRecord[] {
  const tenantId = currentTenant(session);
  return db.emailNotifications
    .filter((notification) => notification.tenantId === tenantId)
    .sort((left, right) => left.id - right.id);
}
