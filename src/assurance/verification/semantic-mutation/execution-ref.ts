import type { SemanticMutationVerificationReport } from '../contract/types.ts';
import type { SemanticMutationVerificationExecutionRef } from '../../../semantics/mutation/types.ts';
import { cloneAndDeepFreeze } from '../../../compiler/semantic-mutation/canonical.ts';
import {
  semanticMutationVerificationExecutionRevision
} from '../../../compiler/semantic-mutation/result.ts';
import {
  assertSemanticMutationVerificationReportInvariant
} from './report-contract.ts';

export function buildSemanticMutationVerificationExecutionRef(
  report: SemanticMutationVerificationReport
): SemanticMutationVerificationExecutionRef {
  assertSemanticMutationVerificationReportInvariant(report);
  const withoutRevision = {
    adapterId: report.adapterId,
    adapterRevision: report.adapterRevision,
    reportRevision: report.reportRevision,
    planRevision: report.planRevision,
    attempted: report.attempted,
    stagedSourceDigest: report.stagedSourceDigest,
    requiredVerificationDigest: report.requiredVerificationDigest,
    status: report.status
  };
  return cloneAndDeepFreeze({
    ...withoutRevision,
    verificationExecutionRevision: semanticMutationVerificationExecutionRevision(withoutRevision)
  });
}
