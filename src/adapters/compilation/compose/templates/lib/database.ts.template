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
  entity: string;
  entityId: string;
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

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export interface TicketInput {
  title: string;
  description?: string;
  status?: TicketStatus;
  assigneeId?: string;
  dueDate?: string;
}

export interface TicketRecord {
  id: number;
  tenantId: string;
  title: string;
  description: string;
  status: TicketStatus;
  assigneeId: string;
  dueDate: string;
  createdBy: string;
  updatedAt: string;
}

export interface TicketAttachmentInput {
  ticketId: number;
  fileName: string;
  contentType: string;
  size: number;
  contentText: string;
}

export interface TicketAttachmentRecord extends TicketAttachmentInput {
  id: number;
  tenantId: string;
  createdAt: string;
}

export interface TicketCommentInput {
  ticketId: number;
  body: string;
}

export interface TicketCommentRecord extends TicketCommentInput {
  id: number;
  tenantId: string;
  authorId: string;
  createdAt: string;
}

export interface WorklogInput {
  ticketId: number;
  minutes: number;
  note?: string;
}

export interface WorklogRecord extends WorklogInput {
  id: number;
  tenantId: string;
  note: string;
  authorId: string;
  createdAt: string;
}

export interface Database {
  nextCustomerId: number;
  customers: CustomerRecord[];
  nextCustomerAttachmentId: number;
  customerAttachments: CustomerAttachmentRecord[];
  nextEmailNotificationId: number;
  emailNotifications: EmailNotificationRecord[];
  auditEntries: AuditEntryRecord[];
  nextTicketId: number;
  tickets: TicketRecord[];
  nextTicketAttachmentId: number;
  ticketAttachments: TicketAttachmentRecord[];
  nextTicketCommentId: number;
  ticketComments: TicketCommentRecord[];
  nextWorklogId: number;
  worklogs: WorklogRecord[];
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
    auditEntries: [],
    nextTicketId: 1,
    tickets: [],
    nextTicketAttachmentId: 1,
    ticketAttachments: [],
    nextTicketCommentId: 1,
    ticketComments: [],
    nextWorklogId: 1,
    worklogs: []
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
