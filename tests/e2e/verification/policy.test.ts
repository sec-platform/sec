import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  runPolicyGate
} from '../../../src/adapters/verification/run-policy-gate.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";
import { writeYaml } from '../../../src/adapters/workspace/yaml.ts';
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../../src/semantics/policies/rules.ts';
import { createWorkspace, prepareComposedWorkspace } from '../../testkit/workspace.ts';

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

test('project policy source rejects schema, duplicate and cross-scope conflicts before evaluation', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-policy-conflicting-duplicate-');
  const { policiesRoot } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(policiesRoot, { recursive: true });
  // Each rejection occurs in the uncached declaration reader, before a Lock or
  // workspace evaluation is acquired. Remove its sole file before the next input.
  for (const [file, policies, failure] of [
    ['unknown.yaml', [{ id: 'unknown-rule', severity: 'error',
      appliesTo: ['entity/customer-basic'], rule: 'source_text_looks_safe' }], /Policy source violates the exact schema/],
    ['duplicate.yaml', [
      { id: 'duplicate-policy', severity: 'warn', appliesTo: ['entity/customer-basic'], rule: TENANT_FLOW_RULE },
      { id: 'duplicate-policy', severity: 'blocker', appliesTo: ['entity/customer-basic'], rule: TENANT_FLOW_RULE }
    ], /Conflicting duplicate policy id/],
    ['official-conflict.yaml', [
      { id: 'tenant-scope-required', severity: 'blocker',
        appliesTo: ['entity/customer-basic'], rule: TENANT_FLOW_RULE }
    ], /Conflicting policy declarations/]
  ] as const) {
    const target = path.join(policiesRoot, file);
    await writeYaml(target, { policies });
    await expect(runPolicyGate(workspaceRoot)).rejects.toThrow(failure);
    await fs.rm(target);
  }
}, 180000);

test('equal project policy declarations retain attribution and resolved applicability across blocks', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-policy-targets-',
    blockIds: ['ticket/basic', 'worklog/basic']
  });
  const { policiesRoot: projectPoliciesRoot } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(projectPoliciesRoot, { recursive: true });
  await writeYaml(path.join(projectPoliciesRoot, 'tenant.yaml'), {
    policies: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['entity/customer-basic', 'ticket/basic', 'worklog/basic'],
      rule: TENANT_FLOW_RULE
    }]
  });

  const report = await runPolicyGate(workspaceRoot);
  const tenantScopePolicy = report.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(report.status).toBe('passed');
  expect(report.violations).toEqual([]);
  expect(report.diagnostics).toEqual([]);
  expect(report.evaluation?.requiredSemanticPredicates).toContain(TENANT_FLOW_PREDICATE);
  expect(tenantScopePolicy).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'model/policies/tenant.yaml'
  });
  expect(report.evaluation?.assurance).toBe('semantic');
  expect(tenantScopePolicy?.targets).toEqual([
    'src/installed/entity/customer-service.ts',
    'src/installed/ticket/ticket-service.ts',
    'src/installed/worklog/worklog-service.ts'
  ]);
  expect(report.evaluation?.unsupportedSemanticPredicates).toEqual([]);

  // The existing composed multi-block workspace also exercises the Policy Gate
  // fail-closed target read, without repeating its full setup in another test.
  await fs.rm(customerServicePath(workspaceRoot));
  await expect(runPolicyGate(workspaceRoot)).rejects.toMatchObject({ code: 'VERIFY-POLICY-003' });
}, 180000);
