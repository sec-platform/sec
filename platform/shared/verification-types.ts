import type { PolicyReport, PolicyViolation } from './policy-types.ts';
import type {
  SemanticMutationBaseV2,
  SemanticMutationVerificationCapabilityV1,
  VerificationRequirementV1
} from './semantic-mutation-types.ts';

export const SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID =
  'semantic-mutation-local-verification' as const;
export const SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION =
  'semantic-mutation-local-verification-v2' as const;
export const SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION =
  'semantic-mutation-verification-capability-plan-v1' as const;
export const SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION =
  'semantic-mutation-verification-report-v1' as const;

export interface SemanticMutationVerificationCapabilityPlanV1 {
  readonly formatRevision: typeof SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION;
  readonly adapterId: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION;
  readonly snapshotInputRevision: string;
  readonly snapshotSemanticRevision: string;
  readonly status: 'runnable' | 'blocked';
  readonly capabilities: readonly SemanticMutationVerificationCapabilityV1[];
  readonly blockedRequirementKeys: readonly string[];
  readonly capabilityPlanRevision: string;
}

export interface SemanticMutationVerifyAllRunnerInputV1 {
  readonly runner: 'verify-all';
  readonly planRevision: string;
  readonly attempted: SemanticMutationBaseV2;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly requirements: readonly VerificationRequirementV1[];
}

export interface SemanticMutationVerifyAllRunnerResultV1 {
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly evidenceDigest: string;
}

export type SemanticMutationVerifyAllRunnerV1 = (
  input: SemanticMutationVerifyAllRunnerInputV1
) => Promise<SemanticMutationVerifyAllRunnerResultV1> | SemanticMutationVerifyAllRunnerResultV1;

export interface SemanticMutationVerificationExecutionV1 {
  readonly requirement: VerificationRequirementV1;
  readonly runner: 'verify-all';
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly evidenceDigest: string;
}

export interface SemanticMutationVerificationReportV1 {
  readonly formatRevision: typeof SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION;
  readonly adapterId: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBaseV2;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly executions: readonly SemanticMutationVerificationExecutionV1[];
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly reportRevision: string;
}

export type VerificationLane = 'fast' | 'runtime' | 'all';
export type VerificationStatus = 'passed' | 'failed' | 'skipped';

export interface VerificationStepReport {
  status: VerificationStatus;
  passed: string[];
  failed: string[];
  command: string | null;
}

export interface VerificationLogs {
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
  };
  logs: VerificationLogs;
}
