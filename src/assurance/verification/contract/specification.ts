import { deepFreeze, sha256, uniqueSorted } from '../../../contracts/canonical.ts';
import {
  readVerificationDataRecord,
  snapshotVerificationData
} from './data.ts';

export const VERIFICATION_CLAIM_SCHEMA = 'verification-claim' as const;
export const VERIFICATION_PROOF_OBLIGATION_SCHEMA = 'verification-proof-obligation' as const;
export const VERIFICATION_METHOD_SELECTION_SCHEMA = 'verification-method-selection' as const;
export const VERIFICATION_SPECIFICATION_BINDING_SCHEMA =
  'verification-specification-binding' as const;

type Digest = `sha256:${string}`;

export type VerificationClaimSource =
  | Readonly<{ kind: 'requirement'; ref: string; revision: string }>
  | Readonly<{ kind: 'invariant'; ref: string; revision: string }>
  | Readonly<{ kind: 'explicit-check-request'; ref: string; revision: string }>;

export type VerificationClaim = Readonly<{
  schema: typeof VERIFICATION_CLAIM_SCHEMA;
  claimRef: string;
  claimRevision: string;
  source: VerificationClaimSource;
  ownerRef: string;
  subjectRef: string;
  subjectRevision: string;
  propositionDigest: Digest;
  applicabilityScopeDigest: Digest;
  assumptionsDigest: Digest;
  requiredAssuranceDigest: Digest;
  lifecycleAndInvalidationDigest: Digest;
  claimDigest: Digest;
}>;

export type ProofObligation = Readonly<{
  schema: typeof VERIFICATION_PROOF_OBLIGATION_SCHEMA;
  obligationRef: string;
  obligationRevision: string;
  claimRef: string;
  claimRevision: string;
  claimDigest: Digest;
  ownerRef: string;
  requiredObservationOrPredicateDigest: Digest;
  applicabilityScopeDigest: Digest;
  requiredIndependenceDigest: Digest;
  admissibleMethodFamilies: readonly string[];
  environmentAndCapabilityConstraintsDigest: Digest;
  coverageAndFailureSpaceDigest: Digest;
  lifecycleAndInvalidationDigest: Digest;
  obligationDigest: Digest;
}>;

export type VerificationMethodSelection = Readonly<{
  schema: typeof VERIFICATION_METHOD_SELECTION_SCHEMA;
  selectionRef: string;
  selectionRevision: string;
  proofObligationRef: string;
  proofObligationRevision: string;
  proofObligationDigest: Digest;
  methodFamily: string;
  methodContractRef: string;
  methodContractRevision: string;
  environmentAndCapabilityRequirementsDigest: Digest;
  oracleCheckerOrReferenceRefs: readonly string[];
  executionRequired: boolean;
  evidenceQualificationDigest: Digest;
  lifecycleAndInvalidationDigest: Digest;
  selectionDigest: Digest;
}>;

export type VerificationSpecificationBinding = Readonly<{
  schema: typeof VERIFICATION_SPECIFICATION_BINDING_SCHEMA;
  claim: VerificationClaim;
  proofObligation: ProofObligation;
  methodSelection: VerificationMethodSelection;
  bindingDigest: Digest;
}>;

const issuedBindings = new WeakSet<object>();

function record(value: unknown, label: string): Record<string, unknown> {
  const snapshot = snapshotVerificationData(value, label);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`${label} must be one object`);
  }
  return snapshot;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
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

function digest(value: unknown, label: string): Digest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)
      || value === `sha256:${'0'.repeat(64)}`) {
    throw new Error(`${label} must be one non-placeholder SHA-256 digest`);
  }
  return value as Digest;
}

function canonicalIdentities(value: unknown, label: string): readonly string[] {
  const snapshot = snapshotVerificationData(value, label);
  if (!Array.isArray(snapshot)) throw new Error(`${label} must be an array`);
  const identities = snapshot.map((entry, index) => identity(entry, `${label}[${index}]`));
  const canonical = uniqueSorted(identities);
  if (canonical.length !== identities.length
      || canonical.some((entry, index) => entry !== identities[index])) {
    throw new Error(`${label} must be unique and canonically ordered`);
  }
  return Object.freeze(canonical);
}

function claimSource(value: unknown): VerificationClaimSource {
  const input = record(value, 'Verification Claim source');
  exactKeys(input, ['kind', 'ref', 'revision'], 'Verification Claim source');
  if (input.kind !== 'requirement' && input.kind !== 'invariant'
      && input.kind !== 'explicit-check-request') {
    throw new Error('Verification Claim source kind is invalid');
  }
  return deepFreeze({
    kind: input.kind,
    ref: identity(input.ref, 'Verification Claim source ref'),
    revision: identity(input.revision, 'Verification Claim source revision')
  } as VerificationClaimSource);
}

function claimWithoutDigest(value: unknown): Omit<VerificationClaim, 'claimDigest'> {
  const input = record(value, 'Verification Claim');
  exactKeys(input, [
    'schema', 'claimRef', 'claimRevision', 'source', 'ownerRef', 'subjectRef',
    'subjectRevision', 'propositionDigest', 'applicabilityScopeDigest',
    'assumptionsDigest', 'requiredAssuranceDigest', 'lifecycleAndInvalidationDigest'
  ], 'Verification Claim');
  if (input.schema !== VERIFICATION_CLAIM_SCHEMA) {
    throw new Error('Verification Claim schema is invalid');
  }
  return deepFreeze({
    schema: VERIFICATION_CLAIM_SCHEMA,
    claimRef: identity(input.claimRef, 'Verification Claim claimRef'),
    claimRevision: identity(input.claimRevision, 'Verification Claim claimRevision'),
    source: claimSource(input.source),
    ownerRef: identity(input.ownerRef, 'Verification Claim ownerRef'),
    subjectRef: identity(input.subjectRef, 'Verification Claim subjectRef'),
    subjectRevision: identity(input.subjectRevision, 'Verification Claim subjectRevision'),
    propositionDigest: digest(input.propositionDigest, 'Verification Claim propositionDigest'),
    applicabilityScopeDigest: digest(
      input.applicabilityScopeDigest,
      'Verification Claim applicabilityScopeDigest'
    ),
    assumptionsDigest: digest(input.assumptionsDigest, 'Verification Claim assumptionsDigest'),
    requiredAssuranceDigest: digest(
      input.requiredAssuranceDigest,
      'Verification Claim requiredAssuranceDigest'
    ),
    lifecycleAndInvalidationDigest: digest(
      input.lifecycleAndInvalidationDigest,
      'Verification Claim lifecycleAndInvalidationDigest'
    )
  });
}

export function createVerificationClaim(
  input: Omit<VerificationClaim, 'schema' | 'claimDigest'>
): VerificationClaim {
  const candidate = record(input, 'Verification Claim input');
  exactKeys(candidate, [
    'claimRef', 'claimRevision', 'source', 'ownerRef', 'subjectRef', 'subjectRevision',
    'propositionDigest', 'applicabilityScopeDigest', 'assumptionsDigest',
    'requiredAssuranceDigest', 'lifecycleAndInvalidationDigest'
  ], 'Verification Claim input');
  const canonical = claimWithoutDigest({ schema: VERIFICATION_CLAIM_SCHEMA, ...candidate });
  return deepFreeze({ ...canonical, claimDigest: sha256(canonical) });
}

export function assertVerificationClaim(value: unknown): asserts value is VerificationClaim {
  const input = record(value, 'Verification Claim');
  exactKeys(input, [
    'schema', 'claimRef', 'claimRevision', 'source', 'ownerRef', 'subjectRef',
    'subjectRevision', 'propositionDigest', 'applicabilityScopeDigest',
    'assumptionsDigest', 'requiredAssuranceDigest', 'lifecycleAndInvalidationDigest',
    'claimDigest'
  ], 'Verification Claim');
  const { claimDigest, ...withoutDigest } = input;
  const canonical = claimWithoutDigest(withoutDigest);
  if (digest(claimDigest, 'Verification Claim claimDigest') !== sha256(canonical)) {
    throw new Error('Verification Claim digest mismatch');
  }
}

function obligationWithoutDigest(value: unknown): Omit<ProofObligation, 'obligationDigest'> {
  const input = record(value, 'Proof Obligation');
  exactKeys(input, [
    'schema', 'obligationRef', 'obligationRevision', 'claimRef', 'claimRevision',
    'claimDigest', 'ownerRef', 'requiredObservationOrPredicateDigest',
    'applicabilityScopeDigest', 'requiredIndependenceDigest', 'admissibleMethodFamilies',
    'environmentAndCapabilityConstraintsDigest', 'coverageAndFailureSpaceDigest',
    'lifecycleAndInvalidationDigest'
  ], 'Proof Obligation');
  if (input.schema !== VERIFICATION_PROOF_OBLIGATION_SCHEMA) {
    throw new Error('Proof Obligation schema is invalid');
  }
  const admissibleMethodFamilies = canonicalIdentities(
    input.admissibleMethodFamilies,
    'Proof Obligation admissibleMethodFamilies'
  );
  if (admissibleMethodFamilies.length === 0) {
    throw new Error('Proof Obligation requires at least one admissible method family');
  }
  return deepFreeze({
    schema: VERIFICATION_PROOF_OBLIGATION_SCHEMA,
    obligationRef: identity(input.obligationRef, 'Proof Obligation obligationRef'),
    obligationRevision: identity(
      input.obligationRevision,
      'Proof Obligation obligationRevision'
    ),
    claimRef: identity(input.claimRef, 'Proof Obligation claimRef'),
    claimRevision: identity(input.claimRevision, 'Proof Obligation claimRevision'),
    claimDigest: digest(input.claimDigest, 'Proof Obligation claimDigest'),
    ownerRef: identity(input.ownerRef, 'Proof Obligation ownerRef'),
    requiredObservationOrPredicateDigest: digest(
      input.requiredObservationOrPredicateDigest,
      'Proof Obligation requiredObservationOrPredicateDigest'
    ),
    applicabilityScopeDigest: digest(
      input.applicabilityScopeDigest,
      'Proof Obligation applicabilityScopeDigest'
    ),
    requiredIndependenceDigest: digest(
      input.requiredIndependenceDigest,
      'Proof Obligation requiredIndependenceDigest'
    ),
    admissibleMethodFamilies,
    environmentAndCapabilityConstraintsDigest: digest(
      input.environmentAndCapabilityConstraintsDigest,
      'Proof Obligation environmentAndCapabilityConstraintsDigest'
    ),
    coverageAndFailureSpaceDigest: digest(
      input.coverageAndFailureSpaceDigest,
      'Proof Obligation coverageAndFailureSpaceDigest'
    ),
    lifecycleAndInvalidationDigest: digest(
      input.lifecycleAndInvalidationDigest,
      'Proof Obligation lifecycleAndInvalidationDigest'
    )
  });
}

export function createProofObligation(
  input: Omit<ProofObligation, 'schema' | 'obligationDigest'>
): ProofObligation {
  const candidate = record(input, 'Proof Obligation input');
  exactKeys(candidate, [
    'obligationRef', 'obligationRevision', 'claimRef', 'claimRevision', 'claimDigest',
    'ownerRef', 'requiredObservationOrPredicateDigest', 'applicabilityScopeDigest',
    'requiredIndependenceDigest', 'admissibleMethodFamilies',
    'environmentAndCapabilityConstraintsDigest', 'coverageAndFailureSpaceDigest',
    'lifecycleAndInvalidationDigest'
  ], 'Proof Obligation input');
  const canonical = obligationWithoutDigest({
    schema: VERIFICATION_PROOF_OBLIGATION_SCHEMA,
    ...candidate
  });
  return deepFreeze({ ...canonical, obligationDigest: sha256(canonical) });
}

export function assertProofObligation(value: unknown): asserts value is ProofObligation {
  const input = record(value, 'Proof Obligation');
  exactKeys(input, [
    'schema', 'obligationRef', 'obligationRevision', 'claimRef', 'claimRevision',
    'claimDigest', 'ownerRef', 'requiredObservationOrPredicateDigest',
    'applicabilityScopeDigest', 'requiredIndependenceDigest', 'admissibleMethodFamilies',
    'environmentAndCapabilityConstraintsDigest', 'coverageAndFailureSpaceDigest',
    'lifecycleAndInvalidationDigest', 'obligationDigest'
  ], 'Proof Obligation');
  const { obligationDigest, ...withoutDigest } = input;
  const canonical = obligationWithoutDigest(withoutDigest);
  if (digest(obligationDigest, 'Proof Obligation obligationDigest') !== sha256(canonical)) {
    throw new Error('Proof Obligation digest mismatch');
  }
}

function selectionWithoutDigest(
  value: unknown
): Omit<VerificationMethodSelection, 'selectionDigest'> {
  const input = record(value, 'Verification Method Selection');
  exactKeys(input, [
    'schema', 'selectionRef', 'selectionRevision', 'proofObligationRef',
    'proofObligationRevision', 'proofObligationDigest', 'methodFamily',
    'methodContractRef', 'methodContractRevision',
    'environmentAndCapabilityRequirementsDigest', 'oracleCheckerOrReferenceRefs',
    'executionRequired', 'evidenceQualificationDigest', 'lifecycleAndInvalidationDigest'
  ], 'Verification Method Selection');
  if (input.schema !== VERIFICATION_METHOD_SELECTION_SCHEMA) {
    throw new Error('Verification Method Selection schema is invalid');
  }
  if (typeof input.executionRequired !== 'boolean') {
    throw new Error('Verification Method Selection executionRequired must be boolean');
  }
  return deepFreeze({
    schema: VERIFICATION_METHOD_SELECTION_SCHEMA,
    selectionRef: identity(input.selectionRef, 'Verification Method Selection selectionRef'),
    selectionRevision: identity(
      input.selectionRevision,
      'Verification Method Selection selectionRevision'
    ),
    proofObligationRef: identity(
      input.proofObligationRef,
      'Verification Method Selection proofObligationRef'
    ),
    proofObligationRevision: identity(
      input.proofObligationRevision,
      'Verification Method Selection proofObligationRevision'
    ),
    proofObligationDigest: digest(
      input.proofObligationDigest,
      'Verification Method Selection proofObligationDigest'
    ),
    methodFamily: identity(input.methodFamily, 'Verification Method Selection methodFamily'),
    methodContractRef: identity(
      input.methodContractRef,
      'Verification Method Selection methodContractRef'
    ),
    methodContractRevision: identity(
      input.methodContractRevision,
      'Verification Method Selection methodContractRevision'
    ),
    environmentAndCapabilityRequirementsDigest: digest(
      input.environmentAndCapabilityRequirementsDigest,
      'Verification Method Selection environmentAndCapabilityRequirementsDigest'
    ),
    oracleCheckerOrReferenceRefs: canonicalIdentities(
      input.oracleCheckerOrReferenceRefs,
      'Verification Method Selection oracleCheckerOrReferenceRefs'
    ),
    executionRequired: input.executionRequired,
    evidenceQualificationDigest: digest(
      input.evidenceQualificationDigest,
      'Verification Method Selection evidenceQualificationDigest'
    ),
    lifecycleAndInvalidationDigest: digest(
      input.lifecycleAndInvalidationDigest,
      'Verification Method Selection lifecycleAndInvalidationDigest'
    )
  });
}

export function createVerificationMethodSelection(
  input: Omit<VerificationMethodSelection, 'schema' | 'selectionDigest'>
): VerificationMethodSelection {
  const candidate = record(input, 'Verification Method Selection input');
  exactKeys(candidate, [
    'selectionRef', 'selectionRevision', 'proofObligationRef', 'proofObligationRevision',
    'proofObligationDigest', 'methodFamily', 'methodContractRef', 'methodContractRevision',
    'environmentAndCapabilityRequirementsDigest', 'oracleCheckerOrReferenceRefs',
    'executionRequired', 'evidenceQualificationDigest', 'lifecycleAndInvalidationDigest'
  ], 'Verification Method Selection input');
  const canonical = selectionWithoutDigest({
    schema: VERIFICATION_METHOD_SELECTION_SCHEMA,
    ...candidate
  });
  return deepFreeze({ ...canonical, selectionDigest: sha256(canonical) });
}

export function assertVerificationMethodSelection(
  value: unknown
): asserts value is VerificationMethodSelection {
  const input = record(value, 'Verification Method Selection');
  exactKeys(input, [
    'schema', 'selectionRef', 'selectionRevision', 'proofObligationRef',
    'proofObligationRevision', 'proofObligationDigest', 'methodFamily',
    'methodContractRef', 'methodContractRevision',
    'environmentAndCapabilityRequirementsDigest', 'oracleCheckerOrReferenceRefs',
    'executionRequired', 'evidenceQualificationDigest', 'lifecycleAndInvalidationDigest',
    'selectionDigest'
  ], 'Verification Method Selection');
  const { selectionDigest, ...withoutDigest } = input;
  const canonical = selectionWithoutDigest(withoutDigest);
  if (digest(selectionDigest, 'Verification Method Selection selectionDigest')
      !== sha256(canonical)) {
    throw new Error('Verification Method Selection digest mismatch');
  }
}

export function createVerificationSpecificationBinding(input: Readonly<{
  claim: VerificationClaim;
  proofObligation: ProofObligation;
  methodSelection: VerificationMethodSelection;
}>): VerificationSpecificationBinding {
  const candidate = readVerificationDataRecord(input, 'Verification specification binding input');
  exactKeys(
    candidate,
    ['claim', 'proofObligation', 'methodSelection'],
    'Verification specification binding input'
  );
  const claim = candidate.claim as VerificationClaim;
  const obligation = candidate.proofObligation as ProofObligation;
  const selection = candidate.methodSelection as VerificationMethodSelection;
  assertVerificationClaim(claim);
  assertProofObligation(obligation);
  assertVerificationMethodSelection(selection);
  if (obligation.claimRef !== claim.claimRef
      || obligation.claimRevision !== claim.claimRevision
      || obligation.claimDigest !== claim.claimDigest) {
    throw new Error('Proof Obligation does not bind the exact Verification Claim');
  }
  if (selection.proofObligationRef !== obligation.obligationRef
      || selection.proofObligationRevision !== obligation.obligationRevision
      || selection.proofObligationDigest !== obligation.obligationDigest) {
    throw new Error('Verification Method Selection does not bind the exact Proof Obligation');
  }
  if (!obligation.admissibleMethodFamilies.includes(selection.methodFamily)) {
    throw new Error('Verification Method Selection method family is not admitted by the obligation');
  }
  const canonical = deepFreeze({
    schema: VERIFICATION_SPECIFICATION_BINDING_SCHEMA,
    claim,
    proofObligation: obligation,
    methodSelection: selection
  });
  const binding = deepFreeze({ ...canonical, bindingDigest: sha256(canonical) });
  issuedBindings.add(binding);
  return binding;
}

export function assertVerificationSpecificationBinding(
  value: VerificationSpecificationBinding
): void {
  if (!issuedBindings.has(value)) {
    throw new Error('Verification specification binding requires canonical chain validation');
  }
}
