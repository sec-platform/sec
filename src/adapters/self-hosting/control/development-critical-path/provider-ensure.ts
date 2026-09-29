import { deepFreeze } from '../../../../contracts/canonical.ts';
import {
  SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
  criticalPathRef,
  failCriticalPath,
  uniqueSortedCriticalPathRefs
} from './common.ts';

export type ProviderEnsureActionKindV1 =
  | 'ensure-image'
  | 'create-container'
  | 'start-container'
  | 'register-runner'
  | 'start-runner-process'
  | 'publish-provider-ledger';

export interface ProviderEnsurePlanV1 {
  readonly schema: 'sec-critical-path-provider-ensure-plan-v1';
  readonly revision: typeof SEC_DEVELOPMENT_CRITICAL_PATH_REVISION;
  /** Exact desired provider/capability/role tuple; this planner never resolves it. */
  readonly target: Readonly<{
    providerRef: string;
    capabilityRef: string;
    roleRef: string;
  }>;
  readonly status: 'ready' | 'action-required' | 'blocked';
  readonly nextAction: Readonly<{
    kind: ProviderEnsureActionKindV1;
    observationRef: string;
  }> | null;
  readonly reasonCodes: readonly string[];
  readonly blockerRefs: readonly string[];
}

function providerState<State extends string>(
  value: State,
  allowed: readonly State[],
  label: string
): State {
  if (!allowed.includes(value)) failCriticalPath(`${label} state is invalid.`);
  return value;
}

export function compileProviderEnsurePlanV1(input: Readonly<{
  providerRef: string;
  capabilityRef: string;
  roleRef: string;
  image: Readonly<{
    state: 'ready' | 'missing' | 'mismatch' | 'unknown';
    observationRef: string;
  }>;
  container: Readonly<{
    state: 'running' | 'stopped' | 'missing' | 'mismatch' | 'unknown';
    observationRef: string;
  }>;
  runnerRegistration: Readonly<{
    state: 'registered' | 'missing' | 'mismatch' | 'unknown';
    observationRef: string;
  }>;
  runnerProcess: Readonly<{
    state: 'running' | 'stopped' | 'missing' | 'mismatch' | 'unknown';
    observationRef: string;
  }>;
  ledger: Readonly<{
    state: 'current' | 'missing' | 'mismatch' | 'unknown';
    observationRef: string;
  }>;
}>): ProviderEnsurePlanV1 {
  const target = Object.freeze({
    providerRef: criticalPathRef(input.providerRef, 'providerRef'),
    capabilityRef: criticalPathRef(input.capabilityRef, 'capabilityRef'),
    roleRef: criticalPathRef(input.roleRef, 'roleRef')
  });
  const states = Object.freeze({
    image: providerState(
      input.image.state,
      ['ready', 'missing', 'mismatch', 'unknown'] as const,
      'image'
    ),
    container: providerState(
      input.container.state,
      ['running', 'stopped', 'missing', 'mismatch', 'unknown'] as const,
      'container'
    ),
    runnerRegistration: providerState(
      input.runnerRegistration.state,
      ['registered', 'missing', 'mismatch', 'unknown'] as const,
      'runnerRegistration'
    ),
    runnerProcess: providerState(
      input.runnerProcess.state,
      ['running', 'stopped', 'missing', 'mismatch', 'unknown'] as const,
      'runnerProcess'
    ),
    ledger: providerState(
      input.ledger.state,
      ['current', 'missing', 'mismatch', 'unknown'] as const,
      'ledger'
    )
  });
  const observations = [
    ['image', input.image, states.image],
    ['container', input.container, states.container],
    ['runner-registration', input.runnerRegistration, states.runnerRegistration],
    ['runner-process', input.runnerProcess, states.runnerProcess],
    ['ledger', input.ledger, states.ledger]
  ] as const;
  for (const [label, observation] of observations) {
    criticalPathRef(observation.observationRef, `${label}.observationRef`);
  }

  const blockers: string[] = [];
  const reasons: string[] = [];
  for (const [label, observation, state] of observations) {
    if (state === 'unknown' || state === 'mismatch') {
      reasons.push(`${label}-${state}`);
      blockers.push(observation.observationRef);
    }
  }
  if (blockers.length > 0) {
    return deepFreeze({
      schema: 'sec-critical-path-provider-ensure-plan-v1',
      revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
      target,
      status: 'blocked',
      nextAction: null,
      reasonCodes: uniqueSortedCriticalPathRefs(reasons),
      blockerRefs: uniqueSortedCriticalPathRefs(blockers)
    });
  }

  const action = (
    kind: ProviderEnsureActionKindV1,
    observationRef: string,
    reasonCode: string
  ): ProviderEnsurePlanV1 => deepFreeze({
    schema: 'sec-critical-path-provider-ensure-plan-v1',
    revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
    target,
    status: 'action-required',
    nextAction: { kind, observationRef },
    reasonCodes: [reasonCode],
    blockerRefs: []
  });

  if (states.image === 'missing') {
    return action('ensure-image', input.image.observationRef, 'image-missing');
  }
  if (states.container === 'missing') {
    return action('create-container', input.container.observationRef, 'container-missing');
  }
  if (states.container === 'stopped') {
    return action('start-container', input.container.observationRef, 'container-stopped');
  }
  if (states.runnerRegistration === 'missing') {
    return action(
      'register-runner',
      input.runnerRegistration.observationRef,
      'runner-registration-missing'
    );
  }
  if (states.runnerProcess === 'missing' || states.runnerProcess === 'stopped') {
    return action(
      'start-runner-process',
      input.runnerProcess.observationRef,
      `runner-process-${states.runnerProcess}`
    );
  }
  if (states.ledger === 'missing') {
    return action('publish-provider-ledger', input.ledger.observationRef, 'ledger-missing');
  }

  return deepFreeze({
    schema: 'sec-critical-path-provider-ensure-plan-v1',
    revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
    target,
    status: 'ready',
    nextAction: null,
    reasonCodes: ['provider-ready'],
    blockerRefs: []
  });
}
