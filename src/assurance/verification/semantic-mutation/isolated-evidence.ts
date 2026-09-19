import type { VerificationReport } from '../contract/types.ts';
import { PIPELINE_VERIFY_STAGE_IDS } from '../../../adapters/compilation-protocol/types.ts';
import { sha256 } from '../../../compiler/semantic-mutation/canonical.ts';
import type { SemanticMutationIsolatedVerificationFailure } from '../../../adapters/verification/semantic-mutation-isolated-verification-failure.ts';

const ISOLATED_VERIFICATION_EVIDENCE_DOMAIN =
  'semantic-mutation-isolated-verification-evidence-v1' as const;

export interface SemanticMutationIsolatedVerificationEvidenceArtifacts {
  readonly rawDigests: {
    readonly acceptanceCoverage: string;
    readonly policyReport: string;
    readonly runtimeReport: string;
    readonly verificationReport: string;
  };
  readonly semanticBundle: Readonly<{
    readonly snapshot: Readonly<{
      readonly ir: Readonly<{
        readonly inputRevision: string;
        readonly semanticRevision: string;
      }>;
    }>;
  }>;
  readonly verificationReport: VerificationReport;
}

export type SemanticMutationIsolatedVerificationEvidence =
  | Readonly<{
      readonly status: 'passed';
      readonly artifacts: SemanticMutationIsolatedVerificationEvidenceArtifacts;
    }>
  | Readonly<{
      readonly status: 'blocked';
      readonly failure?: SemanticMutationIsolatedVerificationFailure;
    }>;

export function semanticMutationIsolatedVerificationEvidenceDigest(
  evidence: SemanticMutationIsolatedVerificationEvidence
): string {
  const payload = evidence.status === 'blocked'
    ? {
        domain: ISOLATED_VERIFICATION_EVIDENCE_DOMAIN,
        reason: 'isolated-verification-unavailable',
        ...(evidence.failure === undefined ? {} : { failure: evidence.failure })
      }
    : (() => {
        const snapshot = evidence.artifacts.semanticBundle.snapshot.ir;
        const generatedReport = evidence.artifacts.verificationReport;
        return {
          domain: ISOLATED_VERIFICATION_EVIDENCE_DOMAIN,
          completedStages: PIPELINE_VERIFY_STAGE_IDS,
          inputRevision: snapshot.inputRevision,
          semanticRevision: snapshot.semanticRevision,
          generatedArtifactRawDigests: evidence.artifacts.rawDigests,
          report: {
            summary: generatedReport.summary,
            build: generatedReport.build,
            unit: generatedReport.unit,
            acceptance: generatedReport.acceptance,
            policy: generatedReport.policy,
            runtime: {
              status: generatedReport.runtime.status,
              build: generatedReport.runtime.build,
              unit: generatedReport.runtime.unit,
              acceptance: generatedReport.runtime.acceptance
            }
          }
        };
      })();
  return sha256(payload);
}
