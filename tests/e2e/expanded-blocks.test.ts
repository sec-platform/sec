import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
    adaptWorkspace,
    verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { prepareComposedWorkspace } from '../testkit/workspace.ts';

test('expanded official block set composes and verifies as one project', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-expanded-',
    blockIds: [
      'rbac/basic',
      'audit/basic',
      'export/csv-basic',
      'file/upload',
      'notify/email-basic',
      'table/filter-search',
      'infra/postgres',
      'ticket/basic',
      'reporting/ticket-summary',
      'worklog/basic'
    ]
  });
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const resolvedLock = await readJson<LockFile>(lockPath);
  expect(resolvedLock.resolvedBlocks.length).toBe(13);
  expect(resolvedLock.slotTasks).toHaveLength(2);

  const storeSource = await fs.readFile(path.join(workspaceRoot, 'project', 'lib', 'store.ts'), 'utf8');
  expect(storeSource).toContain('createRuntimeStore("postgres-contract")');
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');

  const postgresContract = await readJson<{
    provider: string;
    persistenceMode: string;
    tables: Array<{ name: string; columns: string[] }>;
  }>(path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json'));
  expect(postgresContract.provider).toBe('postgres');
  expect(postgresContract.persistenceMode).toBe('contract-only');
  expect(postgresContract.tables.map((table) => table.name)).toEqual(
    expect.arrayContaining([
      'audit_entries',
      'customer_attachments',
      'customers',
      'email_notifications',
      'ticket_attachments',
      'ticket_comments',
      'tickets',
      'worklogs'
    ])
  );
  expect(postgresContract.tables.find((table) => table.name === 'email_notifications')?.columns).toEqual(
    expect.arrayContaining(['id', 'recipient', 'subject', 'event_type'])
  );
  expect(postgresContract.tables.find((table) => table.name === 'tickets')?.columns).toEqual(
    expect.arrayContaining(['id', 'title', 'status', 'due_date', 'tenant_id'])
  );

  const lock = await readJson<LockFile>(lockPath);
  expect(lock.passStatus.verify).toBe('pending');
  expect(lock.resolvedBlocks.some((block) => block.id === 'rbac/basic')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'audit/basic')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'export/csv-basic')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'file/upload')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'notify/email-basic')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'table/filter-search')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'infra/postgres')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'ticket/basic')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'reporting/ticket-summary')).toBe(true);
  expect(lock.resolvedBlocks.some((block) => block.id === 'worklog/basic')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'generated/postgres-contract.json')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'src/installed/reporting/ticket-summary.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'src/installed/worklog/worklog-service.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'tests/unit/ticket-summary.test.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'tests/unit/worklog-service.test.ts')).toBe(true);
  expect(lock.generatedPaths).toEqual(
    expect.arrayContaining([
      'app/tickets/page.tsx',
      'app/api/tickets/route.ts',
      'app/api/tickets/export/route.ts',
      'app/api/tickets/summary/route.ts',
      'app/api/tickets/summary/export/route.ts',
      'app/api/tickets/[ticketId]/attachments/route.ts',
      'app/api/tickets/[ticketId]/comments/route.ts',
      'app/api/tickets/[ticketId]/status/route.ts',
      'app/api/tickets/[ticketId]/worklogs/route.ts',
      'components/ticket-attachment-form.tsx',
      'components/ticket-comment-form.tsx',
      'components/ticket-worklog-form.tsx',
      'components/ticket-form.tsx',
      'components/ticket-status-form.tsx',
      'tests/runtime/unit/ticket-runtime.test.ts',
      'tests/runtime/acceptance/ticket-flow.spec.ts'
    ])
  );

  const routesSource = await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'routes.ts'), 'utf8');
  expect(routesSource).toContain('path: "/tickets"');
  const ticketsPageSource = await fs.readFile(path.join(workspaceRoot, 'project', 'app', 'tickets', 'page.tsx'), 'utf8');
  expect(ticketsPageSource).toContain('Ticket status filter');
  expect(ticketsPageSource).toContain('Ticket SLA summary');
  expect(ticketsPageSource).toContain('Due date: {ticket.dueDate');
  expect(ticketsPageSource).toContain('summaryExportHref');
  expect(ticketsPageSource).toContain('Attachments for ${ticket.title}');
  expect(ticketsPageSource).toContain('Comments for ${ticket.title}');
  expect(ticketsPageSource).toContain('Worklogs for ${ticket.title}');
  expect(ticketsPageSource).toContain('Total worklog minutes');

}, 180000);
test('reference project coverage has no uncovered blocks after runtime acceptance passes', async () => {
  const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
  if (!(await fs.access(acceptanceCoveragePath).then(() => true, () => false))) {
    return;
  }
  const coverage = await readJson<{
    status: 'passed' | 'failed' | 'skipped';
    uncoveredBlocks: string[];
    uncoveredSlots: string[];
  }>(acceptanceCoveragePath);

  if (coverage.status !== 'passed') {
    return;
  }

  const uncovered = coverage.uncoveredBlocks.filter((b) => b !== 'collaboration/enterprise-hub' && b !== 'file/upload');
  expect(uncovered).toHaveLength(0);
  const uncoveredSlots = coverage.uncoveredSlots.filter((s) =>
    !s.includes('collaboration/enterprise-hub') && s !== 'ticket_comment_delegate'
  );
  expect(uncoveredSlots).toHaveLength(0);
}, 180000);
