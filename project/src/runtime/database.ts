export interface CustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface NormalizedCustomerInput {
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface CustomerRecord extends NormalizedCustomerInput {
  id: number;
  tenantId: string;
}

export interface CustomerAttachmentInput {
  customerId: number;
  fileName: string;
  contentType: string;
  size: number;
  contentText: string;
}

export interface CustomerAttachmentRecord extends CustomerAttachmentInput {
  id: number;
  tenantId: string;
  createdAt: string;
}

export interface EmailNotificationRecord {
  id: number;
  tenantId: string;
  customerId: number;
  eventType: string;
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface AuditEntryRecord {
  actorId: string;
  tenantId: string;
  action: string;
  entity: string;
  entityId: string;
  occurredAt: string;
}

export interface Database {
  nextCustomerId: number;
  customers: CustomerRecord[];
  nextCustomerAttachmentId: number;
  customerAttachments: CustomerAttachmentRecord[];
  nextEmailNotificationId: number;
  emailNotifications: EmailNotificationRecord[];
  auditEntries: AuditEntryRecord[];
}

export type RuntimePersistence = 'memory' | 'postgres-contract';

export interface RuntimeStore {
  persistence: RuntimePersistence;
  database: Database;
}

export function createDatabase(): Database {
  return {
    nextCustomerId: 1,
    customers: [],
    nextCustomerAttachmentId: 1,
    customerAttachments: [],
    nextEmailNotificationId: 1,
    emailNotifications: [],
    auditEntries: []
  };
}

export function createRuntimeStore(persistence: RuntimePersistence = 'memory'): RuntimeStore {
  return {
    persistence,
    database: createDatabase()
  };
}

export function getRuntimeDatabase(store: RuntimeStore): Database {
  return store.database;
}
