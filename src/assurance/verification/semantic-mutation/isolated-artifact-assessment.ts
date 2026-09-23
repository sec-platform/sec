import type { SemanticMutationBase } from '../../../semantics/mutation/types.ts';
import {
  semanticMutationIsolatedVerificationEvidenceDigest,
  type SemanticMutationIsolatedVerificationEvidenceArtifacts
} from './isolated-evidence.ts';

export type IsolatedSemanticMutationArtifactAssessment =
  | Readonly<{
      status: 'passed';
      evidenceDigest: string;
    }>
  | Readonly<{
      status: 'blocked';
      failure: Readonly<{ stage: 'binding-mismatch' }>;
      evidenceDigest: string;
    }>;

export function assessIsolatedSemanticMutationArtifacts(input: Readonly<{
  attempted: SemanticMutationBase;
  artifactStatus: 'passed' | 'failed';
  artifacts: SemanticMutationIsolatedVerificationEvidenceArtifacts;
}>): IsolatedSemanticMutationArtifactAssessment {
  const snapshot = input.artifacts.semanticBundle.snapshot.ir;
  const report = input.artifacts.verificationReport;
  const bound = snapshot.inputRevision === input.attempted.inputRevision &&
    snapshot.semanticRevision === input.attempted.semanticRevision &&
    report.summary.status === input.artifactStatus &&
    (input.artifactStatus !== 'passed' ||
      (report.summary.failedLanes.length === 0 &&
        report.fast.status === 'passed' &&
        report.runtime.status === 'passed'));
  if (!bound) {
    const failure = Object.freeze({ stage: 'binding-mismatch' as const });
    return Object.freeze({
      status: 'blocked' as const,
      failure,
      evidenceDigest: semanticMutationIsolatedVerificationEvidenceDigest({
        status: 'blocked',
        failure
      })
    });
  }
  return Object.freeze({
    status: 'passed' as const,
    evidenceDigest: semanticMutationIsolatedVerificationEvidenceDigest({
      status: 'passed',
      artifacts: input.artifacts
    })
  });
}
