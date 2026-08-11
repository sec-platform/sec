import {
  isSecAgentRole,
  isSecAgentSkillId,
  isSecOperationKind,
  type SecAgentRole,
  type SecAgentSkillId,
  type SecOperationKind,
  type SecSkillApplicabilityEnvelopeV1
} from './agent-skill-contract.ts';
import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  sha256
} from './canonical-primitives.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const SEC_OPERATION_READ_PLAN_INPUT_SCHEMA = 'sec-operation-read-plan-input-v1' as const;
export const SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA = 'sec-operation-read-closure-request-v1' as const;
export const SEC_OPERATION_READ_PLAN_SCHEMA = 'sec-operation-read-plan-v1' as const;
export const SEC_OPERATION_READ_PLAN_REVISION = 'operation-read-plan-compiler-v1' as const;
export const SEC_TASK_CAPSULE_AUTHORITY_SCHEMA = 'sec-task-capsule-authority-projection-v1' as const;
export const SEC_TASK_CAPSULE_AUTHORITY_REVISION = 'task-capsule-compiler-v1' as const;
export const SEC_MAINTAINER_MUTATION_POLICY = 'current-physical-state-authoritative-v1' as const;
export const SEC_PROTECTED_ROOT_POLICY = 'outside-candidate-write-authority-v1' as const;
export const SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES = Object.freeze([
  'assistant-memory',
  'chat-history',
  'full-issue-census',
  'full-skill-corpus',
  'historical-pr-comments',
  'unrelated-issue-census'
] as const);

export type SecDigestV1 = `sha256:${string}`;

export interface SecTaskCapsuleAuthorityV1 {
  readonly operationId: string;
  readonly role: SecAgentRole;
  readonly operationKind: SecOperationKind;
  readonly goalDigest: SecDigestV1;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly workPackageAuthorizationRef: string;
  readonly workPackageAuthorizationDigest: SecDigestV1;
  readonly ownerFacts: readonly SecAgentOwnerFactV1[];
  readonly scope: SecAgentOperationScopeV1;
  readonly verificationObligations: readonly SecAgentVerificationObligationV1[];
  readonly skillCandidateIds: readonly SecAgentSkillId[];
}

/**
 * Content-addressed projection issued by the upstream #205 Task Capsule owner.
 * This contract verifies integrity only; trusted execution provenance and live
 * repository facts are verified by the consuming adapter.
 */
export interface SecTaskCapsuleBindingV1 {
  readonly schema: typeof SEC_TASK_CAPSULE_AUTHORITY_SCHEMA;
  readonly ref: string;
  readonly revision: typeof SEC_TASK_CAPSULE_AUTHORITY_REVISION;
  readonly authority: SecTaskCapsuleAuthorityV1;
  readonly digest: SecDigestV1;
}

export interface SecOperationReadReferenceV1 {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
  readonly reasonCode: string;
}

export interface SecConditionalReadReferenceV1 extends SecOperationReadReferenceV1 {
  readonly frontierId: string;
}

export interface SecOperationReadFrontierV1 {
  readonly id: string;
  readonly reasonCode: string;
  readonly allowedRefIds: readonly string[];
}

export interface SecOperationReadReceiptV1 {
  readonly refId: string;
  readonly owner: string;
  readonly revision: string;
  readonly reasonCode: string;
  readonly contentDigest: SecDigestV1;
}

export interface SecOperationInvalidationInputV1 {
  readonly id: string;
  readonly revision: string;
}

export interface SecAgentOwnerFactV1 {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
}

export interface SecAgentOperationScopeV1 {
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly forbiddenPaths: readonly string[];
  readonly availableCapabilities: readonly string[];
  readonly authorizedResources: readonly string[];
  readonly authorizedGates: readonly string[];
  readonly changedPaths: readonly string[];
}

export interface SecAgentVerificationObligationV1 {
  readonly id: string;
  readonly revision: string;
  readonly reasonCode: string;
}

export interface SecOperationReadPlanInputV1 {
  readonly schema: typeof SEC_OPERATION_READ_PLAN_INPUT_SCHEMA;
  readonly taskCapsule: SecTaskCapsuleBindingV1;
  readonly requiredRefs: readonly SecOperationReadReferenceV1[];
  readonly conditionalRefs: readonly SecConditionalReadReferenceV1[];
  readonly forbiddenSources: readonly string[];
  readonly maxSkillBodies: 0 | 1;
  readonly unresolvedFrontier: readonly SecOperationReadFrontierV1[];
  readonly readReceipts: readonly SecOperationReadReceiptV1[];
  readonly invalidationInputs: readonly SecOperationInvalidationInputV1[];
}

/** Authority-free request. The trusted adapter derives the entire read closure. */
export interface SecOperationReadClosureRequestV1 {
  readonly schema: typeof SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA;
}

export interface SecOperationReadPlanV1 extends Omit<SecOperationReadPlanInputV1, 'schema'> {
  readonly schema: typeof SEC_OPERATION_READ_PLAN_SCHEMA;
  readonly compilerRevision: typeof SEC_OPERATION_READ_PLAN_REVISION;
  readonly preApplicabilitySkillBodiesRead: 0;
  readonly maintainerMutationPolicy: typeof SEC_MAINTAINER_MUTATION_POLICY;
  readonly protectedRootPolicy: typeof SEC_PROTECTED_ROOT_POLICY;
  readonly readPlanDigest: SecDigestV1;
}

export type SecMaintainerMutationResourceKind =
  | 'protected-interactive-root'
  | 'operation-owned-worktree'
  | 'external-worktree';
export type SecMaintainerMutationRestoreAuthority =
  | 'none'
  | 'explicit-user-request-claimed'
  | 'own-unauthorized-mutation-rollback-claimed'
  | 'operation-owned-cas-claimed';
export interface SecMaintainerMutationInputV1 {
  readonly resourceKind: SecMaintainerMutationResourceKind;
  readonly snapshotRevision: string;
  readonly currentRevision: string;
  readonly conflictsWithOperation: boolean;
  readonly restoreAuthority: SecMaintainerMutationRestoreAuthority;
  readonly casPrecondition: 'matched' | 'mismatched' | 'not-applicable';
}
export type SecMaintainerMutationDecisionV1 = Readonly<{
  schema: 'sec-maintainer-mutation-decision-v1';
  policy: typeof SEC_MAINTAINER_MUTATION_POLICY;
  status:
    | 'unchanged'
    | 'accept-current'
    | 'external-maintainer-mutation'
    | 'recovery-authority-required'
    | 'operation-owned-cas-eligible';
  authoritativeRevision: string;
  oldObservationStale: boolean;
  effectDisposition: 'no-effect' | 'separate-verified-executor-required';
  reasonCode: string;
}>;

const INPUT_KEYS = [
  'schema', 'taskCapsule', 'requiredRefs', 'conditionalRefs', 'forbiddenSources',
  'maxSkillBodies', 'unresolvedFrontier', 'readReceipts', 'invalidationInputs'
] as const;
const PLAN_KEYS = [
  ...INPUT_KEYS.filter((key) => key !== 'schema'), 'schema', 'compilerRevision',
  'preApplicabilitySkillBodiesRead', 'maintainerMutationPolicy', 'protectedRootPolicy',
  'readPlanDigest'
] as const;
const CAPSULE_KEYS = ['schema', 'ref', 'revision', 'authority', 'digest'] as const;
const CAPSULE_AUTHORITY_KEYS = [
  'operationId', 'role', 'operationKind', 'goalDigest', 'trustedRevision',
  'targetCandidate', 'workPackageAuthorizationRef', 'workPackageAuthorizationDigest',
  'ownerFacts', 'scope', 'verificationObligations', 'skillCandidateIds'
] as const;
const OWNER_FACT_KEYS = ['id', 'ref', 'owner', 'revision'] as const;
const SCOPE_KEYS = [
  'readPaths', 'writePaths', 'forbiddenPaths', 'availableCapabilities',
  'authorizedResources', 'authorizedGates', 'changedPaths'
] as const;
const VERIFICATION_KEYS = ['id', 'revision', 'reasonCode'] as const;
const READ_REF_KEYS = ['id', 'ref', 'owner', 'revision', 'reasonCode'] as const;
const CONDITIONAL_REF_KEYS = [...READ_REF_KEYS, 'frontierId'] as const;
const FRONTIER_KEYS = ['id', 'reasonCode', 'allowedRefIds'] as const;
const RECEIPT_KEYS = ['refId', 'owner', 'revision', 'reasonCode', 'contentDigest'] as const;
const INVALIDATION_KEYS = ['id', 'revision'] as const;
const CORE_INVALIDATION_IDS = [
  'goal-digest', 'owner-facts', 'scope', 'skill-candidates', 'task-capsule',
  'trusted-revision', 'target-candidate', 'verification-obligations',
  'work-package-authorization'
] as const;

function fail(message: string): never {
  throw new Error(`Operation Read Plan V1: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be one object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exact; received ${actual.join(',')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    fail(`${label} must be one non-empty string.`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(normalized)) fail(`${label} must be one canonical token.`);
  return normalized;
}

function digest(value: unknown, label: string): SecDigestV1 {
  const normalized = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) fail(`${label} must be one lowercase SHA-256 digest.`);
  return normalized as SecDigestV1;
}

function gitRevision(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[0-9a-f]{40,64}$/u.test(normalized)) fail(`${label} must be one exact lowercase Git object ID.`);
  return normalized;
}

function repositoryScope(value: unknown, label: string): string {
  const normalized = text(value, label);
  const exact = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(exact)) {
    fail(`${label} must be one canonical repository path or directory prefix.`);
  }
  return normalized;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be one array.`);
  return value;
}

function sortedUniqueStrings(
  value: unknown,
  label: string,
  parse: (entry: unknown, entryLabel: string) => string = token
): string[] {
  const parsed = array(value, label).map((entry, index) => parse(entry, `${label}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail(`${label} contains a duplicate.`);
  return [...parsed].sort(compareCodeUnits);
}

function sortedById<Value extends { readonly id: string }>(values: readonly Value[], label: string): Value[] {
  if (new Set(values.map((value) => value.id)).size !== values.length) fail(`${label} contains a duplicate id.`);
  return [...values].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function parseTaskCapsule(value: unknown): SecTaskCapsuleBindingV1 {
  const item = record(value, 'taskCapsule');
  exactKeys(item, CAPSULE_KEYS, 'taskCapsule');
  if (item.schema !== SEC_TASK_CAPSULE_AUTHORITY_SCHEMA
      || item.revision !== SEC_TASK_CAPSULE_AUTHORITY_REVISION) {
    fail('taskCapsule schema or compiler revision is unsupported.');
  }
  const rawAuthority = record(item.authority, 'taskCapsule.authority');
  exactKeys(rawAuthority, CAPSULE_AUTHORITY_KEYS, 'taskCapsule.authority');
  if (!isSecAgentRole(rawAuthority.role)) fail('taskCapsule.authority.role is unsupported.');
  if (!isSecOperationKind(rawAuthority.operationKind)) {
    fail('taskCapsule.authority.operationKind is unsupported.');
  }
  const rawSkillIds = array(rawAuthority.skillCandidateIds, 'taskCapsule.authority.skillCandidateIds');
  const skillCandidateIds = rawSkillIds.map((candidate, index) => {
    if (!isSecAgentSkillId(candidate)) {
      fail(`taskCapsule.authority.skillCandidateIds[${index}] is not registered.`);
    }
    return candidate;
  }).sort(compareCodeUnits);
  if (new Set(skillCandidateIds).size !== skillCandidateIds.length) {
    fail('taskCapsule.authority.skillCandidateIds contains a duplicate.');
  }
  const authority: SecTaskCapsuleAuthorityV1 = {
    operationId: token(rawAuthority.operationId, 'taskCapsule.authority.operationId'),
    role: rawAuthority.role,
    operationKind: rawAuthority.operationKind,
    goalDigest: digest(rawAuthority.goalDigest, 'taskCapsule.authority.goalDigest'),
    trustedRevision: gitRevision(rawAuthority.trustedRevision, 'taskCapsule.authority.trustedRevision'),
    targetCandidate: gitRevision(rawAuthority.targetCandidate, 'taskCapsule.authority.targetCandidate'),
    workPackageAuthorizationRef: repositoryScope(
      rawAuthority.workPackageAuthorizationRef,
      'taskCapsule.authority.workPackageAuthorizationRef'
    ),
    workPackageAuthorizationDigest: digest(
      rawAuthority.workPackageAuthorizationDigest,
      'taskCapsule.authority.workPackageAuthorizationDigest'
    ),
    ownerFacts: parseOwnerFacts(rawAuthority.ownerFacts),
    scope: parseScope(rawAuthority.scope),
    verificationObligations: parseVerification(rawAuthority.verificationObligations),
    skillCandidateIds
  };
  const withoutDigest = {
    schema: SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
    ref: text(item.ref, 'taskCapsule.ref'),
    revision: SEC_TASK_CAPSULE_AUTHORITY_REVISION,
    authority
  };
  const observedDigest = digest(item.digest, 'taskCapsule.digest');
  if (sha256(withoutDigest) !== observedDigest) {
    fail('taskCapsule digest does not bind its complete authority projection.');
  }
  return deepFreeze({ ...withoutDigest, digest: observedDigest });
}

function parseOwnerFacts(value: unknown): SecAgentOwnerFactV1[] {
  const facts = array(value, 'ownerFacts').map((entry, index) => {
    const item = record(entry, `ownerFacts[${index}]`);
    exactKeys(item, OWNER_FACT_KEYS, `ownerFacts[${index}]`);
    return {
      id: token(item.id, `ownerFacts[${index}].id`),
      ref: text(item.ref, `ownerFacts[${index}].ref`),
      owner: token(item.owner, `ownerFacts[${index}].owner`),
      revision: text(item.revision, `ownerFacts[${index}].revision`)
    };
  });
  if (facts.length === 0) fail('ownerFacts must bind at least one canonical owner.');
  return sortedById(facts, 'ownerFacts');
}

function parseScope(value: unknown): SecAgentOperationScopeV1 {
  const item = record(value, 'scope');
  exactKeys(item, SCOPE_KEYS, 'scope');
  const writePaths = sortedUniqueStrings(item.writePaths, 'scope.writePaths', repositoryScope);
  const forbiddenPaths = sortedUniqueStrings(item.forbiddenPaths, 'scope.forbiddenPaths', repositoryScope);
  const overlaps = (left: string, right: string): boolean => {
    const leftExact = left.endsWith('/') ? left.slice(0, -1) : left;
    const rightExact = right.endsWith('/') ? right.slice(0, -1) : right;
    return leftExact === rightExact
      || (left.endsWith('/') && rightExact.startsWith(`${leftExact}/`))
      || (right.endsWith('/') && leftExact.startsWith(`${rightExact}/`));
  };
  for (const writePath of writePaths) {
    if (forbiddenPaths.some((forbidden) => overlaps(writePath, forbidden))) {
      fail(`scope.writePaths overlaps forbidden path ${writePath}.`);
    }
  }
  const changedPaths = sortedUniqueStrings(item.changedPaths, 'scope.changedPaths', repositoryScope);
  const covers = (scope: string, changedPath: string): boolean => {
    const exact = scope.endsWith('/') ? scope.slice(0, -1) : scope;
    return changedPath === exact || (scope.endsWith('/') && changedPath.startsWith(`${exact}/`));
  };
  for (const changedPath of changedPaths) {
    if (!writePaths.some((writePath) => covers(writePath, changedPath))) {
      fail(`scope.changedPaths is outside every authorized write path: ${changedPath}.`);
    }
    if (forbiddenPaths.some((forbiddenPath) => covers(forbiddenPath, changedPath))) {
      fail(`scope.changedPaths enters forbidden scope: ${changedPath}.`);
    }
  }
  return {
    readPaths: sortedUniqueStrings(item.readPaths, 'scope.readPaths', repositoryScope),
    writePaths,
    forbiddenPaths,
    availableCapabilities: sortedUniqueStrings(item.availableCapabilities, 'scope.availableCapabilities'),
    authorizedResources: sortedUniqueStrings(item.authorizedResources, 'scope.authorizedResources'),
    authorizedGates: sortedUniqueStrings(item.authorizedGates, 'scope.authorizedGates'),
    changedPaths
  };
}

function parseVerification(value: unknown): SecAgentVerificationObligationV1[] {
  return sortedById(array(value, 'verificationObligations').map((entry, index) => {
    const item = record(entry, `verificationObligations[${index}]`);
    exactKeys(item, VERIFICATION_KEYS, `verificationObligations[${index}]`);
    return {
      id: token(item.id, `verificationObligations[${index}].id`),
      revision: text(item.revision, `verificationObligations[${index}].revision`),
      reasonCode: token(item.reasonCode, `verificationObligations[${index}].reasonCode`)
    };
  }), 'verificationObligations');
}

function parseReadRefs(value: unknown, conditional: false): SecOperationReadReferenceV1[];
function parseReadRefs(value: unknown, conditional: true): SecConditionalReadReferenceV1[];
function parseReadRefs(
  value: unknown,
  conditional: boolean
): SecOperationReadReferenceV1[] | SecConditionalReadReferenceV1[] {
  const label = conditional ? 'conditionalRefs' : 'requiredRefs';
  const refs = array(value, label).map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    exactKeys(item, conditional ? CONDITIONAL_REF_KEYS : READ_REF_KEYS, `${label}[${index}]`);
    const common = {
      id: token(item.id, `${label}[${index}].id`),
      ref: text(item.ref, `${label}[${index}].ref`),
      owner: token(item.owner, `${label}[${index}].owner`),
      revision: text(item.revision, `${label}[${index}].revision`),
      reasonCode: token(item.reasonCode, `${label}[${index}].reasonCode`)
    };
    return conditional
      ? { ...common, frontierId: token(item.frontierId, `${label}[${index}].frontierId`) }
      : common;
  });
  return sortedById(refs, label) as SecOperationReadReferenceV1[] | SecConditionalReadReferenceV1[];
}

function parseFrontier(value: unknown): SecOperationReadFrontierV1[] {
  return sortedById(array(value, 'unresolvedFrontier').map((entry, index) => {
    const item = record(entry, `unresolvedFrontier[${index}]`);
    exactKeys(item, FRONTIER_KEYS, `unresolvedFrontier[${index}]`);
    const allowedRefIds = sortedUniqueStrings(item.allowedRefIds, `unresolvedFrontier[${index}].allowedRefIds`);
    if (allowedRefIds.length === 0) fail('each unresolved frontier must allow at least one conditional ref.');
    return {
      id: token(item.id, `unresolvedFrontier[${index}].id`),
      reasonCode: token(item.reasonCode, `unresolvedFrontier[${index}].reasonCode`),
      allowedRefIds
    };
  }), 'unresolvedFrontier');
}

function scopeCoversRepositoryPath(scope: string, repositoryPath: string): boolean {
  const exact = scope.endsWith('/') ? scope.slice(0, -1) : scope;
  return repositoryPath === exact || (scope.endsWith('/') && repositoryPath.startsWith(`${exact}/`));
}

function compileFromRecord(input: Record<string, unknown>): SecOperationReadPlanV1 {
  exactKeys(input, INPUT_KEYS, 'input');
  if (input.schema !== SEC_OPERATION_READ_PLAN_INPUT_SCHEMA) fail('input schema is unsupported.');
  const taskCapsule = parseTaskCapsule(input.taskCapsule);
  const authority = taskCapsule.authority;
  const requiredRefs = parseReadRefs(input.requiredRefs, false);
  const conditionalRefs = parseReadRefs(input.conditionalRefs, true);
  if (requiredRefs.length === 0) fail('requiredRefs must bind at least one exact owner ref.');

  const allRefs = [...requiredRefs, ...conditionalRefs];
  if (new Set(allRefs.map((reference) => reference.id)).size !== allRefs.length) {
    fail('requiredRefs and conditionalRefs contain a duplicate id.');
  }
  if (new Set(allRefs.map((reference) => reference.ref)).size !== allRefs.length) {
    fail('each source ref may occur only once per operation context.');
  }
  for (const reference of allRefs) {
    if (CodexDevelopmentIsCanonicalRepositoryPathV1(reference.ref)) {
      if (!authority.scope.readPaths.some((readPath) => scopeCoversRepositoryPath(readPath, reference.ref))) {
        fail(`repository read ref is outside the trusted Capsule read scope: ${reference.id}.`);
      }
    } else if (!authority.scope.authorizedResources.includes(reference.ref)) {
      fail(`external read ref is not an exact trusted Capsule resource: ${reference.id}.`);
    }
  }
  const unresolvedFrontier = parseFrontier(input.unresolvedFrontier);
  const frontierById = new Map(unresolvedFrontier.map((frontier) => [frontier.id, frontier]));
  for (const reference of conditionalRefs) {
    const frontier = frontierById.get(reference.frontierId);
    if (frontier === undefined || !frontier.allowedRefIds.includes(reference.id)) {
      fail(`conditional ref ${reference.id} is not admitted by frontier ${reference.frontierId}.`);
    }
  }
  for (const frontier of unresolvedFrontier) {
    for (const refId of frontier.allowedRefIds) {
      const reference = conditionalRefs.find((candidate) => candidate.id === refId);
      if (reference === undefined || reference.frontierId !== frontier.id) {
        fail(`frontier ${frontier.id} admits a ref that is not bound back to it.`);
      }
    }
  }

  const readReceipts = array(input.readReceipts, 'readReceipts').map((entry, index) => {
    const item = record(entry, `readReceipts[${index}]`);
    exactKeys(item, RECEIPT_KEYS, `readReceipts[${index}]`);
    const refId = token(item.refId, `readReceipts[${index}].refId`);
    const planned = allRefs.find((reference) => reference.id === refId);
    const owner = token(item.owner, `readReceipts[${index}].owner`);
    const revision = text(item.revision, `readReceipts[${index}].revision`);
    const reasonCode = token(item.reasonCode, `readReceipts[${index}].reasonCode`);
    if (planned === undefined || planned.owner !== owner || planned.revision !== revision
        || planned.reasonCode !== reasonCode) {
      fail(`read receipt ${refId} does not bind the planned owner, revision, and reason.`);
    }
    return {
      refId,
      owner,
      revision,
      reasonCode,
      contentDigest: digest(item.contentDigest, `readReceipts[${index}].contentDigest`)
    };
  }).sort((left, right) => compareCodeUnits(left.refId, right.refId));
  if (new Set(readReceipts.map((receipt) => receipt.refId)).size !== readReceipts.length) {
    fail('readReceipts contains a duplicate refId.');
  }

  const maxSkillBodies = input.maxSkillBodies;
  if (maxSkillBodies !== 0 && maxSkillBodies !== 1) fail('maxSkillBodies must be zero or one.');
  if (maxSkillBodies === 0 && authority.skillCandidateIds.length > 0) {
    fail('skillCandidateIds must be empty when maxSkillBodies is zero.');
  }

  const coreInvalidation: SecOperationInvalidationInputV1[] = [
    { id: 'goal-digest', revision: authority.goalDigest },
    { id: 'owner-facts', revision: sha256(authority.ownerFacts) },
    { id: 'scope', revision: sha256(authority.scope) },
    { id: 'skill-candidates', revision: sha256(authority.skillCandidateIds) },
    { id: 'task-capsule', revision: taskCapsule.digest },
    { id: 'target-candidate', revision: authority.targetCandidate },
    { id: 'trusted-revision', revision: authority.trustedRevision },
    { id: 'verification-obligations', revision: sha256(authority.verificationObligations) },
    { id: 'work-package-authorization', revision: authority.workPackageAuthorizationDigest }
  ];
  const additionalInvalidation = sortedById(array(input.invalidationInputs, 'invalidationInputs')
    .map((entry, index) => {
      const item = record(entry, `invalidationInputs[${index}]`);
      exactKeys(item, INVALIDATION_KEYS, `invalidationInputs[${index}]`);
      return {
        id: token(item.id, `invalidationInputs[${index}].id`),
        revision: text(item.revision, `invalidationInputs[${index}].revision`)
      };
    }), 'invalidationInputs');
  if (additionalInvalidation.some((binding) => (CORE_INVALIDATION_IDS as readonly string[]).includes(binding.id))) {
    fail('invalidationInputs cannot override compiler-owned core bindings.');
  }
  const invalidationInputs = sortedById(
    [...coreInvalidation, ...additionalInvalidation],
    'invalidationInputs'
  );

  const forbiddenSources = sortedUniqueStrings(input.forbiddenSources, 'forbiddenSources');
  for (const mandatory of SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES) {
    if (!forbiddenSources.includes(mandatory)) {
      fail(`forbiddenSources omits mandatory baseline source: ${mandatory}.`);
    }
  }
  const withoutDigest = {
    schema: SEC_OPERATION_READ_PLAN_SCHEMA,
    compilerRevision: SEC_OPERATION_READ_PLAN_REVISION,
    taskCapsule,
    requiredRefs,
    conditionalRefs,
    forbiddenSources,
    maxSkillBodies: maxSkillBodies as 0 | 1,
    preApplicabilitySkillBodiesRead: 0 as const,
    unresolvedFrontier,
    readReceipts,
    invalidationInputs,
    maintainerMutationPolicy: SEC_MAINTAINER_MUTATION_POLICY,
    protectedRootPolicy: SEC_PROTECTED_ROOT_POLICY
  };
  return deepFreeze({
    ...withoutDigest,
    readPlanDigest: sha256(withoutDigest) as SecDigestV1
  });
}

/** Pure projection compiler. It performs no repository, provider, process or filesystem reads. */
export function compileSecOperationReadPlanV1(input: unknown): SecOperationReadPlanV1 {
  return compileFromRecord(record(input, 'input'));
}

/** Parse a serialized plan and recompute every canonical field and digest. */
export function parseSecOperationReadPlanV1(value: unknown): SecOperationReadPlanV1 {
  const plan = record(value, 'plan');
  exactKeys(plan, PLAN_KEYS, 'plan');
  if (plan.schema !== SEC_OPERATION_READ_PLAN_SCHEMA
      || plan.compilerRevision !== SEC_OPERATION_READ_PLAN_REVISION
      || plan.preApplicabilitySkillBodiesRead !== 0
      || plan.maintainerMutationPolicy !== SEC_MAINTAINER_MUTATION_POLICY
      || plan.protectedRootPolicy !== SEC_PROTECTED_ROOT_POLICY) {
    fail('plan schema, revision, or fixed policy binding is unsupported.');
  }
  const input: SecOperationReadPlanInputV1 = {
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: plan.taskCapsule as SecTaskCapsuleBindingV1,
    requiredRefs: plan.requiredRefs as readonly SecOperationReadReferenceV1[],
    conditionalRefs: plan.conditionalRefs as readonly SecConditionalReadReferenceV1[],
    forbiddenSources: plan.forbiddenSources as readonly string[],
    maxSkillBodies: plan.maxSkillBodies as 0 | 1,
    unresolvedFrontier: plan.unresolvedFrontier as readonly SecOperationReadFrontierV1[],
    readReceipts: plan.readReceipts as readonly SecOperationReadReceiptV1[],
    invalidationInputs: (plan.invalidationInputs as readonly SecOperationInvalidationInputV1[])
      .filter((binding) => !(CORE_INVALIDATION_IDS as readonly string[]).includes(binding.id))
  };
  const compiled = compileSecOperationReadPlanV1(input);
  if (compiled.readPlanDigest !== plan.readPlanDigest) fail('readPlanDigest mismatch.');
  if (JSON.stringify(canonicalJson(compiled)) !== JSON.stringify(canonicalJson(plan))) {
    fail('plan is not the canonical compiler projection.');
  }
  return compiled;
}

/** Skill metadata projection; the caller must replace changed paths with exact Git observation. */
export function projectSecSkillEnvelopeFromOperationReadPlanV1(
  plan: SecOperationReadPlanV1
): SecSkillApplicabilityEnvelopeV1 {
  const verified = parseSecOperationReadPlanV1(plan);
  const authority = verified.taskCapsule.authority;
  return deepFreeze({
    role: authority.role,
    operationKind: authority.operationKind,
    goalDigest: authority.goalDigest,
    trustedRevision: authority.trustedRevision,
    targetCandidate: authority.targetCandidate,
    workPackageAuthorizationRef: authority.workPackageAuthorizationRef,
    taskCapsuleRef: verified.taskCapsule.ref,
    taskCapsuleDigest: verified.taskCapsule.digest,
    taskCapsuleRevision: verified.taskCapsule.revision,
    candidates: authority.skillCandidateIds,
    availableCapabilities: authority.scope.availableCapabilities,
    authorizedResources: authority.scope.authorizedResources,
    authorizedGates: authority.scope.authorizedGates,
    authorizedWritePaths: authority.scope.writePaths,
    forbiddenPaths: authority.scope.forbiddenPaths,
    changedPaths: authority.scope.changedPaths
  });
}

/**
 * Pure precedence and eligibility resolver. It never issues effect authority;
 * a separate trusted recovery/CAS executor must verify principal, provenance,
 * resource, preimage/current revision and expiry before any write.
 */
export function resolveSecMaintainerMutationV1(
  value: unknown
): SecMaintainerMutationDecisionV1 {
  const input = record(value, 'maintainerMutation');
  exactKeys(input, [
    'resourceKind', 'snapshotRevision', 'currentRevision', 'conflictsWithOperation',
    'restoreAuthority', 'casPrecondition'
  ], 'maintainerMutation');
  if (input.resourceKind !== 'protected-interactive-root'
      && input.resourceKind !== 'operation-owned-worktree'
      && input.resourceKind !== 'external-worktree') {
    fail('maintainerMutation.resourceKind is unsupported.');
  }
  if (input.restoreAuthority !== 'none'
      && input.restoreAuthority !== 'explicit-user-request-claimed'
      && input.restoreAuthority !== 'own-unauthorized-mutation-rollback-claimed'
      && input.restoreAuthority !== 'operation-owned-cas-claimed') {
    fail('maintainerMutation.restoreAuthority is unsupported.');
  }
  if (input.casPrecondition !== 'matched'
      && input.casPrecondition !== 'mismatched'
      && input.casPrecondition !== 'not-applicable') {
    fail('maintainerMutation.casPrecondition is unsupported.');
  }
  if (typeof input.conflictsWithOperation !== 'boolean') {
    fail('maintainerMutation.conflictsWithOperation must be boolean.');
  }
  const authoritativeRevision = text(input.currentRevision, 'currentRevision');
  const snapshotRevision = text(input.snapshotRevision, 'snapshotRevision');
  const base = {
    schema: 'sec-maintainer-mutation-decision-v1' as const,
    policy: SEC_MAINTAINER_MUTATION_POLICY,
    authoritativeRevision
  };
  if (snapshotRevision === authoritativeRevision) {
    return Object.freeze({
      ...base,
      status: 'unchanged',
      oldObservationStale: false,
      effectDisposition: 'no-effect',
      reasonCode: 'same-physical-revision'
    });
  }
  if (input.resourceKind === 'protected-interactive-root' && input.restoreAuthority !== 'none') {
    return Object.freeze({
      ...base,
      status: 'external-maintainer-mutation',
      oldObservationStale: true,
      effectDisposition: 'separate-verified-executor-required',
      reasonCode: 'protected-root-outside-candidate-authority'
    });
  }
  if (input.restoreAuthority === 'explicit-user-request-claimed'
      || input.restoreAuthority === 'own-unauthorized-mutation-rollback-claimed') {
    return Object.freeze({
      ...base,
      status: 'recovery-authority-required',
      oldObservationStale: true,
      effectDisposition: 'separate-verified-executor-required',
      reasonCode: input.restoreAuthority === 'explicit-user-request-claimed'
        ? 'verify-explicit-user-recovery-authority'
        : 'verify-own-unauthorized-mutation-receipt'
    });
  }
  if (input.restoreAuthority === 'operation-owned-cas-claimed') {
    const legal = input.resourceKind === 'operation-owned-worktree'
      && input.casPrecondition === 'matched';
    return Object.freeze({
      ...base,
      status: legal ? 'operation-owned-cas-eligible' : 'external-maintainer-mutation',
      oldObservationStale: true,
      effectDisposition: legal ? 'separate-verified-executor-required' : 'no-effect',
      reasonCode: legal
        ? 'verify-operation-owned-cas-authority'
        : 'operation-owned-cas-not-proven'
    });
  }
  return Object.freeze({
    ...base,
    status: input.conflictsWithOperation ? 'external-maintainer-mutation' : 'accept-current',
    oldObservationStale: true,
    effectDisposition: 'no-effect',
    reasonCode: input.conflictsWithOperation
      ? 'current-physical-state-conflicts'
      : 'current-physical-state-accepted'
  });
}
