import type { MainHealthLedger } from '../../../../execution/verification/session.ts';
import { assertTrustedRuntimeMainHealthQualification } from '../../../verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY, resolveOrdinaryMainHealthLane } from './contract.ts';
import { trustedRuntimeMainHealthReceiptReference, type TrustedRuntimeMainHealthReceipt } from './main-health-observation.ts';
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
      || ledger.producer.sourceTransport !== 'trusted-runtime-live-readback'
      || ledger.producer.trustRevision !== input.mainSha
      || ledger.producer.sourceDigest !== receipt.receiptDigest
      || ledger.producer.sourceRunId !== receipt.executionId
      || ledger.producer.sourceRef !== trustedRuntimeMainHealthReceiptReference(receipt)) {
    throw new Error('local MainHealth receipt differs from live production admission');
  }
}

/** Integration consumes the original producer's authority, not a transport
 * label. Local qualification is an out-of-band live object; durable receipts
 * and caller-shaped objects cannot authorize this branch. Hosted callers keep
 * their exact existing GitHub provenance requirements. */
export function assertIntegrationMainHealthProducer(input: Readonly<{
  ledger: MainHealthLedger;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  localAdmission?: TrustedRuntimeMainHealthPublicationAdmission;
}>): void {
  const health = resolveOrdinaryMainHealthLane({ ledger: input.ledger, now: input.now,
    expectedRepository: input.repository, expectedDefaultBranch: 'main',
    expectedMainSha: input.mainSha, expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha });
  if (!health.allowed || health.status !== 'healthy') {
    throw new Error(`MainHealth integration is not fresh and ordinary: ${health.reason}`);
  }
  const producer = input.ledger.producer;
  if (producer.identity !== DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY
      || producer.trustRevision !== input.mainSha) {
    throw new Error('fresh MainHealth producer provenance is not bound to the trusted authorization runtime.');
  }
  if (producer.sourceTransport === 'github-api') {
    if (input.localAdmission !== undefined
        || producer.sourceRef !== `github-check-runs:${input.repository}@${input.mainSha}`) {
      throw new Error('fresh MainHealth producer provenance is not bound to the trusted authorization runtime.');
    }
    return;
  }
  if (producer.sourceTransport !== 'trusted-runtime-live-readback'
      || input.localAdmission === undefined) {
    throw new Error('Local MainHealth integration requires the original live publication admission.');
  }
  assertTrustedRuntimeMainHealthPublication({ ...input, admission: input.localAdmission });
}
