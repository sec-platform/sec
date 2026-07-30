import path from 'node:path';

import { uniqueSorted } from '../../shared/collections.ts';
import { pathExists, readJson, readText } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath } from '../../shared/paths.ts';
import type {
  MergedPolicyReportEntry,
  PolicyReport,
  PolicyRule,
  PolicyViolation
} from '../../shared/policy-types.ts';
import {
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationGateResultV1
} from '../../shared/verification-result-contract.ts';
import type { VerificationLane } from '../../shared/verification-types.ts';
import {
  loadPolicyDeclarations,
  type LoadedPolicyDefinition,
  type LoadedPolicyScope
} from '../parse/load-policy-declarations.ts';

const POLICY_GATE_ID = 'product-policy-gate';
const POLICY_CLAIM_ID = 'product-policy-verification';
const POLICY_GATE_REVISION = 'product-verification-v1';
const POLICY_GATE_OWNER = 'product-verify-project';
const POLICY_GATE_REQUIREMENT_KEY = 'product-verification';
const POLICY_SUBJECT_REVISION = '0000000000000000000000000000000000000000';
const POLICY_INPUT_DIGEST = `sha256:${'0'.repeat(64)}`;

/**
 * Build a `VerificationGateResultV1` for the policy lane. `skipped` (no policies
 * declared) maps to `not-run` with `not-applicable` applicability, NOT silently
 * passed. `passed`/`failed` map directly via the unified status vocabulary.
 *
 * Issue #176 Slice 2: the policy gate emits an explicit applicability instead
 * of the legacy ambiguous `skipped` status.
 */
export function buildPolicyClaimGate(
  policyReport: PolicyReport,
  _requestedLane: VerificationLane
): VerificationGateResultV1 {
  const claims = [POLICY_CLAIM_ID];

  if (policyReport.status === 'skipped') {
    return CodexDevelopmentBuildVerificationGateResultV1({
      gateId: POLICY_GATE_ID,
      gateRevision: POLICY_GATE_REVISION,
      owner: POLICY_GATE_OWNER,
      requirementKey: POLICY_GATE_REQUIREMENT_KEY,
      subjectRevision: POLICY_SUBJECT_REVISION,
      inputDigest: POLICY_INPUT_DIGEST,
      applicability: 'not-applicable',
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'not-applicable',
      requiredForClaims: claims,
      supportedClaims: [],
      environment: null,
      execution: null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: 'No policies declared; policy gate is not-applicable.'
    });
  }

  const isPassed = policyReport.status === 'passed';
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId: POLICY_GATE_ID,
    gateRevision: POLICY_GATE_REVISION,
    owner: POLICY_GATE_OWNER,
    requirementKey: POLICY_GATE_REQUIREMENT_KEY,
    subjectRevision: POLICY_SUBJECT_REVISION,
    inputDigest: POLICY_INPUT_DIGEST,
    applicability: 'required',
    status: isPassed ? 'passed' : 'failed',
    disposition: 'executed',
    reasonCode: isPassed ? 'executed-success' : 'executed-failure',
    requiredForClaims: claims,
    supportedClaims: isPassed ? claims : [],
    environment: {
      runtime: 'bun',
      os: process.platform,
      arch: process.arch,
      filesystem: null,
      capabilities: [],
      toolchainRevision: 'ci-verification-v19',
      providerRevisions: []
    },
    execution: {
      argv: [],
      startedAt: '1970-01-01T00:00:00.000Z',
      finishedAt: '1970-01-01T00:00:00.000Z',
      durationMs: 0,
      exitCode: isPassed ? 0 : 1,
      outputDigest: `sha256:${'0'.repeat(64)}`,
      failureFingerprint: isPassed ? null : 'policy-violation'
    },
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  });
}

function buildMergedPolicyEntries(
  definitions: ReadonlyMap<string, LoadedPolicyDefinition>,
  lock: LockFile | null
): MergedPolicyReportEntry[] {
  return [...definitions.values()]
    .map((definition) => ({
      id: definition.policy.id,
      sourceScope: definition.sourceScope,
      sourcePath: definition.sourcePath,
      targets: targetFilesForPolicy(lock, definition.policy)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function targetFilesForPolicy(lock: LockFile | null, policy: PolicyRule): string[] {
  const installPlan = lock?.installPlan ?? [];
  const copyTargets = installPlan
    .filter((step) => policy.appliesTo.includes(step.blockId) && isPolicyCheckableInstall(step))
    .map((step) => step.to);

  return copyTargets.length > 0 ? uniqueSorted(copyTargets) : ['src/installed/entity/customer-service.ts'];
}

function isPolicyCheckableInstall(step: InstallPlanStep): boolean {
  return step.action === 'copy' && step.to.startsWith('src/') && step.to.endsWith('.ts');
}

function evaluateTenantScopeRule(
  source: string,
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyViolation | null {
  const hasCurrentTenant = source.includes('currentTenant(session)');
  const tenantIdComparisonPattern = new RegExp(
    [
      String.raw`\b\w+\.tenantId\s*(?:===|!==)\s*tenantId\b`,
      String.raw`\btenantId\s*(?:===|!==)\s*\w+\.tenantId\b`
    ].join('|')
  );
  const hasTenantFilter = tenantIdComparisonPattern.test(source);

  if (hasCurrentTenant && hasTenantFilter) {
    return null;
  }

  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: 'Tenant-scoped queries must derive tenant context and filter by tenantId.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath
  };
}

function buildPolicyReport(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope,
  mergedPolicies: ReadonlyMap<string, LoadedPolicyDefinition>,
  lock: LockFile | null,
  violations: PolicyViolation[]
): PolicyReport {
  const officialViolations = violations.filter((violation) => violation.sourceScope === 'official');
  const projectViolations = violations.filter((violation) => violation.sourceScope === 'project');
  const shouldFail = violations.some((violation) => violation.severity === 'error' || violation.severity === 'blocker');
  const status =
    mergedPolicies.size === 0 ? 'skipped' : shouldFail ? 'failed' : 'passed';

  return {
    status,
    official: {
      policies: official.policies,
      sources: official.sources,
      violations: officialViolations
    },
    project: {
      policies: project.policies,
      sources: project.sources,
      violations: projectViolations
    },
    merged: {
      policies: buildMergedPolicyEntries(mergedPolicies, lock)
    },
    violations
  };
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const {
    official,
    project,
    definitions: mergedPolicies
  } = await loadPolicyDeclarations(workspaceRoot);

  if (mergedPolicies.size === 0) {
    return buildPolicyReport(official, project, mergedPolicies, null, []);
  }

  const violations: PolicyViolation[] = [];
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  const lock = (await pathExists(readableLockPath)) ? await readJson<LockFile>(readableLockPath) : null;

  for (const definition of mergedPolicies.values()) {
    if (definition.policy.rule !== 'tenant_context_must_flow_to_query') {
      continue;
    }

    for (const targetFile of targetFilesForPolicy(lock, definition.policy)) {
      const absolutePath = path.join(projectRoot, targetFile);
      if (!(await pathExists(absolutePath))) {
        continue;
      }
      const violation = evaluateTenantScopeRule(await readText(absolutePath), targetFile, definition);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  return buildPolicyReport(
    official,
    project,
    mergedPolicies,
    lock,
    violations.sort((left, right) =>
      `${left.id}:${left.sourceScope}:${left.sourcePath}:${left.files.join(',')}:${left.message}`.localeCompare(
        `${right.id}:${right.sourceScope}:${right.sourcePath}:${right.files.join(',')}:${right.message}`
      )
    )
  );
}
