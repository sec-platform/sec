import type { MainHealthLedger } from '../../../../execution/verification/session.ts';
import { assertTrustedRuntimeMainHealthQualification } from '../../../verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY } from './contract.ts';
import type { TrustedRuntimeMainHealthReceipt } from './main-health-observation.ts';
import { assertMainHealthPublicationLedger, type MainHealthPublicationAuthority } from './work-selection-main-health.ts';

/** Borrowed same-process evidence. Its fields cannot mint either authority. */
export interface TrustedRuntimeMainHealthPublicationAdmission {
  readonly authority: MainHealthPublicationAuthority;
  readonly receipt: TrustedRuntimeMainHealthReceipt;
  readonly repositoryRoot: string;
}

/** Shared by merge and post-main consumers. A selected ledger alone cannot
 * outlive its physical producer, and JSON cannot reconstruct this admission. */
export function assertTrustedRuntimeMainHealthPublication(input: Readonly<{
  admission: TrustedRuntimeMainHealthPublicationAdmission;
  ledger: MainHealthLedger;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
}>): void {
  const { admission, ledger } = input;
  assertMainHealthPublicationLedger({ authority: admission.authority, ledger, now: input.now });
  const receipt = admission.receipt;
  assertTrustedRuntimeMainHealthQualification({ receipt,
    repositoryRoot: admission.repositoryRoot,
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha });
  if (ledger.producer.identity !== DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY
      || ledger.producer.sourceTransport !== 'trusted-runtime-durable-readback'
      || ledger.producer.trustRevision !== input.mainSha
      || ledger.producer.sourceDigest !== receipt.receiptDigest
      || ledger.producer.sourceRunId !== receipt.executionId
      || ledger.producer.sourceRef !==
        `runtime-state:trusted-main-health/v2/main-${receipt.mainSha}-${receipt.receiptDigest.slice(7)}.json`) {
    throw new Error('local MainHealth receipt differs from live production admission');
  }
}

