import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../src/compiler/policies/contract/rules.ts';
import {
  runPolicyGate
} from '../../src/compiler/verify/run-policy-gate.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';
import { writeYaml } from '../../src/workspace/yaml.ts';
import { createWorkspace, prepareComposedWorkspace } from '../testkit/workspace.ts';

const TENANT_FLOW_RULE = TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE;
const TENANT_FLOW_PREDICATE = policySemanticRule(TENANT_FLOW_RULE).requiredPredicate;

function customerServicePath(workspaceRoot: string): string {
  return path.join(
    workspaceRoot,
    'src',
    'installed',
    'entity',
    'customer-service.ts'
  );
}

test('validated Engineering IR facts prove the tenant flow policy', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-policy-assurance-pass-'
  });

  const report = await runPolicyGate(workspaceRoot);
  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.diagnostics).toEqual([]);
  expect(report.evaluation).toMatchObject({
    assurance: 'semantic',
    requiredSemanticPredicates: [TENANT_FLOW_PREDICATE],
    unsupportedSemanticPredicates: []
  });
}, 180000);

test('unproven tenant flow fails closed instead of becoming an advisory', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-policy-assurance-diagnostic-'
  });
  const targetPath = customerServicePath(workspaceRoot);
  const source = await fs.readFile(targetPath, 'utf8');
  await fs.writeFile(
    targetPath,
    source.replaceAll('currentTenant(session)', 'session.tenantId'),
    'utf8'
  );

  const report = await runPolicyGate(workspaceRoot);
  expect(report.status).toBe('failed');
  expect(report.violations).toHaveLength(1);
  expect(report.official.violations).toHaveLength(1);
  expect(report.project.violations).toEqual([]);
  expect(report.diagnostics).toHaveLength(1);
  expect(report.diagnostics?.[0]).toMatchObject({
    id: 'tenant-scope-required',
    evidenceClass: 'source-structure',
    files: ['src/installed/entity/customer-service.ts']
  });
}, 180000);

test('an applicable policy target must be a retained readable ordinary file', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-policy-missing-target-'
  });
  await fs.rm(customerServicePath(workspaceRoot));

  await expect(runPolicyGate(workspaceRoot)).rejects.toThrow(/Applicable policy target is missing/);
}, 180000);

test('project policy declarations override the official definition without changing assurance', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-policy-project-precedence-'
  });
  const { policiesRoot: projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'tenant.yaml'), {
    policies: [{
      id: 'tenant-scope-required',
      severity: 'blocker',
      appliesTo: ['entity/customer-basic'],
      rule: TENANT_FLOW_RULE
    }]
  });

  const report = await runPolicyGate(workspaceRoot);
  const merged = report.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(merged).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'model/policies/tenant.yaml'
  });
  expect(report.evaluation?.assurance).toBe('semantic');
}, 180000);

test('unknown policy rules fail at the declaration schema boundary', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-unknown-rule-');
  const { policiesRoot: projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
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
  const { policiesRoot: projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'duplicate.yaml'), {
    policies: [
      {
        id: 'duplicate-policy',
        severity: 'warn',
        appliesTo: ['entity/customer-basic'],
        rule: TENANT_FLOW_RULE
      },
      {
        id: 'duplicate-policy',
        severity: 'blocker',
        appliesTo: ['entity/customer-basic'],
        rule: TENANT_FLOW_RULE
      }
    ]
  });

  await expect(runPolicyGate(workspaceRoot)).rejects.toThrow();
}, 180000);

test('policy applicability is derived from the resolved install plan across blocks', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
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
  expect(report.evaluation?.unsupportedSemanticPredicates).toEqual([]);
}, 180000);
