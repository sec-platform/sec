import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, type SemanticMutationVerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import type { SemanticMutationBase, VerificationRequirement } from '../../../src/semantics/mutation/types.ts';

export function semanticMutationVerificationReportFixture(input: {
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBase;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly requirements?: readonly VerificationRequirement[];
}): SemanticMutationVerificationReport {
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
