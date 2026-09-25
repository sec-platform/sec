import { canonicalJson, compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import { IsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';
import {
  isAgentSkillId,
  type AgentSkillId,
  type SkillApplicabilityEnvelope
} from './skill.ts';
import {
  parseTaskCapsule,
  type TaskCapsuleDigest,
  type TaskCapsule
} from './task-capsule.ts';

export const READ_PLAN_INPUT_SCHEMA = 'sec-operation-read-plan-input-v2' as const;
export const READ_CLOSURE_REQUEST_SCHEMA = 'sec-operation-read-closure-request-v2' as const;
const READ_PLAN_SCHEMA = 'sec-operation-read-plan-v2' as const;
const READ_PLAN_REVISION = 'operation-read-plan-compiler-v2' as const;
const MAINTAINER_MUTATION_POLICY = 'current-physical-state-authoritative-v1' as const;
const PROTECTED_ROOT_POLICY = 'outside-candidate-write-authority-v1' as const;
export const MANDATORY_FORBIDDEN_SOURCES = Object.freeze([
  'assistant-memory',
  'chat-history',
  'full-issue-census',
  'full-skill-corpus',
  'historical-pr-comments',
  'unrelated-issue-census'
] as const);

interface ReadReference {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
  readonly reasonCode: string;
  readonly projection: null;
}

interface ConditionalReadReference extends ReadReference {
  readonly frontierId: string;
}

interface ReadFrontier {
  readonly id: string;
  readonly reasonCode: string;
  readonly allowedRefIds: readonly string[];
}

interface ReadReceipt {
  readonly refId: string;
  readonly owner: string;
  readonly revision: string;
  readonly reasonCode: string;
  readonly contentDigest: TaskCapsuleDigest;
}

interface ReadInvalidationInput {
  readonly id: string;
  readonly revision: string;
}

export interface ReadPlanInput {
  readonly schema: typeof READ_PLAN_INPUT_SCHEMA;
  readonly taskCapsule: TaskCapsule;
  readonly requiredRefs: readonly ReadReference[];
  readonly conditionalRefs: readonly ConditionalReadReference[];
  readonly forbiddenSources: readonly string[];
  readonly maxSkillBodies: 0 | 1;
  readonly unresolvedFrontier: readonly ReadFrontier[];
  readonly readReceipts: readonly ReadReceipt[];
  readonly invalidationInputs: readonly ReadInvalidationInput[];
}

export interface ReadPlan extends Omit<ReadPlanInput, 'schema'> {
  readonly schema: typeof READ_PLAN_SCHEMA;
  readonly compilerRevision: typeof READ_PLAN_REVISION;
  readonly preApplicabilitySkillBodiesRead: 0;
  readonly maintainerMutationPolicy: typeof MAINTAINER_MUTATION_POLICY;
  readonly protectedRootPolicy: typeof PROTECTED_ROOT_POLICY;
  readonly readPlanDigest: TaskCapsuleDigest;
}

export type MaintainerMutationDecision = Readonly<{
  schema: 'sec-maintainer-mutation-decision-v1';
  policy: typeof MAINTAINER_MUTATION_POLICY;
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
const READ_REF_KEYS = ['id', 'ref', 'owner', 'revision', 'reasonCode', 'projection'] as const;
const CONDITIONAL_REF_KEYS = [...READ_REF_KEYS, 'frontierId'] as const;
const FRONTIER_KEYS = ['id', 'reasonCode', 'allowedRefIds'] as const;
const RECEIPT_KEYS = ['refId', 'owner', 'revision', 'reasonCode', 'contentDigest'] as const;
const INVALIDATION_KEYS = ['id', 'revision'] as const;
const CORE_INVALIDATION_IDS = [
  'goal-digest', 'owner-facts', 'scope-proposal', 'scope-grant', 'skill-candidates', 'task-capsule',
  'trusted-revision', 'target-candidate', 'verification-obligations',
  'work-package-projection', 'work-package-proposal'
] as const;

function fail(message: string): never {
  throw new Error(`Operation Read Plan: ${message}`);
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

function digest(value: unknown, label: string): TaskCapsuleDigest {
  const normalized = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) fail(`${label} must be one lowercase SHA-256 digest.`);
  return normalized as TaskCapsuleDigest;
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

function parseReadRefs(value: unknown, conditional: false): ReadReference[];
function parseReadRefs(value: unknown, conditional: true): ConditionalReadReference[];
function parseReadRefs(
  value: unknown,
  conditional: boolean
): ReadReference[] | ConditionalReadReference[] {
  const label = conditional ? 'conditionalRefs' : 'requiredRefs';
  const refs = array(value, label).map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    exactKeys(item, conditional ? CONDITIONAL_REF_KEYS : READ_REF_KEYS, `${label}[${index}]`);
    if (item.projection !== null) fail(`${label}[${index}].projection is unsupported.`);
    const common = {
      id: token(item.id, `${label}[${index}].id`),
      ref: text(item.ref, `${label}[${index}].ref`),
      owner: token(item.owner, `${label}[${index}].owner`),
      revision: text(item.revision, `${label}[${index}].revision`),
      reasonCode: token(item.reasonCode, `${label}[${index}].reasonCode`),
      projection: null
    };
    return conditional
      ? { ...common, frontierId: token(item.frontierId, `${label}[${index}].frontierId`) }
      : common;
  });
  return sortedById(refs, label) as ReadReference[] | ConditionalReadReference[];
}

function parseFrontier(value: unknown): ReadFrontier[] {
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

function compileFromRecord(input: Record<string, unknown>): ReadPlan {
  exactKeys(input, INPUT_KEYS, 'input');
  if (input.schema !== READ_PLAN_INPUT_SCHEMA) fail('input schema is unsupported.');
  const taskCapsule = parseTaskCapsule(input.taskCapsule);
  const planningContext = taskCapsule.planningContext;
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
    if (IsCanonicalRepositoryPath(reference.ref)) {
      if (!planningContext.scopeProposal.readPaths.some(
        (readPath) => scopeCoversRepositoryPath(readPath, reference.ref)
      )) {
        fail(`repository read ref is outside the Capsule read proposal: ${reference.id}.`);
      }
    } else if (!planningContext.scopeProposal.authorizedResources.includes(reference.ref)) {
      fail(`external read ref is not an exact Capsule resource proposal: ${reference.id}.`);
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
  if (maxSkillBodies === 0 && planningContext.skillCandidateIds.length > 0) {
    fail('skillCandidateIds must be empty when maxSkillBodies is zero.');
  }

  const coreInvalidation: ReadInvalidationInput[] = [
    { id: 'goal-digest', revision: planningContext.goalDigest },
    { id: 'owner-facts', revision: sha256(planningContext.ownerFacts) },
    { id: 'scope-proposal', revision: sha256(planningContext.scopeProposal) },
    { id: 'scope-grant', revision: sha256({ scopeGrantId: planningContext.scopeGrantId }) },
    { id: 'skill-candidates', revision: sha256(planningContext.skillCandidateIds) },
    { id: 'task-capsule', revision: taskCapsule.digest },
    { id: 'target-candidate', revision: planningContext.targetCandidate },
    { id: 'trusted-revision', revision: planningContext.trustedRevision },
    { id: 'verification-obligations', revision: sha256(planningContext.verificationObligations) },
    { id: 'work-package-projection', revision: planningContext.workPackageProjectionId },
    { id: 'work-package-proposal', revision: planningContext.workPackageProposalDigest }
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
  for (const mandatory of MANDATORY_FORBIDDEN_SOURCES) {
    if (!forbiddenSources.includes(mandatory)) {
      fail(`forbiddenSources omits mandatory baseline source: ${mandatory}.`);
    }
  }
  const withoutDigest = {
    schema: READ_PLAN_SCHEMA,
    compilerRevision: READ_PLAN_REVISION,
    taskCapsule,
    requiredRefs,
    conditionalRefs,
    forbiddenSources,
    maxSkillBodies: maxSkillBodies as 0 | 1,
    preApplicabilitySkillBodiesRead: 0 as const,
    unresolvedFrontier,
    readReceipts,
    invalidationInputs,
    maintainerMutationPolicy: MAINTAINER_MUTATION_POLICY,
    protectedRootPolicy: PROTECTED_ROOT_POLICY
  };
  return deepFreeze({
    ...withoutDigest,
    readPlanDigest: sha256(withoutDigest) as TaskCapsuleDigest
  });
}

/** Pure projection compiler. It performs no repository, provider, process or filesystem reads. */
export function compileReadPlan(input: unknown): ReadPlan {
  return compileFromRecord(record(input, 'input'));
}

/** Parse a serialized plan and recompute every canonical field and digest. */
export function parseReadPlan(value: unknown): ReadPlan {
  const plan = record(value, 'plan');
  exactKeys(plan, PLAN_KEYS, 'plan');
  if (plan.schema !== READ_PLAN_SCHEMA
      || plan.compilerRevision !== READ_PLAN_REVISION
      || plan.preApplicabilitySkillBodiesRead !== 0
      || plan.maintainerMutationPolicy !== MAINTAINER_MUTATION_POLICY
      || plan.protectedRootPolicy !== PROTECTED_ROOT_POLICY) {
    fail('plan schema, revision, or fixed policy binding is unsupported.');
  }
  const input: ReadPlanInput = {
    schema: READ_PLAN_INPUT_SCHEMA,
    taskCapsule: plan.taskCapsule as TaskCapsule,
    requiredRefs: plan.requiredRefs as readonly ReadReference[],
    conditionalRefs: plan.conditionalRefs as readonly ConditionalReadReference[],
    forbiddenSources: plan.forbiddenSources as readonly string[],
    maxSkillBodies: plan.maxSkillBodies as 0 | 1,
    unresolvedFrontier: plan.unresolvedFrontier as readonly ReadFrontier[],
    readReceipts: plan.readReceipts as readonly ReadReceipt[],
    invalidationInputs: (plan.invalidationInputs as readonly ReadInvalidationInput[])
      .filter((binding) => !(CORE_INVALIDATION_IDS as readonly string[]).includes(binding.id))
  };
  const compiled = compileReadPlan(input);
  if (compiled.readPlanDigest !== plan.readPlanDigest) fail('readPlanDigest mismatch.');
  if (JSON.stringify(canonicalJson(compiled)) !== JSON.stringify(canonicalJson(plan))) {
    fail('plan is not the canonical compiler projection.');
  }
  return compiled;
}

/** Skill metadata projection; the caller must replace changed paths with exact Git observation. */
export function projectSkillEnvelopeFromReadPlan(
  plan: ReadPlan
): SkillApplicabilityEnvelope {
  const verified = parseReadPlan(plan);
  const planningContext = verified.taskCapsule.planningContext;
  const candidates = planningContext.skillCandidateIds.map((candidate) => {
    if (!isAgentSkillId(candidate)) {
      fail(`Task Capsule Skill candidate is not in the trusted Skill registry: ${candidate}.`);
    }
    return candidate;
  }) as AgentSkillId[];
  return deepFreeze({
    role: planningContext.role,
    operationKind: planningContext.operationKind,
    goalDigest: planningContext.goalDigest,
    trustedRevision: planningContext.trustedRevision,
    targetCandidate: planningContext.targetCandidate,
    workPackageProposalRef: planningContext.workPackageProposalRef,
    taskCapsuleRef: verified.taskCapsule.ref,
    taskCapsuleDigest: verified.taskCapsule.digest,
    taskCapsuleRevision: verified.taskCapsule.revision,
    candidates,
    changedPaths: planningContext.scopeProposal.changedPaths
  });
}

/**
 * Pure precedence and eligibility resolver. It never issues effect authority;
 * a separate trusted recovery/CAS executor must verify principal, provenance,
 * resource, preimage/current revision and expiry before any write.
 */
export function resolveMaintainerMutation(
  value: unknown
): MaintainerMutationDecision {
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
    policy: MAINTAINER_MUTATION_POLICY,
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
