import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import { createCustomer } from '../../src/installed/entity/customer-service.ts';
import { addCustomerAttachment, listCustomerAttachments } from '../../src/installed/file/customer-attachments.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  const tenantB = login('tenant-b-admin', 'password');
  const customer = createCustomer(db, tenantA, {
    name: 'Acme',
    email: 'sales@acme.test',
    phone: '4008009000',
    company: 'Acme'
  });

  const attachment = addCustomerAttachment(db, tenantA, {
    customerId: customer.id,
    fileName: 'contract.txt',
    contentType: 'text/plain',
    size: 8,
    contentText: 'approved'
  });

  assert.equal(attachment.tenantId, 'tenant-a');
  assert.equal(listCustomerAttachments(db, tenantA, customer.id).length, 1);
  assert.throws(() => listCustomerAttachments(db, tenantB, customer.id), /Customer is not available/);
}
