import { deepFreeze, sha256, uniqueSorted } from '../../../../contracts/canonical.ts';
import {
  readVerificationDataRecord,
  snapshotVerificationData
} from '../../contract/data.ts';
import {
  assertVerificationSpecificationBinding,
  type VerificationSpecificationBinding
} from '../../contract/specification.ts';

import { VERIFICATION_EVIDENCE_USE_SCHEMA } from './schema.ts';

export type VerificationMethodConclusion =
  | 'supports'
  | 'contradicts'
  | 'indeterminate'
  | 'not-produced';

export type VerificationEvidenceQualificationStatus =
  | 'qualified'
  | 'unqualified'
  | 'unknown'
  | 'invalidated';

export type VerificationEvidenceQualificationReason =
  | 'exact-match'
  | 'subject-mismatch'
  | 'obligation-mismatch'
  | 'method-selection-mismatch'
  | 'coverage-insufficient'
  | 'freshness-stale'
  | 'producer-untrusted'
  | 'producer-unsettled'
  | 'cleanup-unclosed'
  | 'invalidation-active'
  | 'qualification-unresolved';

export type VerificationEvidenceQualification = Readonly<{
  status: VerificationEvidenceQualificationStatus;
  reason: VerificationEvidenceQualificationReason;
  qualificationEvidenceRefs: readonly string[];
  invalidationRefs: readonly string[];
}>;

export type VerificationEvidenceUse = Readonly<{
  schema: typeof VERIFICATION_EVIDENCE_USE_SCHEMA;
  evidenceRef: string;
  producerResultRef: string;
  claimRef: string;
  claimRevision: string;
  claimDigest: `sha256:${string}`;
  subjectRef: string;
  subjectRevision: string;
  proofObligationRef: string;
  proofObligationRevision: string;
  proofObligationDigest: `sha256:${string}`;
  methodSelectionRef: string;
  methodSelectionRevision: string;
  methodSelectionDigest: `sha256:${string}`;
  methodConclusion: Exclude<VerificationMethodConclusion, 'not-produced'>;
  qualification: VerificationEvidenceQualification;
  useDigest: `sha256:${string}`;
}>;

export type VerificationEvidenceUseInput = Readonly<{
  specification: VerificationSpecificationBinding;
  evidenceRef: string;
  producerResultRef: string;
  methodConclusion: Exclude<VerificationMethodConclusion, 'not-produced'>;
  qualification: VerificationEvidenceQualification;
}>;

const QUALIFICATION_REASONS: Readonly<Record<
  VerificationEvidenceQualificationStatus,
  ReadonlySet<VerificationEvidenceQualificationReason>
>> = Object.freeze({
  qualified: new Set<VerificationEvidenceQualificationReason>(['exact-match']),
  unqualified: new Set<VerificationEvidenceQualificationReason>([
    'subject-mismatch',
    'obligation-mismatch',
    'method-selection-mismatch',
    'coverage-insufficient',
    'producer-untrusted',
    'producer-unsettled',
    'cleanup-unclosed'
  ]),
  unknown: new Set<VerificationEvidenceQualificationReason>(['qualification-unresolved']),
  invalidated: new Set<VerificationEvidenceQualificationReason>(['freshness-stale', 'invalidation-active'])
});

const METHOD_CONCLUSIONS = new Set<VerificationMethodConclusion>([
  'supports',
  'contradicts',
  'indeterminate',
  'not-produced'
]);

function record(value: unknown, label: string): Record<string, unknown> {
  const snapshot = snapshotVerificationData(value, label);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`${label} must be one ordinary object`);
  }
  return snapshot;
}

function array(value: unknown, label: string): readonly unknown[] {
  const snapshot = snapshotVerificationData(value, label);
  if (!Array.isArray(snapshot)) throw new Error(`${label} must be one array`);
  return snapshot;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
      || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function identity(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
      || value.trim() !== value || value.normalize('NFC') !== value
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} must be one bounded canonical identity`);
  }
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)
      || value === `sha256:${'0'.repeat(64)}`) {
    throw new Error(`${label} must be one non-placeholder SHA-256 digest`);
  }
  return value as `sha256:${string}`;
}

function canonicalRefs(value: unknown, label: string): readonly string[] {
  const entries = array(value, label);
  const refs = entries.map((entry, index) => identity(entry, `${label}[${index}]`));
  const canonical = uniqueSorted(refs);
  if (canonical.length !== refs.length
      || canonical.some((entry, index) => entry !== refs[index])) {
    throw new Error(`${label} must be unique and canonically ordered`);
  }
  return Object.freeze(canonical);
}

function methodConclusion(
  value: unknown
): Exclude<VerificationMethodConclusion, 'not-produced'> {
  if (typeof value !== 'string' || !METHOD_CONCLUSIONS.has(value as VerificationMethodConclusion)) {
    throw new Error('Verification Evidence Use methodConclusion is invalid');
  }
  if (value === 'not-produced') {
    throw new Error(
      'Verification Evidence Use cannot exist for MethodConclusion=not-produced'
    );
  }
  return value as Exclude<VerificationMethodConclusion, 'not-produced'>;
}

function qualification(value: unknown): VerificationEvidenceQualification {
  const input = record(value, 'Verification Evidence Use qualification');
  exactKeys(
    input,
    ['status', 'reason', 'qualificationEvidenceRefs', 'invalidationRefs'],
    'Verification Evidence Use qualification'
  );
  if (typeof input.status !== 'string'
      || !Object.hasOwn(QUALIFICATION_REASONS, input.status)) {
    throw new Error('Verification Evidence Use qualification status is invalid');
  }
  const status = input.status as VerificationEvidenceQualificationStatus;
  if (typeof input.reason !== 'string'
      || !QUALIFICATION_REASONS[status].has(
        input.reason as VerificationEvidenceQualificationReason
      )) {
    throw new Error('Verification Evidence Use qualification reason is invalid');
  }
  const qualificationEvidenceRefs = canonicalRefs(
    input.qualificationEvidenceRefs,
    'Verification Evidence Use qualificationEvidenceRefs'
  );
  const invalidationRefs = canonicalRefs(
    input.invalidationRefs,
    'Verification Evidence Use invalidationRefs'
  );
  if (status === 'qualified') {
    if (qualificationEvidenceRefs.length === 0) {
      throw new Error('Qualified Evidence Use requires qualification evidence');
    }
    if (invalidationRefs.length !== 0) {
      throw new Error('Qualified Evidence Use cannot retain an active invalidation');
    }
  }
  if (status === 'invalidated' && invalidationRefs.length === 0) {
    throw new Error('Invalidated Evidence Use requires an invalidation reference');
  }
  return deepFreeze({
    status,
    reason: input.reason as VerificationEvidenceQualificationReason,
    qualificationEvidenceRefs,
    invalidationRefs
  });
}

function canonicalUseWithoutDigest(value: unknown): Omit<VerificationEvidenceUse, 'useDigest'> {
  const input = record(value, 'Verification Evidence Use');
  exactKeys(input, [
    'schema',
    'evidenceRef',
    'producerResultRef',
    'claimRef',
    'claimRevision',
    'claimDigest',
    'subjectRef',
    'subjectRevision',
    'proofObligationRef',
    'proofObligationRevision',
    'proofObligationDigest',
    'methodSelectionRef',
    'methodSelectionRevision',
    'methodSelectionDigest',
    'methodConclusion',
    'qualification'
  ], 'Verification Evidence Use');
  if (input.schema !== VERIFICATION_EVIDENCE_USE_SCHEMA) {
    throw new Error('Verification Evidence Use schema is invalid');
  }
  return deepFreeze({
    schema: VERIFICATION_EVIDENCE_USE_SCHEMA,
    evidenceRef: identity(input.evidenceRef, 'Verification Evidence Use evidenceRef'),
    producerResultRef: identity(
      input.producerResultRef,
      'Verification Evidence Use producerResultRef'
    ),
    claimRef: identity(input.claimRef, 'Verification Evidence Use claimRef'),
    claimRevision: identity(
      input.claimRevision,
      'Verification Evidence Use claimRevision'
    ),
    claimDigest: digest(input.claimDigest, 'Verification Evidence Use claimDigest'),
    subjectRef: identity(input.subjectRef, 'Verification Evidence Use subjectRef'),
    subjectRevision: identity(
      input.subjectRevision,
      'Verification Evidence Use subjectRevision'
    ),
    proofObligationRef: identity(
      input.proofObligationRef,
      'Verification Evidence Use proofObligationRef'
    ),
    proofObligationRevision: identity(
      input.proofObligationRevision,
      'Verification Evidence Use proofObligationRevision'
    ),
    proofObligationDigest: digest(
      input.proofObligationDigest,
      'Verification Evidence Use proofObligationDigest'
    ),
    methodSelectionRef: identity(
      input.methodSelectionRef,
      'Verification Evidence Use methodSelectionRef'
    ),
    methodSelectionRevision: identity(
      input.methodSelectionRevision,
      'Verification Evidence Use methodSelectionRevision'
    ),
    methodSelectionDigest: digest(
      input.methodSelectionDigest,
      'Verification Evidence Use methodSelectionDigest'
    ),
    methodConclusion: methodConclusion(input.methodConclusion),
    qualification: qualification(input.qualification)
  });
}

export function createVerificationEvidenceUse(
  input: VerificationEvidenceUseInput
): VerificationEvidenceUse {
  const candidate = readVerificationDataRecord(input, 'Verification Evidence Use input');
  exactKeys(candidate, [
    'specification', 'evidenceRef', 'producerResultRef', 'methodConclusion', 'qualification'
  ], 'Verification Evidence Use input');
  const specification = candidate.specification as VerificationSpecificationBinding;
  assertVerificationSpecificationBinding(specification);
  const canonical = canonicalUseWithoutDigest({
    schema: VERIFICATION_EVIDENCE_USE_SCHEMA,
    evidenceRef: candidate.evidenceRef,
    producerResultRef: candidate.producerResultRef,
    claimRef: specification.claim.claimRef,
    claimRevision: specification.claim.claimRevision,
    claimDigest: specification.claim.claimDigest,
    subjectRef: specification.claim.subjectRef,
    subjectRevision: specification.claim.subjectRevision,
    proofObligationRef: specification.proofObligation.obligationRef,
    proofObligationRevision: specification.proofObligation.obligationRevision,
    proofObligationDigest: specification.proofObligation.obligationDigest,
    methodSelectionRef: specification.methodSelection.selectionRef,
    methodSelectionRevision: specification.methodSelection.selectionRevision,
    methodSelectionDigest: specification.methodSelection.selectionDigest,
    methodConclusion: candidate.methodConclusion,
    qualification: candidate.qualification
  });
  return deepFreeze({
    ...canonical,
    useDigest: sha256(canonical)
  });
}

export function assertVerificationEvidenceUse(
  value: unknown
): asserts value is VerificationEvidenceUse {
  const input = record(value, 'Verification Evidence Use');
  exactKeys(input, [
    'schema',
    'evidenceRef',
    'producerResultRef',
    'claimRef',
    'claimRevision',
    'claimDigest',
    'subjectRef',
    'subjectRevision',
    'proofObligationRef',
    'proofObligationRevision',
    'proofObligationDigest',
    'methodSelectionRef',
    'methodSelectionRevision',
    'methodSelectionDigest',
    'methodConclusion',
    'qualification',
    'useDigest'
  ], 'Verification Evidence Use');
  const { useDigest, ...withoutDigest } = input;
  if (typeof useDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(useDigest)) {
    throw new Error('Verification Evidence Use digest is invalid');
  }
  const canonical = canonicalUseWithoutDigest(withoutDigest);
  if (sha256(canonical) !== useDigest) {
    throw new Error('Verification Evidence Use digest mismatch');
  }
}
