export const VERIFICATION_SESSION_RESUME_CONSISTENCY_SCHEMA_V1 =
  'sec-verification-session-resume-consistency-v1' as const;

export const VERIFICATION_SESSION_RESUME_LIVE_DOMAINS_V1 = Object.freeze([
  'subagent',
  'exec',
  'workspace',
  'control',
  'authority',
  'trust',
  'authorization',
  'capability',
  'materialization',
  'provider',
  'external-effect',
  'artifact'
] as const);

export type VerificationSessionResumeLiveDomainV1 =
  typeof VERIFICATION_SESSION_RESUME_LIVE_DOMAINS_V1[number];

export type VerificationSessionResumeIntentV1 =
  | 'spawn-subagent'
  | 'start-exec'
  | 'download'
  | 'build'
  | 'external-write'
  | 'cleanup'
  | 'merge';

export type VerificationSessionResumeObservationStatusV1 =
  | 'matching'
  | 'absent'
  | 'changed'
  | 'unknown'
  | 'unavailable'
  | 'conflicting';

export interface VerificationSessionResumeObservationV1 {
  readonly domain: VerificationSessionResumeLiveDomainV1;
  readonly source: 'live-provider' | 'checkpoint-hint';
  readonly status: VerificationSessionResumeObservationStatusV1;
  readonly observationDigest: `sha256:${string}`;
}

export type VerificationSessionResumeOperationStateV1 =
  | 'none'
  | 'claimed'
  | 'started'
  | 'terminal-unconsumed'
  | 'terminal-consumed'
  | 'authenticated-not-started'
  | 'unknown';

export type VerificationSessionResumeDecisionV1 =
  | 'join-existing'
  | 'consume-terminal'
  | 'claim-required'
  | 'complete'
  | 'reconcile'
  | 'seal-old-epoch'
  | 'blocked';

export interface VerificationSessionResumeConsistencyInputV1 {
  readonly schema: typeof VERIFICATION_SESSION_RESUME_CONSISTENCY_SCHEMA_V1;
  readonly runId: string;
  readonly resumeEpoch: number;
  readonly intent: VerificationSessionResumeIntentV1;
  readonly operationKey: `sha256:${string}`;
  readonly operationState: VerificationSessionResumeOperationStateV1;
  readonly causalCapabilityEpochChanged: boolean;
  readonly observations: readonly VerificationSessionResumeObservationV1[];
}

export interface VerificationSessionResumeConsistencyDecisionV1 {
  readonly integrationStatus: 'unwired-candidate';
  readonly effectAuthority: 'none';
  readonly decision: VerificationSessionResumeDecisionV1;
  readonly reason:
    | 'existing-operation-running'
    | 'terminal-result-unconsumed'
    | 'terminal-result-consumed'
    | 'ambiguous-existing-operation'
    | 'old-epoch-invalidated'
    | 'required-live-owner-unavailable'
    | 'checkpoint-hint-is-not-live-proof'
    | 'required-live-state-is-not-admitted'
    | 'not-started-has-no-causal-change'
    | 'fresh-claim-required';
  readonly blockingDomains: readonly VerificationSessionResumeLiveDomainV1[];
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

const REQUIREMENTS = Object.freeze({
  'spawn-subagent': Object.freeze({
    required: Object.freeze([
      'subagent', 'workspace', 'control', 'authority', 'trust', 'authorization', 'capability'
    ] as const),
    absent: 'subagent' as const
  }),
  'start-exec': Object.freeze({
    required: Object.freeze([
      'exec', 'workspace', 'control', 'authority', 'trust', 'authorization', 'capability'
    ] as const),
    absent: 'exec' as const
  }),
  download: Object.freeze({
    required: Object.freeze([
      'materialization', 'provider', 'control', 'authority', 'trust', 'authorization', 'capability'
    ] as const),
    absent: 'materialization' as const
  }),
  build: Object.freeze({
    required: Object.freeze([
      'materialization', 'provider', 'workspace', 'control', 'authority', 'trust',
      'authorization', 'capability'
    ] as const),
    absent: 'materialization' as const
  }),
  'external-write': Object.freeze({
    required: Object.freeze([
      'external-effect', 'provider', 'control', 'authority', 'trust', 'authorization', 'capability'
    ] as const),
    absent: 'external-effect' as const
  }),
  cleanup: Object.freeze({
    required: Object.freeze([
      'artifact', 'external-effect', 'workspace', 'control', 'authority', 'trust',
      'authorization', 'capability'
    ] as const),
    absent: 'external-effect' as const
  }),
  merge: Object.freeze({
    required: Object.freeze([
      'external-effect', 'provider', 'workspace', 'control', 'authority', 'trust',
      'authorization', 'capability'
    ] as const),
    absent: 'external-effect' as const
  })
} as const satisfies Readonly<Record<VerificationSessionResumeIntentV1, Readonly<{
  required: readonly VerificationSessionResumeLiveDomainV1[];
  absent: VerificationSessionResumeLiveDomainV1;
}>>>);

function decision(
  value: VerificationSessionResumeDecisionV1,
  reason: VerificationSessionResumeConsistencyDecisionV1['reason'],
  blockingDomains: readonly VerificationSessionResumeLiveDomainV1[] = []
): VerificationSessionResumeConsistencyDecisionV1 {
  return Object.freeze({
    integrationStatus: 'unwired-candidate',
    effectAuthority: 'none',
    decision: value,
    reason,
    blockingDomains: Object.freeze([...blockingDomains].sort())
  });
}

function assertInput(input: VerificationSessionResumeConsistencyInputV1): void {
  const intents: readonly string[] = [
    'spawn-subagent', 'start-exec', 'download', 'build', 'external-write', 'cleanup', 'merge'
  ];
  const operationStates: readonly string[] = [
    'none', 'claimed', 'started', 'terminal-unconsumed', 'terminal-consumed',
    'authenticated-not-started', 'unknown'
  ];
  const inputKeys = [
    'schema', 'runId', 'resumeEpoch', 'intent', 'operationKey', 'operationState',
    'causalCapabilityEpochChanged', 'observations'
  ].sort();
  if (input.schema !== VERIFICATION_SESSION_RESUME_CONSISTENCY_SCHEMA_V1
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(input.runId)
      || !Number.isSafeInteger(input.resumeEpoch) || input.resumeEpoch < 1
      || !DIGEST.test(input.operationKey)
      || !intents.includes(input.intent)
      || !operationStates.includes(input.operationState)
      || typeof input.causalCapabilityEpochChanged !== 'boolean'
      || !Array.isArray(input.observations)
      || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(inputKeys)) {
    throw new Error('Verification Session resume identity is invalid');
  }
  const domains = new Set<VerificationSessionResumeLiveDomainV1>();
  for (const observation of input.observations) {
    if (observation === null || typeof observation !== 'object'
        || JSON.stringify(Object.keys(observation).sort())
          !== JSON.stringify(['domain', 'observationDigest', 'source', 'status'])
        || !VERIFICATION_SESSION_RESUME_LIVE_DOMAINS_V1.includes(observation.domain)
        || domains.has(observation.domain)
        || !['live-provider', 'checkpoint-hint'].includes(observation.source)
        || !['matching', 'absent', 'changed', 'unknown', 'unavailable', 'conflicting']
          .includes(observation.status)
        || !DIGEST.test(observation.observationDigest)) {
      throw new Error('Verification Session resume observation set is invalid');
    }
    domains.add(observation.domain);
  }
}

export function compileVerificationSessionResumeConsistencyDecisionV1(
  input: VerificationSessionResumeConsistencyInputV1
): VerificationSessionResumeConsistencyDecisionV1 {
  assertInput(input);
  const requirement = REQUIREMENTS[input.intent];
  const observations = new Map(input.observations.map((value) => [value.domain, value] as const));
  const missing = requirement.required.filter((domain) => observations.get(domain) === undefined);
  const hints = requirement.required.filter((domain) => observations.get(domain)?.source !== 'live-provider');
  const invalidated = requirement.required.filter((domain) => observations.get(domain)?.status === 'changed');
  const unavailable = requirement.required.filter((domain) => {
    const status = observations.get(domain)?.status;
    return status === 'unknown' || status === 'unavailable' || status === 'conflicting';
  });
  if (invalidated.length > 0) return decision('seal-old-epoch', 'old-epoch-invalidated', invalidated);
  if (hints.length > 0) return decision('blocked', 'checkpoint-hint-is-not-live-proof', hints);
  if (missing.length > 0 || unavailable.length > 0) {
    return decision(
      'blocked',
      'required-live-owner-unavailable',
      [...new Set([...missing, ...unavailable])]
    );
  }
  const operationMustExist = input.operationState === 'claimed'
    || input.operationState === 'started'
    || input.operationState === 'terminal-unconsumed'
    || input.operationState === 'terminal-consumed';
  const inadmissible = requirement.required.filter((domain) => {
    const expected = domain === requirement.absent && !operationMustExist ? 'absent' : 'matching';
    return observations.get(domain)?.status !== expected;
  });
  if (inadmissible.length > 0) {
    return decision('blocked', 'required-live-state-is-not-admitted', inadmissible);
  }
  if (input.operationState === 'terminal-unconsumed') {
    return decision('consume-terminal', 'terminal-result-unconsumed');
  }
  if (input.operationState === 'terminal-consumed') {
    return decision('complete', 'terminal-result-consumed');
  }
  if (input.operationState === 'claimed' || input.operationState === 'started') {
    return decision('join-existing', 'existing-operation-running');
  }
  if (input.operationState === 'unknown') {
    return decision('reconcile', 'ambiguous-existing-operation');
  }
  if (input.operationState === 'authenticated-not-started'
      && !input.causalCapabilityEpochChanged) {
    return decision('blocked', 'not-started-has-no-causal-change');
  }
  return decision('claim-required', 'fresh-claim-required');
}
