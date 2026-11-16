import assert from 'node:assert/strict';

import { createCustomer } from '../../src/installed/entity/customer-service.ts';
import {
  addCustomerAttachment,
  listCustomerAttachments
} from '../../src/installed/file/customer-attachments.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA, tenantB } = createTenantRuntimeFixture();
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
  assert.equal(attachment.customerId, customer.id);
  assert.equal(attachment.fileName, 'contract.txt');
  assert.equal(attachment.contentType, 'text/plain');
  assert.equal(attachment.size, 8);
  assert.equal(attachment.contentText, 'approved');
  assert.deepEqual(
    listCustomerAttachments(db, tenantA, customer.id).map(({ fileName, contentText }) => [fileName, contentText]),
    [['contract.txt', 'approved']]
  );
  assert.throws(() => listCustomerAttachments(db, tenantB, customer.id), /Customer is not available/);
}
