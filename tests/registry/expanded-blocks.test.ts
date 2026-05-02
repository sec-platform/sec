import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

test('expanded official block set composes and verifies as one project', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-expanded-');

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'rbac/basic');
  await addBlock(workspaceRoot, 'audit/basic');
  await addBlock(workspaceRoot, 'export/csv-basic');
  await addBlock(workspaceRoot, 'file/upload');
  await addBlock(workspaceRoot, 'notify/email-basic');
  await addBlock(workspaceRoot, 'table/filter-search');
  await addBlock(workspaceRoot, 'infra/postgres');
  await addBlock(workspaceRoot, 'ticket/basic');
  await addBlock(workspaceRoot, 'reporting/ticket-summary');
  await addBlock(workspaceRoot, 'worklog/basic');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.length).toBe(13);
  expect(resolvedLock.slotTasks).toHaveLength(1);

  await composeWorkspace(workspaceRoot);
  const storeSource = await fs.readFile(path.join(workspaceRoot, 'project', 'lib', 'store.ts'), 'utf8');
  expect(storeSource).toContain("createRuntimeStore('postgres-contract')");
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
  expect(postgresContract.tables.map((table) => table.name)).toEqual([] as any);
  expect(postgresContract.tables.find((table) => table.name === 'email_notifications')?.columns).toEqual([] as any);
  expect(postgresContract.tables.find((table) => table.name === 'tickets')?.columns).toEqual([] as any);

  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<typeof resolvedLock>(lockPath);
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
  expect(routesSource).toContain("path: '/tickets'");
  const ticketsPageSource = await fs.readFile(path.join(workspaceRoot, 'project', 'app', 'tickets', 'page.tsx'), 'utf8');
  expect(ticketsPageSource).toContain('Ticket status filter');
  expect(ticketsPageSource).toContain('Ticket SLA summary');
  expect(ticketsPageSource).toContain('Due date: {ticket.dueDate');
  expect(ticketsPageSource).toContain('summaryExportHref');
  expect(ticketsPageSource).toContain('Attachments for ${ticket.title}');
  expect(ticketsPageSource).toContain('Comments for ${ticket.title}');
  expect(ticketsPageSource).toContain('Worklogs for ${ticket.title}');
  expect(ticketsPageSource).toContain('Total worklog minutes');

});

test('reference project coverage has no uncovered blocks', async () => {
  const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
  const coverage = await readJson<{
    uncoveredBlocks: string[];
    uncoveredSlots: string[];
  }>(acceptanceCoveragePath);

  expect(coverage.uncoveredBlocks).toEqual([] as any);
  expect(coverage.uncoveredSlots).toEqual([] as any);
});
