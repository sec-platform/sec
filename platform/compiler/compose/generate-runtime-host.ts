import path from 'node:path';
import { uniqueSorted } from '../../shared/collections.ts';
import { ensureDir, writeText } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';

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

type OptionalSnippet = readonly [enabled: boolean | undefined, source: string];

function renderOptional(enabled: boolean | undefined, source: string): string {
  return enabled ? source : '';
}

function renderOptionalSnippets(snippets: OptionalSnippet[]): string {
  return snippets.map(([enabled, source]) => renderOptional(enabled, source)).join('');
}

function renderImportBlock(imports: string[]): string {
  return imports.filter(Boolean).join('\n');
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
  const rbacImport = renderOptional(options.rbacEnabled, `
import { canAccessWorkspace } from '../../src/installed/auth/authorize.ts';`);
  const rbacSetup = renderOptional(options.rbacEnabled, `
  const ownWorkspaceDecision = canAccessWorkspace(session, session.tenantId);
  const otherTenantId = session.tenantId === 'tenant-a' ? 'tenant-b' : 'tenant-a';
  const otherWorkspaceDecision = canAccessWorkspace(session, otherTenantId);
`);
  const rbacView = renderOptional(options.rbacEnabled, `
        <div className=\"stack\" aria-label=\"Authorization summary\">
          <p>Authorization: {ownWorkspaceDecision.reason}</p>
          <p>Cross-tenant check: {otherWorkspaceDecision.reason}</p>
        </div>
`);

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
  const imports = renderImportBlock([
    `import Link from 'next/link';`,
    `import { redirect } from 'next/navigation';`,
    `import { CustomerForm } from '../../components/customer-form.tsx';`,
    renderOptional(options.fileUploadEnabled, `import { CustomerAttachmentForm } from '../../components/customer-attachment-form.tsx';`),
    `import { LogoutButton } from '../../components/logout-button.tsx';`,
    `import { getCurrentSession } from '../../lib/session.ts';`,
    `import { getDatabase } from '../../lib/store.ts';`,
    `import { listCustomers } from '../../src/installed/entity/customer-service.ts';`,
    renderOptional(options.fileUploadEnabled, `import { listCustomerAttachments } from '../../src/installed/file/customer-attachments.ts';`),
    renderOptional(options.notifyEmailEnabled, `import { listEmailNotifications } from '../../src/installed/notify/email-outbox.ts';`),
    renderOptional(options.tableFilterEnabled, `import { filterCustomers, listCustomerCompanies } from '../../src/installed/table/customer-filter.ts';`)
  ]);

  const searchSetup = options.tableFilterEnabled
    ? `  const params = await searchParams;
  const search = typeof params?.search === 'string' ? params.search : '';
  const company = typeof params?.company === 'string' ? params.company : '';
  const customers = filterCustomers(allCustomers, { search, company });
  const companies = listCustomerCompanies(allCustomers);
`
    : `  const customers = allCustomers;
`;
  const tableFilters = renderOptional(options.tableFilterEnabled, `
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
`);
  const attachmentSetup = renderOptional(options.fileUploadEnabled, `  const attachmentsByCustomer = new Map(customers.map((customer) => [customer.id, listCustomerAttachments(database, session, customer.id)]));
`);
  const attachmentView = renderOptional(options.fileUploadEnabled, `
              <div className=\"stack\" style={{ marginTop: 12 }}>
                <CustomerAttachmentForm customerId={customer.id} customerName={customer.name} />
                <ul className=\"clean\" aria-label={\`Attachments for \${customer.name}\`}>
                  {(attachmentsByCustomer.get(customer.id) ?? []).map((attachment) => (
                    <li key={attachment.id}>{attachment.fileName} ({attachment.contentType})</li>
                  ))}
                </ul>
              </div>`);
  const notificationSetup = renderOptional(options.notifyEmailEnabled, `  const notifications = listEmailNotifications(database, session);
`);
  const auditSetup = renderOptional(options.auditEnabled, `  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId);
`);
  const notificationView = renderOptional(options.notifyEmailEnabled, `
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
`);
  const auditView = renderOptional(options.auditEnabled, `
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
`);

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
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  const ticketSummaryExportEnabled = options.ticketReportingEnabled && options.exportCsvEnabled;
  const auditSetup = renderOptional(options.auditEnabled, `  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId && entry.entity === 'ticket');
`);
  const attachmentSetup = `  const attachmentsByTicket = new Map(tickets.map((ticket) => [ticket.id, listTicketAttachments(database, session, ticket.id)]));
`;
  const commentSetup = `  const commentsByTicket = new Map(tickets.map((ticket) => [ticket.id, listTicketComments(database, session, ticket.id)]));
`;
  const notificationSetup = renderOptional(options.notifyEmailEnabled, `  const ticketNotifications = listEmailNotifications(database, session).filter((notification) => notification.entity === 'ticket');
`);
  const reportingSetup = renderOptional(options.ticketReportingEnabled, `  const ticketSummary = summarizeTickets(tickets);
`);
  const worklogSetup = renderOptional(options.worklogEnabled, `  const worklogsByTicket = new Map(tickets.map((ticket) => [ticket.id, listWorklogs(database, session, ticket.id)]));
  const worklogMinutesByTicket = new Map(tickets.map((ticket) => [ticket.id, summarizeWorklogMinutes(database, session, ticket.id)]));
`);
  const attachmentView = `
              <div className="stack" style={{ marginTop: 12 }}>
                <TicketAttachmentForm ticketId={ticket.id} ticketTitle={ticket.title} />
                <ul className="clean" aria-label={\`Attachments for \${ticket.title}\`}>
                  {(attachmentsByTicket.get(ticket.id) ?? []).map((attachment) => (
                    <li key={attachment.id}>{attachment.fileName} ({attachment.contentType})</li>
                  ))}
                  {(attachmentsByTicket.get(ticket.id) ?? []).length === 0 ? <li>No attachments yet.</li> : null}
                </ul>
              </div>`;
  const commentView = `
              <div className="stack" style={{ marginTop: 12 }}>
                <TicketCommentForm ticketId={ticket.id} ticketTitle={ticket.title} />
                <ul className="clean" aria-label={\`Comments for \${ticket.title}\`}>
                  {(commentsByTicket.get(ticket.id) ?? []).map((comment) => (
                    <li key={comment.id}>{comment.authorId}: {comment.body}</li>
                  ))}
                  {(commentsByTicket.get(ticket.id) ?? []).length === 0 ? <li>No comments yet.</li> : null}
                </ul>
              </div>`;
  const worklogView = renderOptional(options.worklogEnabled, `
              <div className="stack" style={{ marginTop: 12 }}>
                <TicketWorklogForm ticketId={ticket.id} ticketTitle={ticket.title} />
                <div>Total worklog minutes: {worklogMinutesByTicket.get(ticket.id) ?? 0}</div>
                <ul className="clean" aria-label={\`Worklogs for \${ticket.title}\`}>
                  {(worklogsByTicket.get(ticket.id) ?? []).map((worklog) => (
                    <li key={worklog.id}>{worklog.minutes}m by {worklog.authorId}: {worklog.note || 'No note'}</li>
                  ))}
                  {(worklogsByTicket.get(ticket.id) ?? []).length === 0 ? <li>No worklogs yet.</li> : null}
                </ul>
              </div>`);
  const notificationView = renderOptional(options.notifyEmailEnabled, `
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
`);
  const exportAction = renderOptional(options.exportCsvEnabled, `
            <a href={exportHref}>Export tickets CSV</a>`);
  const auditView = renderOptional(options.auditEnabled, `
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
`);
  const summaryExportAction = renderOptional(ticketSummaryExportEnabled, `
            <a href={summaryExportHref}>Export ticket summary CSV</a>`);
  const summaryExportHrefSetup = renderOptional(ticketSummaryExportEnabled, `  const summaryExportHref = queryString ? '/api/tickets/summary/export?' + queryString : '/api/tickets/summary/export';
`);
  const reportingView = renderOptional(options.ticketReportingEnabled, `
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Ticket Summary</h2>
          <div className="row">
            <a href={summaryHref}>View ticket summary JSON</a>${summaryExportAction}
          </div>
        </div>
        <p>Total tickets: {ticketSummary.total}</p>
        <ul className="clean" aria-label="Ticket SLA summary">
          <li>Overdue: {ticketSummary.sla.overdue}</li>
          <li>Due soon: {ticketSummary.sla.dueSoon}</li>
          <li>Unscheduled: {ticketSummary.sla.unscheduled}</li>
        </ul>
        <ul className="clean" aria-label="Ticket status summary">
          <li>Open: {ticketSummary.byStatus.open}</li>
          <li>In progress: {ticketSummary.byStatus.in_progress}</li>
          <li>Closed: {ticketSummary.byStatus.closed}</li>
        </ul>
        <ul className="clean" aria-label="Assignee summary">
          {ticketSummary.byAssignee.map((entry) => (
            <li key={entry.assigneeId}>{entry.assigneeId}: {entry.count}</li>
          ))}
          {ticketSummary.byAssignee.length === 0 ? <li>No assignee summary yet.</li> : null}
        </ul>
      </section>
`);

  return `import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TicketAttachmentForm } from '../../components/ticket-attachment-form.tsx';
import { TicketCommentForm } from '../../components/ticket-comment-form.tsx';${renderOptional(options.worklogEnabled, `
import { TicketWorklogForm } from '../../components/ticket-worklog-form.tsx';`)}
import { TicketForm } from '../../components/ticket-form.tsx';
import { TicketStatusForm } from '../../components/ticket-status-form.tsx';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { getDatabase } from '../../lib/store.ts';
import { listTicketAttachments, listTicketComments, listTickets, listTicketsWithFilters, type TicketFilters } from '../../src/installed/ticket/ticket-service.ts';${renderOptional(options.notifyEmailEnabled, `\nimport { listEmailNotifications } from '../../src/installed/notify/email-outbox.ts';`)}${renderOptional(options.ticketReportingEnabled, `\nimport { summarizeTickets } from '../../src/installed/reporting/ticket-summary.ts';`)}${renderOptional(options.worklogEnabled, `\nimport { listWorklogs, summarizeWorklogMinutes } from '../../src/installed/worklog/worklog-service.ts';`)}

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
  const status = typeof params?.status === 'string' ? params.status : '';
  const database = getDatabase();
  const allTickets = listTickets(database, session);
  const filters: TicketFilters = {
    ...(assignee ? { assigneeId: assignee } : {}),
    ...(status === 'open' || status === 'in_progress' || status === 'closed' ? { status } : {})
  };
  const tickets = listTicketsWithFilters(database, session, filters);
  const assignees = Array.from(new Set(allTickets.map((ticket) => ticket.assigneeId))).sort((left, right) => left.localeCompare(right));
  const summaryQuery = new URLSearchParams();
  if (assignee) {
    summaryQuery.set('assigneeId', assignee);
  }
  if (status) {
    summaryQuery.set('status', status);
  }
  const queryString = summaryQuery.toString();
  const exportHref = queryString ? '/api/tickets/export?' + queryString : '/api/tickets/export';
  const summaryHref = queryString ? '/api/tickets/summary?' + queryString : '/api/tickets/summary';
${summaryExportHrefSetup}${attachmentSetup}${commentSetup}${worklogSetup}${notificationSetup}${reportingSetup}${auditSetup}
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
          <label style={{ flex: 1 }}>
            Status
            <select aria-label="Ticket status filter" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="closed">Closed</option>
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
              <div>Due date: {ticket.dueDate || 'Unscheduled'}</div>
              <TicketStatusForm ticketId={ticket.id} ticketTitle={ticket.title} currentStatus={ticket.status} />${attachmentView}${commentView}${worklogView}
            </li>
          ))}
          {tickets.length === 0 ? <li>No tickets yet.</li> : null}
        </ul>
      </section>${reportingView}${notificationView}${auditView}
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
  return renderEntityApiRoute({
    entityName: 'customer',
    entityType: 'Customer',
    entityPath: 'entity/customer-service.ts',
    listFunction: 'listCustomers',
    createFunction: 'createCustomer',
    inputType: 'CustomerInput',
    auditEnabled: options.auditEnabled,
    notifyEmailEnabled: options.notifyEmailEnabled,
    notifyFunction: 'recordCustomerCreatedEmail',
    tableFilterEnabled: options.tableFilterEnabled,
    filterFunction: 'filterCustomers'
  });
}

function renderRouteLines(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

function renderSessionGuard(): string {
  return `  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }`;
}

function renderReadTicketFilters(): string {
  return `function readTicketFilters(request: Request): TicketFilters {
  const url = new URL(request.url);
  const assigneeId = url.searchParams.get('assigneeId');
  const status = url.searchParams.get('status');
  return {
    ...(assigneeId ? { assigneeId } : {}),
    ...(status === 'open' || status === 'in_progress' || status === 'closed' ? { status: status as TicketStatus } : {})
  };
}`;
}

type NestedResourceRouteOptions = {
  imports: string[];
  contextName: string;
  paramName: string;
  invalidRequestMessage: string;
  getBody: string[];
  postBody: string[];
};

function renderNestedResourceRoute(options: NestedResourceRouteOptions): string {
  return `${options.imports.join('\n')}

interface ${options.contextName} {
  params: Promise<{ ${options.paramName}: string }>;
}

export async function GET(_request: Request, context: ${options.contextName}) {
${renderSessionGuard()}

  try {
${renderRouteLines(options.getBody)}  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '${options.invalidRequestMessage}' }, { status: 400 });
  }
}

export async function POST(request: Request, context: ${options.contextName}) {
${renderSessionGuard()}

  try {
${renderRouteLines(options.postBody)}  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '${options.invalidRequestMessage}' }, { status: 400 });
  }
}
`;
}

type TicketFilterGetRouteOptions = {
  imports: string[];
  body: string[];
};

function renderTicketFilterGetRoute(options: TicketFilterGetRouteOptions): string {
  return `${options.imports.join('\n')}

${renderReadTicketFilters()}

export async function GET(request: Request) {
${renderSessionGuard()}

${renderRouteLines(options.body)}}
`;
}

function renderCustomerAttachmentsRoute(): string {
  return renderNestedResourceRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import { addCustomerAttachment, listCustomerAttachments } from '../../../../../src/installed/file/customer-attachments.ts';`,
      `import { getCurrentSession } from '../../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../../lib/store.ts';`
    ],
    contextName: 'AttachmentRouteContext',
    paramName: 'customerId',
    invalidRequestMessage: 'Invalid attachment request',
    getBody: [
      '    const params = await context.params;',
      '    const customerId = Number(params.customerId);',
      '    const attachments = listCustomerAttachments(getDatabase(), session, customerId);',
      '    return NextResponse.json({ attachments });'
    ],
    postBody: [
      '    const params = await context.params;',
      '    const customerId = Number(params.customerId);',
      '    const formData = await request.formData();',
      "    const file = formData.get('file');",
      '    if (!(file instanceof File)) {',
      "      return NextResponse.json({ error: 'Missing file' }, { status: 400 });",
      '    }',
      '',
      '    const attachment = addCustomerAttachment(getDatabase(), session, {',
      '      customerId,',
      '      fileName: file.name,',
      "      contentType: file.type || 'application/octet-stream',",
      '      size: file.size,',
      '      contentText: await file.text()',
      '    });',
      '    return NextResponse.json({ attachment }, { status: 201 });'
    ]
  });
}

function renderTicketAttachmentsRoute(): string {
  return renderNestedResourceRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import { addTicketAttachment, listTicketAttachments } from '../../../../../src/installed/ticket/ticket-service.ts';`,
      `import { getCurrentSession } from '../../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../../lib/store.ts';`
    ],
    contextName: 'TicketAttachmentRouteContext',
    paramName: 'ticketId',
    invalidRequestMessage: 'Invalid attachment request',
    getBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const attachments = listTicketAttachments(getDatabase(), session, ticketId);',
      '    return NextResponse.json({ attachments });'
    ],
    postBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const formData = await request.formData();',
      "    const file = formData.get('file');",
      '    if (!(file instanceof File)) {',
      "      return NextResponse.json({ error: 'Missing file' }, { status: 400 });",
      '    }',
      '',
      '    const attachment = addTicketAttachment(getDatabase(), session, {',
      '      ticketId,',
      '      fileName: file.name,',
      "      contentType: file.type || 'application/octet-stream',",
      '      size: file.size,',
      '      contentText: await file.text()',
      '    });',
      '    return NextResponse.json({ attachment }, { status: 201 });'
    ]
  });
}

function renderTicketCommentsRoute(): string {
  return renderNestedResourceRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import { addTicketComment, listTicketComments } from '../../../../../src/installed/ticket/ticket-service.ts';`,
      `import { getCurrentSession } from '../../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../../lib/store.ts';`
    ],
    contextName: 'TicketCommentRouteContext',
    paramName: 'ticketId',
    invalidRequestMessage: 'Invalid comment request',
    getBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const comments = listTicketComments(getDatabase(), session, ticketId);',
      '    return NextResponse.json({ comments });'
    ],
    postBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const payload = await request.json() as { body?: string };',
      '    const comment = addTicketComment(getDatabase(), session, {',
      '      ticketId,',
      "      body: payload.body ?? ''",
      '    });',
      '    return NextResponse.json({ comment }, { status: 201 });'
    ]
  });
}

function renderTicketWorklogsRoute(): string {
  return renderNestedResourceRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import { listWorklogs, recordWorklog, summarizeWorklogMinutes } from '../../../../../src/installed/worklog/worklog-service.ts';`,
      `import { getCurrentSession } from '../../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../../lib/store.ts';`
    ],
    contextName: 'TicketWorklogRouteContext',
    paramName: 'ticketId',
    invalidRequestMessage: 'Invalid worklog request',
    getBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const database = getDatabase();',
      '    return NextResponse.json({',
      '      worklogs: listWorklogs(database, session, ticketId),',
      '      totalMinutes: summarizeWorklogMinutes(database, session, ticketId)',
      '    });'
    ],
    postBody: [
      '    const params = await context.params;',
      '    const ticketId = Number(params.ticketId);',
      '    const payload = await request.json() as { minutes?: number; note?: string };',
      '    const worklog = recordWorklog(getDatabase(), session, {',
      '      ticketId,',
      '      minutes: Number(payload.minutes ?? 0),',
      "      note: payload.note ?? ''",
      '    });',
      '    return NextResponse.json({ worklog }, { status: 201 });'
    ]
  });
}

function renderTicketsRoute(options: { auditEnabled: boolean; notifyEmailEnabled: boolean }): string {
  return renderEntityApiRoute({
    entityName: 'ticket',
    entityType: 'Ticket',
    entityPath: 'ticket/ticket-service.ts',
    listFunction: 'listTicketsWithFilters',
    createFunction: 'createTicket',
    inputType: 'TicketInput',
    auditEnabled: options.auditEnabled,
    notifyEmailEnabled: options.notifyEmailEnabled,
    notifyFunction: 'recordTicketCreatedEmail',
    tableFilterEnabled: false,
    extraImports: [`import type { TicketStatus } from '../../../src/runtime/database.ts';`],
    customGetBlock: `  const tickets = listTicketsWithFilters(getDatabase(), session, readTicketFilters(request));`,
    extraTopLevelCode: renderReadTicketFilters()
  });
}

function renderTicketExportRoute(): string {
  return renderTicketFilterGetRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import type { TicketStatus } from '../../../../src/runtime/database.ts';`,
      `import { exportTicketsToCsv } from '../../../../src/installed/export/customer-csv.ts';`,
      `import { listTicketsWithFilters, type TicketFilters } from '../../../../src/installed/ticket/ticket-service.ts';`,
      `import { getCurrentSession } from '../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../lib/store.ts';`
    ],
    body: [
      '  const csv = exportTicketsToCsv(listTicketsWithFilters(getDatabase(), session, readTicketFilters(request)));',
      '  return new NextResponse(csv, {',
      '    headers: {',
      `      'content-disposition': 'attachment; filename="tickets.csv"',`,
      `      'content-type': 'text/csv; charset=utf-8'`,
      '    }',
      '  });'
    ]
  });
}

function renderTicketSummaryRoute(): string {
  return renderTicketFilterGetRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import type { TicketStatus } from '../../../../src/runtime/database.ts';`,
      `import { summarizeTickets } from '../../../../src/installed/reporting/ticket-summary.ts';`,
      `import { listTicketsWithFilters, type TicketFilters } from '../../../../src/installed/ticket/ticket-service.ts';`,
      `import { getCurrentSession } from '../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../lib/store.ts';`
    ],
    body: [
      '  const tickets = listTicketsWithFilters(getDatabase(), session, readTicketFilters(request));',
      '  return NextResponse.json({ summary: summarizeTickets(tickets) });'
    ]
  });
}

function renderTicketSummaryExportRoute(): string {
  return renderTicketFilterGetRoute({
    imports: [
      `import { NextResponse } from 'next/server';`,
      `import type { TicketStatus } from '../../../../../src/runtime/database.ts';`,
      `import { exportTicketSummaryToCsv } from '../../../../../src/installed/export/customer-csv.ts';`,
      `import { summarizeTickets } from '../../../../../src/installed/reporting/ticket-summary.ts';`,
      `import { listTicketsWithFilters, type TicketFilters } from '../../../../../src/installed/ticket/ticket-service.ts';`,
      `import { getCurrentSession } from '../../../../../lib/session.ts';`,
      `import { getDatabase } from '../../../../../lib/store.ts';`
    ],
    body: [
      '  const tickets = listTicketsWithFilters(getDatabase(), session, readTicketFilters(request));',
      '  const csv = exportTicketSummaryToCsv(summarizeTickets(tickets));',
      '  return new NextResponse(csv, {',
      '    headers: {',
      `      'content-disposition': 'attachment; filename="ticket-summary.csv"',`,
      `      'content-type': 'text/csv; charset=utf-8'`,
      '    }',
      '  });'
    ]
  });
}

function renderClientMutationState(): string {
  return `  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);`;
}

function renderFormSubmitStart(): string {
  return `    event.preventDefault();
    setPending(true);
    setError(null);`;
}

function renderMutationStart(): string {
  return `    setPending(true);
    setError(null);`;
}

function renderMutationError(fallbackMessage: string): string {
  return `    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? '${fallbackMessage}');
      setPending(false);
      return;
    }`;
}

function renderTicketStatusRoute(options: { auditEnabled: boolean }): string {
  const auditImport = renderOptional(options.auditEnabled, `
import { appendAuditEntry, createAuditEntry } from '../../../../../src/installed/audit/logger.ts';`);
  const auditLine = renderOptional(options.auditEnabled, `    const auditAction = ticket.status === 'closed' ? 'ticket.closed' : 'ticket.status_transitioned';
    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, auditAction, 'ticket', String(ticket.id)));
`);

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
${renderSessionGuard()}

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


type EntityApiRouteOptions = {
  entityName: string;
  entityType: string;
  entityPath: string;
  listFunction: string;
  createFunction: string;
  inputType: string;
  auditEnabled: boolean;
  notifyEmailEnabled: boolean;
  notifyFunction?: string;
  tableFilterEnabled: boolean;
  filterFunction?: string;
  extraImports?: string[];
  customGetBlock?: string;
  extraTopLevelCode?: string;
};

function renderEntityApiRoute(options: EntityApiRouteOptions): string {
  const imports = renderImportBlock([
    `import { NextResponse } from 'next/server';`,
    `import type { ${options.inputType} } from '../../../src/runtime/database.ts';`,
    `import { ${options.createFunction}, ${options.listFunction} } from '../../../src/installed/${options.entityPath}';`,
    renderOptional(options.auditEnabled, `import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';`),
    renderOptional(options.notifyEmailEnabled && !!options.notifyFunction, `import { ${options.notifyFunction} } from '../../../src/installed/notify/email-outbox.ts';`),
    renderOptional(options.tableFilterEnabled && !!options.filterFunction, `import { ${options.filterFunction} } from '../../../src/installed/table/customer-filter.ts';`),
    `import { getCurrentSession } from '../../../lib/session.ts';`,
    `import { getDatabase } from '../../../lib/store.ts';`,
    ...(options.extraImports ?? [])
  ]);
  const getBlock = options.customGetBlock ?? (options.tableFilterEnabled
    ? `  const database = getDatabase();
  const url = new URL(request.url);
  const ${options.entityName}s = ${options.filterFunction}(${options.listFunction}(database, session), {
    search: url.searchParams.get('search'),
    company: url.searchParams.get('company')
  });
`
    : `  const database = getDatabase();
  const ${options.entityName}s = ${options.listFunction}(database, session);
`);
  const mutationLines = renderOptionalSnippets([
    [options.auditEnabled, `    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, '${options.entityName}.created', '${options.entityName}', String(${options.entityName}.id)));
`],
    [options.notifyEmailEnabled && !!options.notifyFunction, `    ${options.notifyFunction}(database, session, ${options.entityName});
`]
  ]);

  return `${imports}
${options.extraTopLevelCode ?? ''}
export async function GET(request: Request) {
${renderSessionGuard()}

${getBlock}  return NextResponse.json({ ${options.entityName}s });
}

export async function POST(request: Request) {
${renderSessionGuard()}

  try {
    const database = getDatabase();
    const payload = await request.json() as ${options.inputType};
    const ${options.entityName} = ${options.createFunction}(database, session, payload);
${mutationLines}    return NextResponse.json({ ${options.entityName} }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });
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
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch('/api/session/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

${renderMutationError('Login failed')}

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
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(form)
    });

${renderMutationError('Unable to create customer')}

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

type FileUploadFormOptions = { componentName: string; idProp: string; titleProp: string; fetchPath: string; afterSuccess: string; useRouter?: boolean };

function renderFileUploadForm(options: FileUploadFormOptions): string {
  const propsName = `${options.componentName}Props`;
  const routerImport = renderOptional(options.useRouter, `import { useRouter } from 'next/navigation';\n`);
  const routerSetup = renderOptional(options.useRouter, `  const router = useRouter();\n`);

  return `'use client';

${routerImport}import { type FormEvent, useRef, useState } from 'react';

interface ${propsName} {
  ${options.idProp}: number;
  ${options.titleProp}: string;
}

export function ${options.componentName}({ ${options.idProp}, ${options.titleProp} }: ${propsName}) {
${routerSetup}  const formRef = useRef<HTMLFormElement>(null);
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch(${options.fetchPath}, {
      method: 'POST',
      body: new FormData(event.currentTarget)
    });

${renderMutationError('Unable to upload attachment')}

${options.afterSuccess}
  }

  return (
    <form ref={formRef} className="row" onSubmit={handleSubmit}>
      <label style={{ flex: 1 }}>
        Attachment
        <input aria-label={\`Attachment for \${${options.titleProp}}\`} name="file" type="file" />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Uploading...' : \`Upload attachment for \${${options.titleProp}}\`}</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
`;
}

function renderCustomerAttachmentForm(): string {
  return renderFileUploadForm({
    componentName: 'CustomerAttachmentForm',
    idProp: 'customerId',
    titleProp: 'customerName',
    fetchPath: '`/api/customers/${customerId}/attachments`',
    useRouter: true,
    afterSuccess: `    formRef.current?.reset();
    setPending(false);
    router.refresh();`
  });
}

function renderTicketAttachmentForm(): string {
  return renderFileUploadForm({
    componentName: 'TicketAttachmentForm',
    idProp: 'ticketId',
    titleProp: 'ticketTitle',
    fetchPath: '`/api/tickets/${ticketId}/attachments`',
    afterSuccess: `    formRef.current?.reset();
    setPending(false);
    window.location.reload();`
  });
}

function renderTicketCommentForm(): string {
  return `'use client';

import { type FormEvent, useState } from 'react';

interface TicketCommentFormProps {
  ticketId: number;
  ticketTitle: string;
}

export function TicketCommentForm({ ticketId, ticketTitle }: TicketCommentFormProps) {
  const [body, setBody] = useState('');
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch(\`/api/tickets/\${ticketId}/comments\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ body })
    });

${renderMutationError('Unable to add comment')}

    setBody('');
    setPending(false);
    window.location.reload();
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Comment for {ticketTitle}
        <textarea
          aria-label={\`Comment for \${ticketTitle}\`}
          name="body"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" disabled={pending}>{pending ? 'Saving...' : \`Add comment for \${ticketTitle}\`}</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
`;
}

function renderTicketWorklogForm(): string {
  return `'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

interface TicketWorklogFormProps {
  ticketId: number;
  ticketTitle: string;
}

export function TicketWorklogForm({ ticketId, ticketTitle }: TicketWorklogFormProps) {
  const router = useRouter();
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch(\`/api/tickets/\${ticketId}/worklogs\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ minutes: Number(minutes), note })
    });

${renderMutationError('Unable to record worklog')}

    setMinutes('');
    setNote('');
    setPending(false);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="row">
        <label style={{ flex: 1 }}>
          Minutes for {ticketTitle}
          <input
            aria-label={\`Worklog minutes for \${ticketTitle}\`}
            min="1"
            type="number"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label style={{ flex: 2 }}>
          Note
          <input
            aria-label={\`Worklog note for \${ticketTitle}\`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button type="submit" disabled={pending}>{pending ? 'Saving...' : \`Add worklog for \${ticketTitle}\`}</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
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
  assigneeId: '',
  dueDate: ''
};

export function TicketForm() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL_STATE);
${renderClientMutationState()}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
${renderFormSubmitStart()}

    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(form)
    });

${renderMutationError('Unable to create ticket')}

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
        <label style={{ flex: 1 }}>
          Due date
          <input aria-label="Ticket due date" type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
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
${renderClientMutationState()}
  const nextStatus = NEXT_STATUS[currentStatus];

  async function transitionStatus() {
${renderMutationStart()}

    const response = await fetch(\`/api/tickets/\${ticketId}/status\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ status: nextStatus })
    });

${renderMutationError('Unable to update ticket')}

    setPending(false);
    window.location.reload();
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
  worklogEnabled: boolean;
}): string {
  const imports = renderImportBlock([
    `import { beforeEach, describe, expect, it } from 'vitest';`,
    `import { login } from '../../../src/installed/auth/session.ts';`,
    `import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';`,
    renderOptional(options.auditEnabled, `import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';`),
    renderOptional(options.fileUploadEnabled, `import { addCustomerAttachment, listCustomerAttachments } from '../../../src/installed/file/customer-attachments.ts';`),
    renderOptional(options.notifyEmailEnabled, `import { listEmailNotifications, recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';`),
    renderOptional(options.postgresEnabled, `import { POSTGRES_CONTRACT } from '../../../src/installed/infra/postgres-contract.ts';`),
    renderOptional(options.rbacEnabled, `import { canAccessWorkspace } from '../../../src/installed/auth/authorize.ts';`),
    renderOptional(options.tableFilterEnabled, `import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';`),
    options.postgresEnabled ? `import { getDatabase, getRuntimeStore, resetDatabase } from '../../../lib/store.ts';` : `import { getDatabase, resetDatabase } from '../../../lib/store.ts';`
  ]);
  const postgresTables = [
    'customers',
    'customer_attachments',
    'email_notifications',
    'audit_entries',
    ...(options.ticketEnabled ? ['tickets', 'ticket_attachments', 'ticket_comments'] : []),
    ...(options.ticketEnabled && options.worklogEnabled ? ['worklogs'] : [])
  ];
  const postgresTableList = postgresTables.map((table) => `      '${table}'`).join(',\n');
  const featureAssertions = renderOptionalSnippets([
    [options.auditEnabled, `
    const auditEntry = createAuditEntry(tenantA, 'customer.created', 'customer', String(created.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, auditEntry);
    expect(database.auditEntries).toEqual([auditEntry]);
    expect(auditEntry.occurredAt).toBe('1970-01-01T00:00:00.000Z');
`],
    [options.fileUploadEnabled, `
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
`],
    [options.notifyEmailEnabled, `
    const notification = recordCustomerCreatedEmail(database, tenantA, created);
    expect(notification.eventType).toBe('customer.created');
    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);
    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);
`],
    [options.tableFilterEnabled, `
    expect(filterCustomers(listCustomers(database, tenantA), { search: 'ACME' })).toHaveLength(1);
    expect(filterCustomers(listCustomers(database, tenantA), { company: 'Unknown' })).toHaveLength(1);
`],
    [options.postgresEnabled, `
    expect(getRuntimeStore().persistence).toBe('postgres-contract');
    expect(POSTGRES_CONTRACT.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
${postgresTableList}
      ])
    );
`],
    [options.rbacEnabled, `
    expect(canAccessWorkspace(tenantA, tenantA.tenantId)).toEqual({ allowed: true, reason: 'allowed' });
    expect(canAccessWorkspace(tenantA, tenantB.tenantId)).toEqual({ allowed: false, reason: 'tenant-mismatch' });
`]
  ]);

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
    expect(listCustomers(database, tenantB)).toHaveLength(0);${featureAssertions}  });
});
`;
}

function renderTicketRuntimeUnitTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  const featureImports = renderOptionalSnippets([
    [options.auditEnabled, `
import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';`],
    [options.notifyEmailEnabled, `
import { listEmailNotifications, recordTicketCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';`],
    [options.exportCsvEnabled, `
import { exportTicketsToCsv } from '../../../src/installed/export/customer-csv.ts';`],
    [options.ticketReportingEnabled, `
import { summarizeTickets } from '../../../src/installed/reporting/ticket-summary.ts';
import { listTicketsWithFilters } from '../../../src/installed/ticket/ticket-service.ts';`],
    [options.worklogEnabled, `
import { listWorklogs, recordWorklog, summarizeWorklogMinutes } from '../../../src/installed/worklog/worklog-service.ts';`]
  ]);
  const featureAssertions = renderOptionalSnippets([
    [options.auditEnabled, `
    const createdAuditEntry = createAuditEntry(tenantA, 'ticket.created', 'ticket', String(ticket.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, createdAuditEntry);
    const transitionedAuditEntry = createAuditEntry(tenantA, 'ticket.status_transitioned', 'ticket', String(ticket.id));
    database.auditEntries = appendAuditEntry(database.auditEntries, transitionedAuditEntry);
    expect(database.auditEntries.map((entry) => entry.action)).toEqual(['ticket.created', 'ticket.status_transitioned']);
`],
    [options.notifyEmailEnabled, `
    const notification = recordTicketCreatedEmail(database, tenantA, ticket);
    expect(notification.entity).toBe('ticket');
    expect(notification.entityId).toBe(String(ticket.id));
    expect(notification.eventType).toBe('ticket.created');
    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);
    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);
`],
    [options.exportCsvEnabled, `
    const csv = exportTicketsToCsv(listTickets(database, tenantA));
    expect(csv).toContain('id,tenantId,title,description,status,assigneeId,dueDate,createdBy,updatedAt');
    expect(csv).toContain('tenant-a,Escalate onboarding issue,Customer cannot finish setup,in_progress,support-owner,2026-04-20');
`],
    [options.ticketReportingEnabled, `
    const summary = summarizeTickets(listTickets(database, tenantA));
    expect(summary.total).toBe(2);
    expect(summary.byStatus.in_progress).toBe(1);
    expect(summary.sla).toEqual({ overdue: 1, dueSoon: 1, unscheduled: 0 });
    expect(summary.byAssignee).toEqual([
      { assigneeId: 'renewal-owner', count: 1 },
      { assigneeId: 'support-owner', count: 1 }
    ]);
    const filteredSummary = summarizeTickets(listTicketsWithFilters(database, tenantA, { status: 'in_progress' }));
    expect(filteredSummary.total).toBe(1);
    expect(filteredSummary.byStatus.in_progress).toBe(1);
    expect(filteredSummary.sla).toEqual({ overdue: 1, dueSoon: 0, unscheduled: 0 });
    expect(filteredSummary.byAssignee).toEqual([{ assigneeId: 'support-owner', count: 1 }]);
`],
    [options.worklogEnabled, `
    const worklog = recordWorklog(database, tenantA, {
      ticketId: ticket.id,
      minutes: 45,
      note: 'Investigated customer setup logs'
    });
    expect(worklog.authorId).toBe('user-tenant-a-admin');
    expect(listWorklogs(database, tenantA, ticket.id)).toHaveLength(1);
    expect(summarizeWorklogMinutes(database, tenantA, ticket.id)).toBe(45);
    expect(() => listWorklogs(database, tenantB, ticket.id)).toThrow(/Ticket is not available/);
`]
  ]);

  return `import { beforeEach, describe, expect, it } from 'vitest';
import { login } from '../../../src/installed/auth/session.ts';
import { addTicketAttachment, addTicketComment, createTicket, listTicketAttachments, listTicketComments, listTickets, listTicketsByAssignee, transitionTicketStatus } from '../../../src/installed/ticket/ticket-service.ts';${featureImports}
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
      assigneeId: 'support-owner',
      dueDate: '2026-04-20'
    });
    createTicket(database, tenantA, { title: 'Prepare renewal checklist', assigneeId: 'renewal-owner', dueDate: '2026-05-01' });
    createTicket(database, tenantB, { title: 'Tenant B support ticket' });

    expect(listTickets(database, tenantA)).toHaveLength(2);
    expect(listTickets(database, tenantB)).toHaveLength(1);
    expect(listTicketsByAssignee(database, tenantA, 'support-owner')).toEqual([ticket]);
    const attachment = addTicketAttachment(database, tenantA, {
      ticketId: ticket.id,
      fileName: 'incident.txt',
      contentType: 'text/plain',
      size: 12,
      contentText: 'triage notes'
    });
    expect(attachment.fileName).toBe('incident.txt');
    expect(listTicketAttachments(database, tenantA, ticket.id)).toHaveLength(1);
    expect(() => listTicketAttachments(database, tenantB, ticket.id)).toThrow(/Ticket is not available/);
    const comment = addTicketComment(database, tenantA, {
      ticketId: ticket.id,
      body: 'Customer is waiting for an update'
    });
    expect(comment.authorId).toBe('user-tenant-a-admin');
    expect(listTicketComments(database, tenantA, ticket.id)).toHaveLength(1);
    expect(() => listTicketComments(database, tenantB, ticket.id)).toThrow(/Ticket is not available/);
    expect(() => addTicketComment(database, tenantA, { ticketId: ticket.id, body: '   ' })).toThrow(/Ticket comment is required/);
    expect(transitionTicketStatus(database, tenantA, ticket.id, 'in_progress').status).toBe('in_progress');${featureAssertions}
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
  const workspaceAssertions = renderOptional(options.rbacEnabled, `
  await expect(page.getByText('Authorization: allowed')).toBeVisible();
  await expect(page.getByText('Cross-tenant check: tenant-mismatch')).toBeVisible();
`);
  const customerSteps = renderOptionalSnippets([
    [options.fileUploadEnabled, `
  await page.getByLabel('Attachment for Acme').setInputFiles({
    name: 'contract.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('approved')
  });
  await page.getByRole('button', { name: 'Upload attachment for Acme' }).click();
  await expect(createdCustomer).toContainText('contract.txt');
`],
    [options.tableFilterEnabled, `
  await page.getByLabel('Search customers').fill('acme');
  await page.getByLabel('Company filter').selectOption('Unknown');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(1);
`],
    [options.notifyEmailEnabled, `
  await expect(page.getByText('Customer created: Acme')).toBeVisible();
`],
    [options.auditEnabled, `
  await expect(page.getByRole('list', { name: 'Audit entries' }).getByText('customer.created')).toBeVisible();
`]
  ]);
  const tenantBAssertions = renderOptional(options.fileUploadEnabled, `
  await expect(page.getByText('contract.txt')).toHaveCount(0);`);

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
  await expect(page).toHaveURL(/\\/workspace$/);${workspaceAssertions}

  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\\/customers$/);
  const customerList = page.getByRole('list', { name: 'Customers' });
  await page.getByLabel('Name', { exact: true }).fill('Acme');
  await page.getByLabel('Email', { exact: true }).fill('Sales@Acme.test');
  await page.getByLabel('Phone', { exact: true }).fill('400-800-9000');
  await page.getByLabel('Company', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  const createdCustomer = customerList.getByRole('listitem').filter({ hasText: 'Acme' });
  await expect(createdCustomer).toHaveCount(1);${customerSteps}
  await page.request.post('/api/session/logout');
  await signIn(page, 'tenant-b-admin');
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\\/workspace$/);
  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\\/customers$/);
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);${tenantBAssertions}
});
`;
}

function renderTicketRuntimeAcceptanceTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  const auditAssertions = renderOptional(options.auditEnabled, `
  const ticketAuditList = page.getByRole('list', { name: 'Ticket audit entries' });
  await expect(ticketAuditList.getByRole('listitem').filter({ hasText: 'ticket.created ticket 1' })).toHaveCount(1);
  await expect(ticketAuditList.getByRole('listitem').filter({ hasText: 'ticket.status_transitioned ticket 1' })).toHaveCount(1);
`);
  const notificationAssertions = renderOptional(options.notifyEmailEnabled, `
  const ticketNotificationList = page.getByRole('list', { name: 'Ticket notifications' });
  await expect(ticketNotificationList.getByRole('listitem').filter({ hasText: 'Ticket created: Escalate onboarding issue' })).toHaveCount(1);
`);
  const exportCsvAssertions = renderOptional(options.exportCsvEnabled, `
  await expect(page.getByRole('link', { name: 'Export tickets CSV' })).toBeVisible();
  const exportResponse = await page.request.get('/api/tickets/export');
  expect(exportResponse.ok()).toBe(true);
  expect(exportResponse.headers()['content-type']).toContain('text/csv');
  const csv = await exportResponse.text();
  expect(csv).toContain('id,tenantId,title,description,status,assigneeId,dueDate,createdBy,updatedAt');
  expect(csv).toContain('tenant-a,Escalate onboarding issue,Customer cannot finish setup,open,support-owner,2026-04-20');
`);
  const attachmentAssertions = `
  await createdTicket.getByLabel('Attachment for Escalate onboarding issue').setInputFiles({
    name: 'incident.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('triage notes')
  });
  await createdTicket.getByRole('button', { name: 'Upload attachment for Escalate onboarding issue' }).click();
  await expect(createdTicket).toContainText('incident.txt');
  const attachmentResponse = await page.request.get('/api/tickets/1/attachments');
  expect(attachmentResponse.ok()).toBe(true);
  const attachmentPayload = await attachmentResponse.json() as {
    attachments: Array<{ ticketId: number; fileName: string }>;
  };
  expect(attachmentPayload.attachments).toEqual([
    expect.objectContaining({ ticketId: 1, fileName: 'incident.txt' })
  ]);
  await createdTicket.getByLabel('Comment for Escalate onboarding issue').fill('Customer approved the workaround');
  await createdTicket.getByRole('button', { name: 'Add comment for Escalate onboarding issue' }).click();
  await expect(createdTicket).toContainText('Customer approved the workaround');
  const commentResponse = await page.request.get('/api/tickets/1/comments');
  expect(commentResponse.ok()).toBe(true);
`;
  const worklogAssertions = renderOptional(options.worklogEnabled, `
  const expectedWorklogResponse = page.waitForResponse((response) => response.url().includes('/api/tickets/1/worklogs') && response.request().method() === 'POST');
  await createdTicket.getByLabel('Worklog minutes for Escalate onboarding issue').fill('45');
  await createdTicket.getByLabel('Worklog note for Escalate onboarding issue').fill('Investigated customer setup logs');
  await createdTicket.getByRole('button', { name: 'Add worklog for Escalate onboarding issue' }).click();
  const createdWorklogResponse = await expectedWorklogResponse;
  expect(createdWorklogResponse.ok()).toBe(true);
  await expect(createdTicket).toContainText('Total worklog minutes: 45');
  await expect(createdTicket).toContainText('45m by user-tenant-a-admin: Investigated customer setup logs');
  const worklogResponse = await page.request.get('/api/tickets/1/worklogs');
  expect(worklogResponse.ok()).toBe(true);
  const worklogPayload = await worklogResponse.json() as {
    totalMinutes: number;
    worklogs: Array<{ ticketId: number; minutes: number; note: string }>;
  };
  expect(worklogPayload.totalMinutes).toBe(45);
  expect(worklogPayload.worklogs).toEqual([
    expect.objectContaining({ ticketId: 1, minutes: 45, note: 'Investigated customer setup logs' })
  ]);
`);
  const tenantBWorklogAssertion = renderOptional(options.worklogEnabled, `
  const tenantBWorklogResponse = await page.request.get('/api/tickets/1/worklogs');
  expect(tenantBWorklogResponse.status()).toBe(400);`);
  const summaryExportAssertions = renderOptional(options.ticketReportingEnabled && options.exportCsvEnabled, `
  const summaryCsvLink = page.getByRole('link', { name: 'Export ticket summary CSV' });
  await expect(summaryCsvLink).toBeVisible();`);
  const filteredSummaryExportAssertions = renderOptional(options.ticketReportingEnabled && options.exportCsvEnabled, `
  await expect(page.getByRole('link', { name: 'Export ticket summary CSV' })).toHaveAttribute('href', /status=in_progress/);
  const filteredSummaryExportResponse = await page.request.get('/api/tickets/summary/export?assigneeId=support-owner&status=in_progress');
  expect(filteredSummaryExportResponse.ok()).toBe(true);
  const filteredSummaryCsv = await filteredSummaryExportResponse.text();
  expect(filteredSummaryCsv).toContain('status,in_progress,1');
  expect(filteredSummaryCsv).toContain('sla,overdue,1');
  expect(filteredSummaryCsv).toContain('assignee,support-owner,1');`);
  const filteredReportingAssertions = renderOptional(options.ticketReportingEnabled, `
  await expect(page.getByText('Total tickets: 1')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ticket status summary' }).getByText('In progress: 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View ticket summary JSON' })).toHaveAttribute('href', /status=in_progress/);${filteredSummaryExportAssertions}
  const filteredSummaryResponse = await page.request.get('/api/tickets/summary?assigneeId=support-owner&status=in_progress');
  expect(filteredSummaryResponse.ok()).toBe(true);
  const filteredSummaryPayload = await filteredSummaryResponse.json() as {
    summary: {
      total: number;
      byStatus: { open: number; in_progress: number; closed: number };
      sla: { overdue: number; dueSoon: number; unscheduled: number };
      byAssignee: Array<{ assigneeId: string; count: number }>;
    };
  };
  expect(filteredSummaryPayload.summary.total).toBe(1);
  expect(filteredSummaryPayload.summary.byStatus.in_progress).toBe(1);
  expect(filteredSummaryPayload.summary.sla).toEqual({ overdue: 1, dueSoon: 0, unscheduled: 0 });
  expect(filteredSummaryPayload.summary.byAssignee).toEqual([{ assigneeId: 'support-owner', count: 1 }]);`);
  const summaryExportRequestAssertions = renderOptional(options.exportCsvEnabled, `
  const summaryExportResponse = await page.request.get('/api/tickets/summary/export');
  expect(summaryExportResponse.ok()).toBe(true);
  expect(summaryExportResponse.headers()['content-type']).toContain('text/csv');
  const summaryCsv = await summaryExportResponse.text();
  expect(summaryCsv).toContain('section,key,value');
  expect(summaryCsv).toContain('total,tickets,1');
  expect(summaryCsv).toContain('status,open,1');
  expect(summaryCsv).toContain('sla,overdue,1');
  expect(summaryCsv).toContain('assignee,support-owner,1');`);
  const reportingAssertions = renderOptional(options.ticketReportingEnabled, `
  await expect(page.getByRole('heading', { name: 'Ticket Summary' })).toBeVisible();
  const summaryJsonLink = page.getByRole('link', { name: 'View ticket summary JSON' });
  await expect(summaryJsonLink).toBeVisible();${summaryExportAssertions}
  await expect(page.getByText('Total tickets: 1')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ticket status summary' }).getByText('Open: 1')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ticket SLA summary' }).getByText('Overdue: 1')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Assignee summary' }).getByText('support-owner: 1')).toBeVisible();
  const summaryResponse = await page.request.get('/api/tickets/summary');
  expect(summaryResponse.ok()).toBe(true);
  const summaryPayload = await summaryResponse.json() as {
    summary: {
      total: number;
      byStatus: { open: number; in_progress: number; closed: number };
      sla: { overdue: number; dueSoon: number; unscheduled: number };
      byAssignee: Array<{ assigneeId: string; count: number }>;
    };
  };
  expect(summaryPayload.summary.total).toBe(1);
  expect(summaryPayload.summary.byStatus.open).toBe(1);
  expect(summaryPayload.summary.sla).toEqual({ overdue: 1, dueSoon: 0, unscheduled: 0 });
  expect(summaryPayload.summary.byAssignee).toEqual([{ assigneeId: 'support-owner', count: 1 }]);${summaryExportRequestAssertions}
`);

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
  const ticketItems = ticketList.locator(':scope > li');
  await page.getByLabel('Ticket title').fill('Escalate onboarding issue');
  await page.getByLabel('Ticket assignee').fill('support-owner');
  await page.getByLabel('Ticket description').fill('Customer cannot finish setup');
  await page.getByLabel('Ticket due date').fill('2026-04-20');
  await page.getByRole('button', { name: 'Create Ticket' }).click();${notificationAssertions}${exportCsvAssertions}${reportingAssertions}
  const createdTicket = ticketItems.filter({ hasText: 'Escalate onboarding issue' });
  await expect(createdTicket).toContainText('open');${attachmentAssertions}${worklogAssertions}

  await page.getByLabel('Ticket title').fill('Prepare renewal checklist');
  await page.getByLabel('Ticket assignee').fill('renewal-owner');
  await page.getByLabel('Ticket due date').fill('2026-05-01');
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(ticketItems).toHaveCount(2);

  await page.getByLabel('Assignee filter').selectOption('support-owner');
  await page.getByRole('button', { name: 'Apply ticket filters' }).click();
  await expect(ticketItems.filter({ hasText: 'Escalate onboarding issue' })).toHaveCount(1);
  await expect(ticketItems.filter({ hasText: 'Prepare renewal checklist' })).toHaveCount(0);

  await createdTicket.getByRole('button', { name: 'Start progress for Escalate onboarding issue' }).click();
  await expect(createdTicket).toContainText('in_progress');
  await page.getByLabel('Ticket status filter').selectOption('in_progress');
  await page.getByRole('button', { name: 'Apply ticket filters' }).click();
  await expect(page).toHaveURL(/status=in_progress/);
  await expect(ticketItems).toHaveCount(1);
  await expect(ticketItems.filter({ hasText: 'Escalate onboarding issue' })).toHaveCount(1);${filteredReportingAssertions}

  await expect(createdTicket).toContainText('in_progress');${auditAssertions}

  await page.request.post('/api/session/logout');
  await signIn(page, 'tenant-b-admin');
  await page.goto('/workspace');
  await page.getByRole('link', { name: '/tickets' }).click();
  await expect(ticketItems.filter({ hasText: 'Escalate onboarding issue' })).toHaveCount(0);
  const tenantBAttachmentResponse = await page.request.get('/api/tickets/1/attachments');
  expect(tenantBAttachmentResponse.status()).toBe(400);
  const tenantBCommentResponse = await page.request.get('/api/tickets/1/comments');
  expect(tenantBCommentResponse.status()).toBe(400);${tenantBWorklogAssertion}
});
`;
}

type RuntimeHostFeatures = {
  authEnabled: boolean;
  auditEnabled: boolean;
  customerEnabled: boolean;
  exportCsvEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  postgresEnabled: boolean;
  rbacEnabled: boolean;
  tableFilterEnabled: boolean;
  ticketEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
};

type RuntimeHostScaffoldEntry = {
  relativePath: string;
  source: string;
};

type RuntimeHostScaffoldPredicate = (features: RuntimeHostFeatures) => boolean;

type RuntimeHostScaffoldDefinition = {
  relativePath: string;
  enabled?: RuntimeHostScaffoldPredicate;
  render: (features: RuntimeHostFeatures) => string;
};

function defineRuntimeHostScaffold(
  relativePath: string,
  render: (features: RuntimeHostFeatures) => string,
  enabled?: RuntimeHostScaffoldPredicate
): RuntimeHostScaffoldDefinition {
  return { relativePath, render, ...(enabled ? { enabled } : {}) };
}

const isAuthEnabled: RuntimeHostScaffoldPredicate = (features) => features.authEnabled;
const isCustomerEnabled: RuntimeHostScaffoldPredicate = (features) => features.customerEnabled;
const isCustomerFileUploadEnabled: RuntimeHostScaffoldPredicate = (features) => (
  features.customerEnabled && features.fileUploadEnabled
);
const isTicketEnabled: RuntimeHostScaffoldPredicate = (features) => features.ticketEnabled;
const isTicketExportEnabled: RuntimeHostScaffoldPredicate = (features) => (
  features.ticketEnabled && features.exportCsvEnabled
);
const isTicketReportingEnabled: RuntimeHostScaffoldPredicate = (features) => (
  features.ticketEnabled && features.ticketReportingEnabled
);
const isTicketSummaryExportEnabled: RuntimeHostScaffoldPredicate = (features) => (
  features.ticketEnabled && features.ticketReportingEnabled && features.exportCsvEnabled
);
const isTicketWorklogEnabled: RuntimeHostScaffoldPredicate = (features) => (
  features.ticketEnabled && features.worklogEnabled
);

const runtimeHostScaffoldDefinitions: RuntimeHostScaffoldDefinition[] = [
  defineRuntimeHostScaffold('app/layout.tsx', renderLayout),
  defineRuntimeHostScaffold('app/page.tsx', (features) => renderIndexPage(features.authEnabled)),
  defineRuntimeHostScaffold('lib/store.ts', renderStoreLibrary),
  defineRuntimeHostScaffold('app/login/page.tsx', renderLoginPage, isAuthEnabled),
  defineRuntimeHostScaffold('app/workspace/page.tsx', renderWorkspacePage, isAuthEnabled),
  defineRuntimeHostScaffold('app/api/session/login/route.ts', renderLoginRoute, isAuthEnabled),
  defineRuntimeHostScaffold('app/api/session/logout/route.ts', renderLogoutRoute, isAuthEnabled),
  defineRuntimeHostScaffold('app/api/session/current/route.ts', renderCurrentSessionRoute, isAuthEnabled),
  defineRuntimeHostScaffold('components/login-form.tsx', renderLoginForm, isAuthEnabled),
  defineRuntimeHostScaffold('components/logout-button.tsx', renderLogoutButton, isAuthEnabled),
  defineRuntimeHostScaffold('lib/session.ts', renderSessionLibrary, isAuthEnabled),
  defineRuntimeHostScaffold('app/customers/page.tsx', renderCustomersPage, isCustomerEnabled),
  defineRuntimeHostScaffold('app/api/customers/route.ts', renderCustomersRoute, isCustomerEnabled),
  defineRuntimeHostScaffold('components/customer-form.tsx', renderCustomerForm, isCustomerEnabled),
  defineRuntimeHostScaffold('tests/runtime/unit/customer-runtime.test.ts', renderRuntimeUnitTest, isCustomerEnabled),
  defineRuntimeHostScaffold(
    'tests/runtime/acceptance/customer-flow.spec.ts',
    renderRuntimeAcceptanceTest,
    isCustomerEnabled
  ),
  defineRuntimeHostScaffold(
    'app/api/customers/[customerId]/attachments/route.ts',
    renderCustomerAttachmentsRoute,
    isCustomerFileUploadEnabled
  ),
  defineRuntimeHostScaffold(
    'components/customer-attachment-form.tsx',
    renderCustomerAttachmentForm,
    isCustomerFileUploadEnabled
  ),
  defineRuntimeHostScaffold('app/tickets/page.tsx', renderTicketsPage, isTicketEnabled),
  defineRuntimeHostScaffold('app/api/tickets/route.ts', renderTicketsRoute, isTicketEnabled),
  defineRuntimeHostScaffold(
    'app/api/tickets/summary/route.ts',
    renderTicketSummaryRoute,
    isTicketReportingEnabled
  ),
  defineRuntimeHostScaffold(
    'app/api/tickets/summary/export/route.ts',
    renderTicketSummaryExportRoute,
    isTicketSummaryExportEnabled
  ),
  defineRuntimeHostScaffold('app/api/tickets/export/route.ts', renderTicketExportRoute, isTicketExportEnabled),
  defineRuntimeHostScaffold(
    'app/api/tickets/[ticketId]/attachments/route.ts',
    renderTicketAttachmentsRoute,
    isTicketEnabled
  ),
  defineRuntimeHostScaffold(
    'app/api/tickets/[ticketId]/comments/route.ts',
    renderTicketCommentsRoute,
    isTicketEnabled
  ),
  defineRuntimeHostScaffold(
    'app/api/tickets/[ticketId]/worklogs/route.ts',
    renderTicketWorklogsRoute,
    isTicketWorklogEnabled
  ),
  defineRuntimeHostScaffold(
    'app/api/tickets/[ticketId]/status/route.ts',
    renderTicketStatusRoute,
    isTicketEnabled
  ),
  defineRuntimeHostScaffold('components/ticket-attachment-form.tsx', renderTicketAttachmentForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-comment-form.tsx', renderTicketCommentForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-worklog-form.tsx', renderTicketWorklogForm, isTicketWorklogEnabled),
  defineRuntimeHostScaffold('components/ticket-form.tsx', renderTicketForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-status-form.tsx', renderTicketStatusForm, isTicketEnabled),
  defineRuntimeHostScaffold('tests/runtime/unit/ticket-runtime.test.ts', renderTicketRuntimeUnitTest, isTicketEnabled),
  defineRuntimeHostScaffold(
    'tests/runtime/acceptance/ticket-flow.spec.ts',
    renderTicketRuntimeAcceptanceTest,
    isTicketEnabled
  )
];

function buildRuntimeHostFeatures(lock: LockFile): RuntimeHostFeatures {
  return {
    authEnabled: hasBlock(lock, 'auth/basic-session'),
    auditEnabled: hasBlock(lock, 'audit/basic'),
    customerEnabled: hasBlock(lock, 'entity/customer-basic'),
    exportCsvEnabled: hasBlock(lock, 'export/csv-basic'),
    fileUploadEnabled: hasBlock(lock, 'file/upload'),
    notifyEmailEnabled: hasBlock(lock, 'notify/email-basic'),
    postgresEnabled: hasBlock(lock, 'infra/postgres'),
    rbacEnabled: hasBlock(lock, 'rbac/basic'),
    tableFilterEnabled: hasBlock(lock, 'table/filter-search'),
    ticketEnabled: hasBlock(lock, 'ticket/basic'),
    ticketReportingEnabled: hasBlock(lock, 'reporting/ticket-summary'),
    worklogEnabled: hasBlock(lock, 'worklog/basic')
  };
}

function scaffoldEntries(lock: LockFile): RuntimeHostScaffoldEntry[] {
  const features = buildRuntimeHostFeatures(lock);
  return runtimeHostScaffoldDefinitions
    .filter((definition) => definition.enabled?.(features) ?? true)
    .map((definition) => ({
      relativePath: definition.relativePath,
      source: definition.render(features)
    }));
}

function generatedPathsForScaffold(lock: LockFile): string[] {
  const entries = scaffoldEntries(lock).map((entry) => entry.relativePath);
  return uniqueSorted([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries]);
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
