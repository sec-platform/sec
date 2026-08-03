import {
  type VerificationReasonCode,
  type VerificationResultStatus
} from './verification-result-contract.ts';

export const VERIFICATION_LEGACY_PROJECTION_SCHEMA_V1 =
  'sec-verification-legacy-projection-v1' as const;

export type VerificationLegacyProjectionKindV1 =
  | 'semantic-mutation-result'
  | 'lock-pass-status'
  | 'runtime-legacy-gate'
  | 'ci-evidence-legacy';

export interface VerificationLegacyProjectionCanonicalReferenceV1 {
  sourceKind: 'report' | 'evidence' | 'artifact-set';
  reference: string;
  digest: string;
  revision: string;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  claimDigest: string | null;
}

export interface VerificationLegacyProjectionV1 {
  schema: typeof VERIFICATION_LEGACY_PROJECTION_SCHEMA_V1;
  projectionKind: VerificationLegacyProjectionKindV1;
  legacyValue: string;
  canonical: VerificationLegacyProjectionCanonicalReferenceV1;
  authoritative: false;
  informationLoss: string[];
  consumers: string[];
  retirementTarget: string;
}

const PROJECTION_KINDS = new Set<VerificationLegacyProjectionKindV1>([
  'semantic-mutation-result',
  'lock-pass-status',
  'runtime-legacy-gate',
  'ci-evidence-legacy'
]);
const STATUSES = new Set<VerificationResultStatus>([
  'passed', 'failed', 'not-run', 'unsupported', 'invalidated'
]);
const PASS_LIKE_VALUES = new Set(['passed', 'succeeded', 'success', 'true']);
const TOP_LEVEL_KEYS = [
  'schema',
  'projectionKind',
  'legacyValue',
  'canonical',
  'authoritative',
  'informationLoss',
  'consumers',
  'retirementTarget'
] as const;
const CANONICAL_KEYS = [
  'sourceKind',
  'reference',
  'digest',
  'revision',
  'status',
  'reasonCode',
  'claimDigest'
] as const;

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function text(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4096
    || value.includes('\0')
  ) throw new Error(`${label} must be bounded non-empty text.`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be a non-empty bounded array.`);
  }
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(value).size !== value.length) throw new Error(`${label} must be unique.`);
  const sorted = [...value].sort((left, right) => left.localeCompare(right, 'en'));
  if (sorted.some((entry, index) => entry !== value[index])) {
    throw new Error(`${label} must be in canonical lexical order.`);
  }
}

function assertReasonMatchesStatus(
  status: VerificationResultStatus,
  reasonCode: VerificationReasonCode
): void {
  const allowed: Record<VerificationResultStatus, ReadonlySet<VerificationReasonCode>> = {
    passed: new Set(['executed-success']),
    failed: new Set([
      'executed-failure', 'timeout', 'cleanup-failed', 'process-settlement-failed'
    ]),
    'not-run': new Set([
      'not-applicable', 'fail-fast-prerequisite-failed',
      'current-runner-not-owning-environment', 'not-dispatched',
      'required-artifact-missing'
    ]),
    unsupported: new Set(['capability-unsupported', 'platform-unsupported']),
    invalidated: new Set([
      'selection-unresolved', 'input-invalidated', 'evidence-stale',
      'superseded-revision', 'cancelled'
    ])
  };
  if (!allowed[status].has(reasonCode)) {
    throw new Error(`canonical reasonCode ${reasonCode} does not match status ${status}.`);
  }
}

export function CodexDevelopmentAssertVerificationLegacyProjectionV1(
  value: unknown
): asserts value is VerificationLegacyProjectionV1 {
  object(value, 'verification legacy projection');
  exact(value, TOP_LEVEL_KEYS, 'verification legacy projection');
  if (value.schema !== VERIFICATION_LEGACY_PROJECTION_SCHEMA_V1) {
    throw new Error('Verification legacy projection schema mismatch.');
  }
  text(value.projectionKind, 'projectionKind');
  if (!PROJECTION_KINDS.has(value.projectionKind as VerificationLegacyProjectionKindV1)) {
    throw new Error('projectionKind is invalid.');
  }
  text(value.legacyValue, 'legacyValue');
  if (value.authoritative !== false) {
    throw new Error('Legacy Verification projection can never be authoritative.');
  }
  strings(value.informationLoss, 'informationLoss');
  strings(value.consumers, 'consumers');
  text(value.retirementTarget, 'retirementTarget');

  object(value.canonical, 'canonical');
  exact(value.canonical, CANONICAL_KEYS, 'canonical');
  if (!['report', 'evidence', 'artifact-set'].includes(String(value.canonical.sourceKind))) {
    throw new Error('canonical.sourceKind is invalid.');
  }
  text(value.canonical.reference, 'canonical.reference');
  digest(value.canonical.digest, 'canonical.digest');
  text(value.canonical.revision, 'canonical.revision');
  text(value.canonical.status, 'canonical.status');
  if (!STATUSES.has(value.canonical.status as VerificationResultStatus)) {
    throw new Error('canonical.status is invalid.');
  }
  text(value.canonical.reasonCode, 'canonical.reasonCode');
  if (value.canonical.claimDigest !== null) {
    digest(value.canonical.claimDigest, 'canonical.claimDigest');
  }
  assertReasonMatchesStatus(
    value.canonical.status as VerificationResultStatus,
    value.canonical.reasonCode as VerificationReasonCode
  );

  if (
    PASS_LIKE_VALUES.has((value.legacyValue as string).toLowerCase())
    && value.canonical.status !== 'passed'
  ) {
    throw new Error('Legacy pass-like value requires canonical passed status.');
  }
}

export function CodexDevelopmentBuildVerificationLegacyProjectionV1(
  input: Omit<VerificationLegacyProjectionV1, 'schema' | 'authoritative'>
): VerificationLegacyProjectionV1 {
  const projection: VerificationLegacyProjectionV1 = {
    schema: VERIFICATION_LEGACY_PROJECTION_SCHEMA_V1,
    ...input,
    authoritative: false
  };
  CodexDevelopmentAssertVerificationLegacyProjectionV1(projection);
  return projection;
}
