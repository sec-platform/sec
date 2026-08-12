import { createHash } from 'node:crypto';

import { encodeVerificationActionDataV2 } from './verification-action-contract.ts';

/** Content-integrity decision object, not a signature. Consumers independently verify producer transport and exact live main. */

export const MAIN_HEALTH_LEDGER_SCHEMA_V1 = 'sec-main-health-ledger-v1' as const;
export type MainHealthStatusV1 = 'healthy' | 'degraded' | 'locked';
export type MainHealthLaneV1 = 'ordinary' | 'repair';
export type MainHealthDigest = `sha256:${string}`;
export const MAIN_HEALTH_REPAIR_IDENTITY_SCHEMA_V1 =
  'sec-main-health-repair-work-package-identity-v1' as const;

export interface MainHealthProducerV1 {
  readonly identity: string;
  readonly trustRevision: string;
  readonly sourceTransport: 'github-api' | 'trusted-local-readback';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: MainHealthDigest;
}

export interface MainHealthLedgerV1 {
  readonly schema: typeof MAIN_HEALTH_LEDGER_SCHEMA_V1;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly status: MainHealthStatusV1;
  readonly failureFingerprints: readonly MainHealthDigest[];
  readonly owner: string | null;
  readonly repairWorkPackage: string | null;
  readonly expiresAt: string;
  /**
   * Semantic routing eligibility for this exact ledger. This field is not a
   * physical executor, frozen Work Package, Scope authorization, or merge
   * authority. Every effectful consumer must independently prove those
   * capabilities before it can act on an eligible lane.
   */
  readonly allowedLanes: readonly MainHealthLaneV1[];
  readonly trustRevision: string;
  readonly observedAt: string;
  readonly producer: MainHealthProducerV1;
  readonly healthRevision: MainHealthDigest;
  readonly ledgerDigest: MainHealthDigest;
}

export type MainHealthLedgerInputV1 = Omit<MainHealthLedgerV1, 'schema' | 'healthRevision' | 'ledgerDigest'>;
export type MainHealthSemanticInputV1 = Omit<MainHealthLedgerInputV1, 'producer' | 'expiresAt' | 'observedAt'>;

function fail(message: string): never { throw new Error(`MainHealth ${message}`); }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}
function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a commit/tree SHA.`);
  return result;
}
function digest(value: unknown, label: string): MainHealthDigest {
  const result = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest.`);
  return result as MainHealthDigest;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}
function optionalText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}
function hash(value: unknown): MainHealthDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

/**
 * Derives the sole future repair locator from the exact failed main identity.
 * The full content digest remains in the path so a new failure generation
 * cannot alias or resurrect an already-published repair package.
 */
export function createMainHealthRepairWorkPackagePathV1(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  owner: string;
  failureFingerprints: readonly MainHealthDigest[];
}>): string {
  if (!Array.isArray(input.failureFingerprints) || input.failureFingerprints.length === 0) {
    fail('repair identity requires at least one failure fingerprint.');
  }
  const failureFingerprints = input.failureFingerprints
    .map((value, index) => digest(value, `repair failureFingerprints[${index}]`))
    .sort();
  if (new Set(failureFingerprints).size !== failureFingerprints.length) {
    fail('repair failureFingerprints must be unique.');
  }
  const mainSha = sha(input.mainSha, 'repair mainSha');
  const identity = hash(Object.freeze({
    schema: MAIN_HEALTH_REPAIR_IDENTITY_SCHEMA_V1,
    repository: text(input.repository, 'repair repository'),
    defaultBranch: text(input.defaultBranch, 'repair defaultBranch'),
    mainSha,
    mainTreeSha: sha(input.mainTreeSha, 'repair mainTreeSha'),
    owner: text(input.owner, 'repair owner'),
    failureFingerprints: Object.freeze(failureFingerprints)
  })).slice('sha256:'.length);
  return `docs/work-packages/default-branch-health-repair-${mainSha}-${identity}.md`;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('ledger must be an object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`ledger must contain exactly: ${wanted.join(', ')}.`);
}

function normalizeMainHealthSemanticInputV1(input: MainHealthSemanticInputV1) {
  if (!['healthy', 'degraded', 'locked'].includes(input.status)) fail('status is invalid.');
  if (!Array.isArray(input.failureFingerprints) || !Array.isArray(input.allowedLanes)) {
    fail('health semantic arrays are invalid.');
  }
  const failureFingerprints = input.failureFingerprints
    .map((value, index) => digest(value, `failureFingerprints[${index}]`))
    .sort();
  if (new Set(failureFingerprints).size !== failureFingerprints.length) {
    fail('failureFingerprints must be unique.');
  }
  if (input.allowedLanes.some((lane) => lane !== 'ordinary' && lane !== 'repair')) {
    fail('allowedLanes are invalid.');
  }
  const allowedLanes = [...input.allowedLanes].sort() as MainHealthLaneV1[];
  if (new Set(allowedLanes).size !== allowedLanes.length) fail('allowedLanes must be unique.');
  if (input.status === 'healthy' && (
    failureFingerprints.length !== 0 || input.owner !== null ||
    input.repairWorkPackage !== null || !allowedLanes.includes('ordinary')
  )) fail('healthy ledger requires no failures/repair owner and must allow ordinary lane.');
  if (input.status === 'degraded' && (
    failureFingerprints.length === 0 || input.owner === null || input.repairWorkPackage === null ||
    allowedLanes.includes('ordinary') || !allowedLanes.includes('repair')
  )) fail('degraded ledger requires fingerprint, owner, repair Work Package, and repair-only lane.');
  if (input.status === 'degraded' && input.repairWorkPackage !== createMainHealthRepairWorkPackagePathV1({
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    owner: input.owner!,
    failureFingerprints
  })) {
    fail('degraded ledger repair Work Package identity is not canonical.');
  }
  if (input.status === 'locked' && (
    allowedLanes.length !== 0 || input.owner !== null || input.repairWorkPackage !== null
  )) {
    fail('locked ledger cannot allow a lane or expose repair identity.');
  }
  return Object.freeze({
    schema: MAIN_HEALTH_LEDGER_SCHEMA_V1,
    repository: text(input.repository, 'repository'),
    defaultBranch: text(input.defaultBranch, 'defaultBranch'),
    mainSha: sha(input.mainSha, 'mainSha'),
    mainTreeSha: sha(input.mainTreeSha, 'mainTreeSha'),
    status: input.status,
    failureFingerprints: Object.freeze(failureFingerprints),
    owner: optionalText(input.owner, 'owner'),
    repairWorkPackage: optionalText(input.repairWorkPackage, 'repairWorkPackage'),
    allowedLanes: Object.freeze(allowedLanes),
    trustRevision: sha(input.trustRevision, 'trustRevision')
  });
}

export function createMainHealthRevisionV1(input: MainHealthSemanticInputV1): MainHealthDigest {
  return hash(normalizeMainHealthSemanticInputV1(input));
}

export function createMainHealthLedgerV1(input: MainHealthLedgerInputV1): MainHealthLedgerV1 {
  const producerValue = input.producer as unknown;
  if (producerValue === null || typeof producerValue !== 'object' || Array.isArray(producerValue)) fail('producer must be an object.');
  const producer = producerValue as Record<string, unknown>;
  const producerKeys = Object.keys(producer).sort();
  const expectedProducerKeys = ['identity', 'trustRevision', 'sourceTransport', 'sourceRunId', 'sourceRef', 'sourceDigest'].sort();
  if (producerKeys.length !== expectedProducerKeys.length || producerKeys.some((key, index) => key !== expectedProducerKeys[index])) fail('producer keys are invalid.');
  if (producer.sourceTransport !== 'github-api' && producer.sourceTransport !== 'trusted-local-readback') fail('producer.sourceTransport is invalid.');
  const semantic = normalizeMainHealthSemanticInputV1(input);
  const normalized = Object.freeze({
    ...semantic,
    expiresAt: instant(input.expiresAt, 'expiresAt'),
    observedAt: instant(input.observedAt, 'observedAt'),
    producer: Object.freeze({
      identity: text(producer.identity, 'producer.identity'),
      trustRevision: sha(producer.trustRevision, 'producer.trustRevision'),
      sourceTransport: producer.sourceTransport,
      sourceRunId: text(producer.sourceRunId, 'producer.sourceRunId'),
      sourceRef: text(producer.sourceRef, 'producer.sourceRef'),
      sourceDigest: digest(producer.sourceDigest, 'producer.sourceDigest')
    })
  });
  if (normalized.producer.trustRevision !== normalized.trustRevision) fail('producer trustRevision must match ledger trustRevision.');
  if (normalized.expiresAt <= normalized.observedAt) fail('expiresAt must be after observedAt.');
  const receipt = Object.freeze({ ...normalized, healthRevision: hash(semantic) });
  return Object.freeze({ ...receipt, ledgerDigest: hash(receipt) });
}

export function parseMainHealthLedgerV1(source: string): MainHealthLedgerV1 {
  const parsed = record(JSON.parse(source) as unknown);
  exact(parsed, ['schema', 'repository', 'defaultBranch', 'mainSha', 'mainTreeSha', 'status', 'failureFingerprints', 'owner', 'repairWorkPackage', 'expiresAt', 'allowedLanes', 'trustRevision', 'observedAt', 'producer', 'healthRevision', 'ledgerDigest']);
  if (parsed.schema !== MAIN_HEALTH_LEDGER_SCHEMA_V1) fail('schema mismatch.');
  const ledger = createMainHealthLedgerV1(parsed as unknown as MainHealthLedgerInputV1);
  if (ledger.healthRevision !== parsed.healthRevision) fail('health semantic revision mismatch.');
  if (ledger.ledgerDigest !== parsed.ledgerDigest) fail('digest mismatch.');
  return ledger;
}

export interface MainHealthLaneDecisionV1 {
  readonly status: MainHealthStatusV1;
  /** Ledger-level routing eligibility only; never physical effect authority. */
  readonly allowed: boolean;
  /** Parse, freshness, and exact identity validity, independent of lane eligibility. */
  readonly observationValidity: 'valid' | 'invalid';
  readonly reasonCode:
    | 'invalid-ledger'
    | 'ledger-expired'
    | 'ledger-identity-drift'
    | 'lane-eligible'
    | 'lane-ineligible';
  readonly reason: string;
  readonly ledger: MainHealthLedgerV1 | null;
}

export function resolveMainHealthLaneV1(input: {
  readonly ledger: unknown;
  readonly lane: MainHealthLaneV1;
  readonly now: string;
  readonly expectedRepository: string;
  readonly expectedDefaultBranch: string;
  readonly expectedMainSha: string;
  readonly expectedMainTreeSha: string;
  readonly expectedTrustRevision: string;
}): MainHealthLaneDecisionV1 {
  let ledger: MainHealthLedgerV1;
  try {
    ledger = typeof input.ledger === 'string'
      ? parseMainHealthLedgerV1(input.ledger)
      : parseMainHealthLedgerV1(encodeVerificationActionDataV2(input.ledger));
  } catch {
    return Object.freeze({
      status: 'locked', allowed: false, observationValidity: 'invalid', reasonCode: 'invalid-ledger',
      reason: 'unknown or invalid MainHealth locks all lanes', ledger: null
    });
  }
  const now = instant(input.now, 'now');
  if (now > ledger.expiresAt) {
    return Object.freeze({
      status: 'locked', allowed: false, observationValidity: 'invalid', reasonCode: 'ledger-expired',
      reason: 'MainHealth ledger expired', ledger
    });
  }
  if (ledger.repository !== input.expectedRepository || ledger.defaultBranch !== input.expectedDefaultBranch ||
    ledger.mainSha !== input.expectedMainSha || ledger.mainTreeSha !== input.expectedMainTreeSha ||
    ledger.trustRevision !== input.expectedTrustRevision) {
    return Object.freeze({
      status: 'locked', allowed: false, observationValidity: 'invalid',
      reasonCode: 'ledger-identity-drift',
      reason: 'MainHealth repository/branch/main/tree/trust identity drifted', ledger
    });
  }
  const allowed = ledger.status !== 'locked' && ledger.allowedLanes.includes(input.lane);
  return Object.freeze({
    status: allowed ? ledger.status : 'locked',
    allowed,
    observationValidity: 'valid',
    reasonCode: allowed ? 'lane-eligible' : 'lane-ineligible',
    reason: allowed
      ? `${input.lane} lane is eligible under the live ${ledger.status} ledger`
      : `${input.lane} lane is not eligible under the live ledger`,
    ledger
  });
}
