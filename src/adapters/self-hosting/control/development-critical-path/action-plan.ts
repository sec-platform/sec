import { compareCodeUnits, deepFreeze } from '../../../../contracts/canonical.ts';
import {
  SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
  criticalPathDigest,
  criticalPathRef,
  failCriticalPath,
  sortedUniqueCriticalPathDigests,
  uniqueSortedCriticalPathRefs,
  type CriticalPathDigest
} from './common.ts';

export type CriticalPathActionObservationStateV1 =
  | 'fresh-pass'
  | 'fresh-failure'
  | 'in-flight'
  | 'missing'
  | 'stale'
  | 'unknown';

export type CriticalPathRequiredClosureStateV1 =
  | 'required'
  | 'not-applicable'
  | 'unresolved';

const ACTION_OBSERVATION_STATES = Object.freeze([
  'fresh-pass',
  'fresh-failure',
  'in-flight',
  'missing',
  'stale',
  'unknown'
] as const);

const REQUIRED_CLOSURE_STATES = Object.freeze([
  'required',
  'not-applicable',
  'unresolved'
] as const);

export interface CriticalPathActionObservationV1 {
  readonly actionKey: CriticalPathDigest;
  readonly state: CriticalPathActionObservationStateV1;
  /** #179-owned observation/terminal/in-flight locator. */
  readonly observationRef: string;
  /** #179-owned semantic revision for the observation, never recomputed here. */
  readonly ownerRevision: string;
}

export interface MissingOrStalePlanV1 {
  readonly schema: 'sec-critical-path-missing-or-stale-plan-v1';
  readonly revision: typeof SEC_DEVELOPMENT_CRITICAL_PATH_REVISION;
  readonly status: 'ready' | 'blocked';
  /** Exact #188 closure identity consumed by this plan. */
  readonly requiredClosureRef: string;
  readonly requiredClosureRevision: string;
  readonly requiredClosureState: CriticalPathRequiredClosureStateV1;
  readonly requiredActionKeys: readonly CriticalPathDigest[];
  /** Normalized #179 observations keep the plan bound to their exact revisions. */
  readonly observations: readonly CriticalPathActionObservationV1[];
  readonly reusePass: readonly CriticalPathDigest[];
  readonly reuseFailure: readonly CriticalPathDigest[];
  readonly join: readonly CriticalPathDigest[];
  readonly execute: readonly CriticalPathDigest[];
  readonly blocked: readonly CriticalPathDigest[];
  readonly blockerRefs: readonly string[];
}

export function compileMissingOrStalePlanV1(input: Readonly<{
  requiredClosure: Readonly<{
    state: CriticalPathRequiredClosureStateV1;
    ref: string;
    ownerRevision: string;
    actionKeys: readonly CriticalPathDigest[];
  }>;
  observations: readonly CriticalPathActionObservationV1[];
}>): MissingOrStalePlanV1 {
  const requiredClosureRef = criticalPathRef(input.requiredClosure.ref, 'requiredClosure.ref');
  const requiredClosureRevision = criticalPathRef(
    input.requiredClosure.ownerRevision,
    'requiredClosure.ownerRevision'
  );
  if (!REQUIRED_CLOSURE_STATES.includes(input.requiredClosure.state)) {
    failCriticalPath('requiredClosure.state is invalid.');
  }
  const requiredClosureState = input.requiredClosure.state;
  const requiredActionKeys = sortedUniqueCriticalPathDigests(
    input.requiredClosure.actionKeys,
    'requiredClosure.actionKeys'
  );
  if (requiredClosureState !== 'required') {
    if (requiredActionKeys.length !== 0 || input.observations.length !== 0) {
      failCriticalPath(
        'not-applicable/unresolved closure cannot expose an executable Action subset.'
      );
    }
    return deepFreeze({
      schema: 'sec-critical-path-missing-or-stale-plan-v1',
      revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
      status: requiredClosureState === 'unresolved' ? 'blocked' : 'ready',
      requiredClosureRef,
      requiredClosureRevision,
      requiredClosureState,
      requiredActionKeys,
      observations: [],
      reusePass: [],
      reuseFailure: [],
      join: [],
      execute: [],
      blocked: [],
      blockerRefs: requiredClosureState === 'unresolved' ? [requiredClosureRef] : []
    });
  }

  const required = new Set(requiredActionKeys);
  const observations = input.observations.map((value, index) => {
    const actionKey = criticalPathDigest(value.actionKey, `observations[${index}].actionKey`);
    if (!required.has(actionKey)) {
      failCriticalPath(`observations[${index}] is outside the required closure.`);
    }
    if (!ACTION_OBSERVATION_STATES.includes(value.state)) {
      failCriticalPath(`observations[${index}].state is invalid.`);
    }
    return Object.freeze({
      actionKey,
      state: value.state,
      observationRef: criticalPathRef(
        value.observationRef,
        `observations[${index}].observationRef`
      ),
      ownerRevision: criticalPathRef(
        value.ownerRevision,
        `observations[${index}].ownerRevision`
      )
    });
  }).sort((left, right) => compareCodeUnits(left.actionKey, right.actionKey));
  if (new Set(observations.map(({ actionKey }) => actionKey)).size !== observations.length) {
    failCriticalPath('observations contain a duplicate ActionKey.');
  }
  if (observations.length !== requiredActionKeys.length) {
    failCriticalPath('every required ActionKey must have exactly one owner observation.');
  }

  const byKey = new Map(observations.map((observation) => [observation.actionKey, observation]));
  const reusePass: CriticalPathDigest[] = [];
  const reuseFailure: CriticalPathDigest[] = [];
  const join: CriticalPathDigest[] = [];
  const execute: CriticalPathDigest[] = [];
  const blocked: CriticalPathDigest[] = [];
  const blockerRefs: string[] = [];

  for (const actionKey of requiredActionKeys) {
    const observation = byKey.get(actionKey);
    if (observation === undefined) {
      failCriticalPath('required Action observation disappeared during normalization.');
    }
    switch (observation.state) {
      case 'fresh-pass': reusePass.push(actionKey); break;
      case 'fresh-failure': reuseFailure.push(actionKey); break;
      case 'in-flight': join.push(actionKey); break;
      case 'missing':
      case 'stale':
        execute.push(actionKey);
        break;
      case 'unknown':
        blocked.push(actionKey);
        blockerRefs.push(observation.observationRef);
        break;
    }
  }

  return deepFreeze({
    schema: 'sec-critical-path-missing-or-stale-plan-v1',
    revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
    status: blocked.length === 0 ? 'ready' : 'blocked',
    requiredClosureRef,
    requiredClosureRevision,
    requiredClosureState,
    requiredActionKeys,
    observations,
    reusePass,
    reuseFailure,
    join,
    execute,
    blocked,
    blockerRefs: uniqueSortedCriticalPathRefs(blockerRefs)
  });
}
