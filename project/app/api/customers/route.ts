import { NextResponse } from 'next/server';
import type { CustomerInput } from '../../../src/runtime/database.ts';
import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';
import { getCurrentSession } from '../../../lib/session.ts';
import { getDatabase } from '../../../lib/store.ts';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  const database = getDatabase();
  const customers = listCustomers(database, session);
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
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });
  }
}
