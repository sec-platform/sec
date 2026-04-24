import { NextResponse } from 'next/server';
import type { CustomerInput } from '../../../src/runtime/database.ts';
import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';
import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';
import { recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';
import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';
import { getCurrentSession } from '../../../lib/session.ts';
import { getDatabase } from '../../../lib/store.ts';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  const database = getDatabase();
  const url = new URL(request.url);
  const customers = filterCustomers(listCustomers(database, session), {
    search: url.searchParams.get('search'),
    company: url.searchParams.get('company')
  });
  return NextResponse.json({ customers });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const database = getDatabase();
    const payload = await request.json() as CustomerInput;
    const customer = createCustomer(database, session, payload);
    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, 'customer.created', 'customer', String(customer.id)));
    recordCustomerCreatedEmail(database, session, customer);
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });
  }
}
