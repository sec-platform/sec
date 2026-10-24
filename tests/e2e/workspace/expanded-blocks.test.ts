import { expect, test } from 'bun:test';
import path from 'node:path';

import { readJson } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { verifyWorkspace } from '../../../src/bootstrap/engineering/cli.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import { prepareComposedWorkspace } from '../../testkit/workspace.ts';

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
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const postgresContractPath = path.join(workspaceRoot, 'generated', 'postgres-contract.json');
  const resolvedLock = await readJson<LockFile>(lockPath);
  const expectedBlockIds = [
    'audit/basic',
    'auth/basic-session',
    'entity/customer-basic',
    'export/csv-basic',
    'file/upload',
    'infra/postgres',
    'notify/email-basic',
    'rbac/basic',
    'reporting/ticket-summary',
    'table/filter-search',
    'tenant/basic-workspace',
    'ticket/basic',
    'worklog/basic'
  ];
  expect(resolvedLock.resolvedBlocks.map((block) => block.id).sort()).toEqual(expectedBlockIds);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');

  const postgresContract = await readJson<{
    provider: string;
    persistenceMode: string;
    tables: Array<{ name: string; columns: string[] }>;
  }>(postgresContractPath);
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
  expect(lock.resolvedBlocks.map((block) => block.id).sort()).toEqual(expectedBlockIds);
  expect(lock.installPlan.some((step) => step.to === 'generated/postgres-contract.json')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'src/installed/reporting/ticket-summary.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'src/installed/worklog/worklog-service.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'tests/unit/ticket-summary.test.ts')).toBe(true);
  expect(lock.installPlan.some((step) => step.to === 'tests/acceptance/worklog-flow.test.ts')).toBe(true);
  expect(lock.generatedPaths).toEqual(
    expect.arrayContaining([
      'src/runtime/store.ts',
      'src/runtime/database.ts',
      'tests/runtime/unit/ticket-runtime.test.ts',
      'tests/runtime/unit/customer-runtime.test.ts'
    ])
  );
  expect(
    lock.generatedPaths.some((entry) =>
      /^(?:app|components)(?:\/|$)|^next(?:-env\.d\.ts|\.config\.mjs)$|^tests\/runtime\/acceptance\//u.test(entry)
    )
  ).toBe(false);
}, 180000);
