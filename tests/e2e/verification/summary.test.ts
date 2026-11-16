import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { publishReviewSummary } from '../../../src/adapters/compilation/emit/publish-review-summary.ts';
import { buildReviewSummary } from '../../../src/adapters/compilation/emit/write-review-summary.ts';
import { readJson, writeJson } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { writeYaml } from '../../../src/adapters/workspace/yaml.ts';
import { runPolicyGate } from '../../../src/adapters/verification/run-policy-gate.ts';
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../../src/semantics/policies/rules.ts';
import type { AcceptanceCoverageReport } from '../../../src/assurance/acceptance/coverage.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { parseReviewSummaryJson } from '../../../src/assurance/verification/review/contract/summary.ts';
import { verifyWorkspace } from '../../../src/bootstrap/engineering/cli.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import type { ProvenanceFile } from '../../../src/semantics/provenance/types.ts';
import {
  buildReviewInputs
} from '../../helpers/review-fixtures.ts';
import { runCliInProcess } from '../../testkit/cli.ts';
import { createWorkspace, prepareComposedWorkspace } from '../../testkit/workspace.ts';

const TENANT_FLOW_RULE = TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE;
const TENANT_FLOW_PREDICATE = policySemanticRule(TENANT_FLOW_RULE).requiredPredicate;

// Review Summary production and durable-artifact contracts.
async function readReviewInputs(workspaceRoot: string): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
}> {
  const acceptanceCoveragePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
  const [lock, provenance, report, coverage] = await Promise.all([
    readJson<LockFile>(lockPath),
    readJson<ProvenanceFile>(provenancePath),
    readJson<VerificationReport>(verificationReportPath),
    readJson<AcceptanceCoverageReport>(acceptanceCoveragePath)
  ]);

  return { lock, provenance, report, coverage };
}

test('canonical Review Summary publication persists the artifact and generated path', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-write-');
  // Source declaration rejections require no Lock or separate workspace.
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
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const reviewSummaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
  const { lock, provenance, report, coverage } = buildReviewInputs({
    lock: {
      app: { stack: 'typescript-library' },
      passStatus: { lock: 'succeeded' }
    }
  });
  await fs.mkdir(path.dirname(reviewSummaryPath), { recursive: true });
  await writeJson(lockPath, lock);

  const summary = await publishReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  const persistedLock = await readJson<LockFile>(lockPath);
  const persistedSource = await fs.readFile(reviewSummaryPath, 'utf8');
  const persistedSummary = parseReviewSummaryJson(persistedSource);

  expect(summary.ciSummary).toEqual({
    status: 'passed',
    failureCount: 0,
    regressionRiskCount: 0,
    conflictHintCount: 0,
    impactedBlockCount: 0,
    runtimeEntryCount: 0
  });
  expect(summary).toMatchObject({
    changeSourceCount: 0,
    runtimeEntryCount: 0,
    installImpactCount: 0
  });
  expect(summary.conflictHints).toHaveLength(0);
  expect(persistedSummary).toEqual(summary);
  expect(() => parseReviewSummaryJson(JSON.stringify({ ...persistedSummary, formatVersion: 'unknown' }))).toThrow();
  expect(() => parseReviewSummaryJson(JSON.stringify({ ...persistedSummary, undeclared: true }))).toThrow();
  const formatVersion = JSON.stringify(summary.formatVersion);
  const duplicateFormatVersion = `{"formatVersion":${formatVersion},"formatVersion":${formatVersion}}`;
  expect(() => parseReviewSummaryJson(duplicateFormatVersion)).toThrow(
    'duplicate key "formatVersion"'
  );
  await fs.writeFile(reviewSummaryPath, duplicateFormatVersion, 'utf8');
  const rejectedReview = await runCliInProcess(workspaceRoot, ['review', '--json', '--compact']);
  expect(rejectedReview.code).toBe(1);
  expect(rejectedReview.stdout).toBe('');
  expect(rejectedReview.stderr).toContain('duplicate key "formatVersion"');
  expect(persistedLock.generatedPaths).toContain(CI_ARTIFACT_FILES.reviewSummary);
}, 360000);
test('buildReviewSummary captures fast-lane policy failures as structured failure points', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-review-fast-',
    blockIds: ['ticket/basic', 'worklog/basic']
  });
  const projectRoot = workspaceRoot;
  const customerServicePath = path.join(
    projectRoot,
    'src',
    'installed',
    'entity',
    'customer-service.ts'
  );
  const customerService = await fs.readFile(customerServicePath, 'utf8');
  // The live Policy Gate is observed before mutating the same independently owned workspace.
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

  const gateReport = await runPolicyGate(workspaceRoot);
  const tenantScopePolicy = gateReport.merged.policies.find((policy) => policy.id === 'tenant-scope-required');

  expect(gateReport.status).toBe('passed');
  expect(gateReport.violations).toEqual([]);
  expect(gateReport.diagnostics).toEqual([]);
  expect(gateReport.evaluation?.requiredSemanticPredicates).toContain(TENANT_FLOW_PREDICATE);
  expect(tenantScopePolicy).toMatchObject({
    sourceScope: 'project',
    sourcePath: 'model/policies/tenant.yaml'
  });
  expect(gateReport.evaluation?.assurance).toBe('semantic');
  expect(tenantScopePolicy?.targets).toEqual([
    'src/installed/entity/customer-service.ts',
    'src/installed/ticket/ticket-service.ts',
    'src/installed/worklog/worklog-service.ts'
  ]);
  expect(gateReport.evaluation?.unsupportedSemanticPredicates).toEqual([]);

  // The existing composed multi-block workspace also exercises the Policy Gate
  // fail-closed target read, without repeating its full setup in another test.
  await fs.rm(customerServicePath);
  await expect(runPolicyGate(workspaceRoot)).rejects.toMatchObject({ code: 'VERIFY-POLICY-003' });
  await fs.writeFile(customerServicePath, customerService, 'utf8');
  await fs.rm(path.join(projectPoliciesRoot, 'tenant.yaml'));
  const policyViolatingCustomerService = customerService
    .replace("import { currentTenant } from '../tenant/context.ts';\n", '')
    .replaceAll('const tenantId = currentTenant(session);', 'const tenantId = session.tenantId;');
  if (policyViolatingCustomerService === customerService) {
    throw new Error('Customer service fixture no longer exposes the tenant-policy mutation boundary');
  }

  await fs.writeFile(
    customerServicePath,
    policyViolatingCustomerService,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  // Observe the actual failed policy report published by Verification, rather
  // than repeating the same source mutation through a direct policy-only call.
  const unprovenReport = await readJson<PolicyReport>(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport)
  );
  expect(unprovenReport.status).toBe('failed');
  expect(unprovenReport.violations).toHaveLength(1);
  expect(unprovenReport.official.violations).toHaveLength(1);
  expect(unprovenReport.project.violations).toEqual([]);
  expect(unprovenReport.diagnostics).toHaveLength(1);
  expect(unprovenReport.diagnostics?.[0]).toMatchObject({
    id: 'tenant-scope-required',
    evidenceClass: 'source-structure',
    files: ['src/installed/entity/customer-service.ts']
  });

  const { lock, provenance, report, coverage } = await readReviewInputs(workspaceRoot);
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary.ciSummary.status).toBe('failed');
  expect(summary.ciSummary.failureCount).toBeGreaterThanOrEqual(2);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'all',
        kind: 'summary',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Verification failed in lanes: fast'
      },
      {
        lane: 'fast',
        kind: 'policy',
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'Policy tenant-scope-required: Tenant-scoped queries must derive tenant context and filter by tenantId.'
      }
    ])
  );
}, 360000);
