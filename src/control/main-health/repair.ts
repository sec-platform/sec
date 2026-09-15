import { deepFreeze, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  resolveRepairMainHealthLane,
  type MainHealthDigest,
  type MainHealthLedger
} from './contract.ts';

export const MAIN_HEALTH_REPAIR_DECISION_SCHEMA =
  'sec-main-health-repair-decision-v1' as const;

export type MainHealthRepairReasonCode =
  | 'repair-ready'
  | 'repair-provider-missing'
  | 'repair-provider-unavailable'
  | 'repair-provider-invalid'
  | 'repair-ledger-invalid'
  | 'repair-ledger-expired'
  | 'repair-ledger-identity-drift'
  | 'repair-lane-ineligible'
  | 'repair-manifest-identity-invalid';

export interface MainHealthRepairBinding {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly trustRevision: string;
  readonly healthRevision: MainHealthDigest;
  readonly ledgerDigest: MainHealthDigest;
  readonly owner: string;
  readonly manifestPath: string;
  readonly packageId: string;
  readonly failureFingerprints: readonly MainHealthDigest[];
}

export interface MainHealthRepairDecision {
  readonly schema: typeof MAIN_HEALTH_REPAIR_DECISION_SCHEMA;
  readonly status: 'repair-ready' | 'blocked';
  /**
   * Mutually exclusive routing projection from the same exact MainHealth
   * ledger. A consumer may invoke the ordinary selector only for
   * `ordinary-only`; repair and locked states never fall through to an Issue
   * catalog observation.
   */
  readonly routingState: 'ordinary-only' | 'repair-only' | 'locked';
  readonly reasonCode: MainHealthRepairReasonCode;
  readonly observationDigest: MainHealthDigest;
  readonly binding: MainHealthRepairBinding | null;
  readonly decisionDigest: MainHealthDigest;
}

export type MainHealthRepairObservation = Readonly<
  | { kind: 'available'; ledger: unknown }
  | { kind: 'provider-missing'; observationRef: MainHealthDigest }
  | { kind: 'provider-unavailable'; observationRef: MainHealthDigest }
  | { kind: 'provider-invalid'; observationRef: MainHealthDigest }
>;

function blocked(
  reasonCode: Exclude<MainHealthRepairReasonCode, 'repair-ready'>,
  observationDigest: MainHealthDigest,
  routingState: 'ordinary-only' | 'repair-only' | 'locked'
): MainHealthRepairDecision {
  const semantic = deepFreeze({
    schema: MAIN_HEALTH_REPAIR_DECISION_SCHEMA,
    status: 'blocked' as const,
    routingState,
    reasonCode,
    observationDigest,
    binding: null
  });
  return deepFreeze({ ...semantic, decisionDigest: sha256(semantic) as MainHealthDigest });
}

export function compileMainHealthRepairDecision(input: Readonly<{
  observation: MainHealthRepairObservation;
  now: string;
  expectedRepository: string;
  expectedDefaultBranch: string;
  expectedMainSha: string;
  expectedMainTreeSha: string;
  expectedTrustRevision: string;
}>): MainHealthRepairDecision {
  const observationDigest = sha256(input.observation) as MainHealthDigest;
  if (input.observation.kind !== 'available') {
    const reasonCode = input.observation.kind === 'provider-missing'
      ? 'repair-provider-missing'
      : input.observation.kind === 'provider-unavailable'
        ? 'repair-provider-unavailable'
        : 'repair-provider-invalid';
    return blocked(reasonCode, observationDigest, 'locked');
  }
  const lane = resolveRepairMainHealthLane({
    ledger: input.observation.ledger,
    now: input.now,
    expectedRepository: input.expectedRepository,
    expectedDefaultBranch: input.expectedDefaultBranch,
    expectedMainSha: input.expectedMainSha,
    expectedMainTreeSha: input.expectedMainTreeSha,
    expectedTrustRevision: input.expectedTrustRevision
  });
  if (lane.observationValidity === 'invalid' || lane.ledger === null) {
    const reasonCode = lane.reasonCode === 'ledger-expired'
      ? 'repair-ledger-expired'
      : lane.reasonCode === 'ledger-identity-drift'
        ? 'repair-ledger-identity-drift'
        : 'repair-ledger-invalid';
    return blocked(reasonCode, observationDigest, 'locked');
  }
  if (!lane.allowed || lane.ledger.status !== 'degraded') {
    const ordinaryOnly = lane.ledger.status === 'healthy'
      && lane.ledger.allowedLanes.length === 1
      && lane.ledger.allowedLanes[0] === 'ordinary';
    return blocked(
      'repair-lane-ineligible',
      observationDigest,
      ordinaryOnly ? 'ordinary-only' : 'locked'
    );
  }
  const ledger: MainHealthLedger = lane.ledger;
  const manifestPath = ledger.repairWorkPackage;
  if (manifestPath === null || ledger.owner === null || ledger.failureFingerprints.length === 0) {
    return blocked('repair-manifest-identity-invalid', observationDigest, 'repair-only');
  }
  const match = /^docs\/work-packages\/([a-z0-9][a-z0-9-]*)\.md$/u.exec(manifestPath);
  if (match === null) {
    return blocked('repair-manifest-identity-invalid', observationDigest, 'repair-only');
  }
  const binding = deepFreeze({
    repository: ledger.repository,
    defaultBranch: ledger.defaultBranch,
    mainSha: ledger.mainSha,
    mainTreeSha: ledger.mainTreeSha,
    trustRevision: ledger.trustRevision,
    healthRevision: ledger.healthRevision,
    ledgerDigest: ledger.ledgerDigest,
    owner: ledger.owner,
    manifestPath,
    packageId: match[1]!,
    failureFingerprints: ledger.failureFingerprints
  });
  const semantic = deepFreeze({
    schema: MAIN_HEALTH_REPAIR_DECISION_SCHEMA,
    status: 'repair-ready' as const,
    routingState: 'repair-only' as const,
    reasonCode: 'repair-ready' as const,
    observationDigest,
    binding
  });
  return deepFreeze({ ...semantic, decisionDigest: sha256(semantic) as MainHealthDigest });
}
