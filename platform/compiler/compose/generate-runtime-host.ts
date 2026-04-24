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
  return `import type { ReactNode } from 'react';\nimport './globals.css';\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  );\n}\n`;
}

function renderIndexPage(hasAuth: boolean): string {
  if (hasAuth) {
    return `import { redirect } from 'next/navigation';\nimport { getCurrentSession } from '../lib/session.ts';\n\nexport default async function HomePage() {\n  const session = await getCurrentSession();\n  redirect(session ? '/workspace' : '/login');\n}\n`;
  }

  return `import Link from 'next/link';\nimport { routes } from '../generated/routes.ts';\n\nexport default function HomePage() {\n  return (\n    <main className=\"stack\">\n      <section className=\"card stack\">\n        <h1>Runtime Host</h1>\n        <p>This generated host exposes the resolved block routes for local inspection.</p>\n        <nav className=\"row\">\n          {routes.length === 0 ? <span>No routes published by the current block set.</span> : null}\n          {routes.map((route) => (\n            <Link key={route.path} href={route.path}>{route.path}</Link>\n          ))}\n        </nav>\n      </section>\n    </main>\n  );\n}\n`;
}

function renderLoginPage(): string {
  return `import { redirect } from 'next/navigation';\nimport { LoginForm } from '../../components/login-form.tsx';\nimport { getCurrentSession } from '../../lib/session.ts';\n\nexport default async function LoginPage() {\n  const session = await getCurrentSession();\n  if (session) {\n    redirect('/workspace');\n  }\n\n  return (\n    <main className=\"stack\">\n      <section className=\"card stack\">\n        <div className=\"stack\">\n          <h1>Customer Admin</h1>\n          <p>Sign in with <strong>tenant-a-admin</strong> or <strong>tenant-b-admin</strong>. Password: <strong>password</strong>.</p>\n        </div>\n        <LoginForm />\n      </section>\n    </main>\n  );\n}\n`;
}

function renderWorkspacePage(): string {
  return `import Link from 'next/link';\nimport { redirect } from 'next/navigation';\nimport { LogoutButton } from '../../components/logout-button.tsx';\nimport { getCurrentSession } from '../../lib/session.ts';\nimport { routes } from '../../generated/routes.ts';\n\nexport default async function WorkspacePage() {\n  const session = await getCurrentSession();\n  if (!session) {\n    redirect('/login');\n  }\n\n  const visibleRoutes = routes.filter((route) => route.path !== '/login');\n\n  return (\n    <main className=\"stack\">\n      <section className=\"card stack\">\n        <div className=\"row\" style={{ justifyContent: 'space-between' }}>\n          <div className=\"stack\">\n            <h1>Workspace</h1>\n            <p>{session.username} in tenant <strong>{session.tenantId}</strong></p>\n          </div>\n          <LogoutButton />\n        </div>\n        <nav className=\"row\">\n          {visibleRoutes.length === 0 ? <span>No block routes available for this workspace.</span> : null}\n          {visibleRoutes.map((route) => (\n            <Link key={route.path} href={route.path}>{route.path}</Link>\n          ))}\n        </nav>\n      </section>\n    </main>\n  );\n}\n`;
}

function renderCustomersPage(options: {
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
    ? `  const params = await searchParams;\n  const search = typeof params?.search === 'string' ? params.search : '';\n  const company = typeof params?.company === 'string' ? params.company : '';\n  const customers = filterCustomers(allCustomers, { search, company });\n  const companies = listCustomerCompanies(allCustomers);\n`
    : `  const customers = allCustomers;\n`;
  const tableFilters = options.tableFilterEnabled
    ? `\n      <section className=\"card stack\">\n        <h2>Filters</h2>\n        <form className=\"row\" action=\"/customers\">\n          <label style={{ flex: 1 }}>\n            Search\n            <input aria-label=\"Search customers\" name=\"search\" defaultValue={search} />\n          </label>\n          <label style={{ flex: 1 }}>\n            Company\n            <select aria-label=\"Company filter\" name=\"company\" defaultValue={company}>\n              <option value=\"\">All companies</option>\n              {companies.map((entry) => (\n                <option key={entry} value={entry}>{entry}</option>\n              ))}\n            </select>\n          </label>\n          <button type=\"submit\">Apply filters</button>\n        </form>\n      </section>\n`
    : '';
  const attachmentSetup = options.fileUploadEnabled
    ? `  const attachmentsByCustomer = new Map(customers.map((customer) => [customer.id, listCustomerAttachments(database, session, customer.id)]));\n`
    : '';
  const attachmentView = options.fileUploadEnabled
    ? `\n              <div className=\"stack\" style={{ marginTop: 12 }}>\n                <CustomerAttachmentForm customerId={customer.id} customerName={customer.name} />\n                <ul className=\"clean\" aria-label={\`Attachments for \${customer.name}\`}>\n                  {(attachmentsByCustomer.get(customer.id) ?? []).map((attachment) => (\n                    <li key={attachment.id}>{attachment.fileName} ({attachment.contentType})</li>\n                  ))}\n                </ul>\n              </div>`
    : '';
  const notificationSetup = options.notifyEmailEnabled
    ? `  const notifications = listEmailNotifications(database, session);\n`
    : '';
  const notificationView = options.notifyEmailEnabled
    ? `\n      <section className=\"card stack\">\n        <h2>Email Notifications</h2>\n        <ul className=\"clean\" aria-label=\"Notifications\">\n          {notifications.map((notification) => (\n            <li key={notification.id}>\n              <div><strong>{notification.subject}</strong></div>\n              <div>{notification.recipient}</div>\n            </li>\n          ))}\n          {notifications.length === 0 ? <li>No notifications yet.</li> : null}\n        </ul>\n      </section>\n`
    : '';

  return `${imports}\n\ninterface CustomersPageProps {\n  searchParams?: Promise<Record<string, string | string[] | undefined>>;\n}\n\nexport default async function CustomersPage({ searchParams }: CustomersPageProps) {\n  const session = await getCurrentSession();\n  if (!session) {\n    redirect('/login');\n  }\n\n  const database = getDatabase();\n  const allCustomers = listCustomers(database, session);\n${searchSetup}${attachmentSetup}${notificationSetup}\n  return (\n    <main className=\"stack\">\n      <section className=\"card stack\">\n        <div className=\"row\" style={{ justifyContent: 'space-between' }}>\n          <div className=\"stack\">\n            <h1>Customers</h1>\n            <p>Tenant <strong>{session.tenantId}</strong> currently sees {customers.length} customer(s).</p>\n          </div>\n          <div className=\"row\">\n            <Link href=\"/workspace\">Workspace</Link>\n            <LogoutButton />\n          </div>\n        </div>\n      </section>\n${tableFilters}\n      <section className=\"card stack\">\n        <CustomerForm />\n      </section>\n\n      <section className=\"card stack\">\n        <h2>Customer List</h2>\n        <ul className=\"clean\" aria-label=\"Customers\">\n          {customers.map((customer) => (\n            <li key={customer.id}>\n              <div><strong>{customer.name}</strong> ({customer.company})</div>\n              <div>{customer.email}</div>\n              <div>{customer.phone}</div>${attachmentView}\n            </li>\n          ))}\n          {customers.length === 0 ? <li>No customers yet.</li> : null}\n        </ul>\n      </section>${notificationView}\n    </main>\n  );\n}\n`;
}

function renderSessionLibrary(): string {
  return `import { cookies } from 'next/headers';\nimport type { Session } from '../src/installed/auth/session.ts';\n\nconst SESSION_COOKIE_NAME = 'engineering-compiler-session';\n\nfunction isSession(value: unknown): value is Session {\n  return typeof value === 'object' && value !== null && 'userId' in value && 'tenantId' in value && 'username' in value;\n}\n\nexport function serializeSession(session: Session): string {\n  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');\n}\n\nexport function deserializeSession(raw: string | null | undefined): Session | null {\n  if (!raw) {\n    return null;\n  }\n\n  try {\n    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;\n    return isSession(parsed) ? parsed : null;\n  } catch {\n    return null;\n  }\n}\n\nexport async function getCurrentSession(): Promise<Session | null> {\n  const cookieStore = await cookies();\n  return deserializeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);\n}\n\nexport function getSessionCookieName(): string {\n  return SESSION_COOKIE_NAME;\n}\n`;
}

function renderStoreLibrary(): string {
  return `import { createDatabase, type Database } from '../src/runtime/database.ts';\n\ndeclare global {\n  var __engineeringCompilerDatabase: Database | undefined;\n}\n\nexport function getDatabase(): Database {\n  if (!globalThis.__engineeringCompilerDatabase) {\n    globalThis.__engineeringCompilerDatabase = createDatabase();\n  }\n  return globalThis.__engineeringCompilerDatabase;\n}\n\nexport function resetDatabase(): void {\n  globalThis.__engineeringCompilerDatabase = createDatabase();\n}\n`;
}

function renderLoginRoute(): string {
  return `import { cookies } from 'next/headers';\nimport { NextResponse } from 'next/server';\nimport { login } from '../../../../src/installed/auth/session.ts';\nimport { getSessionCookieName, serializeSession } from '../../../../lib/session.ts';\n\nexport async function POST(request: Request) {\n  const payload = await request.json() as { username?: string; password?: string };\n\n  try {\n    const session = login(String(payload.username ?? ''), String(payload.password ?? ''));\n    const cookieStore = await cookies();\n    cookieStore.set(getSessionCookieName(), serializeSession(session), {\n      httpOnly: true,\n      sameSite: 'lax',\n      path: '/'\n    });\n    return NextResponse.json({ session });\n  } catch (error) {\n    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid credentials' }, { status: 401 });\n  }\n}\n`;
}

function renderLogoutRoute(): string {
  return `import { cookies } from 'next/headers';\nimport { NextResponse } from 'next/server';\nimport { getSessionCookieName } from '../../../../lib/session.ts';\n\nexport async function POST() {\n  const cookieStore = await cookies();\n  cookieStore.set(getSessionCookieName(), '', {\n    httpOnly: true,\n    sameSite: 'lax',\n    path: '/',\n    maxAge: 0\n  });\n  return NextResponse.json({ ok: true });\n}\n`;
}

function renderCurrentSessionRoute(): string {
  return `import { NextResponse } from 'next/server';\nimport { getCurrentSession } from '../../../../lib/session.ts';\n\nexport async function GET() {\n  const session = await getCurrentSession();\n  return NextResponse.json({ session });\n}\n`;
}

function renderCustomersRoute(options: {
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const imports = [
    `import { NextResponse } from 'next/server';`,
    `import type { CustomerInput } from '../../../src/runtime/database.ts';`,
    `import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';`,
    options.notifyEmailEnabled ? `import { recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';` : '',
    options.tableFilterEnabled ? `import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';` : '',
    `import { getCurrentSession } from '../../../lib/session.ts';`,
    `import { getDatabase } from '../../../lib/store.ts';`
  ].filter(Boolean).join('\n');
  const filterCustomersLine = options.tableFilterEnabled
    ? `  const url = new URL(request.url);\n  const customers = filterCustomers(listCustomers(getDatabase(), session), {\n    search: url.searchParams.get('search'),\n    company: url.searchParams.get('company')\n  });\n`
    : `  const customers = listCustomers(getDatabase(), session);\n`;
  const notifyLine = options.notifyEmailEnabled
    ? `    recordCustomerCreatedEmail(getDatabase(), session, customer);\n`
    : '';

  return `${imports}\n\nexport async function GET(request: Request) {\n  const session = await getCurrentSession();\n  if (!session) {\n    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });\n  }\n\n${filterCustomersLine}  return NextResponse.json({ customers });\n}\n\nexport async function POST(request: Request) {\n  const session = await getCurrentSession();\n  if (!session) {\n    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });\n  }\n\n  try {\n    const payload = await request.json() as CustomerInput;\n    const customer = createCustomer(getDatabase(), session, payload);\n${notifyLine}    return NextResponse.json({ customer }, { status: 201 });\n  } catch (error) {\n    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });\n  }\n}\n`;
}

function renderCustomerAttachmentsRoute(): string {
  return `import { NextResponse } from 'next/server';\nimport { addCustomerAttachment, listCustomerAttachments } from '../../../../../src/installed/file/customer-attachments.ts';\nimport { getCurrentSession } from '../../../../../lib/session.ts';\nimport { getDatabase } from '../../../../../lib/store.ts';\n\ninterface AttachmentRouteContext {\n  params: Promise<{ customerId: string }>;\n}\n\nexport async function GET(_request: Request, context: AttachmentRouteContext) {\n  const session = await getCurrentSession();\n  if (!session) {\n    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });\n  }\n\n  try {\n    const params = await context.params;\n    const customerId = Number(params.customerId);\n    const attachments = listCustomerAttachments(getDatabase(), session, customerId);\n    return NextResponse.json({ attachments });\n  } catch (error) {\n    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });\n  }\n}\n\nexport async function POST(request: Request, context: AttachmentRouteContext) {\n  const session = await getCurrentSession();\n  if (!session) {\n    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });\n  }\n\n  try {\n    const params = await context.params;\n    const customerId = Number(params.customerId);\n    const formData = await request.formData();\n    const file = formData.get('file');\n    if (!(file instanceof File)) {\n      return NextResponse.json({ error: 'Missing file' }, { status: 400 });\n    }\n\n    const attachment = addCustomerAttachment(getDatabase(), session, {\n      customerId,\n      fileName: file.name,\n      contentType: file.type || 'application/octet-stream',\n      size: file.size,\n      contentText: await file.text()\n    });\n    return NextResponse.json({ attachment }, { status: 201 });\n  } catch (error) {\n    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });\n  }\n}\n`;
}

function renderLoginForm(): string {
  return `'use client';\n\nimport { useRouter } from 'next/navigation';\nimport { type FormEvent, useState } from 'react';\n\nexport function LoginForm() {\n  const router = useRouter();\n  const [username, setUsername] = useState('tenant-a-admin');\n  const [password, setPassword] = useState('password');\n  const [error, setError] = useState<string | null>(null);\n  const [pending, setPending] = useState(false);\n\n  async function handleSubmit(event: FormEvent<HTMLFormElement>) {\n    event.preventDefault();\n    setPending(true);\n    setError(null);\n\n    const response = await fetch('/api/session/login', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json'\n      },\n      body: JSON.stringify({ username, password })\n    });\n\n    if (!response.ok) {\n      const payload = await response.json() as { error?: string };\n      setError(payload.error ?? 'Login failed');\n      setPending(false);\n      return;\n    }\n\n    router.push('/workspace');\n    router.refresh();\n  }\n\n  return (\n    <form className=\"stack\" onSubmit={handleSubmit}>\n      <label>\n        Username\n        <input aria-label=\"Username\" value={username} onChange={(event) => setUsername(event.target.value)} />\n      </label>\n      <label>\n        Password\n        <input aria-label=\"Password\" type=\"password\" value={password} onChange={(event) => setPassword(event.target.value)} />\n      </label>\n      {error ? <p role=\"alert\">{error}</p> : null}\n      <button type=\"submit\" disabled={pending}>{pending ? 'Signing In...' : 'Sign In'}</button>\n    </form>\n  );\n}\n`;
}

function renderLogoutButton(): string {
  return `'use client';\n\nimport { useRouter } from 'next/navigation';\n\nexport function LogoutButton() {\n  const router = useRouter();\n\n  async function handleLogout() {\n    await fetch('/api/session/logout', {\n      method: 'POST'\n    });\n    router.push('/login');\n    router.refresh();\n  }\n\n  return <button type=\"button\" className=\"secondary\" onClick={handleLogout}>Sign out</button>;\n}\n`;
}

function renderCustomerForm(): string {
  return `'use client';\n\nimport { useRouter } from 'next/navigation';\nimport { type FormEvent, useState } from 'react';\n\nconst INITIAL_STATE = {\n  name: '',\n  email: '',\n  phone: '',\n  company: ''\n};\n\nexport function CustomerForm() {\n  const router = useRouter();\n  const [form, setForm] = useState(INITIAL_STATE);\n  const [error, setError] = useState<string | null>(null);\n  const [pending, setPending] = useState(false);\n\n  async function handleSubmit(event: FormEvent<HTMLFormElement>) {\n    event.preventDefault();\n    setPending(true);\n    setError(null);\n\n    const response = await fetch('/api/customers', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json'\n      },\n      body: JSON.stringify(form)\n    });\n\n    if (!response.ok) {\n      const payload = await response.json() as { error?: string };\n      setError(payload.error ?? 'Unable to create customer');\n      setPending(false);\n      return;\n    }\n\n    setForm(INITIAL_STATE);\n    setPending(false);\n    router.refresh();\n  }\n\n  return (\n    <form className=\"stack\" onSubmit={handleSubmit}>\n      <div className=\"row\">\n        <label style={{ flex: 1 }}>\n          Name\n          <input aria-label=\"Name\" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />\n        </label>\n        <label style={{ flex: 1 }}>\n          Company\n          <input aria-label=\"Company\" value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} />\n        </label>\n      </div>\n      <div className=\"row\">\n        <label style={{ flex: 1 }}>\n          Email\n          <input aria-label=\"Email\" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />\n        </label>\n        <label style={{ flex: 1 }}>\n          Phone\n          <input aria-label=\"Phone\" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />\n        </label>\n      </div>\n      {error ? <p role=\"alert\">{error}</p> : null}\n      <button type=\"submit\" disabled={pending}>{pending ? 'Creating...' : 'Create Customer'}</button>\n    </form>\n  );\n}\n`;
}

function renderCustomerAttachmentForm(): string {
  return `'use client';\n\nimport { useRouter } from 'next/navigation';\nimport { type FormEvent, useRef, useState } from 'react';\n\ninterface CustomerAttachmentFormProps {\n  customerId: number;\n  customerName: string;\n}\n\nexport function CustomerAttachmentForm({ customerId, customerName }: CustomerAttachmentFormProps) {\n  const router = useRouter();\n  const formRef = useRef<HTMLFormElement>(null);\n  const [error, setError] = useState<string | null>(null);\n  const [pending, setPending] = useState(false);\n\n  async function handleSubmit(event: FormEvent<HTMLFormElement>) {\n    event.preventDefault();\n    setPending(true);\n    setError(null);\n\n    const response = await fetch(\`/api/customers/\${customerId}/attachments\`, {\n      method: 'POST',\n      body: new FormData(event.currentTarget)\n    });\n\n    if (!response.ok) {\n      const payload = await response.json() as { error?: string };\n      setError(payload.error ?? 'Unable to upload attachment');\n      setPending(false);\n      return;\n    }\n\n    formRef.current?.reset();\n    setPending(false);\n    router.refresh();\n  }\n\n  return (\n    <form ref={formRef} className=\"row\" onSubmit={handleSubmit}>\n      <label style={{ flex: 1 }}>\n        Attachment\n        <input aria-label={\`Attachment for \${customerName}\`} name=\"file\" type=\"file\" />\n      </label>\n      <button type=\"submit\" disabled={pending}>{pending ? 'Uploading...' : \`Upload attachment for \${customerName}\`}</button>\n      {error ? <p role=\"alert\">{error}</p> : null}\n    </form>\n  );\n}\n`;
}

function renderRuntimeUnitTest(options: {
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const imports = [
    `import { beforeEach, describe, expect, it } from 'vitest';`,
    `import { login } from '../../../src/installed/auth/session.ts';`,
    `import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';`,
    options.fileUploadEnabled ? `import { addCustomerAttachment, listCustomerAttachments } from '../../../src/installed/file/customer-attachments.ts';` : '',
    options.notifyEmailEnabled ? `import { listEmailNotifications, recordCustomerCreatedEmail } from '../../../src/installed/notify/email-outbox.ts';` : '',
    options.tableFilterEnabled ? `import { filterCustomers } from '../../../src/installed/table/customer-filter.ts';` : '',
    `import { getDatabase, resetDatabase } from '../../../lib/store.ts';`
  ].filter(Boolean).join('\n');
  const fileAssertions = options.fileUploadEnabled
    ? `\n    const attachment = addCustomerAttachment(database, tenantA, {\n      customerId: created.id,\n      fileName: 'contract.txt',\n      contentType: 'text/plain',\n      size: 8,\n      contentText: 'approved'\n    });\n    expect(attachment.tenantId).toBe('tenant-a');\n    expect(listCustomerAttachments(database, tenantA, created.id)).toHaveLength(1);\n    expect(() => listCustomerAttachments(database, tenantB, created.id)).toThrow(/Customer is not available/);\n`
    : '';
  const notifyAssertions = options.notifyEmailEnabled
    ? `\n    const notification = recordCustomerCreatedEmail(database, tenantA, created);\n    expect(notification.eventType).toBe('customer.created');\n    expect(listEmailNotifications(database, tenantA)).toHaveLength(1);\n    expect(listEmailNotifications(database, tenantB)).toHaveLength(0);\n`
    : '';
  const filterAssertions = options.tableFilterEnabled
    ? `\n    expect(filterCustomers(listCustomers(database, tenantA), { search: 'ACME' })).toHaveLength(1);\n    expect(filterCustomers(listCustomers(database, tenantA), { company: 'Unknown' })).toHaveLength(1);\n`
    : '';

  return `${imports}\n\ndescribe('runtime customer service', () => {\n  beforeEach(() => {\n    resetDatabase();\n  });\n\n  it('creates a customer for tenant a and hides it from tenant b', () => {\n    const database = getDatabase();\n    const tenantA = login('tenant-a-admin', 'password');\n    const tenantB = login('tenant-b-admin', 'password');\n\n    const created = createCustomer(database, tenantA, {\n      name: 'Acme',\n      email: 'Sales@Acme.test',\n      phone: '400-800-9000',\n      company: ''\n    });\n\n    expect(created.company).toBe('Unknown');\n    expect(listCustomers(database, tenantA)).toHaveLength(1);\n    expect(listCustomers(database, tenantB)).toHaveLength(0);${fileAssertions}${notifyAssertions}${filterAssertions}  });\n});\n`;
}

function renderRuntimeAcceptanceTest(options: {
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  const uploadSteps = options.fileUploadEnabled
    ? `\n  await page.getByLabel('Attachment for Acme').setInputFiles({\n    name: 'contract.txt',\n    mimeType: 'text/plain',\n    buffer: Buffer.from('approved')\n  });\n  await page.getByRole('button', { name: 'Upload attachment for Acme' }).click();\n  await expect(createdCustomer).toContainText('contract.txt');\n`
    : '';
  const filterSteps = options.tableFilterEnabled
    ? `\n  await page.getByLabel('Search customers').fill('acme');\n  await page.getByLabel('Company filter').selectOption('Unknown');\n  await page.getByRole('button', { name: 'Apply filters' }).click();\n  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(1);\n`
    : '';
  const notificationSteps = options.notifyEmailEnabled
    ? `\n  await expect(page.getByText('Customer created: Acme')).toBeVisible();\n`
    : '';
  const tenantBAttachmentAssertion = options.fileUploadEnabled
    ? `\n  await expect(page.getByText('contract.txt')).toHaveCount(0);`
    : '';

  return `import { expect, test } from '@playwright/test';\n\ntest('customer runtime flow keeps tenant data isolated', async ({ page }) => {\n  await page.goto('/login');\n  await page.getByLabel('Username').fill('tenant-a-admin');\n  await page.getByLabel('Password').fill('password');\n  await page.getByRole('button', { name: 'Sign In' }).click();\n  await expect(page).toHaveURL(/\\/workspace$/);\n\n  await page.getByRole('link', { name: '/customers' }).click();\n  await expect(page).toHaveURL(/\\/customers$/);\n  const customerList = page.getByRole('list', { name: 'Customers' });\n  await page.getByLabel('Name', { exact: true }).fill('Acme');\n  await page.getByLabel('Email', { exact: true }).fill('Sales@Acme.test');\n  await page.getByLabel('Phone', { exact: true }).fill('400-800-9000');\n  await page.getByLabel('Company', { exact: true }).fill('');\n  await page.getByRole('button', { name: 'Create Customer' }).click();\n  const createdCustomer = customerList.getByRole('listitem').filter({ hasText: 'Acme' });\n  await expect(createdCustomer).toHaveCount(1);${uploadSteps}${filterSteps}${notificationSteps}\n  await page.request.post('/api/session/logout');\n  await page.goto('/login');\n  await expect(page).toHaveURL(/\\/login$/);\n\n  await page.getByLabel('Username').fill('tenant-b-admin');\n  await page.getByLabel('Password').fill('password');\n  await page.getByRole('button', { name: 'Sign In' }).click();\n  await page.getByRole('link', { name: '/customers' }).click();\n  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);${tenantBAttachmentAssertion}\n});\n`;
}

function scaffoldEntries(lock: LockFile): Array<{ relativePath: string; source: string }> {
  const authEnabled = hasBlock(lock, 'auth/basic-session');
  const customerEnabled = hasBlock(lock, 'entity/customer-basic');
  const customerFeatureOptions = {
    fileUploadEnabled: hasBlock(lock, 'file/upload'),
    notifyEmailEnabled: hasBlock(lock, 'notify/email-basic'),
    tableFilterEnabled: hasBlock(lock, 'table/filter-search')
  };
  const entries: Array<{ relativePath: string; source: string }> = [
    { relativePath: 'app/layout.tsx', source: renderLayout() },
    { relativePath: 'app/page.tsx', source: renderIndexPage(authEnabled) },
    { relativePath: 'lib/store.ts', source: renderStoreLibrary() }
  ];

  if (authEnabled) {
    entries.push(
      { relativePath: 'app/login/page.tsx', source: renderLoginPage() },
      { relativePath: 'app/workspace/page.tsx', source: renderWorkspacePage() },
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
