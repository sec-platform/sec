import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CustomerForm } from '../../components/customer-form.tsx';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { getDatabase } from '../../lib/store.ts';
import { listCustomers } from '../../src/installed/entity/customer-service.ts';

interface CustomersPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }

  const database = getDatabase();
  const allCustomers = listCustomers(database, session);
  const customers = allCustomers;

  return (
    <main className="stack">
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="stack">
            <h1>Customers</h1>
            <p>Tenant <strong>{session.tenantId}</strong> currently sees {customers.length} customer(s).</p>
          </div>
          <div className="row">
            <Link href="/workspace">Workspace</Link>
            <LogoutButton />
          </div>
        </div>
      </section>

      <section className="card stack">
        <CustomerForm />
      </section>

      <section className="card stack">
        <h2>Customer List</h2>
        <ul className="clean" aria-label="Customers">
          {customers.map((customer) => (
            <li key={customer.id}>
              <div><strong>{customer.name}</strong> ({customer.company})</div>
              <div>{customer.email}</div>
              <div>{customer.phone}</div>
            </li>
          ))}
          {customers.length === 0 ? <li>No customers yet.</li> : null}
        </ul>
      </section>
    </main>
  );
}
