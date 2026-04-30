import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';

import { runPolicyGate } from '../../platform/compiler/verify/run-policy-gate.ts';
import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { compilerRoot, getWorkspacePaths, relativePosixPath } from '../../platform/shared/paths.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

const activeOfficialPolicyDirs = new Set<string>();
const officialPoliciesRoot = path.join(compilerRoot, 'platform', 'policies', 'official');

afterAll(async () => {
  for (const directory of activeOfficialPolicyDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {}
  }
});

async function createOfficialPolicyDir(prefix: string): Promise<string> {
  const parentDir = path.join(officialPoliciesRoot, '__tests__');
  await fs.mkdir(parentDir, { recursive: true });
  const fixtureDir = await fs.mkdtemp(path.join(parentDir, `${prefix}-`));
  activeOfficialPolicyDirs.add(fixtureDir);
  return fixtureDir;
}

function normalizePolicyPath(rootDir: string, filePath: string, scope: 'official' | 'project'): string {
  const relativePath = relativePosixPath(rootDir, filePath);
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

test('policy gate handles a missing project policies directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-missing-project-');

  await writeCustomerService(workspaceRoot, true);
  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('passed');
  expect(report.project).toEqual({
    policies: [],
    sources: [],
    violations: []
  });
  expect(report.official.policies).toContain('tenant-scope-required');
});

test('policy gate handles an empty project policies directory', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-empty-project-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);

  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('passed');
  expect(report.project).toEqual({
    policies: [],
    sources: [],
    violations: []
  });
  expect(report.official.policies).toContain('tenant-scope-required');
});

test('policy gate reports empty project policy YAML sources', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-empty-source-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);

  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'empty.yaml'), { policies: [] });

  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('passed');
  expect(report.project).toEqual({
    policies: [],
    sources: [
      {
        path: 'project/policies/empty.yaml',
        policyIds: []
      }
    ],
    violations: []
  });
  expect(report.official.policies).toContain('tenant-scope-required');
});

test('policy gate loads uppercase YAML project policy files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-uppercase-yaml-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);

  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'tenant-scope.YAML'), {
    policies: [
      {
        id: 'uppercase-project-policy',
        severity: 'warn',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      }
    ]
  });

  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('passed');
  expect(report.project.sources).toContainEqual({
    path: 'project/policies/tenant-scope.YAML',
    policyIds: ['uppercase-project-policy']
  });
  expect(report.merged.policies.find((policy) => policy.id === 'uppercase-project-policy')).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'project/policies/tenant-scope.YAML'
  });
});

test('policy gate loads developer source policy files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-source-layer-');
  const { sourcePoliciesRoot } = getWorkspacePaths(workspaceRoot);

  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(sourcePoliciesRoot, { recursive: true });
  await writeYaml(path.join(sourcePoliciesRoot, 'tenant-source.yaml'), {
    policies: [
      {
        id: 'source-layer-policy',
        severity: 'warn',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      }
    ]
  });

  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('passed');
  expect(report.project.sources).toContainEqual({
    path: 'source/model/policies/tenant-source.yaml',
    policyIds: ['source-layer-policy']
  });
  expect(report.merged.policies.find((policy) => policy.id === 'source-layer-policy')).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'source/model/policies/tenant-source.yaml'
  });
});

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

test('policy gate records missing install plan targets without violations', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-missing-target-');
  const { lockPath } = getWorkspacePaths(workspaceRoot);
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
        stepId: 'copy_missing_tenant_query',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'copy',
        from: 'files/src/installed/alt/missing-query.ts',
        to: 'src/installed/alt/missing-query.ts'
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

  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.merged.policies.find((policy) => policy.id === 'tenant-scope-required')?.targets).toEqual([
    'src/installed/alt/missing-query.ts'
  ]);
});

test('policy gate uses lock install plan to locate applied block files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-install-plan-');
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const projectRoot = path.join(workspaceRoot, 'project');
  const alphaTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'alpha-query.ts');
  const zetaTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'zeta-query.ts');
  const nonTypeScriptTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'tenant-query.md');
  const nonCopyTargetPath = path.join(projectRoot, 'src', 'installed', 'alt', 'template-query.ts');
  await fs.mkdir(path.dirname(alphaTargetPath), { recursive: true });
  for (const targetPath of [alphaTargetPath, zetaTargetPath, nonTypeScriptTargetPath, nonCopyTargetPath]) {
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
        stepId: 'copy_non_typescript_tenant_query',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'copy',
        from: 'files/src/installed/alt/tenant-query.md',
        to: 'src/installed/alt/tenant-query.md'
      },
      {
        stepId: 'template_tenant_query',
        blockId: 'entity/customer-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'platform/registry/official/entity.customer-basic/files',
        action: 'template',
        from: 'files/src/installed/alt/template-query.ts',
        to: 'src/installed/alt/template-query.ts'
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

  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const report = await readJson<{
    policy: { status: string; violations: Array<{ id: string; sourceScope: string; sourcePath: string }> };
  }>(verificationReportPath);
  expect(report.policy.status).toBe('failed');
  expect(report.policy.violations[0]?.id).toBe('tenant-scope-required');
  expect(report.policy.violations[0]?.sourceScope).toBe('official');
  expect(report.policy.violations[0]?.sourcePath).toBe('platform/policies/official/policy.spec.yaml');
});

test('policy gate targets ticket and worklog tenant-scoped services', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-ticket-targets-');

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  await addBlock(workspaceRoot, 'worklog/basic');
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const report = await runPolicyGate(workspaceRoot);
  const tenantScopePolicy = report.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(report.status).toBe('passed');
  expect(tenantScopePolicy?.targets).toEqual([
    'src/installed/entity/customer-service.ts',
    'src/installed/ticket/ticket-service.ts',
    'src/installed/worklog/worklog-service.ts'
  ]);
});

test('policy gate fails when ticket service loses tenant context', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-ticket-failure-');

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  await fs.writeFile(
    path.join(projectRoot, 'src', 'installed', 'ticket', 'ticket-service.ts'),
    `import type { Database, TicketInput, TicketRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';

export function createTicket(db: Database, session: Session, input: TicketInput): TicketRecord {
  const ticket: TicketRecord = {
    id: db.nextTicketId++,
    tenantId: session.tenantId,
    title: input.title,
    description: '',
    status: 'open',
    assigneeId: session.userId,
    dueDate: '',
    createdBy: session.userId,
    updatedAt: new Date(0).toISOString()
  };
  db.tickets.push(ticket);
  return ticket;
}

export function listTickets(db: Database, session: Session): TicketRecord[] {
  return db.tickets.filter((ticket) => ticket.tenantId === session.tenantId);
}
`,
    'utf8'
  );

  const report = await runPolicyGate(workspaceRoot);

  expect(report.status).toBe('failed');
  expect(report.violations).toEqual([
    expect.objectContaining({
      id: 'tenant-scope-required',
      files: ['src/installed/ticket/ticket-service.ts'],
      message: 'Tenant-scoped queries must derive tenant context and filter by tenantId.'
    })
  ]);
});
