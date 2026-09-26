import { compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import { IsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';

export const TASK_CAPSULE_COMPILE_REQUEST_SCHEMA =
  'sec-task-capsule-compile-request-v2' as const;
export const TASK_CAPSULE_INPUT_SCHEMA = 'sec-task-capsule-input-v2' as const;
const TASK_CAPSULE_SCHEMA = 'sec-task-capsule-v2' as const;
export const TASK_CAPSULE_REVISION = 'task-capsule-compiler-v2' as const;
export const TASK_CAPSULE_AUTHORITY_STATUS = 'unbound-planning-content' as const;

/** Operation vocabulary is upstream execution identity, not Skill-owned guidance. */
const AGENT_ROLES = [
  'a0',
  'worker',
  'reviewer',
  'auditor',
  'maintainer'
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

const OPERATION_KINDS = [
  'orient',
  'audit',
  'diagnose',
  'design',
  'implement',
  'review',
  'integrate',
  'govern',
  'no-change'
] as const;

export type TaskOperationKind = (typeof OPERATION_KINDS)[number];

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value);
}

export function isTaskOperationKind(value: unknown): value is TaskOperationKind {
  return typeof value === 'string' && (OPERATION_KINDS as readonly string[]).includes(value);
}

export type TaskCapsuleDigest = `sha256:${string}`;

interface AgentOwnerFact {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
}

interface AgentOperationScopeProposal {
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly forbiddenPaths: readonly string[];
  readonly authorizedResources: readonly string[];
  readonly authorizedGates: readonly string[];
  readonly changedPaths: readonly string[];
}

interface AgentVerificationObligation {
  readonly id: string;
  readonly revision: string;
  readonly reasonCode: string;
}

export interface TaskCapsulePlanningContext {
  readonly operationId: string;
  readonly role: AgentRole;
  readonly operationKind: TaskOperationKind;
  readonly goalDigest: TaskCapsuleDigest;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly workPackageProposalRef: string;
  readonly workPackageProposalDigest: TaskCapsuleDigest;
  readonly workPackageProjectionId: TaskCapsuleDigest;
  readonly scopeGrantId: null;
  readonly ownerFacts: readonly AgentOwnerFact[];
  readonly scopeProposal: AgentOperationScopeProposal;
  readonly verificationObligations: readonly AgentVerificationObligation[];
  readonly skillCandidateIds: readonly string[];
}

export interface TaskCapsuleInput {
  readonly schema: typeof TASK_CAPSULE_INPUT_SCHEMA;
  readonly ref: string;
  readonly planningContext: TaskCapsulePlanningContext;
}

/**
 * Immutable Phase-A Task Capsule. The compiler owns these bytes and their
 * identity; downstream Read Plan, Skill, Session and Review consumers may
 * reference the capsule but may not reconstruct a parallel content owner.
 */
export interface TaskCapsule {
  readonly schema: typeof TASK_CAPSULE_SCHEMA;
  readonly ref: string;
  readonly revision: typeof TASK_CAPSULE_REVISION;
  /** Content is not issuer-bound until a separate trusted adapter supplies live provenance. */
  readonly authorityStatus: typeof TASK_CAPSULE_AUTHORITY_STATUS;
  /** Capsule is immutable planning input; an effect executor still needs separate live permission. */
  readonly effectAuthority: 'none';
  readonly planningContext: TaskCapsulePlanningContext;
  readonly digest: TaskCapsuleDigest;
}

const INPUT_KEYS = ['schema', 'ref', 'planningContext'] as const;
const CAPSULE_KEYS = [
  'schema', 'ref', 'revision', 'authorityStatus', 'effectAuthority', 'planningContext', 'digest'
] as const;
const PLANNING_CONTEXT_KEYS = [
  'operationId', 'role', 'operationKind', 'goalDigest', 'trustedRevision',
  'targetCandidate', 'workPackageProposalRef', 'workPackageProposalDigest',
  'workPackageProjectionId', 'scopeGrantId',
  'ownerFacts', 'scopeProposal', 'verificationObligations', 'skillCandidateIds'
] as const;
const OWNER_FACT_KEYS = ['id', 'ref', 'owner', 'revision'] as const;
const SCOPE_KEYS = [
  'readPaths', 'writePaths', 'forbiddenPaths',
  'authorizedResources', 'authorizedGates', 'changedPaths'
] as const;
const VERIFICATION_KEYS = ['id', 'revision', 'reasonCode'] as const;

function fail(message: string): never {
  throw new Error(`Task Capsule: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
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
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(normalized)) {
    fail(`${label} must be one canonical token.`);
  }
  return normalized;
}

function digest(value: unknown, label: string): TaskCapsuleDigest {
  const normalized = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    fail(`${label} must be one lowercase SHA-256 digest.`);
  }
  return normalized as TaskCapsuleDigest;
}

function gitRevision(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[0-9a-f]{40,64}$/u.test(normalized)) {
    fail(`${label} must be one exact lowercase Git object ID.`);
  }
  return normalized;
}

function repositoryScope(value: unknown, label: string): string {
  const normalized = text(value, label);
  const exact = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (!IsCanonicalRepositoryPath(exact)) {
    fail(`${label} must be one canonical repository path or directory prefix.`);
  }
  return normalized;
}

function repositoryPath(value: unknown, label: string): string {
  const normalized = repositoryScope(value, label);
  if (normalized.endsWith('/')) fail(`${label} must be one exact repository path.`);
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

function sortedById<Value extends { readonly id: string }>(
  values: readonly Value[],
  label: string
): Value[] {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    fail(`${label} contains a duplicate id.`);
  }
  return [...values].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function parseOwnerFacts(value: unknown): AgentOwnerFact[] {
  const facts = array(value, 'planningContext.ownerFacts').map((entry, index) => {
    const item = record(entry, `planningContext.ownerFacts[${index}]`);
    exactKeys(item, OWNER_FACT_KEYS, `planningContext.ownerFacts[${index}]`);
    return {
      id: token(item.id, `planningContext.ownerFacts[${index}].id`),
      ref: text(item.ref, `planningContext.ownerFacts[${index}].ref`),
      owner: token(item.owner, `planningContext.ownerFacts[${index}].owner`),
      revision: text(item.revision, `planningContext.ownerFacts[${index}].revision`)
    };
  });
  if (facts.length === 0) fail('planningContext.ownerFacts must bind at least one canonical owner.');
  return sortedById(facts, 'planningContext.ownerFacts');
}

function scopeMatchesPath(scope: string, repositoryPath: string): boolean {
  const exact = scope.endsWith('/') ? scope.slice(0, -1) : scope;
  return repositoryPath === exact
    || (scope.endsWith('/') && repositoryPath.startsWith(`${exact}/`));
}

function scopesOverlap(left: string, right: string): boolean {
  return scopeMatchesPath(left, right.endsWith('/') ? right.slice(0, -1) : right)
    || scopeMatchesPath(right, left.endsWith('/') ? left.slice(0, -1) : left);
}

function parseScopeProposal(value: unknown): AgentOperationScopeProposal {
  const item = record(value, 'planningContext.scopeProposal');
  exactKeys(item, SCOPE_KEYS, 'planningContext.scopeProposal');
  const readPaths = sortedUniqueStrings(
    item.readPaths,
    'planningContext.scopeProposal.readPaths',
    repositoryScope
  );
  const writePaths = sortedUniqueStrings(
    item.writePaths,
    'planningContext.scopeProposal.writePaths',
    repositoryScope
  );
  const forbiddenPaths = sortedUniqueStrings(
    item.forbiddenPaths,
    'planningContext.scopeProposal.forbiddenPaths',
    repositoryScope
  );
  for (const writePath of writePaths) {
    if (forbiddenPaths.some((forbiddenPath) => scopesOverlap(writePath, forbiddenPath))) {
      fail(`planningContext.scopeProposal.writePaths overlaps forbidden path ${writePath}.`);
    }
  }
  const changedPaths = sortedUniqueStrings(
    item.changedPaths,
    'planningContext.scopeProposal.changedPaths',
    repositoryPath
  );
  for (const changedPath of changedPaths) {
    if (!writePaths.some((writePath) => scopeMatchesPath(writePath, changedPath))) {
      fail(`planningContext.scopeProposal.changedPaths is outside every proposed write path: ${changedPath}.`);
    }
    if (forbiddenPaths.some((forbiddenPath) => scopeMatchesPath(forbiddenPath, changedPath))) {
      fail(`planningContext.scopeProposal.changedPaths enters forbidden scope: ${changedPath}.`);
    }
  }
  return {
    readPaths,
    writePaths,
    forbiddenPaths,
    authorizedResources: sortedUniqueStrings(
      item.authorizedResources,
      'planningContext.scopeProposal.authorizedResources'
    ),
    authorizedGates: sortedUniqueStrings(
      item.authorizedGates,
      'planningContext.scopeProposal.authorizedGates'
    ),
    changedPaths
  };
}

function parseVerification(value: unknown): AgentVerificationObligation[] {
  return sortedById(array(value, 'planningContext.verificationObligations').map((entry, index) => {
    const item = record(entry, `planningContext.verificationObligations[${index}]`);
    exactKeys(item, VERIFICATION_KEYS, `planningContext.verificationObligations[${index}]`);
    return {
      id: token(item.id, `planningContext.verificationObligations[${index}].id`),
      revision: text(item.revision, `planningContext.verificationObligations[${index}].revision`),
      reasonCode: token(
        item.reasonCode,
        `planningContext.verificationObligations[${index}].reasonCode`
      )
    };
  }), 'planningContext.verificationObligations');
}

function parsePlanningContext(value: unknown): TaskCapsulePlanningContext {
  const item = record(value, 'planningContext');
  exactKeys(item, PLANNING_CONTEXT_KEYS, 'planningContext');
  if (!isAgentRole(item.role)) fail('planningContext.role is unsupported.');
  if (!isTaskOperationKind(item.operationKind)) fail('planningContext.operationKind is unsupported.');
  if (item.scopeGrantId !== null) {
    fail('planningContext.scopeGrantId must remain null in unbound planning content.');
  }
  const skillCandidateIds = sortedUniqueStrings(
    item.skillCandidateIds,
    'planningContext.skillCandidateIds'
  );
  return {
    operationId: token(item.operationId, 'planningContext.operationId'),
    role: item.role,
    operationKind: item.operationKind,
    goalDigest: digest(item.goalDigest, 'planningContext.goalDigest'),
    trustedRevision: gitRevision(item.trustedRevision, 'planningContext.trustedRevision'),
    targetCandidate: gitRevision(item.targetCandidate, 'planningContext.targetCandidate'),
    workPackageProposalRef: repositoryPath(
      item.workPackageProposalRef,
      'planningContext.workPackageProposalRef'
    ),
    workPackageProposalDigest: digest(
      item.workPackageProposalDigest,
      'planningContext.workPackageProposalDigest'
    ),
    workPackageProjectionId: digest(
      item.workPackageProjectionId,
      'planningContext.workPackageProjectionId'
    ),
    scopeGrantId: null,
    ownerFacts: parseOwnerFacts(item.ownerFacts),
    scopeProposal: parseScopeProposal(item.scopeProposal),
    verificationObligations: parseVerification(item.verificationObligations),
    skillCandidateIds
  };
}

export function compileTaskCapsule(value: unknown): TaskCapsule {
  const input = record(value, 'input');
  exactKeys(input, INPUT_KEYS, 'input');
  if (input.schema !== TASK_CAPSULE_INPUT_SCHEMA) fail('input schema is unsupported.');
  const withoutDigest = {
    schema: TASK_CAPSULE_SCHEMA,
    ref: text(input.ref, 'ref'),
    revision: TASK_CAPSULE_REVISION,
    authorityStatus: TASK_CAPSULE_AUTHORITY_STATUS,
    effectAuthority: 'none' as const,
    planningContext: parsePlanningContext(input.planningContext)
  };
  return deepFreeze({
    ...withoutDigest,
    digest: sha256(withoutDigest) as TaskCapsuleDigest
  });
}

export function parseTaskCapsule(value: unknown): TaskCapsule {
  const capsule = record(value, 'capsule');
  exactKeys(capsule, CAPSULE_KEYS, 'capsule');
  if (capsule.schema !== TASK_CAPSULE_SCHEMA
      || capsule.revision !== TASK_CAPSULE_REVISION
      || capsule.authorityStatus !== TASK_CAPSULE_AUTHORITY_STATUS
      || capsule.effectAuthority !== 'none') {
    fail('capsule schema or compiler revision is unsupported.');
  }
  const compiled = compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: capsule.ref,
    planningContext: capsule.planningContext
  });
  const observedDigest = digest(capsule.digest, 'capsule.digest');
  if (compiled.digest !== observedDigest) {
    fail('capsule digest does not bind its complete planning content.');
  }
  return compiled;
}
