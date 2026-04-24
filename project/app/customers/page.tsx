import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CustomerForm } from '../../components/customer-form.tsx';
import { CustomerAttachmentForm } from '../../components/customer-attachment-form.tsx';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { getDatabase } from '../../lib/store.ts';
import { listCustomers } from '../../src/installed/entity/customer-service.ts';
import { listCustomerAttachments } from '../../src/installed/file/customer-attachments.ts';
import { listEmailNotifications } from '../../src/installed/notify/email-outbox.ts';
import { filterCustomers, listCustomerCompanies } from '../../src/installed/table/customer-filter.ts';

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
  const params = await searchParams;
  const search = typeof params?.search === 'string' ? params.search : '';
  const company = typeof params?.company === 'string' ? params.company : '';
  const customers = filterCustomers(allCustomers, { search, company });
  const companies = listCustomerCompanies(allCustomers);
  const attachmentsByCustomer = new Map(customers.map((customer) => [customer.id, listCustomerAttachments(database, session, customer.id)]));
  const notifications = listEmailNotifications(database, session);
  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId);

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
        <h2>Filters</h2>
        <form className="row" action="/customers">
          <label style={{ flex: 1 }}>
            Search
            <input aria-label="Search customers" name="search" defaultValue={search} />
          </label>
          <label style={{ flex: 1 }}>
            Company
            <select aria-label="Company filter" name="company" defaultValue={company}>
              <option value="">All companies</option>
              {companies.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>
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
              <div className="stack" style={{ marginTop: 12 }}>
                <CustomerAttachmentForm customerId={customer.id} customerName={customer.name} />
                <ul className="clean" aria-label={`Attachments for ${customer.name}`}>
                  {(attachmentsByCustomer.get(customer.id) ?? []).map((attachment) => (
                    <li key={attachment.id}>{attachment.fileName} ({attachment.contentType})</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
          {customers.length === 0 ? <li>No customers yet.</li> : null}
        </ul>
      </section>
      <section className="card stack">
        <h2>Email Notifications</h2>
        <ul className="clean" aria-label="Notifications">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <div><strong>{notification.subject}</strong></div>
              <div>{notification.recipient}</div>
            </li>
          ))}
          {notifications.length === 0 ? <li>No notifications yet.</li> : null}
        </ul>
      </section>

      <section className="card stack">
        <h2>Audit Trail</h2>
        <ul className="clean" aria-label="Audit entries">
          {auditEntries.map((entry) => (
            <li key={`${entry.action}:${entry.entity}:${entry.entityId}`}>
              <div><strong>{entry.action}</strong> {entry.entity} {entry.entityId}</div>
              <div>{entry.actorId} in {entry.tenantId}</div>
            </li>
          ))}
          {auditEntries.length === 0 ? <li>No audit entries yet.</li> : null}
        </ul>
      </section>

    </main>
  );
}
