import { createHash } from 'node:crypto';

import type { SemanticMutationBaseV2, VerificationRequirementV1 } from '../../platform/shared/semantic-mutation-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  type SemanticMutationVerificationReportV1
} from '../../platform/shared/verification-types.ts';

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function semanticMutationVerificationReportFixture(input: {
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBaseV2;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly requirements?: readonly VerificationRequirementV1[];
}): SemanticMutationVerificationReportV1 {
  const requirements = input.requirements ?? [{ kind: 'pass', passId: 'verify' }];
  const withoutRevision = {
    formatRevision: 'semantic-mutation-verification-report-v1' as const,
    adapterId: input.adapterId as typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: input.adapterRevision as typeof SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    planRevision: input.planRevision,
    attempted: input.attempted,
    stagedSourceDigest: input.stagedSourceDigest,
    requiredVerificationDigest: input.requiredVerificationDigest,
    executions: requirements.map((requirement) => ({
      requirement,
      runner: 'verify-all' as const,
      status: input.status,
      evidenceDigest: sha256({ requirement, status: input.status })
    })),
    status: input.status
  };
  return {
    ...withoutRevision,
    reportRevision: sha256({ domain: 'semantic-mutation-verification-report-v1', ...withoutRevision })
  };
}
