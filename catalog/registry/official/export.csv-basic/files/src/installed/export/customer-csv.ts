import type { CustomerRecord, TicketRecord } from '../../runtime/database.ts';

interface TicketSummaryCsvInput {
  total: number;
  byStatus: {
    open: number;
    in_progress: number;
    closed: number;
  };
  sla: {
    overdue: number;
    dueSoon: number;
    unscheduled: number;
  };
  byAssignee: Array<{
    assigneeId: string;
    count: number;
  }>;
}

export function exportCustomersToCsv(customers: CustomerRecord[]): string {
  const rows = [
    ['id', 'tenantId', 'name', 'email', 'phone', 'company'],
    ...customers.map((customer) => [
      String(customer.id),
      customer.tenantId,
      customer.name,
      customer.email,
      customer.phone,
      customer.company
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function exportTicketsToCsv(tickets: TicketRecord[]): string {
  const rows = [
    ['id', 'tenantId', 'title', 'description', 'status', 'assigneeId', 'dueDate', 'createdBy', 'updatedAt'],
    ...tickets.map((ticket) => [
      String(ticket.id),
      ticket.tenantId,
      ticket.title,
      ticket.description,
      ticket.status,
      ticket.assigneeId,
      ticket.dueDate,
      ticket.createdBy,
      ticket.updatedAt
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function exportTicketSummaryToCsv(summary: TicketSummaryCsvInput): string {
  const rows = [
    ['section', 'key', 'value'],
    ['total', 'tickets', String(summary.total)],
    ['status', 'open', String(summary.byStatus.open)],
    ['status', 'in_progress', String(summary.byStatus.in_progress)],
    ['status', 'closed', String(summary.byStatus.closed)],
    ['sla', 'overdue', String(summary.sla.overdue)],
    ['sla', 'dueSoon', String(summary.sla.dueSoon)],
    ['sla', 'unscheduled', String(summary.sla.unscheduled)],
    ...summary.byAssignee.map((entry) => ['assignee', entry.assigneeId, String(entry.count)])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
