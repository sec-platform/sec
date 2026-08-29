import { deepFreeze, sha256 } from './canonical-primitives.ts';
import {
  resolveRepairMainHealthLaneV1,
  type MainHealthDigest,
  type MainHealthLedgerV1
} from './main-health-contract.ts';

export const MAIN_HEALTH_REPAIR_DECISION_SCHEMA_V1 =
  'sec-main-health-repair-decision-v1' as const;

export type MainHealthRepairReasonCodeV1 =
  | 'repair-ready'
  | 'repair-provider-missing'
  | 'repair-provider-unavailable'
  | 'repair-provider-invalid'
  | 'repair-provider-conflict'
  | 'repair-ledger-invalid'
  | 'repair-ledger-expired'
  | 'repair-ledger-identity-drift'
  | 'repair-lane-ineligible'
  | 'repair-manifest-identity-invalid';

export interface MainHealthRepairBindingV1 {
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

export interface MainHealthRepairDecisionV1 {
  readonly schema: typeof MAIN_HEALTH_REPAIR_DECISION_SCHEMA_V1;
  readonly status: 'repair-ready' | 'blocked';
  /**
   * Mutually exclusive routing projection from the same exact MainHealth
   * ledger. A consumer may invoke the ordinary selector only for
   * `ordinary-only`; repair and locked states never fall through to an Issue
   * catalog observation.
   */
  readonly routingState: 'ordinary-only' | 'repair-only' | 'locked';
  readonly reasonCode: MainHealthRepairReasonCodeV1;
  readonly observationDigest: MainHealthDigest;
  readonly binding: MainHealthRepairBindingV1 | null;
  readonly decisionDigest: MainHealthDigest;
}

export type MainHealthRepairObservationV1 = Readonly<
  | { kind: 'available'; ledger: unknown }
  | { kind: 'provider-missing'; observationRef: MainHealthDigest }
  | { kind: 'provider-unavailable'; observationRef: MainHealthDigest }
  | { kind: 'provider-invalid'; observationRef: MainHealthDigest }
  | { kind: 'provider-conflict'; observationRef: MainHealthDigest }
>;

function blocked(
  reasonCode: Exclude<MainHealthRepairReasonCodeV1, 'repair-ready'>,
  observationDigest: MainHealthDigest,
  routingState: 'ordinary-only' | 'repair-only' | 'locked'
): MainHealthRepairDecisionV1 {
  const semantic = deepFreeze({
    schema: MAIN_HEALTH_REPAIR_DECISION_SCHEMA_V1,
    status: 'blocked' as const,
    routingState,
    reasonCode,
    observationDigest,
    binding: null
  });
  return deepFreeze({ ...semantic, decisionDigest: sha256(semantic) as MainHealthDigest });
}

export function compileMainHealthRepairDecisionV1(input: Readonly<{
  observation: MainHealthRepairObservationV1;
  now: string;
  expectedRepository: string;
  expectedDefaultBranch: string;
  expectedMainSha: string;
  expectedMainTreeSha: string;
  expectedTrustRevision: string;
}>): MainHealthRepairDecisionV1 {
  const observationDigest = sha256(input.observation) as MainHealthDigest;
  if (input.observation.kind !== 'available') {
    const reasonCode = input.observation.kind === 'provider-missing'
      ? 'repair-provider-missing'
      : input.observation.kind === 'provider-unavailable'
        ? 'repair-provider-unavailable'
        : input.observation.kind === 'provider-conflict'
          ? 'repair-provider-conflict'
          : 'repair-provider-invalid';
    return blocked(reasonCode, observationDigest, 'locked');
  }
  const lane = resolveRepairMainHealthLaneV1({
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
  const ledger: MainHealthLedgerV1 = lane.ledger;
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
    schema: MAIN_HEALTH_REPAIR_DECISION_SCHEMA_V1,
    status: 'repair-ready' as const,
    routingState: 'repair-only' as const,
    reasonCode: 'repair-ready' as const,
    observationDigest,
    binding
  });
  return deepFreeze({ ...semantic, decisionDigest: sha256(semantic) as MainHealthDigest });
}
