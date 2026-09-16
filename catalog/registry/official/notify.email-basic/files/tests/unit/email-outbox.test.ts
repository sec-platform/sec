import assert from 'node:assert/strict';
import { createCustomer } from '../../src/installed/entity/customer-service.ts';
import { listEmailNotifications, recordCustomerCreatedEmail, recordTicketCreatedEmail } from '../../src/installed/notify/email-outbox.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();
  const customer = createCustomer(db, tenantA, {
    name: 'Acme',
    email: 'sales@acme.test',
    phone: '4008009000',
    company: 'Acme'
  });

  const notification = recordCustomerCreatedEmail(db, tenantA, customer);

  assert.equal(notification.entity, 'customer');
  assert.equal(notification.entityId, String(customer.id));
  assert.equal(notification.eventType, 'customer.created');
  assert.equal(notification.recipient, 'tenant-a-admin@example.test');

  const ticketNotification = recordTicketCreatedEmail(db, tenantA, {
    id: 1,
    tenantId: tenantA.tenantId,
    title: 'Escalate onboarding issue',
    description: 'Customer cannot finish setup',
    status: 'open',
    assigneeId: tenantA.userId,
    dueDate: '',
    createdBy: tenantA.userId,
    updatedAt: new Date(0).toISOString()
  });
  assert.equal(ticketNotification.entity, 'ticket');
  assert.equal(ticketNotification.entityId, '1');
  assert.equal(ticketNotification.eventType, 'ticket.created');

  assert.equal(listEmailNotifications(db, tenantA).length, 2);
  assert.equal(listEmailNotifications(db, tenantB).length, 0);
}
