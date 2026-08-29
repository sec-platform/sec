import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';
import { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';

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
