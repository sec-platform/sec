import path from 'node:path';

import { uniqueSorted } from '../../shared/collections.ts';
import { defaultLimit } from '../../shared/concurrency.ts';
import { writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import {
  isCanonicalPortableLogicalPathV1,
  portableLogicalPathCollisionKeyV1
} from '../../shared/logical-path-identity.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import {
  decodeExactUtf8V1,
  readOptionalRetainedOrdinaryFileV1
} from '../../shared/retained-file-read.ts';
import { TemplateEngine } from './template-engine.ts';

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

function renderLayout(): string {
  return TemplateEngine.render('app/layout.tsx.template', {});
}

function renderIndexPage(hasAuth: boolean): string {
  return TemplateEngine.render('app/page.tsx.template', { authEnabled: hasAuth });
}

function renderLoginPage(): string {
  return TemplateEngine.render('app/login/page.tsx.template', {});
}

function renderWorkspacePage(options: { rbacEnabled: boolean }): string {
  return TemplateEngine.render('app/workspace/page.tsx.template', options);
}

function renderCustomersPage(options: {
  auditEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  return TemplateEngine.render('app/customers/page.tsx.template', options);
}

function renderTicketsPage(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  const ticketSummaryExportEnabled = options.ticketReportingEnabled && options.exportCsvEnabled;
  return TemplateEngine.render('app/tickets/page.tsx.template', {
    ...options,
    ticketSummaryExportEnabled
  });
}

function renderSessionLibrary(): string {
  return TemplateEngine.render('lib/session.ts.template', {});
}

function renderStoreLibrary(options: { postgresEnabled: boolean }): string {
  const persistence = options.postgresEnabled ? 'postgres-contract' : 'memory';
  return TemplateEngine.render('lib/store.ts.template', { persistence });
}

function renderLoginRoute(): string {
  return TemplateEngine.render('app/api/session/login/route.ts.template', {});
}

function renderLogoutRoute(): string {
  return TemplateEngine.render('app/api/session/logout/route.ts.template', {});
}

function renderCurrentSessionRoute(): string {
  return TemplateEngine.render('app/api/session/current/route.ts.template', {});
}

function renderCustomersRoute(options: {
  auditEnabled: boolean;
  notifyEmailEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  return TemplateEngine.render('app/api/customers/route.ts.template', options);
}

function renderCustomerAttachmentsRoute(): string {
  return TemplateEngine.render('app/api/customers/[customerId]/attachments/route.ts.template', {});
}

function renderTicketAttachmentsRoute(): string {
  return TemplateEngine.render('app/api/tickets/[ticketId]/attachments/route.ts.template', {});
}

function renderTicketCommentsRoute(): string {
  return TemplateEngine.render('app/api/tickets/[ticketId]/comments/route.ts.template', {});
}

function renderTicketWorklogsRoute(): string {
  return TemplateEngine.render('app/api/tickets/[ticketId]/worklogs/route.ts.template', {});
}

function renderTicketsRoute(options: { auditEnabled: boolean; notifyEmailEnabled: boolean }): string {
  return TemplateEngine.render('app/api/tickets/route.ts.template', options);
}

function renderTicketExportRoute(): string {
  return TemplateEngine.render('app/api/tickets/export/route.ts.template', {});
}

function renderTicketSummaryRoute(): string {
  return TemplateEngine.render('app/api/tickets/summary/route.ts.template', {});
}

function renderTicketSummaryExportRoute(): string {
  return TemplateEngine.render('app/api/tickets/summary/export/route.ts.template', {});
}

function renderTicketStatusRoute(options: { auditEnabled: boolean }): string {
  return TemplateEngine.render('app/api/tickets/[ticketId]/status/route.ts.template', options);
}

function renderLoginForm(): string {
  return TemplateEngine.render('components/login-form.tsx.template', {});
}

function renderLogoutButton(): string {
  return TemplateEngine.render('components/logout-button.tsx.template', {});
}

function renderCustomerForm(): string {
  return TemplateEngine.render('components/customer-form.tsx.template', {});
}

function renderCustomerAttachmentForm(): string {
  return TemplateEngine.render('components/customer-attachment-form.tsx.template', {});
}

function renderTicketAttachmentForm(): string {
  return TemplateEngine.render('components/ticket-attachment-form.tsx.template', {});
}

function renderTicketCommentForm(): string {
  return TemplateEngine.render('components/ticket-comment-form.tsx.template', {});
}

function renderTicketWorklogForm(): string {
  return TemplateEngine.render('components/ticket-worklog-form.tsx.template', {});
}

function renderTicketForm(): string {
  return TemplateEngine.render('components/ticket-form.tsx.template', {});
}

function renderTicketStatusForm(): string {
  return TemplateEngine.render('components/ticket-status-form.tsx.template', {});
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
  const postgresTables = [
    'customers',
    'customer_attachments',
    'email_notifications',
    'audit_entries',
    ...(options.ticketEnabled ? ['tickets', 'ticket_attachments', 'ticket_comments'] : []),
    ...(options.ticketEnabled && options.worklogEnabled ? ['worklogs'] : [])
  ];
  const postgresTableList = postgresTables.map((table) => `      '${table}'`).join(',\n');
  return TemplateEngine.render('tests/runtime/unit/customer-runtime.test.ts.template', {
    ...options,
    postgresTableList
  });
}

function renderTicketRuntimeUnitTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  return TemplateEngine.render('tests/runtime/unit/ticket-runtime.test.ts.template', options);
}

function renderRuntimeAcceptanceTest(options: {
  auditEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  rbacEnabled: boolean;
  tableFilterEnabled: boolean;
}): string {
  return TemplateEngine.render('tests/runtime/acceptance/customer-flow.spec.ts.template', options);
}

function renderTicketRuntimeAcceptanceTest(options: {
  auditEnabled: boolean;
  exportCsvEnabled: boolean;
  notifyEmailEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
}): string {
  return TemplateEngine.render('tests/runtime/acceptance/ticket-flow.spec.ts.template', options);
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
  if (!isCanonicalPortableLogicalPathV1(relativePath)) {
    throw new Error(`Runtime Host scaffold path is not canonical: ${relativePath}`);
  }
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
  defineRuntimeHostScaffold('tests/runtime/acceptance/customer-flow.spec.ts', renderRuntimeAcceptanceTest, isCustomerEnabled),
  defineRuntimeHostScaffold('app/api/customers/[customerId]/attachments/route.ts', renderCustomerAttachmentsRoute, isCustomerFileUploadEnabled),
  defineRuntimeHostScaffold('components/customer-attachment-form.tsx', renderCustomerAttachmentForm, isCustomerFileUploadEnabled),
  defineRuntimeHostScaffold('app/tickets/page.tsx', renderTicketsPage, isTicketEnabled),
  defineRuntimeHostScaffold('app/api/tickets/route.ts', renderTicketsRoute, isTicketEnabled),
  defineRuntimeHostScaffold('app/api/tickets/summary/route.ts', renderTicketSummaryRoute, isTicketReportingEnabled),
  defineRuntimeHostScaffold('app/api/tickets/summary/export/route.ts', renderTicketSummaryExportRoute, isTicketSummaryExportEnabled),
  defineRuntimeHostScaffold('app/api/tickets/export/route.ts', renderTicketExportRoute, isTicketExportEnabled),
  defineRuntimeHostScaffold('app/api/tickets/[ticketId]/attachments/route.ts', renderTicketAttachmentsRoute, isTicketEnabled),
  defineRuntimeHostScaffold('app/api/tickets/[ticketId]/comments/route.ts', renderTicketCommentsRoute, isTicketEnabled),
  defineRuntimeHostScaffold('app/api/tickets/[ticketId]/worklogs/route.ts', renderTicketWorklogsRoute, isTicketWorklogEnabled),
  defineRuntimeHostScaffold('app/api/tickets/[ticketId]/status/route.ts', renderTicketStatusRoute, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-attachment-form.tsx', renderTicketAttachmentForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-comment-form.tsx', renderTicketCommentForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-worklog-form.tsx', renderTicketWorklogForm, isTicketWorklogEnabled),
  defineRuntimeHostScaffold('components/ticket-form.tsx', renderTicketForm, isTicketEnabled),
  defineRuntimeHostScaffold('components/ticket-status-form.tsx', renderTicketStatusForm, isTicketEnabled),
  defineRuntimeHostScaffold('tests/runtime/unit/ticket-runtime.test.ts', renderTicketRuntimeUnitTest, isTicketEnabled),
  defineRuntimeHostScaffold('tests/runtime/acceptance/ticket-flow.spec.ts', renderTicketRuntimeAcceptanceTest, isTicketEnabled)
];

const scaffoldDefinitionPaths = runtimeHostScaffoldDefinitions.map((definition) => definition.relativePath);
if (new Set(scaffoldDefinitionPaths.map((value) => portableLogicalPathCollisionKeyV1(
  value,
  'Runtime Host scaffold path'
))).size !== scaffoldDefinitionPaths.length) {
  throw new Error('Runtime Host scaffold definitions contain duplicate output paths');
}

function buildRuntimeHostFeatures(lock: LockFile): RuntimeHostFeatures {
  const blockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
  const has = (blockId: string): boolean => blockIds.has(blockId);
  return {
    authEnabled: has('auth/basic-session'),
    auditEnabled: has('audit/basic'),
    customerEnabled: has('entity/customer-basic'),
    exportCsvEnabled: has('export/csv-basic'),
    fileUploadEnabled: has('file/upload'),
    notifyEmailEnabled: has('notify/email-basic'),
    postgresEnabled: has('infra/postgres'),
    rbacEnabled: has('rbac/basic'),
    tableFilterEnabled: has('table/filter-search'),
    ticketEnabled: has('ticket/basic'),
    ticketReportingEnabled: has('reporting/ticket-summary'),
    worklogEnabled: has('worklog/basic')
  };
}

function scaffoldEntries(lock: LockFile): RuntimeHostScaffoldEntry[] {
  const features = buildRuntimeHostFeatures(lock);
  return runtimeHostScaffoldDefinitions
    .filter((definition) => definition.enabled?.(features) ?? true)
    .map((definition) => ({ relativePath: definition.relativePath, source: definition.render(features) }));
}

function readOptionalScaffoldText(targetPath: string, relativePath: string): string | null {
  const bytes = readOptionalRetainedOrdinaryFileV1(targetPath, `Runtime Host target ${relativePath}`);
  return bytes === null ? null : decodeExactUtf8V1(bytes, `Runtime Host target ${relativePath}`);
}

export async function generateRuntimeHostScaffold(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<string[]> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const entries = scaffoldEntries(lock);

  await Promise.all(entries.map((entry) => defaultLimit(async () => {
    const targetPath = path.join(projectRoot, ...entry.relativePath.split('/'));
    const current = readOptionalScaffoldText(targetPath, entry.relativePath);
    if (current === entry.source) return;
    await writeText(targetPath, entry.source, commitFence);
  })));

  return uniqueSorted([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries.map((entry) => entry.relativePath)]);
}
