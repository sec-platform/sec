import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildPolicyClaimGate,
  runPolicyGate
} from '../../platform/compiler/verify/run-policy-gate.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { createWorkspace, prepareAdaptedWorkspace } from '../testkit/workspace.ts';

async function writeCustomerService(workspaceRoot: string, matchesStructuralHeuristic: boolean): Promise<void> {
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
    matchesStructuralHeuristic
      ? `import type { Session } from '../auth/session.ts';\nimport { currentTenant } from '../tenant/context.ts';\n\nexport function listCustomers(db: { customers: Array<{ tenantId: string }> }, session: Session) {\n  const tenantId = currentTenant(session);\n  return db.customers.filter((customer) => customer.tenantId === tenantId);\n}\n`
      : `import type { Session } from '../auth/session.ts';\n\nexport function listCustomers(db: { customers: Array<{ tenantId: string }> }, session: Session) {\n  return db.customers.filter((customer) => customer.tenantId === session.tenantId);\n}\n`,
    'utf8'
  );
}

test('source-structure match cannot mint a semantic Policy PASS', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-assurance-pass-');
  await writeCustomerService(workspaceRoot, true);

  const report = await runPolicyGate(workspaceRoot);
  const gate = buildPolicyClaimGate(report, 'fast');

  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.diagnostics).toEqual([]);
  expect(report.evaluation).toMatchObject({
    assurance: 'source-structure',
    requiredSemanticPredicates: ['FLOWS_TO'],
    unsupportedSemanticPredicates: ['FLOWS_TO']
  });
  expect(gate.status).toBe('unsupported');
  expect(gate.reasonCode).toBe('capability-unsupported');
  expect(gate.supportedClaims).toEqual([]);
}, 180000);

test('source-structure mismatch is advisory and cannot mint a semantic Policy FAIL', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-assurance-diagnostic-');
  await writeCustomerService(workspaceRoot, false);

  const report = await runPolicyGate(workspaceRoot);
  const gate = buildPolicyClaimGate(report, 'fast');

  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.official.violations).toEqual([]);
  expect(report.project.violations).toEqual([]);
  expect(report.diagnostics).toHaveLength(1);
  expect(report.diagnostics?.[0]).toMatchObject({
    id: 'tenant-scope-required',
    evidenceClass: 'source-structure',
    files: ['src/installed/entity/customer-service.ts']
  });
  expect(gate.status).toBe('unsupported');
  expect(gate.reasonCode).toBe('capability-unsupported');
}, 180000);

test('an applicable policy target must be a retained readable ordinary file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-missing-target-');

  await expect(runPolicyGate(workspaceRoot)).rejects.toThrow(/Applicable policy target is missing/);
}, 180000);

test('project policy declarations override the official definition without changing assurance', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-project-precedence-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'tenant.yaml'), {
    policies: [{
      id: 'tenant-scope-required',
      severity: 'blocker',
      appliesTo: ['entity/customer-basic'],
      rule: 'tenant_context_must_flow_to_query'
    }]
  });

  const report = await runPolicyGate(workspaceRoot);
  const merged = report.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(merged).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'project/policies/tenant.yaml'
  });
  expect(report.evaluation?.assurance).toBe('source-structure');
  expect(buildPolicyClaimGate(report, 'fast').status).toBe('unsupported');
}, 180000);

test('unknown policy rules fail at the declaration schema boundary', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-unknown-rule-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'unknown.yaml'), {
    policies: [{
      id: 'unknown-rule',
      severity: 'error',
      appliesTo: ['entity/customer-basic'],
      rule: 'source_text_looks_safe'
    }]
  });

  await expect(runPolicyGate(workspaceRoot)).rejects.toThrow();
}, 180000);

test('same policy id with different declarations is a conflict, not last-wins input', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-conflicting-duplicate-');
  const { projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await writeCustomerService(workspaceRoot, true);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'duplicate.yaml'), {
    policies: [
      {
        id: 'duplicate-policy',
        severity: 'warn',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      },
      {
        id: 'duplicate-policy',
        severity: 'blocker',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query'
      }
    ]
  });

  await expect(runPolicyGate(workspaceRoot)).rejects.toThrow();
}, 180000);

test('policy applicability is derived from the resolved install plan across blocks', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({
    prefix: 'engineering-compiler-policy-targets-',
    blockIds: ['ticket/basic', 'worklog/basic']
  });

  const report = await runPolicyGate(workspaceRoot);
  const tenantScopePolicy = report.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(tenantScopePolicy?.targets).toEqual([
    'src/installed/entity/customer-service.ts',
    'src/installed/ticket/ticket-service.ts',
    'src/installed/worklog/worklog-service.ts'
  ]);
  expect(report.evaluation?.unsupportedSemanticPredicates).toEqual(['FLOWS_TO']);
}, 180000);
