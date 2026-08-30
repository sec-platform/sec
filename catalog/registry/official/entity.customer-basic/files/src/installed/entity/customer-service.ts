import type { CustomerInput, CustomerRecord, Database, NormalizedCustomerInput } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new Error('customer name is required');
  }
  const email = input.email ? String(input.email).trim().toLowerCase() : '';
  const phone = input.phone ? String(input.phone).replace(/[\s-]+/g, '') : '';
  const company = String(input.company ?? '').trim() || 'Unknown';
  return { name, email, phone, company };
}

export function createCustomer(
  db: Database,
  session: Session,
  input: CustomerInput
): CustomerRecord {
  const tenantId = currentTenant(session);
  const normalized = normalizeCustomerInput(input);
  const customer: CustomerRecord = {
    id: db.nextCustomerId++,
    tenantId,
    ...normalized
  };

  db.customers.push(customer);
  return customer;
}

export function listCustomers(db: Database, session: Session): CustomerRecord[] {
  const tenantId = currentTenant(session);
  return db.customers.filter((customer) => customer.tenantId === tenantId);
}
