import type { CustomerRecord, TicketRecord } from '../../runtime/database.ts';

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
    ['id', 'tenantId', 'title', 'description', 'status', 'assigneeId', 'createdBy', 'updatedAt'],
    ...tickets.map((ticket) => [
      String(ticket.id),
      ticket.tenantId,
      ticket.title,
      ticket.description,
      ticket.status,
      ticket.assigneeId,
      ticket.createdBy,
      ticket.updatedAt
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
