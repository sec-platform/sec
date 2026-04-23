import type { CustomerRecord } from '../../runtime/database.ts';

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

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
