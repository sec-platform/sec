import { canonicalEquals, compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import type { MainHealthRoutingState } from '../main-health/contract.ts';

export const SEC_WORK_SELECTION_INPUT_SCHEMA = 'sec-work-selection-input-v1' as const;
const SEC_WORK_DECISION_SCHEMA = 'sec-work-decision-v1' as const;
export const SEC_WORK_SELECTION_POLICY_REVISION = 'work-selection-policy-v1' as const;

export const SEC_WORK_PRIORITY_CLASSES = [
  'integrity-critical',
  'active-critical-path',
  'product-critical-path',
  'near-term-acceleration',
  'maintenance-required',
  'defer'
] as const;

export type WorkPriorityClass = (typeof SEC_WORK_PRIORITY_CLASSES)[number];
type WorkDecisionStatus =
  | 'continue-active'
  | 'closeout'
  | 'reconcile'
  | 'select-next'
  | 'none'
  | 'unresolved'
  | 'human-escalation';
export type WorkCandidateDecisionStatus =
  | 'eligible'
  | 'rejected'
  | 'unresolved'
  | 'human-required';
export type WorkDigest = `sha256:${string}`;

interface WorkSelectionIdentity {
  readonly exactMain: string;
  readonly roadmapRevision: WorkDigest;
  readonly candidateSetRevision: WorkDigest;
  readonly selectionPolicyRevision: typeof SEC_WORK_SELECTION_POLICY_REVISION;
}

export interface CurrentWorkLifecycle {
  readonly activeWorkId: string | null;
  readonly activeRef: string | null;
  readonly activeState: 'none' | 'incomplete' | 'complete' | 'unresolved';
  readonly activeLegality: 'not-applicable' | 'legal' | 'invalid' | 'unresolved';
  readonly mainHealthState: MainHealthRoutingState;
  readonly mainHealthRef: string;
  readonly closeoutState: 'none' | 'required' | 'unresolved';
  readonly closeoutRef: string;
  readonly controlState: 'consistent' | 'conflict' | 'unresolved';
  readonly controlRef: string;
}

export interface WorkDependencyFact {
  readonly ref: string;
  readonly status: 'satisfied' | 'unsatisfied' | 'unresolved';
}

export interface WorkCandidate {
  readonly workId: string;
  readonly candidateRef: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: WorkDigest;
  readonly ownerRef: string | null;
  readonly kind: 'focused' | 'program' | 'maintenance' | 'diagnostic' | 'spike';
  readonly lifecycle: 'open' | 'already-in-main' | 'superseded' | 'deferred';
  readonly lifecycleRef: string;
  readonly priorityClass: WorkPriorityClass;
  readonly priorityEvidenceRefs: readonly string[];
  readonly readiness: 'ready' | 'not-ready' | 'unresolved';
  readonly readinessRef: string;
  readonly prerequisiteFacts: readonly WorkDependencyFact[];
  readonly orderedAfterFacts: readonly WorkDependencyFact[];
  readonly conflictStatus:
    | 'clear'
    | 'write-conflict'
    | 'resource-conflict'
    | 'authority-conflict'
    | 'unresolved';
  readonly conflictDecisionRefs: readonly string[];
  readonly blockedReadySuccessorCount: number;
  readonly roadmapDirect: boolean;
  readonly reproductionOrEvidenceFreshness: 'fresh' | 'stale' | 'missing';
  readonly rootCauseState: 'not-repeated' | 'repeat-root-cause' | 'unresolved';
  readonly rootCauseRef: string;
  readonly scopeClosure: 'closed' | 'open' | 'unresolved';
  readonly exitCriteriaRef: string | null;
  readonly nearTermConsumerRef: string | null;
  readonly humanDecisionRef: string | null;
}

export interface WorkSelectionInput {
  readonly schema: typeof SEC_WORK_SELECTION_INPUT_SCHEMA;
  readonly identity: WorkSelectionIdentity;
  readonly current: CurrentWorkLifecycle;
  readonly candidates: readonly WorkCandidate[];
}

interface WorkCandidateDecision {
  readonly workId: string;
  readonly candidateRef: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: WorkDigest;
  readonly status: WorkCandidateDecisionStatus;
  readonly reasonCodes: readonly string[];
  readonly blockerRefs: readonly string[];
}

interface WorkSelectionPrecondition {
  readonly workId: string;
  readonly currentSpecRef: string | null;
  readonly currentSpecRevision: WorkDigest | null;
  readonly reasonCode: string;
  readonly blockerRef: string;
}

interface WorkCurrentSpecBinding {
  readonly workId: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: WorkDigest;
}

export interface WorkDecision {
  readonly schema: typeof SEC_WORK_DECISION_SCHEMA;
  readonly policyRevision: typeof SEC_WORK_SELECTION_POLICY_REVISION;
  readonly inputDigest: WorkDigest;
  readonly status: WorkDecisionStatus;
  readonly selectedWorkId: string | null;
  readonly selectedCandidateRef: string | null;
  readonly selectedCurrentSpecRef: string | null;
  readonly selectedCurrentSpecRevision: WorkDigest | null;
  readonly currentSpecBindings: readonly WorkCurrentSpecBinding[];
  readonly blockedCandidateRefs: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly requiredPreconditions: readonly WorkSelectionPrecondition[];
  readonly rejectionWitnesses: readonly WorkCandidateDecision[];
  readonly decisionDigest: WorkDigest;
}

const INPUT_KEYS = ['schema', 'identity', 'current', 'candidates'] as const;
const IDENTITY_KEYS = [
  'exactMain', 'roadmapRevision', 'candidateSetRevision', 'selectionPolicyRevision'
] as const;
const CURRENT_KEYS = [
  'activeWorkId', 'activeRef', 'activeState', 'activeLegality',
  'mainHealthState', 'mainHealthRef', 'closeoutState', 'closeoutRef',
  'controlState', 'controlRef'
] as const;
const CANDIDATE_KEYS = [
  'workId', 'candidateRef', 'currentSpecRef', 'currentSpecRevision', 'ownerRef',
  'kind', 'lifecycle', 'lifecycleRef',
  'priorityClass', 'priorityEvidenceRefs', 'readiness', 'readinessRef',
  'prerequisiteFacts', 'orderedAfterFacts', 'conflictStatus', 'conflictDecisionRefs',
  'blockedReadySuccessorCount', 'roadmapDirect', 'reproductionOrEvidenceFreshness',
  'rootCauseState', 'rootCauseRef', 'scopeClosure', 'exitCriteriaRef', 'nearTermConsumerRef',
  'humanDecisionRef'
] as const;
const DEPENDENCY_KEYS = ['ref', 'status'] as const;

const PRIORITY_ORDER = new Map<WorkPriorityClass, number>(
  SEC_WORK_PRIORITY_CLASSES.map((priorityClass, index) => [priorityClass, index])
);
const FRESHNESS_ORDER = new Map<WorkCandidate['reproductionOrEvidenceFreshness'], number>([
  ['fresh', 0],
  ['stale', 1],
  ['missing', 2]
]);

function fail(message: string): never {
  throw new Error(`Work Selection V1: ${message}`);
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

function reference(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (parsed.length > 512 || /[\u0000-\u0020\u007f]/u.test(parsed)) {
    fail(`${label} must be one bounded canonical reference without whitespace or control bytes.`);
  }
  return parsed;
}

function optionalReference(value: unknown, label: string): string | null {
  return value === null ? null : reference(value, label);
}

function token(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(parsed)) {
    fail(`${label} must be one canonical token.`);
  }
  return parsed;
}

function exactMain(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(parsed)) fail(`${label} must be one lowercase full Git object ID.`);
  return parsed;
}

function digest(value: unknown, label: string): WorkDigest {
  const parsed = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(parsed)) {
    fail(`${label} must be one lowercase SHA-256 digest.`);
  }
  return parsed as WorkDigest;
}

function enumeration<Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    fail(`${label} must be one of ${values.join(',')}.`);
  }
  return value as Value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be one boolean.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be one non-negative safe integer.`);
  }
  return value;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be one array.`);
  return value;
}

function sortedUniqueTexts(value: unknown, label: string): string[] {
  const parsed = array(value, label).map((entry, index) => reference(entry, `${label}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail(`${label} contains a duplicate ref.`);
  return parsed.sort(compareCodeUnits);
}

function parseDependencyFacts(value: unknown, label: string): WorkDependencyFact[] {
  const facts = array(value, label).map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    exactKeys(item, DEPENDENCY_KEYS, `${label}[${index}]`);
    return {
      ref: reference(item.ref, `${label}[${index}].ref`),
      status: enumeration(
        item.status,
        ['satisfied', 'unsatisfied', 'unresolved'] as const,
        `${label}[${index}].status`
      )
    };
  });
  if (new Set(facts.map(({ ref }) => ref)).size !== facts.length) {
    fail(`${label} contains a duplicate ref.`);
  }
  return facts.sort((left, right) => compareCodeUnits(left.ref, right.ref));
}

function parseCandidate(value: unknown, index: number): WorkCandidate {
  const label = `candidates[${index}]`;
  const item = record(value, label);
  exactKeys(item, CANDIDATE_KEYS, label);
  const prerequisiteFacts = parseDependencyFacts(item.prerequisiteFacts, `${label}.prerequisiteFacts`);
  const orderedAfterFacts = parseDependencyFacts(item.orderedAfterFacts, `${label}.orderedAfterFacts`);
  const allDependencyRefs = [...prerequisiteFacts, ...orderedAfterFacts].map(({ ref }) => ref);
  if (new Set(allDependencyRefs).size !== allDependencyRefs.length) {
    fail(`${label} repeats one dependency ref across prerequisiteFacts and orderedAfterFacts.`);
  }
  const parsed: WorkCandidate = {
    workId: token(item.workId, `${label}.workId`),
    candidateRef: reference(item.candidateRef, `${label}.candidateRef`),
    currentSpecRef: reference(item.currentSpecRef, `${label}.currentSpecRef`),
    currentSpecRevision: digest(item.currentSpecRevision, `${label}.currentSpecRevision`),
    ownerRef: optionalReference(item.ownerRef, `${label}.ownerRef`),
    kind: enumeration(
      item.kind,
      ['focused', 'program', 'maintenance', 'diagnostic', 'spike'] as const,
      `${label}.kind`
    ),
    lifecycle: enumeration(
      item.lifecycle,
      ['open', 'already-in-main', 'superseded', 'deferred'] as const,
      `${label}.lifecycle`
    ),
    lifecycleRef: reference(item.lifecycleRef, `${label}.lifecycleRef`),
    priorityClass: enumeration(item.priorityClass, SEC_WORK_PRIORITY_CLASSES, `${label}.priorityClass`),
    priorityEvidenceRefs: sortedUniqueTexts(item.priorityEvidenceRefs, `${label}.priorityEvidenceRefs`),
    readiness: enumeration(
      item.readiness,
      ['ready', 'not-ready', 'unresolved'] as const,
      `${label}.readiness`
    ),
    readinessRef: reference(item.readinessRef, `${label}.readinessRef`),
    prerequisiteFacts,
    orderedAfterFacts,
    conflictStatus: enumeration(
      item.conflictStatus,
      ['clear', 'write-conflict', 'resource-conflict', 'authority-conflict', 'unresolved'] as const,
      `${label}.conflictStatus`
    ),
    conflictDecisionRefs: sortedUniqueTexts(
      item.conflictDecisionRefs,
      `${label}.conflictDecisionRefs`
    ),
    blockedReadySuccessorCount: nonNegativeInteger(
      item.blockedReadySuccessorCount,
      `${label}.blockedReadySuccessorCount`
    ),
    roadmapDirect: boolean(item.roadmapDirect, `${label}.roadmapDirect`),
    reproductionOrEvidenceFreshness: enumeration(
      item.reproductionOrEvidenceFreshness,
      ['fresh', 'stale', 'missing'] as const,
      `${label}.reproductionOrEvidenceFreshness`
    ),
    rootCauseState: enumeration(
      item.rootCauseState,
      ['not-repeated', 'repeat-root-cause', 'unresolved'] as const,
      `${label}.rootCauseState`
    ),
    rootCauseRef: reference(item.rootCauseRef, `${label}.rootCauseRef`),
    scopeClosure: enumeration(
      item.scopeClosure,
      ['closed', 'open', 'unresolved'] as const,
      `${label}.scopeClosure`
    ),
    exitCriteriaRef: optionalReference(item.exitCriteriaRef, `${label}.exitCriteriaRef`),
    nearTermConsumerRef: optionalReference(item.nearTermConsumerRef, `${label}.nearTermConsumerRef`),
    humanDecisionRef: optionalReference(item.humanDecisionRef, `${label}.humanDecisionRef`)
  };

  if (parsed.conflictDecisionRefs.length === 0) {
    fail(`${label}.conflictDecisionRefs must bind the conflict owner decision.`);
  }
  if (parsed.priorityClass === 'near-term-acceleration' && parsed.nearTermConsumerRef === null) {
    fail(`${label} near-term acceleration requires a direct consumer ref.`);
  }
  if (parsed.priorityClass === 'product-critical-path' && !parsed.roadmapDirect) {
    fail(`${label} product-critical-path must be direct to the current roadmap stage.`);
  }
  if (
    parsed.priorityClass !== 'maintenance-required'
    && parsed.priorityClass !== 'defer'
    && parsed.priorityEvidenceRefs.length === 0
  ) {
    fail(`${label} priority class requires at least one machine evidence ref.`);
  }
  if (parsed.rootCauseState === 'repeat-root-cause' && parsed.priorityEvidenceRefs.length === 0) {
    fail(`${label} repeat root cause requires one machine evidence ref.`);
  }
  return parsed;
}

function normalizeCandidates(value: unknown): WorkCandidate[] {
  const candidates = array(value, 'candidates').map(parseCandidate);
  if (new Set(candidates.map(({ workId }) => workId)).size !== candidates.length) {
    fail('candidates contains a duplicate workId.');
  }
  if (new Set(candidates.map(({ candidateRef }) => candidateRef)).size !== candidates.length) {
    fail('candidates contains a duplicate candidateRef.');
  }
  if (new Set(candidates.map(({ currentSpecRef }) => currentSpecRef)).size !== candidates.length) {
    fail('candidates contains a duplicate currentSpecRef.');
  }
  return candidates.sort((left, right) => compareCodeUnits(left.workId, right.workId));
}

export function computeWorkCandidateSetRevision(
  candidates: readonly WorkCandidate[]
): WorkDigest {
  return sha256(normalizeCandidates(candidates)) as WorkDigest;
}

export function parseWorkSelectionInput(value: unknown): WorkSelectionInput {
  const input = record(value, 'input');
  exactKeys(input, INPUT_KEYS, 'input');
  if (input.schema !== SEC_WORK_SELECTION_INPUT_SCHEMA) {
    fail(`input.schema must be ${SEC_WORK_SELECTION_INPUT_SCHEMA}.`);
  }
  const identity = record(input.identity, 'identity');
  exactKeys(identity, IDENTITY_KEYS, 'identity');
  if (identity.selectionPolicyRevision !== SEC_WORK_SELECTION_POLICY_REVISION) {
    fail(`identity.selectionPolicyRevision must be ${SEC_WORK_SELECTION_POLICY_REVISION}.`);
  }
  const current = record(input.current, 'current');
  exactKeys(current, CURRENT_KEYS, 'current');
  const activeWorkId = current.activeWorkId === null
    ? null
    : token(current.activeWorkId, 'current.activeWorkId');
  const activeRef = optionalReference(current.activeRef, 'current.activeRef');
  const activeState = enumeration(
    current.activeState,
    ['none', 'incomplete', 'complete', 'unresolved'] as const,
    'current.activeState'
  );
  if ((activeState === 'none') !== (activeWorkId === null)) {
    fail('current.activeWorkId must be null exactly when activeState is none.');
  }
  if ((activeState === 'none') !== (activeRef === null)) {
    fail('current.activeRef must be null exactly when activeState is none.');
  }
  const activeLegality = enumeration(
    current.activeLegality,
    ['not-applicable', 'legal', 'invalid', 'unresolved'] as const,
    'current.activeLegality'
  );
  if ((activeState === 'none') !== (activeLegality === 'not-applicable')) {
    fail('current.activeLegality must be not-applicable exactly when activeState is none.');
  }
  const candidates = normalizeCandidates(input.candidates);
  const candidateSetRevision = digest(identity.candidateSetRevision, 'identity.candidateSetRevision');
  const expectedCandidateSetRevision = sha256(candidates);
  if (candidateSetRevision !== expectedCandidateSetRevision) {
    fail('identity.candidateSetRevision does not bind the normalized candidate set.');
  }
  return deepFreeze({
    schema: SEC_WORK_SELECTION_INPUT_SCHEMA,
    identity: {
      exactMain: exactMain(identity.exactMain, 'identity.exactMain'),
      roadmapRevision: digest(identity.roadmapRevision, 'identity.roadmapRevision'),
      candidateSetRevision,
      selectionPolicyRevision: SEC_WORK_SELECTION_POLICY_REVISION
    },
    current: {
      activeWorkId,
      activeRef,
      activeState,
      activeLegality,
      mainHealthState: enumeration(
        current.mainHealthState,
        ['healthy', 'unhealthy', 'unresolved'] as const,
        'current.mainHealthState'
      ),
      mainHealthRef: reference(current.mainHealthRef, 'current.mainHealthRef'),
      closeoutState: enumeration(
        current.closeoutState,
        ['none', 'required', 'unresolved'] as const,
        'current.closeoutState'
      ),
      closeoutRef: reference(current.closeoutRef, 'current.closeoutRef'),
      controlState: enumeration(
        current.controlState,
        ['consistent', 'conflict', 'unresolved'] as const,
        'current.controlState'
      ),
      controlRef: reference(current.controlRef, 'current.controlRef')
    },
    candidates
  });
}

export interface CandidateEvaluation {
  readonly candidate: WorkCandidate;
  readonly decision: WorkCandidateDecision;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

export function evaluateWorkCandidate(candidate: WorkCandidate): CandidateEvaluation {
  const rejected: string[] = [];
  const unresolved: string[] = [];
  const reasons: string[] = [];
  const blockers: string[] = [];
  if (candidate.lifecycle === 'already-in-main') {
    rejected.push('already-in-main');
    blockers.push(candidate.lifecycleRef);
  } else if (candidate.lifecycle === 'superseded') {
    rejected.push('superseded');
    blockers.push(candidate.lifecycleRef);
  } else if (candidate.lifecycle === 'deferred' || candidate.priorityClass === 'defer') {
    rejected.push('future-only');
    blockers.push(candidate.lifecycleRef);
  }
  if (candidate.kind === 'diagnostic' || candidate.kind === 'spike') {
    rejected.push('non-merge-candidate');
    blockers.push(candidate.candidateRef);
  }
  if (candidate.ownerRef === null) {
    rejected.push('missing-owner');
    blockers.push(candidate.candidateRef);
  }
  if (candidate.exitCriteriaRef === null) {
    rejected.push('missing-exit-criteria');
    blockers.push(candidate.candidateRef);
  }
  if (candidate.readiness === 'not-ready') {
    rejected.push('not-ready');
    blockers.push(candidate.readinessRef);
  } else if (candidate.readiness === 'unresolved') {
    unresolved.push('readiness-unresolved');
    blockers.push(candidate.readinessRef);
  }
  for (const fact of candidate.prerequisiteFacts) {
    if (fact.status === 'unsatisfied') rejected.push('prerequisite-unsatisfied');
    if (fact.status === 'unresolved') unresolved.push('prerequisite-unresolved');
    if (fact.status !== 'satisfied') blockers.push(fact.ref);
  }
  for (const fact of candidate.orderedAfterFacts) {
    if (fact.status === 'unsatisfied') rejected.push('ordered-after');
    if (fact.status === 'unresolved') unresolved.push('ordered-after-unresolved');
    if (fact.status !== 'satisfied') blockers.push(fact.ref);
  }
  if (candidate.conflictStatus === 'write-conflict') rejected.push('write-conflict');
  if (candidate.conflictStatus === 'resource-conflict') rejected.push('resource-conflict');
  if (candidate.conflictStatus === 'authority-conflict') rejected.push('authority-conflict');
  if (candidate.conflictStatus === 'unresolved') unresolved.push('unresolved-conflict');
  if (candidate.conflictStatus !== 'clear') blockers.push(...candidate.conflictDecisionRefs);
  if (candidate.scopeClosure === 'open') {
    rejected.push('scope-not-closed');
    blockers.push(candidate.candidateRef);
  } else if (candidate.scopeClosure === 'unresolved') {
    unresolved.push('scope-unresolved');
    blockers.push(candidate.candidateRef);
  }
  if (
    candidate.reproductionOrEvidenceFreshness === 'missing'
    && candidate.priorityClass !== 'maintenance-required'
    && candidate.priorityClass !== 'defer'
  ) {
    rejected.push('required-evidence-missing');
    blockers.push(...candidate.priorityEvidenceRefs);
  }
  if (candidate.rootCauseState === 'unresolved') {
    unresolved.push('root-cause-unresolved');
    blockers.push(candidate.rootCauseRef);
  } else if (candidate.rootCauseState === 'repeat-root-cause') {
    reasons.push('repeat-root-cause');
  }

  reasons.push(candidate.priorityClass);
  if (candidate.priorityClass === 'active-critical-path') reasons.push('blocks-current');
  if (candidate.blockedReadySuccessorCount > 0) reasons.push('blocks-ready-successors');
  if (candidate.roadmapDirect) reasons.push('product-stage-direct');
  if (candidate.nearTermConsumerRef !== null) reasons.push('near-term-consumer-proven');

  let status: WorkCandidateDecisionStatus;
  if (rejected.length > 0) {
    status = 'rejected';
    reasons.push(...rejected);
  } else if (unresolved.length > 0) {
    status = 'unresolved';
    reasons.push(...unresolved);
  } else if (candidate.humanDecisionRef !== null) {
    status = 'human-required';
    reasons.push('human-decision-required');
    blockers.push(candidate.humanDecisionRef);
  } else {
    status = 'eligible';
  }
  return {
    candidate,
    decision: deepFreeze({
      workId: candidate.workId,
      candidateRef: candidate.candidateRef,
      currentSpecRef: candidate.currentSpecRef,
      currentSpecRevision: candidate.currentSpecRevision,
      status,
      reasonCodes: uniqueSorted(reasons),
      blockerRefs: uniqueSorted(blockers)
    })
  };
}

function compareCandidateRank(left: WorkCandidate, right: WorkCandidate): number {
  const priority = PRIORITY_ORDER.get(left.priorityClass)! - PRIORITY_ORDER.get(right.priorityClass)!;
  if (priority !== 0) return priority;
  if (left.blockedReadySuccessorCount !== right.blockedReadySuccessorCount) {
    return right.blockedReadySuccessorCount - left.blockedReadySuccessorCount;
  }
  if (left.roadmapDirect !== right.roadmapDirect) return left.roadmapDirect ? -1 : 1;
  const freshness = FRESHNESS_ORDER.get(left.reproductionOrEvidenceFreshness)!
    - FRESHNESS_ORDER.get(right.reproductionOrEvidenceFreshness)!;
  if (freshness !== 0) return freshness;
  if (left.scopeClosure !== right.scopeClosure) {
    const order = { closed: 0, open: 1, unresolved: 2 } as const;
    return order[left.scopeClosure] - order[right.scopeClosure];
  }
  return compareCodeUnits(left.workId, right.workId);
}

function candidatePreconditions(
  evaluations: readonly CandidateEvaluation[]
): WorkSelectionPrecondition[] {
  const projected: WorkSelectionPrecondition[] = [];
  const precondition = (
    candidate: WorkCandidate,
    reasonCode: string,
    blockerRef: string
  ): WorkSelectionPrecondition => ({
    workId: candidate.workId,
    currentSpecRef: candidate.currentSpecRef,
    currentSpecRevision: candidate.currentSpecRevision,
    reasonCode,
    blockerRef
  });
  for (const { candidate, decision } of evaluations) {
    if (decision.status === 'unresolved') {
      if (candidate.readiness === 'unresolved') {
        projected.push(precondition(candidate, 'readiness-unresolved', candidate.readinessRef));
      }
      for (const fact of candidate.prerequisiteFacts.filter(({ status }) => status === 'unresolved')) {
        projected.push(precondition(candidate, 'prerequisite-unresolved', fact.ref));
      }
      for (const fact of candidate.orderedAfterFacts.filter(({ status }) => status === 'unresolved')) {
        projected.push(precondition(candidate, 'ordered-after-unresolved', fact.ref));
      }
      if (candidate.conflictStatus === 'unresolved') {
        for (const blockerRef of candidate.conflictDecisionRefs) {
          projected.push(precondition(candidate, 'unresolved-conflict', blockerRef));
        }
      }
      if (candidate.scopeClosure === 'unresolved') {
        projected.push(precondition(candidate, 'scope-unresolved', candidate.candidateRef));
      }
      if (candidate.rootCauseState === 'unresolved') {
        projected.push(precondition(candidate, 'root-cause-unresolved', candidate.rootCauseRef));
      }
    }
    if (decision.status === 'human-required' && candidate.humanDecisionRef !== null) {
      projected.push(precondition(candidate, 'human-decision-required', candidate.humanDecisionRef));
    }
  }
  return projected.sort((left, right) => (
    compareCodeUnits(left.workId, right.workId)
    || compareCodeUnits(left.reasonCode, right.reasonCode)
    || compareCodeUnits(left.blockerRef, right.blockerRef)
  ));
}

function currentPreconditions(input: WorkSelectionInput): WorkSelectionPrecondition[] {
  const projected: WorkSelectionPrecondition[] = [];
  const workId = input.current.activeWorkId ?? 'current-control';
  if (
    (input.current.activeState === 'unresolved' || input.current.activeLegality === 'unresolved')
    && input.current.activeRef !== null
  ) {
    projected.push({
      workId,
      currentSpecRef: null,
      currentSpecRevision: null,
      reasonCode: 'active-state-unresolved',
      blockerRef: input.current.activeRef
    });
  }
  if (input.current.mainHealthState === 'unresolved') {
    projected.push({
      workId,
      currentSpecRef: null,
      currentSpecRevision: null,
      reasonCode: 'main-health-unresolved',
      blockerRef: input.current.mainHealthRef
    });
  }
  if (input.current.closeoutState === 'unresolved') {
    projected.push({
      workId,
      currentSpecRef: null,
      currentSpecRevision: null,
      reasonCode: 'closeout-unresolved',
      blockerRef: input.current.closeoutRef
    });
  }
  if (input.current.controlState === 'unresolved') {
    projected.push({
      workId,
      currentSpecRef: null,
      currentSpecRevision: null,
      reasonCode: 'control-unresolved',
      blockerRef: input.current.controlRef
    });
  }
  return projected.sort((left, right) => (
    compareCodeUnits(left.reasonCode, right.reasonCode)
    || compareCodeUnits(left.blockerRef, right.blockerRef)
  ));
}

function finalizeDecision(
  input: WorkSelectionInput,
  material: Omit<
    WorkDecision,
    | 'schema'
    | 'policyRevision'
    | 'inputDigest'
    | 'selectedCurrentSpecRef'
    | 'selectedCurrentSpecRevision'
    | 'currentSpecBindings'
    | 'decisionDigest'
  >
): WorkDecision {
  const selectedCandidate = material.selectedCandidateRef === null
    ? null
    : input.candidates.find(({ candidateRef }) => candidateRef === material.selectedCandidateRef) ?? null;
  if (material.selectedCandidateRef !== null && selectedCandidate === null) {
    fail('selected candidate ref must resolve inside the bound candidate set.');
  }
  const withoutDigest = {
    schema: SEC_WORK_DECISION_SCHEMA,
    policyRevision: SEC_WORK_SELECTION_POLICY_REVISION,
    inputDigest: sha256(input) as WorkDigest,
    selectedCurrentSpecRef: selectedCandidate?.currentSpecRef ?? null,
    selectedCurrentSpecRevision: selectedCandidate?.currentSpecRevision ?? null,
    currentSpecBindings: input.candidates.map((candidate) => ({
      workId: candidate.workId,
      currentSpecRef: candidate.currentSpecRef,
      currentSpecRevision: candidate.currentSpecRevision
    })),
    ...material
  };
  return deepFreeze({
    ...withoutDigest,
    decisionDigest: sha256(withoutDigest) as WorkDigest
  });
}

export function compileWorkDecision(value: unknown): WorkDecision {
  const input = parseWorkSelectionInput(value);
  const emptyWitnesses: readonly WorkCandidateDecision[] = Object.freeze([]);
  const emptyPreconditions: readonly WorkSelectionPrecondition[] = Object.freeze([]);
  if (
    input.current.activeState === 'incomplete'
    && input.current.activeLegality === 'legal'
    && input.current.mainHealthState === 'healthy'
    && input.current.controlState === 'consistent'
  ) {
    return finalizeDecision(input, {
      status: 'continue-active',
      selectedWorkId: input.current.activeWorkId,
      selectedCandidateRef: null,
      blockedCandidateRefs: [],
      reasonCodes: ['active-incomplete'],
      requiredPreconditions: emptyPreconditions,
      rejectionWitnesses: emptyWitnesses
    });
  }
  if (input.current.closeoutState === 'required') {
    return finalizeDecision(input, {
      status: 'closeout',
      selectedWorkId: input.current.activeWorkId,
      selectedCandidateRef: null,
      blockedCandidateRefs: [],
      reasonCodes: ['closeout-required'],
      requiredPreconditions: emptyPreconditions,
      rejectionWitnesses: emptyWitnesses
    });
  }
  const reconciliationReasons = uniqueSorted([
    ...(input.current.controlState === 'conflict' ? ['control-conflict'] : []),
    ...(input.current.mainHealthState === 'unhealthy' ? ['main-unhealthy'] : []),
    ...(input.current.activeLegality === 'invalid' ? ['active-invalid'] : [])
  ]);
  if (reconciliationReasons.length > 0) {
    return finalizeDecision(input, {
      status: 'reconcile',
      selectedWorkId: input.current.activeWorkId,
      selectedCandidateRef: null,
      blockedCandidateRefs: [],
      reasonCodes: reconciliationReasons,
      requiredPreconditions: emptyPreconditions,
      rejectionWitnesses: emptyWitnesses
    });
  }
  if (
    input.current.activeState === 'unresolved'
    || input.current.activeLegality === 'unresolved'
    || input.current.mainHealthState === 'unresolved'
    || input.current.closeoutState === 'unresolved'
    || input.current.controlState === 'unresolved'
  ) {
    return finalizeDecision(input, {
      status: 'unresolved',
      selectedWorkId: null,
      selectedCandidateRef: null,
      blockedCandidateRefs: [],
      reasonCodes: ['current-lifecycle-unresolved'],
      requiredPreconditions: currentPreconditions(input),
      rejectionWitnesses: emptyWitnesses
    });
  }

  const evaluations = input.candidates.map(evaluateWorkCandidate);
  const ordered = [...evaluations].sort((left, right) => (
    compareCandidateRank(left.candidate, right.candidate)
  ));
  const eligible = ordered.filter(({ decision }) => decision.status === 'eligible');
  const uncertain = ordered.filter(({ decision }) => (
    decision.status === 'unresolved' || decision.status === 'human-required'
  ));
  const bestEligible = eligible[0];
  const bestUncertain = uncertain[0];
  const uncertainOutranksEligible = bestUncertain !== undefined && (
    bestEligible === undefined
    || compareCandidateRank(bestUncertain.candidate, bestEligible.candidate) < 0
  );
  const rejectionWitnesses = evaluations
    .filter(({ decision }) => decision.status !== 'eligible')
    .map(({ decision }) => decision)
    .sort((left, right) => compareCodeUnits(left.workId, right.workId));
  const blockedCandidateRefs = uniqueSorted(rejectionWitnesses.map(({ candidateRef }) => candidateRef));
  const requiredPreconditions = candidatePreconditions(evaluations);

  if (uncertainOutranksEligible) {
    return finalizeDecision(input, {
      status: bestUncertain!.decision.status === 'human-required'
        ? 'human-escalation'
        : 'unresolved',
      selectedWorkId: null,
      selectedCandidateRef: null,
      blockedCandidateRefs,
      reasonCodes: bestUncertain!.decision.status === 'human-required'
        ? ['human-decision-required']
        : ['selection-input-unresolved'],
      requiredPreconditions,
      rejectionWitnesses
    });
  }
  if (bestEligible !== undefined) {
    return finalizeDecision(input, {
      status: 'select-next',
      selectedWorkId: bestEligible.candidate.workId,
      selectedCandidateRef: bestEligible.candidate.candidateRef,
      blockedCandidateRefs,
      reasonCodes: uniqueSorted(['candidate-selected', ...bestEligible.decision.reasonCodes]),
      requiredPreconditions,
      rejectionWitnesses
    });
  }
  return finalizeDecision(input, {
    status: 'none',
    selectedWorkId: null,
    selectedCandidateRef: null,
    blockedCandidateRefs,
    reasonCodes: ['none-required'],
    requiredPreconditions,
    rejectionWitnesses
  });
}

export function assertWorkDecision(
  value: unknown,
  input: unknown
): WorkDecision {
  const compiled = compileWorkDecision(input);
  if (!canonicalEquals(value, compiled)) {
    fail('decision does not equal the canonical decision for its bound input.');
  }
  return compiled;
}
