import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { buildReviewSummary } from '../platform/compiler/emit/write-review-summary.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { readJson } from '../platform/shared/fs.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  VerificationReport
} from '../platform/shared/types.ts';

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

async function readReviewInputs(workspaceRoot: string): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
}> {
  const { acceptanceCoveragePath, lockPath, provenancePath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const [lock, provenance, report, coverage] = await Promise.all([
    readJson<LockFile>(lockPath),
    readJson<ProvenanceFile>(provenancePath),
    readJson<VerificationReport>(verificationReportPath),
    readJson<AcceptanceCoverageReport>(acceptanceCoveragePath)
  ]);

  return { lock, provenance, report, coverage };
}

test('buildReviewSummary captures fast-lane policy failures as structured failure points', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-fast-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  await fs.writeFile(
    path.join(projectRoot, 'src', 'installed', 'entity', 'customer-service.ts'),
    `import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';\nimport type { Session } from '../auth/session.ts';\nimport { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';\n\nexport function createCustomer(db: Database, session: Session, input: CustomerInput): CustomerRecord {\n  const normalized = normalizeCustomerInput(input);\n  const customer: CustomerRecord = {\n    id: db.nextCustomerId++,\n    tenantId: session.tenantId,\n    ...normalized\n  };\n  db.customers.push(customer);\n  return customer;\n}\n\nexport function listCustomers(db: Database, session: Session): CustomerRecord[] {\n  return db.customers.filter((customer) => customer.tenantId === session.tenantId);\n}\n`,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const { lock, provenance, report, coverage } = await readReviewInputs(workspaceRoot);
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary.formatVersion).toBe('2');
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'all',
        kind: 'summary',
        artifactPath: 'generated/verification-report.json',
        message: 'Verification failed in lanes: fast'
      },
      {
        lane: 'fast',
        kind: 'policy',
        artifactPath: 'generated/policy-report.json',
        message: 'Policy tenant-scope-required: Entity customer queries must derive tenant context and filter by tenantId.'
      }
    ])
  );
});

test('buildReviewSummary captures runtime failures and coverage gaps as structured risks', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-runtime-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  await fs.writeFile(
    path.join(projectRoot, 'tests', 'runtime', 'unit', 'customer-runtime.test.ts'),
    `import { describe, expect, it } from 'vitest';\n\ndescribe('runtime customer service', () => {\n  it('fails intentionally', () => {\n    expect(1).toBe(2);\n  });\n});\n`,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const { lock, provenance, report, coverage } = await readReviewInputs(workspaceRoot);
  expect(report.runtime.unit.status).toBe('failed');
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'all',
        kind: 'summary',
        artifactPath: 'generated/verification-report.json',
        message: 'Verification failed in lanes: runtime'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: 'generated/runtime-report.json',
        message: 'Runtime unit tests failed'
      }
    ])
  );
  expect(summary.regressionRisks.some((risk) => risk.kind === 'coverage-gap' && typeof risk.message === 'string')).toBe(true);
});
