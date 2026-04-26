import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace,
  explainWorkspace
} from '../platform/orchestrator.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

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

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.length).toBe(12);
  expect(resolvedLock.slotTasks).toHaveLength(1);

  await composeWorkspace(workspaceRoot);
  const storeSource = await fs.readFile(path.join(workspaceRoot, 'project', 'lib', 'store.ts'), 'utf8');
  expect(storeSource).toContain("createRuntimeStore('postgres-contract')");
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  const coverage = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'acceptance-coverage.json'), 'utf8')
  ) as { uncoveredBlocks: string[]; uncoveredSlots: string[] };
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(coverage.uncoveredSlots).toEqual([]);

  const postgresContract = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json'), 'utf8')
  ) as { provider: string; persistenceMode: string; tables: Array<{ name: string; columns: string[] }> };
  expect(postgresContract.provider).toBe('postgres');
  expect(postgresContract.persistenceMode).toBe('contract-only');
  expect(postgresContract.tables.map((table) => table.name)).toEqual([
    'customers',
    'customer_attachments',
    'email_notifications',
    'audit_entries',
    'tickets'
  ]);
  expect(postgresContract.tables.find((table) => table.name === 'email_notifications')?.columns).toEqual([
    'id',
    'tenant_id',
    'entity',
    'entity_id',
    'event_type',
    'recipient',
    'subject',
    'body',
    'created_at'
  ]);

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  expect(locked.resolvedBlocks.some((block) => block.id === 'rbac/basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'audit/basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'export/csv-basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'file/upload')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'notify/email-basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'table/filter-search')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'infra/postgres')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'ticket/basic')).toBe(true);
  expect(locked.resolvedBlocks.some((block) => block.id === 'reporting/ticket-summary')).toBe(true);
  expect(locked.installPlan.some((step) => step.to === 'generated/postgres-contract.json')).toBe(true);
  expect(locked.installPlan.some((step) => step.to === 'src/installed/reporting/ticket-summary.ts')).toBe(true);
  expect(locked.installPlan.some((step) => step.to === 'tests/unit/ticket-summary.test.ts')).toBe(true);
  expect(locked.generatedPaths).toEqual(
    expect.arrayContaining([
      'app/tickets/page.tsx',
      'app/api/tickets/route.ts',
      'app/api/tickets/export/route.ts',
      'app/api/tickets/summary/route.ts',
      'app/api/tickets/summary/export/route.ts',
      'app/api/tickets/[ticketId]/status/route.ts',
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
  expect(ticketsPageSource).toContain('summaryExportHref');

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expect(
    reviewSummary.runtimeEntries.find((entry) => entry.path === 'app/api/tickets/summary/export/route.ts')
  ).toEqual({
    path: 'app/api/tickets/summary/export/route.ts',
    kind: 'api',
    vertical: 'ticket',
    relatedBlocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic']
  });
  expect(reviewSummary.verticalSlices).toEqual(
    expect.arrayContaining([
      {
        id: 'ticket',
        runtimeEntries: expect.arrayContaining([
          'app/tickets/page.tsx',
          'app/api/tickets/export/route.ts',
          'app/api/tickets/summary/route.ts',
          'app/api/tickets/summary/export/route.ts'
        ]),
        relatedBlocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic']
      }
    ])
  );
  expect(
    graph.edges.some(
      (edge) =>
        edge.from === 'block:reporting/ticket-summary' &&
        edge.to === 'file:app/api/tickets/summary/route.ts' &&
        edge.type === 'writes_to'
    )
  ).toBe(true);
  const sourceView = await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'views', 'source-view.html'), 'utf8');
  expect(sourceView).toContain('Runtime Entry Points');
  expect(sourceView).toContain('Vertical Summary');
  expect(sourceView).toContain('Block Combination Summary');
  expect(sourceView).toContain('Review Runtime Attribution');
  expect(sourceView).toContain('app/api/tickets/export/route.ts');
  expect(sourceView).toContain('app/api/tickets/summary/route.ts');
  expect(sourceView).toContain('app/api/tickets/summary/export/route.ts');
  expect(sourceView).toContain('ticket/basic');
  expect(sourceView).toContain('reporting/ticket-summary');
});

test('reference project coverage has no uncovered blocks', async () => {
  const coverage = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'project', 'generated', 'acceptance-coverage.json'), 'utf8')
  ) as { uncoveredBlocks: string[]; uncoveredSlots: string[] };

  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(coverage.uncoveredSlots).toEqual([]);
});
