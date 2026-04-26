import path from 'node:path';
import { ensureDir, writeText } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { LockFile } from '../../shared/types.ts';

const BASE_RUNTIME_SCAFFOLD_PATHS = [
  'package.json',
  'tsconfig.json',
  'next.config.mjs',
  'next-env.d.ts',
  'app/globals.css',
  'app/layout.tsx',
  'app/page.tsx',
  'lib/store.ts'
] as const;

function hasBlock(lock: LockFile, blockId: string): boolean {
  return lock.resolvedBlocks.some((block) => block.id === blockId);
}

function renderLayout(): string {
  return `import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang=\"en\">
      <body>{children}</body>
    </html>
  );
}
`;
}

function renderIndexPage(hasAuth: boolean): string {
  if (hasAuth) {
    return `import { redirect } from 'next/navigation';
import { getCurrentSession } from '../lib/session.ts';

export default async function HomePage() {
  const session = await getCurrentSession();
  redirect(session ? '/workspace' : '/login');
}
`;
  }

  return `import Link from 'next/link';
import { routes } from '../generated/routes.ts';

export default function HomePage() {
  return (
    <main className=\"stack\">
      <section className=\"card stack\">
        <h1>Runtime Host</h1>
        <p>This generated host exposes the resolved block routes for local inspection.</p>
        <nav className=\"row\">
          {routes.length === 0 ? <span>No routes published by the current block set.</span> : null}
          {routes.map((route) => (
            <Link key={route.path} href={route.path}>{route.path}</Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
`;
}

function renderLoginPage(): string {
  return `import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/login-form.tsx';
import { getCurrentSession } from '../../lib/session.ts';

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect('/workspace');
  }

  return (
    <main className=\"stack\">
      <section className=\"card stack\">
        <div className=\"stack\">
          <h1>Customer Admin</h1>
          <p>Sign in with <strong>tenant-a-admin</strong> or <strong>tenant-b-admin</strong>. Password: <strong>password</strong>.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
`;
}

function renderWorkspacePage(options: {
  rbacEnabled: boolean;
}): string {
  const rbacImport = options.rbacEnabled
    ? `
import { canAccessWorkspace } from '../../src/installed/auth/authorize.ts';`
    : '';
  const rbacSetup = options.rbacEnabled
    ? `
  const ownWorkspaceDecision = canAccessWorkspace(session, session.tenantId);
  const otherTenantId = session.tenantId === 'tenant-a' ? 'tenant-b' : 'tenant-a';
  const otherWorkspaceDecision = canAccessWorkspace(session, otherTenantId);
`
    : '';
  const rbacView = options.rbacEnabled
    ? `
        <div className=\"stack\" aria-label=\"Authorization summary\">
          <p>Authorization: {ownWorkspaceDecision.reason}</p>
          <p>Cross-tenant check: {otherWorkspaceDecision.reason}</p>
        </div>
`
    : '';

  return `import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { routes } from '../../generated/routes.ts';${rbacImport}

export default async function WorkspacePage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }

  const visibleRoutes = routes.filter((route) => route.path !== '/login');
${rbacSetup}
  return (
    <main className=\"stack\">
      <section className=\"card stack\">
        <div className=\"row\" style={{ justifyContent: 'space-between' }}>
          <div className=\"stack\">
            <h1>Workspace</h1>
            <p>{session.username} in tenant <strong>{session.tenantId}</strong></p>
          </div>
          <LogoutButton />
        </div>${rbacView}
        <nav className=\"row\">
          {visibleRoutes.length === 0 ? <span>No block routes available for this workspace.</span> : null}
          {visibleRoutes.map((route) => (
            <Link key={route.path} href={route.path}>{route.path}</Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
`;
}

function renderCustomersPage(options: {
  auditEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const imports = [
    `import Link from 'next/link';`,
    `import { redirect } from 'next/navigation';`,
    `import { CustomerForm } from '../../components/customer-form.tsx';`,
    options.fileUploadEnabled ? `import { CustomerAttachmentForm } from '../../components/customer-attachment-form.tsx';` : '',
    `import { LogoutButton } from '../../components/logout-button.tsx';`,
    `import { getCurrentSession } from '../../lib/session.ts';`,
    `import { getDatabase } from '../../lib/store.ts';`,
    `import { listCustomers } from '../../src/installed/entity/customer-service.ts';`,
    options.fileUploadEnabled ? `import { listCustomerAttachments } from '../../src/installed/file/customer-attachments.ts';` : '',
    options.notifyEmailEnabled ? `import { listEmailNotifications } from '../../src/installed/notify/email-outbox.ts';` : '',
    options.tableFilterEnabled ? `import { filterCustomers, listCustomerCompanies } from '../../src/installed/table/customer-filter.ts';` : ''
  ].filter(Boolean).join('\n');

  const searchSetup = options.tableFilterEnabled
    ? `  const params = await searchParams;
  const search = typeof params?.search === 'string' ? params.search : '';
  const company = typeof params?.company === 'string' ? params.company : '';
  const customers = filterCustomers(allCustomers, { search, company });
  const companies = listCustomerCompanies(allCustomers);
`
    : `  const customers = allCustomers;
`;
  const tableFilters = options.tableFilterEnabled
    ? `
      <section className=\"card stack\">
        <h2>Filters</h2>
        <form className=\"row\" action=\"/customers\">
          <label style={{ flex: 1 }}>
            Search
            <input aria-label=\"Search customers\" name=\"search\" defaultValue={search} />
          </label>
          <label style={{ flex: 1 }}>
            Company
            <select aria-label=\"Company filter\" name=\"company\" defaultValue={company}>
              <option value=\"\">All companies</option>
              {companies.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <button type=\"submit\">Apply filters</button>
        </form>
      </section>
`
    : '';
  const attachmentSetup = options.fileUploadEnabled
    ? `  const attachmentsByCustomer = new Map(customers.map((customer) => [customer.id, listCustomerAttachments(database, session, customer.id)]));
`
    : '';
  const attachmentView = options.fileUploadEnabled
    ? `
              <div className=\"stack\" style={{ marginTop: 12 }}>
                <CustomerAttachmentForm customerId={customer.id} customerName={customer.name} />
                <ul className=\"clean\" aria-label={\`Attachments for \${customer.name}\`}>
                  {(attachmentsByCustomer.get(customer.id) ?? []).map((attachment) => (
                    <li key={attachment.id}>{attachment.fileName} ({attachment.contentType})</li>
                  ))}
                </ul>
              </div>`
    : '';
  const notificationSetup = options.notifyEmailEnabled
    ? `  const notifications = listEmailNotifications(database, session);
`
    : '';
  const auditSetup = options.auditEnabled
    ? `  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId);
`
    : '';
  const notificationView = options.notifyEmailEnabled
    ? `
      <section className=\"card stack\">
        <h2>Email Notifications</h2>
        <ul className=\"clean\" aria-label=\"Notifications\">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <div><strong>{notification.subject}</strong></div>
              <div>{notification.recipient}</div>
            </li>
          ))}
          {notifications.length === 0 ? <li>No notifications yet.</li> : null}
        </ul>
      </section>
`
    : '';
  const auditView = options.auditEnabled
    ? `
      <section className=\"card stack\">
        <h2>Audit Trail</h2>
        <ul className=\"clean\" aria-label=\"Audit entries\">
          {auditEntries.map((entry) => (
            <li key={\`\${entry.action}:\${entry.entity}:\${entry.entityId}\`}>
              <div><strong>{entry.action}</strong> {entry.entity} {entry.entityId}</div>
              <div>{entry.actorId} in {entry.tenantId}</div>
            </li>
          ))}
          {auditEntries.length === 0 ? <li>No audit entries yet.</li> : null}
        </ul>
      </section>
`
    : '';

  return `${imports}

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
${searchSetup}${attachmentSetup}${notificationSetup}${auditSetup}
  return (
    <main className=\"stack\">
      <section className=\"card stack\">
        <div className=\"row\" style={{ justifyContent: 'space-between' }}>
          <div className=\"stack\">
            <h1>Customers</h1>
            <p>Tenant <strong>{session.tenantId}</strong> currently sees {customers.length} customer(s).</p>
          </div>
          <div className=\"row\">
            <Link href=\"/workspace\">Workspace</Link>
            <LogoutButton />
          </div>
        </div>
      </section>
${tableFilters}
      <section className=\"card stack\">
        <CustomerForm />
      </section>

      <section className=\"card stack\">
        <h2>Customer List</h2>
        <ul className=\"clean\" aria-label=\"Customers\">
          {customers.map((customer) => (
            <li key={customer.id}>
              <div><strong>{customer.name}</strong> ({customer.company})</div>
              <div>{customer.email}</div>
              <div>{customer.phone}</div>${attachmentView}
            </li>
          ))}
          {customers.length === 0 ? <li>No customers yet.</li> : null}
        </ul>
      </section>${notificationView}${auditView}
    </main>
  );
}
`;
}

function renderTicketsPage(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
}): string {
  const auditSetup = options.auditEnabled
    ? `  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId && entry.entity === 'ticket');
`
    : '';
  const notificationSetup = options.notifyEmailEnabled
    ? `  const ticketNotifications = listEmailNotifications(database, session).filter((notification) => notification.entity === 'ticket');
`
    : '';
  const notificationView = options.notifyEmailEnabled
    ? `
      <section className="card stack">
        <h2>Ticket Notifications</h2>
        <ul className="clean" aria-label="Ticket notifications">
          {ticketNotifications.map((notification) => (
            <li key={notification.id}>
              <div><strong>{notification.subject}</strong></div>
              <div>{notification.recipient}</div>
            </li>
          ))}
          {ticketNotifications.length === 0 ? <li>No ticket notifications yet.</li> : null}
        </ul>
      </section>
`
    : '';
  const exportAction = options.exportCsvEnabled
    ? `
            <a href="/api/tickets/export">Export tickets CSV</a>`
    : '';
  const auditView = options.auditEnabled
    ? `
      <section className="card stack">
        <h2>Ticket Audit Trail</h2>
        <ul className="clean" aria-label="Ticket audit entries">
          {auditEntries.map((entry) => (
            <li key={\`\${entry.action}:\${entry.entityId}:\${entry.occurredAt}\`}>
              <div><strong>{entry.action}</strong> ticket {entry.entityId}</div>
              <div>{entry.actorId} in {entry.tenantId}</div>
            </li>
          ))}
          {auditEntries.length === 0 ? <li>No ticket audit entries yet.</li> : null}
        </ul>
      </section>
`
    : '';

  return `import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TicketForm } from '../../components/ticket-form.tsx';
import { TicketStatusForm } from '../../components/ticket-status-form.tsx';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { getDatabase } from '../../lib/store.ts';
import { listTickets, listTicketsByAssignee } from '../../src/installed/ticket/ticket-service.ts';${options.notifyEmailEnabled ? `\nimport { listEmailNotifications } from '../../src/installed/notify/email-outbox.ts';` : ''}

interface TicketsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const assignee = typeof params?.assignee === 'string' ? params.assignee : '';
  const database = getDatabase();
  const allTickets = listTickets(database, session);
  const tickets = assignee ? listTicketsByAssignee(database, session, assignee) : allTickets;
  const assignees = Array.from(new Set(allTickets.map((ticket) => ticket.assigneeId))).sort((left, right) => left.localeCompare(right));
${notificationSetup}${auditSetup}
  return (
    <main className="stack">
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="stack">
            <h1>Tickets</h1>
            <p>Tenant <strong>{session.tenantId}</strong> currently sees {tickets.length} ticket(s).</p>
          </div>
          <div className="row">
            <Link href="/workspace">Workspace</Link>${exportAction}
            <LogoutButton />
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Filters</h2>
        <form className="row" action="/tickets">
          <label style={{ flex: 1 }}>
            Assignee
            <select aria-label="Assignee filter" name="assignee" defaultValue={assignee}>
              <option value="">All assignees</option>
              {assignees.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply ticket filters</button>
        </form>
      </section>

      <section className="card stack">
        <TicketForm />
      </section>

      <section className="card stack">
        <h2>Ticket List</h2>
        <ul className="clean" aria-label="Tickets">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <div><strong>{ticket.title}</strong> ({ticket.status})</div>
              <div>{ticket.description || 'No description'}</div>
              <div>Assignee: {ticket.assigneeId}</div>
              <TicketStatusForm ticketId={ticket.id} ticketTitle={ticket.title} currentStatus={ticket.status} />
            </li>
          ))}
          {tickets.length === 0 ? <li>No tickets yet.</li> : null}
        </ul>
      </section>${notificationView}${auditView}
    </main>
  );
}
`;
}

function renderSessionLibrary(): string {
  return `import { cookies } from 'next/headers';
import type { Session } from '../src/installed/auth/session.ts';

const SESSION_COOKIE_NAME = 'engineering-compiler-session';

function isSession(value: unknown): value is Session {
  return typeof value === 'object' && value !== null && 'userId' in value && 'tenantId' in value && 'username' in value;
}

export function serializeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

export function deserializeSession(raw: string | null | undefined): Session | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  return deserializeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
`;
}

function renderStoreLibrary(options: { postgresEnabled: boolean }): string {
  const persistence = options.postgresEnabled ? 'postgres-contract' : 'memory';
  return `import { createRuntimeStore, getRuntimeDatabase, type Database, type RuntimeStore } from '../src/runtime/database.ts';

declare global {
  var __engineeringCompilerRuntimeStore: RuntimeStore | undefined;
}

export function getRuntimeStore(): RuntimeStore {
  if (!globalThis.__engineeringCompilerRuntimeStore) {
    globalThis.__engineeringCompilerRuntimeStore = createRuntimeStore('${persistence}');
  }
  return globalThis.__engineeringCompilerRuntimeStore;
}

export function getDatabase(): Database {
  return getRuntimeDatabase(getRuntimeStore());
}

export function resetDatabase(): void {
  globalThis.__engineeringCompilerRuntimeStore = createRuntimeStore('${persistence}');
}
`;
}

function renderLoginRoute(): string {
  return `import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { login } from '../../../../src/installed/auth/session.ts';
import { getSessionCookieName, serializeSession } from '../../../../lib/session.ts';

export async function POST(request: Request) {
  const payload = await request.json() as { username?: string; password?: string };

  try {
    const session = login(String(payload.username ?? ''), String(payload.password ?? ''));
    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), serializeSession(session), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid credentials' }, { status: 401 });
  }
}
`;
}

function renderLogoutRoute(): string {
  return `import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionCookieName } from '../../../../lib/session.ts';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
  return NextResponse.json({ ok: true });
}
`;
}

function renderCurrentSessionRoute(): string {
  return `import { NextResponse } from 'next/server';
import { getCurrentSession } from '../../../../lib/session.ts';

export async function GET() {
  const session = await getCurrentSession();
  return NextResponse.json({ session });
}
`;
}

function renderCustomersRoute(options: {
  auditEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const imports = [
    `import { NextResponse } from 'next/server';`,
    `import type { CustomerInput } from '../../../src/runtime/database.ts';`,
    `import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';`,
    options.auditEnabled ? `import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';` : '',
    options.notifyEmailEnabled ? `import { recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';` : '',
    options.tableFilterEnabled ? `import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';` : '',
    `import { getCurrentSession } from '../../../lib/session.ts';`,
    `import { getDatabase } from '../../../lib/store.ts';`
  ].filter(Boolean).join('\n');
  const filterCustomersLine = options.tableFilterEnabled
    ? `  const database = getDatabase();
  const url = new URL(request.url);
  const customers = filterCustomers(listCustomers(database, session), {
    search: url.searchParams.get('search'),
    company: url.searchParams.get('company')
  });
`
    : `  const database = getDatabase();
  const customers = listCustomers(database, session);
`;
  const auditLine = options.auditEnabled
    ? `    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, 'customer.created', 'customer', String(customer.id)));
`
    : '';
  const notifyLine = options.notifyEmailEnabled
    ? `    recordCustomerCreatedEmail(database, session, customer);
`
    : '';

  return `${imports}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

${filterCustomersLine}  return NextResponse.json({ customers });
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
${auditLine}${notifyLine}    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });
  }
}
`;
}

function renderCustomerAttachmentsRoute(): string {
  return `import { NextResponse } from 'next/server';
import { addCustomerAttachment, listCustomerAttachments } from '../../../../../src/installed/file/customer-attachments.ts';
import { getCurrentSession } from '../../../../../lib/session.ts';
import { getDatabase } from '../../../../../lib/store.ts';

interface AttachmentRouteContext {
  params: Promise<{ customerId: string }>;
}

export async function GET(_request: Request, context: AttachmentRouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const customerId = Number(params.customerId);
    const attachments = listCustomerAttachments(getDatabase(), session, customerId);
    return NextResponse.json({ attachments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });
  }
}

export async function POST(request: Request, context: AttachmentRouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const customerId = Number(params.customerId);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const attachment = addCustomerAttachment(getDatabase(), session, {
      customerId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      contentText: await file.text()
    });
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });
  }
}
`;
}

function renderTicketsRoute(options: { auditEnabled: boolean; notifyEmailEnabled: boolean }): string {
  const auditImport = options.auditEnabled
    ? `
import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';`
    : '';
  const auditLine = options.auditEnabled
    ? `    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, 'ticket.created', 'ticket', String(ticket.id)));
`
    : '';
  const notifyImport = options.notifyEmailEnabled
    ? `
import { recordTicketCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';`
    : '';
  const notifyLine = options.notifyEmailEnabled
    ? `    recordTicketCreatedEmail(database, session, ticket);
`
    : '';

  return `import { NextResponse } from 'next/server';
import type { TicketInput } from '../../../src/runtime/database.ts';
import { createTicket, listTickets, listTicketsByAssignee } from '../../../src/installed/ticket/ticket-service.ts';${auditImport}${notifyImport}
import { getCurrentSession } from '../../../lib/session.ts';
import { getDatabase } from '../../../lib/store.ts';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  const database = getDatabase();
  const url = new URL(request.url);
  const assigneeId = url.searchParams.get('assigneeId');
  const tickets = assigneeId ? listTicketsByAssignee(database, session, assigneeId) : listTickets(database, session);
  return NextResponse.json({ tickets });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const database = getDatabase();
    const payload = await request.json() as TicketInput;
    const ticket = createTicket(database, session, payload);
${auditLine}${notifyLine}    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });
  }
}
`;
}

function renderTicketExportRoute(): string {
  return `import { NextResponse } from 'next/server';
import { exportTicketsToCsv } from '../../../../src/installed/export/customer-csv.ts';
import { listTickets } from '../../../../src/installed/ticket/ticket-service.ts';
import { getCurrentSession } from '../../../../lib/session.ts';
import { getDatabase } from '../../../../lib/store.ts';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  const csv = exportTicketsToCsv(listTickets(getDatabase(), session));
  return new NextResponse(csv, {
    headers: {
      'content-disposition': 'attachment; filename="tickets.csv"',
      'content-type': 'text/csv; charset=utf-8'
    }
  });
}
`;
}

function renderTicketStatusRoute(options: { auditEnabled: boolean }): string {
  const auditImport = options.auditEnabled
    ? `
import { appendAuditEntry, createAuditEntry } from '../../../../../src/installed/audit/logger.ts';`
    : '';
  const auditLine = options.auditEnabled
    ? `    const auditAction = ticket.status === 'closed' ? 'ticket.closed' : 'ticket.status_transitioned';
    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, auditAction, 'ticket', String(ticket.id)));
`
    : '';

  return `import { NextResponse } from 'next/server';
import type { TicketStatus } from '../../../../../src/runtime/database.ts';
import { transitionTicketStatus } from '../../../../../src/installed/ticket/ticket-service.ts';${auditImport}
import { getCurrentSession } from '../../../../../lib/session.ts';
import { getDatabase } from '../../../../../lib/store.ts';

const STATUSES = new Set<TicketStatus>(['open', 'in_progress', 'closed']);

interface TicketStatusRouteContext {
  params: Promise<{ ticketId: string }>;
}

export async function POST(request: Request, context: TicketStatusRouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const payload = await request.json() as { status?: string };
    if (!STATUSES.has(payload.status as TicketStatus)) {
      return NextResponse.json({ error: 'Invalid ticket status' }, { status: 400 });
    }

    const database = getDatabase();
    const ticket = transitionTicketStatus(database, session, Number(params.ticketId), payload.status as TicketStatus);
${auditLine}    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid ticket status request' }, { status: 400 });
  }
}
`;
}

function renderLoginForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('tenant-a-admin');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/session/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Login failed');
      setPending(false);
      return;
    }

    router.push('/workspace');
    router.refresh();
  }

  return (
    <form className=\"stack\" onSubmit={handleSubmit}>
      <label>
        Username
        <input aria-label=\"Username\" value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label>
        Password
        <input aria-label=\"Password\" type=\"password\" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {error ? <p role=\"alert\">{error}</p> : null}
      <button type=\"submit\" disabled={pending}>{pending ? 'Signing In...' : 'Sign In'}</button>
    </form>
  );
}
`;
}

function renderLogoutButton(): string {
  return `'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/session/logout', {
      method: 'POST'
    });
    router.push('/login');
    router.refresh();
  }

  return <button type=\"button\" className=\"secondary\" onClick={handleLogout}>Sign out</button>;
}
`;
}

function renderCustomerForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const INITIAL_STATE = {
  name: '',
  email: '',
  phone: '',
  company: ''
};

export function CustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to create customer');
      setPending(false);
      return;
    }

    setForm(INITIAL_STATE);
    setPending(false);
    router.refresh();
  }

  return (
    <form className=\"stack\" onSubmit={handleSubmit}>
      <div className=\"row\">
        <label style={{ flex: 1 }}>
          Name
          <input aria-label=\"Name\" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Company
          <input aria-label=\"Company\" value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} />
        </label>
      </div>
      <div className=\"row\">
        <label style={{ flex: 1 }}>
          Email
          <input aria-label=\"Email\" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Phone
          <input aria-label=\"Phone\" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
        </label>
      </div>
      {error ? <p role=\"alert\">{error}</p> : null}
      <button type=\"submit\" disabled={pending}>{pending ? 'Creating...' : 'Create Customer'}</button>
    </form>
  );
}
`;
}

function renderCustomerAttachmentForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

interface CustomerAttachmentFormProps {
  customerId: number;
  customerName: string;
}

export function CustomerAttachmentForm({ customerId, customerName }: CustomerAttachmentFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch(\`/api/customers/\${customerId}/attachments\`, {
      method: 'POST',
      body: new FormData(event.currentTarget)
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to upload attachment');
      setPending(false);
      return;
    }

    formRef.current?.reset();
    setPending(false);
    router.refresh();
  }

  return (
    <form ref={formRef} className=\"row\" onSubmit={handleSubmit}>
      <label style={{ flex: 1 }}>
        Attachment
        <input aria-label={\`Attachment for \${customerName}\`} name=\"file\" type=\"file\" />
      </label>
      <button type=\"submit\" disabled={pending}>{pending ? 'Uploading...' : \`Upload attachment for \${customerName}\`}</button>
      {error ? <p role=\"alert\">{error}</p> : null}
    </form>
  );
}
`;
}

function renderTicketForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const INITIAL_STATE = {
  title: '',
  description: '',
  assigneeId: ''
};

export function TicketForm() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to create ticket');
      setPending(false);
      return;
    }

    setForm(INITIAL_STATE);
    setPending(false);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="row">
        <label style={{ flex: 1 }}>
          Title
          <input aria-label="Ticket title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Assignee
          <input aria-label="Ticket assignee" value={form.assigneeId} onChange={(event) => setForm((current) => ({ ...current, assigneeId: event.target.value }))} />
        </label>
      </div>
      <label>
        Description
        <textarea aria-label="Ticket description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create Ticket'}</button>
    </form>
  );
}
`;
}

function renderTicketStatusForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TicketStatus } from '../src/runtime/database.ts';

interface TicketStatusFormProps {
  ticketId: number;
  ticketTitle: string;
  currentStatus: TicketStatus;
}

const NEXT_STATUS: Record<TicketStatus, TicketStatus> = {
  open: 'in_progress',
  in_progress: 'closed',
  closed: 'open'
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Start progress',
  in_progress: 'Close ticket',
  closed: 'Reopen ticket'
};

export function TicketStatusForm({ ticketId, ticketTitle, currentStatus }: TicketStatusFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nextStatus = NEXT_STATUS[currentStatus];

  async function transitionStatus() {
    setPending(true);
    setError(null);

    const response = await fetch(\`/api/tickets/\${ticketId}/status\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to update ticket');
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  return (
    <div className="row" style={{ marginTop: 12 }}>
      <button type="button" className="secondary" disabled={pending} onClick={transitionStatus}>
        {pending ? 'Updating...' : \`\${STATUS_LABEL[currentStatus]} for \${ticketTitle}\`}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
`;
}

function renderRuntimeUnitTest(options: {
  auditEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  postgresEnabled: boolean;
  rbacEnabled: boolean;
  tableFilterEnabled: boolean;
  ticketEnabled: boolean;
}): string {
  const imports = [
    `import { beforeEach, describe, expect, it } from 'vitest';`,
    `import { login } from '../../../src/installed/auth/session.ts';`,
    `import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';`,
    options.auditEnabled ? `import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';` : '',
    options.fileUploadEnabled ? `import { addCustomerAttachment, listCustomerAttachments } from '../../../src/installed/file/customer-attachments.ts';` : '',
    options.notifyEmailEnabled ? `import { listEmailNotifications, recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';` : '',
    options.postgresEnabled ? `import { POSTGRES_CONTRACT } from '../../../src/installed/infra/postgres-contract.ts';` : '',
    options.rbacEnabled ? `import { canAccessWorkspace } from '../../../src/installed/auth/authorize.ts';` : '',
    options.tableFilterEnabled ? `import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';` : '',
    options.postgresEnabled ? `import { getDatabase, getRuntimeStore, resetDatabase } from '../../../lib/store.ts';` : `import { getDatabase, resetDatabase } from '../../../lib/store.ts';`
  ].filter(Boolean).join('\n');
  const auditAssertions = options.auditEnabled
    ? `
    const auditEntry = createAuditEntry(tenantA, 'customer.created', 'customer', String(created.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, auditEntry);
    expect(database.auditEntries).toEqual([auditEntry]);
    expect(auditEntry.occurredAt).toBe('1970-01-01T00:00:00.000Z');
`
    : '';
  const fileAssertions = options.fileUploadEnabled
    ? `
    const attachment = addCustomerAttachment(database, tenantA, {
      customerId: created.id,
      fileName: 'contract.txt',
      contentType: 'text/plain',
      size: 8,
      contentText: 'approved'
    });
    expect(attachment.tenantId).toBe('tenant-a');
    expect(listCustomerAttachments(database, tenantA, created.id)).toHaveLength(1);
    expect(() => listCustomerAttachments(database, tenantB, created.id)).toThrow(/Customer is not available/);
`
    : '';
  const notifyAssertions = options.notifyEmailEnabled
    ? `
    const notification = recordCustomerCreatedEmail(database, tenantA, created);
    expect(notification.eventType).toBe('customer.created');
    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);
    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);
`
    : '';
  const filterAssertions = options.tableFilterEnabled
    ? `
    expect(filterCustomers(listCustomers(database, tenantA), { search: 'ACME' })).toHaveLength(1);
    expect(filterCustomers(listCustomers(database, tenantA), { company: 'Unknown' })).toHaveLength(1);
`
    : '';
  const postgresTables = options.ticketEnabled
    ? `
      'customers',
      'customer_attachments',
      'email_notifications',
      'audit_entries',
      'tickets'
    `
    : `
      'customers',
      'customer_attachments',
      'email_notifications',
      'audit_entries'
    `;
  const postgresAssertions = options.postgresEnabled
    ? `
    expect(getRuntimeStore().persistence).toBe('postgres-contract');
    expect(POSTGRES_CONTRACT.tables.map((table) => table.name)).toEqual([${postgresTables}]);
`
    : '';
  const rbacAssertions = options.rbacEnabled
    ? `
    expect(canAccessWorkspace(tenantA, tenantA.tenantId)).toEqual({ allowed: true, reason: 'allowed' });
    expect(canAccessWorkspace(tenantA, tenantB.tenantId)).toEqual({ allowed: false, reason: 'tenant-mismatch' });
`
    : '';

  return `${imports}

describe('runtime customer service', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('creates a customer for tenant a and hides it from tenant b', () => {
    const database = getDatabase();
    const tenantA = login('tenant-a-admin', 'password');
    const tenantB = login('tenant-b-admin', 'password');

    const created = createCustomer(database, tenantA, {
      name: 'Acme',
      email: 'Sales@Acme.test',
      phone: '400-800-9000',
      company: ''
    });

    expect(created.company).toBe('Unknown');
    expect(listCustomers(database, tenantA)).toHaveLength(1);
    expect(listCustomers(database, tenantB)).toHaveLength(0);${auditAssertions}${fileAssertions}${notifyAssertions}${filterAssertions}${postgresAssertions}${rbacAssertions}  });
});
`;
}

function renderTicketRuntimeUnitTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
}): string {
  const auditImport = options.auditEnabled
    ? `
import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';`
    : '';
  const auditAssertions = options.auditEnabled
    ? `
    const createdAuditEntry = createAuditEntry(tenantA, 'ticket.created', 'ticket', String(ticket.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, createdAuditEntry);
    const transitionedAuditEntry = createAuditEntry(tenantA, 'ticket.status_transitioned', 'ticket', String(ticket.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, transitionedAuditEntry);
    expect(database.auditEntries.map((entry) => entry.action)).toEqual(['ticket.created', 'ticket.status_transitioned']);
`
    : '';
  const notifyImport = options.notifyEmailEnabled
    ? `
import { listEmailNotifications, recordTicketCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';`
    : '';
  const exportCsvImport = options.exportCsvEnabled
    ? `
import { exportTicketsToCsv } from '../../../src/installed/export/customer-csv.ts';`
    : '';
  const notifyAssertions = options.notifyEmailEnabled
    ? `
    const notification = recordTicketCreatedEmail(database, tenantA, ticket);
    expect(notification.entity).toBe('ticket');
    expect(notification.entityId).toBe(String(ticket.id));
    expect(notification.eventType).toBe('ticket.created');
    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);
    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);
`
    : '';
  const exportCsvAssertions = options.exportCsvEnabled
    ? `
    const csv = exportTicketsToCsv(listTickets(database, tenantA));
    expect(csv).toContain('id,tenantId,title,description,status,assigneeId,createdBy,updatedAt');
    expect(csv).toContain('tenant-a,Escalate onboarding issue,Customer cannot finish setup,in_progress,support-owner');
`
    : '';

  return `import { beforeEach, describe, expect, it } from 'vitest';
import { login } from '../../../src/installed/auth/session.ts';
import { createTicket, listTickets, listTicketsByAssignee, transitionTicketStatus } from '../../../src/installed/ticket/ticket-service.ts';${auditImport}${notifyImport}${exportCsvImport}
import { getDatabase, resetDatabase } from '../../../lib/store.ts';

describe('runtime ticket service', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('creates, filters, transitions, and isolates tickets by tenant', () => {
    const database = getDatabase();
    const tenantA = login('tenant-a-admin', 'password');
    const tenantB = login('tenant-b-admin', 'password');

    const ticket = createTicket(database, tenantA, {
      title: 'Escalate onboarding issue',
      description: 'Customer cannot finish setup',
      assigneeId: 'support-owner'
    });
    createTicket(database, tenantA, { title: 'Prepare renewal checklist', assigneeId: 'renewal-owner' });
    createTicket(database, tenantB, { title: 'Tenant B support ticket' });

    expect(listTickets(database, tenantA)).toHaveLength(2);
    expect(listTickets(database, tenantB)).toHaveLength(1);
    expect(listTicketsByAssignee(database, tenantA, 'support-owner')).toEqual([ticket]);
    expect(transitionTicketStatus(database, tenantA, ticket.id, 'in_progress').status).toBe('in_progress');${auditAssertions}${notifyAssertions}${exportCsvAssertions}
    expect(() => transitionTicketStatus(database, tenantB, ticket.id, 'closed')).toThrow(/Ticket is not available/);
  });
});
`;
}

function renderRuntimeAcceptanceTest(options: {
  auditEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  rbacEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const uploadSteps = options.fileUploadEnabled
    ? `
  await page.getByLabel('Attachment for Acme').setInputFiles({
    name: 'contract.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('approved')
  });
  await page.getByRole('button', { name: 'Upload attachment for Acme' }).click();
  await expect(createdCustomer).toContainText('contract.txt');
`
    : '';
  const filterSteps = options.tableFilterEnabled
    ? `
  await page.getByLabel('Search customers').fill('acme');
  await page.getByLabel('Company filter').selectOption('Unknown');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(1);
`
    : '';
  const notificationSteps = options.notifyEmailEnabled
    ? `
  await expect(page.getByText('Customer created: Acme')).toBeVisible();
`
    : '';
  const auditSteps = options.auditEnabled
    ? `
  await expect(page.getByRole('list', { name: 'Audit entries' }).getByText('customer.created')).toBeVisible();
`
    : '';
  const rbacSteps = options.rbacEnabled
    ? `
  await expect(page.getByText('Authorization: allowed')).toBeVisible();
  await expect(page.getByText('Cross-tenant check: tenant-mismatch')).toBeVisible();
`
    : '';
  const tenantBAttachmentAssertion = options.fileUploadEnabled
    ? `
  await expect(page.getByText('contract.txt')).toHaveCount(0);`
    : '';

  return `import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string): Promise<void> {
  const response = await page.request.post('/api/session/login', {
    data: { username, password: 'password' }
  });
  expect(response.ok()).toBe(true);
}

test('customer runtime flow keeps tenant data isolated', async ({ page }) => {
  test.setTimeout(60000);

  await signIn(page, 'tenant-a-admin');
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\\/workspace$/);${rbacSteps}

  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\\/customers$/);
  const customerList = page.getByRole('list', { name: 'Customers' });
  await page.getByLabel('Name', { exact: true }).fill('Acme');
  await page.getByLabel('Email', { exact: true }).fill('Sales@Acme.test');
  await page.getByLabel('Phone', { exact: true }).fill('400-800-9000');
  await page.getByLabel('Company', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  const createdCustomer = customerList.getByRole('listitem').filter({ hasText: 'Acme' });
  await expect(createdCustomer).toHaveCount(1);${uploadSteps}${filterSteps}${notificationSteps}${auditSteps}
  await page.request.post('/api/session/logout');
  await signIn(page, 'tenant-b-admin');
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\\/workspace$/);
  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\\/customers$/);
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);${tenantBAttachmentAssertion}
});
`;
}

function renderTicketRuntimeAcceptanceTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
}): string {
  const auditAssertions = options.auditEnabled
    ? `
  const ticketAuditList = page.getByRole('list', { name: 'Ticket audit entries' });
  await expect(ticketAuditList.getByRole('listitem').filter({ hasText: 'ticket.created ticket 1' })).toHaveCount(1);
  await expect(ticketAuditList.getByRole('listitem').filter({ hasText: 'ticket.status_transitioned ticket 1' })).toHaveCount(1);
`
    : '';
  const notificationAssertions = options.notifyEmailEnabled
    ? `
  const ticketNotificationList = page.getByRole('list', { name: 'Ticket notifications' });
  await expect(ticketNotificationList.getByRole('listitem').filter({ hasText: 'Ticket created: Escalate onboarding issue' })).toHaveCount(1);
`
    : '';
  const exportCsvAssertions = options.exportCsvEnabled
    ? `
  await expect(page.getByRole('link', { name: 'Export tickets CSV' })).toBeVisible();
  const exportResponse = await page.request.get('/api/tickets/export');
  expect(exportResponse.ok()).toBe(true);
  expect(exportResponse.headers()['content-type']).toContain('text/csv');
  const csv = await exportResponse.text();
  expect(csv).toContain('id,tenantId,title,description,status,assigneeId,createdBy,updatedAt');
  expect(csv).toContain('tenant-a,Escalate onboarding issue,Customer cannot finish setup,open,support-owner');
`
    : '';

  return `import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string): Promise<void> {
  const response = await page.request.post('/api/session/login', {
    data: { username, password: 'password' }
  });
  expect(response.ok()).toBe(true);
}

test('ticket runtime flow supports assignee filters, status transitions, and tenant isolation', async ({ page }) => {
  test.setTimeout(60000);

  await signIn(page, 'tenant-a-admin');
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\\/workspace$/);

  await page.getByRole('link', { name: '/tickets' }).click();
  await expect(page).toHaveURL(/\\/tickets$/);
  const ticketList = page.getByRole('list', { name: 'Tickets' });
  await page.getByLabel('Ticket title').fill('Escalate onboarding issue');
  await page.getByLabel('Ticket assignee').fill('support-owner');
  await page.getByLabel('Ticket description').fill('Customer cannot finish setup');
  await page.getByRole('button', { name: 'Create Ticket' }).click();${notificationAssertions}${exportCsvAssertions}
  const createdTicket = ticketList.getByRole('listitem').filter({ hasText: 'Escalate onboarding issue' });
  await expect(createdTicket).toContainText('open');

  await page.getByLabel('Ticket title').fill('Prepare renewal checklist');
  await page.getByLabel('Ticket assignee').fill('renewal-owner');
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(ticketList.getByRole('listitem')).toHaveCount(2);

  await page.getByLabel('Assignee filter').selectOption('support-owner');
  await page.getByRole('button', { name: 'Apply ticket filters' }).click();
  await expect(ticketList.getByRole('listitem').filter({ hasText: 'Escalate onboarding issue' })).toHaveCount(1);
  await expect(ticketList.getByRole('listitem').filter({ hasText: 'Prepare renewal checklist' })).toHaveCount(0);

  await createdTicket.getByRole('button', { name: 'Start progress for Escalate onboarding issue' }).click();
  await expect(createdTicket).toContainText('in_progress');${auditAssertions}

  await page.request.post('/api/session/logout');
  await signIn(page, 'tenant-b-admin');
  await page.goto('/workspace');
  await page.getByRole('link', { name: '/tickets' }).click();
  await expect(ticketList.getByRole('listitem').filter({ hasText: 'Escalate onboarding issue' })).toHaveCount(0);
});
`;
}

function scaffoldEntries(lock: LockFile): Array<{ relativePath: string; source: string }> {
  const authEnabled = hasBlock(lock, 'auth/basic-session');
  const customerEnabled = hasBlock(lock, 'entity/customer-basic');
  const ticketEnabled = hasBlock(lock, 'ticket/basic');
  const customerFeatureOptions = {
    auditEnabled: hasBlock(lock, 'audit/basic'),
    fileUploadEnabled: hasBlock(lock, 'file/upload'),
    exportCsvEnabled: hasBlock(lock, 'export/csv-basic'),
    notifyEmailEnabled: hasBlock(lock, 'notify/email-basic'),
    postgresEnabled: hasBlock(lock, 'infra/postgres'),
    rbacEnabled: hasBlock(lock, 'rbac/basic'),
    tableFilterEnabled: hasBlock(lock, 'table/filter-search'),
    ticketEnabled
  };
  const entries: Array<{ relativePath: string; source: string }> = [
    { relativePath: 'app/layout.tsx', source: renderLayout() },
    { relativePath: 'app/page.tsx', source: renderIndexPage(authEnabled) },
    { relativePath: 'lib/store.ts', source: renderStoreLibrary(customerFeatureOptions) }
  ];

  if (authEnabled) {
    entries.push(
      { relativePath: 'app/login/page.tsx', source: renderLoginPage() },
      { relativePath: 'app/workspace/page.tsx', source: renderWorkspacePage(customerFeatureOptions) },
      { relativePath: 'app/api/session/login/route.ts', source: renderLoginRoute() },
      { relativePath: 'app/api/session/logout/route.ts', source: renderLogoutRoute() },
      { relativePath: 'app/api/session/current/route.ts', source: renderCurrentSessionRoute() },
      { relativePath: 'components/login-form.tsx', source: renderLoginForm() },
      { relativePath: 'components/logout-button.tsx', source: renderLogoutButton() },
      { relativePath: 'lib/session.ts', source: renderSessionLibrary() }
    );
  }

  if (customerEnabled) {
    entries.push(
      { relativePath: 'app/customers/page.tsx', source: renderCustomersPage(customerFeatureOptions) },
      { relativePath: 'app/api/customers/route.ts', source: renderCustomersRoute(customerFeatureOptions) },
      { relativePath: 'components/customer-form.tsx', source: renderCustomerForm() },
      { relativePath: 'tests/runtime/unit/customer-runtime.test.ts', source: renderRuntimeUnitTest(customerFeatureOptions) },
      { relativePath: 'tests/runtime/acceptance/customer-flow.spec.ts', source: renderRuntimeAcceptanceTest(customerFeatureOptions) }
    );

    if (customerFeatureOptions.fileUploadEnabled) {
      entries.push(
        { relativePath: 'app/api/customers/[customerId]/attachments/route.ts', source: renderCustomerAttachmentsRoute() },
        { relativePath: 'components/customer-attachment-form.tsx', source: renderCustomerAttachmentForm() }
      );
    }
  }

  if (ticketEnabled) {
    entries.push(
      { relativePath: 'app/tickets/page.tsx', source: renderTicketsPage(customerFeatureOptions) },
      { relativePath: 'app/api/tickets/route.ts', source: renderTicketsRoute(customerFeatureOptions) },
      ...(customerFeatureOptions.exportCsvEnabled
        ? [{ relativePath: 'app/api/tickets/export/route.ts', source: renderTicketExportRoute() }]
        : []),
      { relativePath: 'app/api/tickets/[ticketId]/status/route.ts', source: renderTicketStatusRoute(customerFeatureOptions) },
      { relativePath: 'components/ticket-form.tsx', source: renderTicketForm() },
      { relativePath: 'components/ticket-status-form.tsx', source: renderTicketStatusForm() },
      { relativePath: 'tests/runtime/unit/ticket-runtime.test.ts', source: renderTicketRuntimeUnitTest(customerFeatureOptions) },
      { relativePath: 'tests/runtime/acceptance/ticket-flow.spec.ts', source: renderTicketRuntimeAcceptanceTest(customerFeatureOptions) }
    );
  }

  return entries;
}

function generatedPathsForScaffold(lock: LockFile): string[] {
  const entries = scaffoldEntries(lock).map((entry) => entry.relativePath);
  return [...new Set([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries])].sort((left, right) => left.localeCompare(right));
}

export async function generateRuntimeHostScaffold(workspaceRoot: string, lock: LockFile): Promise<string[]> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const entries = scaffoldEntries(lock);

  for (const entry of entries) {
    const targetPath = path.join(projectRoot, entry.relativePath);
    await ensureDir(path.dirname(targetPath));
    await writeText(targetPath, entry.source);
  }

  return generatedPathsForScaffold(lock);
}
