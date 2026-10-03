import { deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import { readVerificationDataRecord, snapshotVerificationData } from './data.ts';
import {
  assertVerificationClaim,
  createVerificationSpecificationBinding,
  type VerificationClaim,
  type VerificationSpecificationBinding
} from './specification.ts';

/** Canonical test responsibility data. Validation is not author approval. */
export interface VerificationTestResponsibility {
  readonly schema: 'verification-test-responsibility-v1';
  readonly testRef: string;
  readonly testRevision: string;
  readonly ownerRef: string;
  readonly bindings: readonly Readonly<{
    readonly specification: VerificationSpecificationBinding;
    readonly failureMeaning: string;
    readonly observationBoundary: string;
    readonly oracleAndIndependenceRefs: readonly string[];
  }>[];
  readonly environmentAndResourceRequirementsDigest: `sha256:${string}`;
  readonly impactAndLifecycleDigest: `sha256:${string}`;
  readonly retirementConditionsDigest: `sha256:${string}`;
  readonly responsibilityDigest: `sha256:${string}`;
}

type ResponsibilityInput = Omit<VerificationTestResponsibility,
  'schema' | 'responsibilityDigest'>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
      || value.trim() !== value || value.normalize('NFC') !== value
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} requires bounded canonical text`);
  }
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)
      || value === `sha256:${'0'.repeat(64)}`) {
    throw new Error(`${label} requires a non-placeholder digest`);
  }
  return value as `sha256:${string}`;
}

const INPUT_KEYS = [
  'testRef', 'testRevision', 'ownerRef', 'bindings',
  'environmentAndResourceRequirementsDigest', 'impactAndLifecycleDigest',
  'retirementConditionsDigest'
] as const;

export function createVerificationTestResponsibility(input: ResponsibilityInput): VerificationTestResponsibility {
  const value = readVerificationDataRecord(
    snapshotVerificationData(input, 'Test responsibility'), 'Test responsibility'
  );
  exactKeys(value, INPUT_KEYS, 'Test responsibility');
  if (!Array.isArray(value.bindings) || value.bindings.length === 0 || value.bindings.length > 128) {
    throw new Error('Test responsibility requires a bounded non-empty obligation binding set');
  }
  const ownerRef = text(value.ownerRef, 'Test responsibility ownerRef');
  const bindings = value.bindings.map((raw) => {
    const binding = readVerificationDataRecord(raw, 'Test responsibility binding');
    exactKeys(binding, [
      'specification', 'failureMeaning', 'observationBoundary', 'oracleAndIndependenceRefs'
    ], 'Test responsibility binding');
    const specificationData = readVerificationDataRecord(
      binding.specification, 'Test responsibility specification'
    );
    exactKeys(specificationData, [
      'schema', 'claim', 'proofObligation', 'methodSelection', 'bindingDigest'
    ], 'Test responsibility specification');
    const specification = createVerificationSpecificationBinding({
      claim: specificationData.claim as VerificationSpecificationBinding['claim'],
      proofObligation: specificationData.proofObligation as VerificationSpecificationBinding['proofObligation'],
      methodSelection: specificationData.methodSelection as VerificationSpecificationBinding['methodSelection']
    });
    if (specificationData.schema !== specification.schema
        || specificationData.bindingDigest !== specification.bindingDigest) {
      throw new Error('Test responsibility does not bind the exact specification');
    }
    if (!Array.isArray(binding.oracleAndIndependenceRefs)
        || binding.oracleAndIndependenceRefs.length === 0
        || binding.oracleAndIndependenceRefs.length > 128) {
      throw new Error('Test responsibility requires bounded oracle/independence references');
    }
    const oracleAndIndependenceRefs = binding.oracleAndIndependenceRefs
      .map((ref) => text(ref, 'Test responsibility oracle reference')).sort();
    if (new Set(oracleAndIndependenceRefs).size !== oracleAndIndependenceRefs.length) {
      throw new Error('Test responsibility oracle references must be unique');
    }
    return deepFreeze({
      specification,
      failureMeaning: text(binding.failureMeaning, 'Test responsibility failureMeaning'),
      observationBoundary: text(binding.observationBoundary, 'Test responsibility observationBoundary'),
      oracleAndIndependenceRefs
    });
  }).sort((left, right) => left.specification.bindingDigest < right.specification.bindingDigest ? -1 : 1);
  if (new Set(bindings.map(({ specification }) => specification.bindingDigest)).size !== bindings.length) {
    throw new Error('Test responsibility specification bindings must be unique');
  }
  const canonical = deepFreeze({
    schema: 'verification-test-responsibility-v1' as const,
    testRef: text(value.testRef, 'Test responsibility testRef'),
    testRevision: text(value.testRevision, 'Test responsibility testRevision'),
    ownerRef,
    bindings,
    environmentAndResourceRequirementsDigest: digest(
      value.environmentAndResourceRequirementsDigest, 'Test responsibility environment/resources'
    ),
    impactAndLifecycleDigest: digest(value.impactAndLifecycleDigest, 'Test responsibility lifecycle'),
    retirementConditionsDigest: digest(value.retirementConditionsDigest, 'Test responsibility retirement')
  });
  return deepFreeze({ ...canonical, responsibilityDigest: sha256(canonical) as `sha256:${string}` });
}

/** Revalidate persisted data through the same canonical owner, without issuing approval. */
export function parseVerificationTestResponsibility(input: unknown): VerificationTestResponsibility {
  const value = readVerificationDataRecord(
    snapshotVerificationData(input, 'Test responsibility'), 'Test responsibility'
  );
  exactKeys(value, ['schema', ...INPUT_KEYS, 'responsibilityDigest'], 'Test responsibility');
  const { schema, responsibilityDigest, ...fields } = value;
  const canonical = createVerificationTestResponsibility(fields as unknown as ResponsibilityInput);
  if (schema !== canonical.schema || responsibilityDigest !== canonical.responsibilityDigest) {
    throw new Error('Test responsibility schema or digest is invalid');
  }
  return canonical;
}

/** Repository-specific adoption policy. The adopted interpreter owns this
 * policy; candidate data cannot substitute a more permissive policy. */
const repositoryRequirementOwnerPolicy = deepFreeze({
  schema: 'repository-test-requirement-owner-policy-v1' as const,
  sourceKinds: ['invariant', 'requirement'] as const,
  sourceRoot: 'docs/',
  principalKind: 'User' as const,
  roles: ['admin', 'maintain'] as const,
  allowJointTestAuthorship: true,
  subject: 'exact-repository-source-transition' as const
});
export const REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY = deepFreeze({
  ...repositoryRequirementOwnerPolicy,
  policyDigest: sha256(repositoryRequirementOwnerPolicy)
});

export interface VerificationRequirementSourceBinding {
  readonly ref: string;
  readonly revision: string;
  readonly path: string;
  readonly blobSha: string;
  readonly contentDigest: `sha256:${string}`;
}

/** Explicit semantic adoption, not a claim that prose was mechanically proved.
 * The host must independently observe the source bytes and authorized actor. */
export interface VerificationRequirementDisposition {
  readonly decisionId: `sha256:${string}`;
  readonly kind: 'retired' | 'not-applicable';
  readonly baselineBindingDigest: `sha256:${string}`;
  readonly ownerRef: string;
  readonly priorSource: VerificationRequirementSourceBinding;
  readonly currentSource: VerificationRequirementSourceBinding;
  readonly currentClaim: VerificationClaim;
  readonly obligationScopeDigest: `sha256:${string}`;
  readonly supportedEnvironmentDigest: `sha256:${string}`;
  readonly remainingRequiredBindingDigests: readonly `sha256:${string}`[];
  readonly reactivationCondition: string;
}

function requirementSource(input: unknown): VerificationRequirementSourceBinding {
  const value = readVerificationDataRecord(snapshotVerificationData(input, 'Requirement source'), 'Requirement source');
  exactKeys(value, ['ref', 'revision', 'path', 'blobSha', 'contentDigest'], 'Requirement source');
  const path = text(value.path, 'Requirement source path');
  const ref = text(value.ref, 'Requirement source ref');
  // This first repository policy accepts exact canonical document references,
  // not a caller-authored mapping from an opaque ref to unrelated changed docs.
  if (!path.startsWith(REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.sourceRoot) || !path.endsWith('.md')
      || path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..')
      || ref.split('#')[0] !== path || !/^[a-f0-9]{40}$/u.test(String(value.blobSha))) {
    throw new Error('Requirement source requires its original canonical document reference and exact blob');
  }
  return deepFreeze({ ref, path, revision: text(value.revision, 'Requirement source revision'),
    blobSha: String(value.blobSha), contentDigest: digest(value.contentDigest, 'Requirement source bytes') });
}

export function createVerificationRequirementDisposition(input: Omit<VerificationRequirementDisposition, 'decisionId'>): VerificationRequirementDisposition {
  const value = readVerificationDataRecord(snapshotVerificationData(input, 'Requirement disposition'), 'Requirement disposition');
  exactKeys(value, ['kind', 'baselineBindingDigest', 'ownerRef', 'priorSource', 'currentSource', 'currentClaim',
    'obligationScopeDigest', 'supportedEnvironmentDigest', 'remainingRequiredBindingDigests', 'reactivationCondition'], 'Requirement disposition');
  if (value.kind !== 'retired' && value.kind !== 'not-applicable') throw new Error('Requirement disposition kind is invalid');
  assertVerificationClaim(value.currentClaim);
  if (!Array.isArray(value.remainingRequiredBindingDigests) || value.remainingRequiredBindingDigests.length > 128) {
    throw new Error('Requirement disposition requires bounded remaining obligations');
  }
  const remaining = value.remainingRequiredBindingDigests.map(item => digest(item, 'Remaining requirement binding')).sort();
  if (new Set(remaining).size !== remaining.length) throw new Error('Remaining requirement bindings must be unique');
  const canonical = deepFreeze({ kind: value.kind as VerificationRequirementDisposition['kind'], baselineBindingDigest: digest(value.baselineBindingDigest, 'Baseline requirement binding'),
    ownerRef: text(value.ownerRef, 'Requirement owner'), priorSource: requirementSource(value.priorSource),
    currentSource: requirementSource(value.currentSource), currentClaim: value.currentClaim,
    obligationScopeDigest: digest(value.obligationScopeDigest, 'Retirement applicability scope'),
    supportedEnvironmentDigest: digest(value.supportedEnvironmentDigest, 'Retirement supported environment'),
    remainingRequiredBindingDigests: remaining, reactivationCondition: text(value.reactivationCondition, 'Requirement reactivation condition') });
  return deepFreeze({ ...canonical, decisionId: sha256(canonical) as `sha256:${string}` });
}

export function parseVerificationRequirementDisposition(input: unknown): VerificationRequirementDisposition {
  const value = readVerificationDataRecord(snapshotVerificationData(input, 'Requirement disposition'), 'Requirement disposition');
  const { decisionId, ...fields } = value;
  const result = createVerificationRequirementDisposition(fields as unknown as Omit<VerificationRequirementDisposition, 'decisionId'>);
  if (decisionId !== result.decisionId) throw new Error('Requirement disposition identity is invalid');
  return result;
}

/** Pure bounded evaluator. Its result is conditional data, never live approval.
 * Requirement ownership is read from the specification, not the test owner. */
export function evaluateVerificationTestRetirement(input: Readonly<{
  responsibility: VerificationTestResponsibility;
  decisions: readonly VerificationRequirementDisposition[];
  currentSourceRevision: string;
}>): Readonly<{ status: 'eligible' | 'blocked'; decisionIds: readonly string[]; blockers: readonly string[]; evaluationDigest: string }> {
  const responsibility = parseVerificationTestResponsibility(input.responsibility);
  const decisions = input.decisions.map(parseVerificationRequirementDisposition);
  const byBinding = new Map(decisions.map(decision => [decision.baselineBindingDigest, decision] as const));
  const blockers = new Set<string>();
  if (byBinding.size !== decisions.length || decisions.length !== responsibility.bindings.length) blockers.add('obligation-set-incomplete-or-duplicate');
  for (const { specification } of responsibility.bindings) {
    const decision = byBinding.get(specification.bindingDigest);
    if (decision === undefined) { blockers.add('obligation-disposition-missing'); continue; }
    const { claim, proofObligation } = specification;
    if (!REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.sourceKinds.some(kind => kind === claim.source.kind)) blockers.add('requirement-source-kind-unsupported');
    if (decision.ownerRef !== claim.ownerRef || decision.ownerRef !== proofObligation.ownerRef
        || decision.currentClaim.ownerRef !== claim.ownerRef) blockers.add('requirement-owner-mismatch');
    if (decision.priorSource.ref !== claim.source.ref || decision.priorSource.revision !== claim.source.revision
        || decision.currentSource.ref !== claim.source.ref
        || decision.currentClaim.source.ref !== decision.currentSource.ref
        || decision.currentClaim.source.revision !== decision.currentSource.revision
        || decision.currentClaim.source.kind !== claim.source.kind) blockers.add('requirement-source-reference-mismatch');
    // Baseline semantic revision is stored before this source snapshot exists.
    // The sealed producer binds the accepted artifact to its physical snapshot.
    if (decision.currentClaim.subjectRevision !== input.currentSourceRevision
        || decision.currentClaim.subjectRef !== claim.subjectRef || decision.currentClaim.claimRef !== claim.claimRef) blockers.add('requirement-subject-mismatch');
    if (decision.obligationScopeDigest !== proofObligation.applicabilityScopeDigest
        || decision.currentClaim.applicabilityScopeDigest !== claim.applicabilityScopeDigest
        || decision.supportedEnvironmentDigest !== proofObligation.environmentAndCapabilityConstraintsDigest) blockers.add('requirement-scope-mismatch');
    if (decision.remainingRequiredBindingDigests.length !== 0) blockers.add('required-obligation-remains');
    if (decision.currentClaim.claimRevision === claim.claimRevision) blockers.add('requirement-claim-revision-not-renewed');
    if (decision.kind === 'retired' && (decision.currentSource.blobSha === decision.priorSource.blobSha
        || decision.currentSource.revision === decision.priorSource.revision
        || decision.currentClaim.claimRevision === claim.claimRevision)) blockers.add('requirement-retirement-not-revised');
  }
  const canonical = deepFreeze({ status: blockers.size === 0 ? 'eligible' as const : 'blocked' as const,
    decisionIds: decisions.map(({ decisionId }) => decisionId).sort(), blockers: [...blockers].sort() });
  return deepFreeze({ ...canonical, evaluationDigest: sha256(canonical) });
}
