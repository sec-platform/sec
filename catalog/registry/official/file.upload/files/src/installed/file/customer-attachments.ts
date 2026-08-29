import type {
  CustomerAttachmentInput,
  CustomerAttachmentRecord,
  Database
} from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

function assertCustomerBelongsToTenant(db: Database, tenantId: string, customerId: number): void {
  const customer = db.customers.find((entry) => entry.id === customerId && entry.tenantId === tenantId);
  if (!customer) {
    throw new Error('Customer is not available for this tenant');
  }
}

export function addCustomerAttachment(
  db: Database,
  session: Session,
  input: CustomerAttachmentInput
): CustomerAttachmentRecord {
  const tenantId = currentTenant(session);
  assertCustomerBelongsToTenant(db, tenantId, input.customerId);

  const attachment: CustomerAttachmentRecord = {
    id: db.nextCustomerAttachmentId++,
    tenantId,
    customerId: input.customerId,
    fileName: input.fileName.trim() || 'attachment',
    contentType: input.contentType || 'application/octet-stream',
    size: input.size,
    contentText: input.contentText,
    createdAt: new Date(0).toISOString()
  };

  db.customerAttachments.push(attachment);
  return attachment;
}

export function listCustomerAttachments(
  db: Database,
  session: Session,
  customerId: number
): CustomerAttachmentRecord[] {
  const tenantId = currentTenant(session);
  assertCustomerBelongsToTenant(db, tenantId, customerId);
  return db.customerAttachments
    .filter((attachment) => attachment.tenantId === tenantId && attachment.customerId === customerId)
    .sort((left, right) => left.id - right.id);
}
