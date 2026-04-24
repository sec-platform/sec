import { beforeEach, describe, expect, it } from 'vitest';
import { login } from '../../../src/installed/auth/session.ts';
import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';
import { addCustomerAttachment, listCustomerAttachments } from '../../../src/installed/file/customer-attachments.ts';
import { listEmailNotifications, recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';
import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';
import { getDatabase, resetDatabase } from '../../../lib/store.ts';

describe('runtime customer service', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('creates a customer for tenant a and hides it from tenant b', () => {
    const database = getDatabase();
    const tenantA = login('tenant-a-admin', 'password');
    const tenantB = login('tenant-b-admin', 'password');

    const created = createCustomer(database, tenantA, {
      name: 'Acme',
      email: 'Sales@Acme.test',
      phone: '400-800-9000',
      company: ''
    });

    expect(created.company).toBe('Unknown');
    expect(listCustomers(database, tenantA)).toHaveLength(1);
    expect(listCustomers(database, tenantB)).toHaveLength(0);
    const attachment = addCustomerAttachment(database, tenantA, {
      customerId: created.id,
      fileName: 'contract.txt',
      contentType: 'text/plain',
      size: 8,
      contentText: 'approved'
    });
    expect(attachment.tenantId).toBe('tenant-a');
    expect(listCustomerAttachments(database, tenantA, created.id)).toHaveLength(1);
    expect(() => listCustomerAttachments(database, tenantB, created.id)).toThrow(/Customer is not available/);

    const notification = recordCustomerCreatedEmail(database, tenantA, created);
    expect(notification.eventType).toBe('customer.created');
    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);
    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);

    expect(filterCustomers(listCustomers(database, tenantA), { search: 'ACME' })).toHaveLength(1);
    expect(filterCustomers(listCustomers(database, tenantA), { company: 'Unknown' })).toHaveLength(1);
  });
});
