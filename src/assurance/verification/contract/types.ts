import type { SemanticMutationBase, SemanticMutationVerificationCapability, VerificationRequirement } from '../../../semantics/mutation/types.ts';
import type { PolicyReport, PolicyViolation } from '../../../semantics/policies/types.ts';
import type { VerificationAggregateResult, VerificationGateResult } from '../result/contract/result.ts';
import type { VerificationLane } from './lanes.ts';
export type { VerificationLane } from './lanes.ts';

export const SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID =
  'semantic-mutation-local-verification' as const;
export const SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION =
  'semantic-mutation-local-verification-v2' as const;
export const SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION =
  'semantic-mutation-verification-capability-plan-v1' as const;
export const SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION =
  'semantic-mutation-verification-report-v1' as const;

export interface SemanticMutationVerificationCapabilityPlan {
  readonly formatRevision: typeof SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION;
  readonly adapterId: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION;
  readonly snapshotInputRevision: string;
  readonly snapshotSemanticRevision: string;
  readonly status: 'runnable' | 'blocked';
  readonly capabilities: readonly SemanticMutationVerificationCapability[];
  readonly blockedRequirementKeys: readonly string[];
  readonly capabilityPlanRevision: string;
}

interface SemanticMutationVerifyAllRunnerInput {
  readonly runner: 'verify-all';
  readonly planRevision: string;
  readonly attempted: SemanticMutationBase;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly requirements: readonly VerificationRequirement[];
}

interface SemanticMutationVerifyAllRunnerResult {
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly evidenceDigest: string;
}

export type SemanticMutationVerifyAllRunner = (
  input: SemanticMutationVerifyAllRunnerInput
) => Promise<SemanticMutationVerifyAllRunnerResult> | SemanticMutationVerifyAllRunnerResult;

interface SemanticMutationVerificationExecution {
  readonly requirement: VerificationRequirement;
  readonly runner: 'verify-all';
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly evidenceDigest: string;
}

export interface SemanticMutationVerificationReport {
  readonly formatRevision: typeof SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION;
  readonly adapterId: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBase;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly executions: readonly SemanticMutationVerificationExecution[];
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly reportRevision: string;
}

export type VerificationStatus = 'passed' | 'failed' | 'skipped';

export interface VerificationStepReport {
  status: VerificationStatus;
  passed: string[];
  failed: string[];
  command: string | null;
}

interface VerificationLogs {
  stdout: string;
  stderr: string;
}

export interface FastVerificationLaneReport {
  status: VerificationStatus;
  build: {
    status: VerificationStatus;
  };
  unit: {
    status: VerificationStatus;
    passed: string[];
  };
  acceptance: {
    status: VerificationStatus;
    passed: string[];
    failed: string[];
  };
  policy: {
    status: 'passed' | 'failed' | 'skipped';
    violations: PolicyViolation[];
  };
  policyReport?: PolicyReport;
  logs: VerificationLogs;
}

export interface RuntimeVerificationLaneReport {
  status: VerificationStatus;
  build: VerificationStepReport;
  unit: VerificationStepReport;
  acceptance: VerificationStepReport;
  logs: VerificationLogs;
}

/**
 * Claim-based verification summary produced by aggregating lane-level gate
 * results through `aggregateVerificationClaims`. Replaces
 * the legacy "skipped → passed" false-green path: `overallStatus` is `passed`
 * only when every required claim is `passed`.
 */
export interface VerificationClaimSummary {
  readonly overall: VerificationAggregateResult;
  readonly gates: readonly VerificationGateResult[];
}

export interface VerificationReport {
  build: FastVerificationLaneReport['build'];
  unit: FastVerificationLaneReport['unit'];
  acceptance: FastVerificationLaneReport['acceptance'];
  policy: FastVerificationLaneReport['policy'];
  fast: FastVerificationLaneReport;
  runtime: RuntimeVerificationLaneReport;
  summary: {
    status: 'passed' | 'failed';
    requestedLane: VerificationLane;
    failedLanes: Array<'fast' | 'runtime'>;
    /**
     * Claim-based summary from `aggregateVerificationClaims`.
     * Production code always sets this; tests for unrelated features may omit it.
     * When present, `status` MUST be consistent with `claimSummary.overall.overallStatus`.
     */
    claimSummary?: VerificationClaimSummary;
  };
  logs: VerificationLogs;
}
