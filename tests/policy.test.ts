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
import { runPolicyGate } from '../platform/compiler/verify/run-policy-gate.ts';
import { compilerRoot } from '../platform/shared/paths.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';
import type { LockFile } from '../platform/shared/types.ts';

const activeWorkspaces = new Set<string>();
const activeOfficialPolicyDirs = new Set<string>();
const officialPoliciesRoot = path.join(compilerRoot, 'platform', 'policies', 'official');

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  for (const directory of activeOfficialPolicyDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
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

async function createOfficialPolicyDir(prefix: string): Promise<string> {
  const parentDir = path.join(officialPoliciesRoot, '__tests__');
  await fs.mkdir(parentDir, { recursive: true });
  const fixtureDir = await fs.mkdtemp(path.join(parentDir, `${prefix}-`));
  activeOfficialPolicyDirs.add(fixtureDir);
  return fixtureDir;
}

function normalizePolicyPath(rootDir: string, filePath: string, scope: 'official' | 'project'): string {
  const relativePath = path.relative(rootDir, filePath).replaceAll('\\', '/');
  return scope === 'official' ? `platform/policies/official/${relativePath}` : `project/policies/${relativePath}`;
}

async function writeCustomerService(workspaceRoot: string, valid: boolean): Promise<void> {
  const customerServicePath = path.join(
    workspaceRoot,
    'project',
    'src',
    'installed',
    'entity',
    'customer-service.ts'
  );
  await fs.mkdir(path.dirname(customerServicePath), { recursive: true });
  await fs.writeFile(
    customerServicePath,
    valid
      ? `import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';\nimport type { Session } from '../auth/session.ts';\nimport { currentTenant } from '../tenant/context.ts';\nimport { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';\n\nexport function createCustomer(db: Database, session: Session, input: CustomerInput): CustomerRecord {\n  const tenantId = currentTenant(session);\n  const normalized = normalizeCustomerInput(input);\n  const customer: CustomerRecord = {\n    id: db.nextCustomerId++,\n    tenantId,\n    ...normalized\n  };\n  db.customers.push(customer);\n  return customer;\n}\n\nexport function listCustomers(db: Database, session: Session): CustomerRecord[] {\n  const tenantId = currentTenant(session);\n  return db.customers.filter((customer) => customer.tenantId === tenantId);\n}\n`
      : `import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';\nimport type { Session } from '../auth/session.ts';\nimport { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';\n\nexport function createCustomer(db: Database, session: Session, input: CustomerInput): CustomerRecord {\n  const normalized = normalizeCustomerInput(input);\n  const customer: CustomerRecord = {\n    id: db.nextCustomerId++,\n    tenantId: session.tenantId,\n    ...normalized\n  };\n  db.customers.push(customer);\n  return customer;\n}\n\nexport function listCustomers(db: Database, session: Session): CustomerRecord[] {\n  return db.customers.filter((customer) => customer.tenantId === session.tenantId);\n}\n`,
    'utf8'
  );
}

test('policy gate ignores non-YAML project policy files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-ignore-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);

  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await fs.writeFile(path.join(projectPoliciesRoot, 'notes.txt'), 'tenant-scope-required\n', 'utf8');

  const report = await runPolicyGate(workspaceRoot);

  expect(report.project.sources.some((source) => source.path.endsWith('notes.txt'))).toBe(false);
});

test('policy gate merges recursive official/project sources and reports winning definitions', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-merge-');
  const officialFixtureDir = await createOfficialPolicyDir('merge');
  const officialScopeRoot = officialPoliciesRoot;
  const projectPoliciesRoot = path.join(workspaceRoot, 'project', 'policies');

  try {
    await writeCustomerService(workspaceRoot, true);

    const officialFirst = path.join(officialFixtureDir, 'a', 'shadow-base.yaml');
    const officialWinning = path.join(officialFixtureDir, 'z', 'shadow-winning.yml');
    await fs.mkdir(path.dirname(officialFirst), { recursive: true });
    await fs.mkdir(path.dirname(officialWinning), { recursive: true });
    await writeYaml(officialFirst, {
      policies: [
        {
          id: 'official-shadow',
          severity: 'warn',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        }
      ]
    });
    await writeYaml(officialWinning, {
      policies: [
        {
          id: 'official-shadow',
          severity: 'warn',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        },
        {
          id: 'official-only',
          severity: 'info',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        }
      ]
    });

    const projectBase = path.join(projectPoliciesRoot, 'a', 'tenant-base.yaml');
    const projectWinning = path.join(projectPoliciesRoot, 'z', 'tenant-winning.yml');
    await fs.mkdir(path.dirname(projectBase), { recursive: true });
    await fs.mkdir(path.dirname(projectWinning), { recursive: true });
    await writeYaml(projectBase, {
      policies: [
        {
          id: 'tenant-scope-required',
          severity: 'error',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        }
      ]
    });
    await writeYaml(projectWinning, {
      policies: [
        {
          id: 'tenant-scope-required',
          severity: 'blocker',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        },
        {
          id: 'project-only',
          severity: 'warn',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        },
        {
          id: 'project-only',
          severity: 'warn',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query'
        }
      ]
    });

    const report = await runPolicyGate(workspaceRoot);
    expect(report.status).toBe('passed');
    expect(report.violations).toEqual([]);
    expect(report.official.sources).toEqual(
      expect.arrayContaining([
        {
          path: normalizePolicyPath(officialScopeRoot, officialFirst, 'official'),
          policyIds: ['official-shadow']
        },
        {
          path: normalizePolicyPath(officialScopeRoot, officialWinning, 'official'),
          policyIds: ['official-only', 'official-shadow']
        }
      ])
    );
    expect(report.project.sources).toEqual(
      expect.arrayContaining([
        {
          path: normalizePolicyPath(projectPoliciesRoot, projectBase, 'project'),
          policyIds: ['tenant-scope-required']
        },
        {
          path: normalizePolicyPath(projectPoliciesRoot, projectWinning, 'project'),
          policyIds: ['project-only', 'tenant-scope-required']
        }
      ])
    );

    const mergedPolicies = new Map(report.merged.policies.map((policy) => [policy.id, policy]));
    expect(mergedPolicies.get('official-shadow')).toEqual({
      id: 'official-shadow',
      sourceScope: 'official',
      sourcePath: normalizePolicyPath(officialScopeRoot, officialWinning, 'official'),
      targets: ['src/installed/entity/customer-service.ts']
    });
    expect(mergedPolicies.get('tenant-scope-required')).toEqual({
      id: 'tenant-scope-required',
      sourceScope: 'project',
      sourcePath: normalizePolicyPath(projectPoliciesRoot, projectWinning, 'project'),
      targets: ['src/installed/entity/customer-service.ts']
    });
    expect(mergedPolicies.get('project-only')).toEqual({
      id: 'project-only',
      sourceScope: 'project',
      sourcePath: normalizePolicyPath(projectPoliciesRoot, projectWinning, 'project'),
      targets: ['src/installed/entity/customer-service.ts']
    });
  } finally {
    await fs.rm(officialFixtureDir, { recursive: true, force: true });
    activeOfficialPolicyDirs.delete(officialFixtureDir);
  }
});

test('policy report violations point to the winning project source after recursive merge', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-winning-source-');
  const projectPoliciesRoot = path.join(workspaceRoot, 'project', 'policies');

  await writeCustomerService(workspaceRoot, false);

  const projectBase = path.join(projectPoliciesRoot, 'a', 'tenant-base.yaml');
  const projectWinning = path.join(projectPoliciesRoot, 'z', 'tenant-winning.yml');
  await fs.mkdir(path.dirname(projectBase), { recursive: true });
  await fs.mkdir(path.dirname(projectWinning), { recursive: true });
  await writeYaml(projectBase, {
    policies: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      }
    ]
  });
  await writeYaml(projectWinning, {
    policies: [
      {
        id: 'tenant-scope-required',
        severity: 'blocker',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      }
    ]
  });

  const report = await runPolicyGate(workspaceRoot);
  expect(report.status).toBe('failed');
  expect(report.official.violations).toEqual([]);
  expect(report.project.violations).toHaveLength(1);
  expect(report.violations).toHaveLength(1);
  expect(report.violations[0]).toMatchObject({
    id: 'tenant-scope-required',
    sourceScope: 'project',
    sourcePath: normalizePolicyPath(projectPoliciesRoot, projectWinning, 'project')
  });
  expect(report.merged.policies.find((policy) => policy.id === 'tenant-scope-required')).toEqual({
    id: 'tenant-scope-required',
    sourceScope: 'project',
    sourcePath: normalizePolicyPath(projectPoliciesRoot, projectWinning, 'project'),
    targets: ['src/installed/entity/customer-service.ts']
  });
});

test('policy gate uses lock install plan to locate applied block files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-install-plan-');
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const projectRoot = path.join(workspaceRoot, 'project');
  const alphaTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'alpha-query.ts');
  const zetaTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'zeta-query.ts');
  await fs.mkdir(path.dirname(alphaTargetPath), { recursive: true });
  for (const targetPath of [alphaTargetPath, zetaTargetPath]) {
    await fs.writeFile(
      targetPath,
      `export function listCustomers(db: { customers: Array<{ tenantId: string }> }, session: { tenantId: string }) {
  return db.customers.filter((customer) => customer.tenantId === session.tenantId);
}
`,
      'utf8'
    );
  }

  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [
      {
        stepId: 'copy_zeta_tenant_query',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'copy',
        from: 'files/src/installed/alt/zeta-query.ts',
        to: 'src/installed/alt/zeta-query.ts'
      },
      {
        stepId: 'copy_alpha_tenant_query',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'copy',
        from: 'files/src/installed/alt/alpha-query.ts',
        to: 'src/installed/alt/alpha-query.ts'
      },
      {
        stepId: 'copy_customer_normalizer_test',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'copy',
        from: 'files/tests/unit/customer-normalizer.test.ts',
        to: 'tests/unit/customer-normalizer.test.ts'
      },
      {
        stepId: 'copy_other_query',
        blockId: 'audit/basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/audit.basic/files',
        action: 'copy',
        from: 'files/src/installed/audit/audit-log.ts',
        to: 'src/installed/audit/audit-log.ts'
      }
    ],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    }
  };
  await writeJson(lockPath, lock);

  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('failed');
  expect(report.violations.map((violation) => violation.files[0])).toEqual([
    'src/installed/alt/alpha-query.ts',
    'src/installed/alt/zeta-query.ts'
  ]);
  expect(report.merged.policies.find((policy) => policy.id === 'tenant-scope-required')?.targets).toEqual([
    'src/installed/alt/alpha-query.ts',
    'src/installed/alt/zeta-query.ts'
  ]);
});

test('policy gate fails when tenant scoping is removed from customer queries', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await writeCustomerService(workspaceRoot, false);

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const report = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'verification-report.json'), 'utf8')
  ) as { policy: { status: string; violations: Array<{ id: string; sourceScope: string; sourcePath: string }> } };
  expect(report.policy.status).toBe('failed');
  expect(report.policy.violations[0]?.id).toBe('tenant-scope-required');
  expect(report.policy.violations[0]?.sourceScope).toBe('official');
  expect(report.policy.violations[0]?.sourcePath).toBe('platform/policies/official/policy.spec.yaml');
});
