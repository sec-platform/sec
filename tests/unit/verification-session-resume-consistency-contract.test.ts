import { describe, expect, test } from 'bun:test';

import {
  VERIFICATION_SESSION_RESUME_CONSISTENCY_SCHEMA_V1,
  compileVerificationSessionResumeConsistencyDecisionV1,
  type VerificationSessionResumeConsistencyInputV1,
  type VerificationSessionResumeLiveDomainV1,
  type VerificationSessionResumeObservationStatusV1
} from '../../platform/shared/verification-session-resume-consistency-contract.ts';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function observation(
  domain: VerificationSessionResumeLiveDomainV1,
  status: VerificationSessionResumeObservationStatusV1,
  source: 'live-provider' | 'checkpoint-hint' = 'live-provider'
) {
  return { domain, status, source, observationDigest: digest('a') } as const;
}

function spawnInput(
  overrides: Partial<VerificationSessionResumeConsistencyInputV1> = {}
): VerificationSessionResumeConsistencyInputV1 {
  return {
    schema: VERIFICATION_SESSION_RESUME_CONSISTENCY_SCHEMA_V1,
    runId: 'run-1',
    resumeEpoch: 1,
    intent: 'spawn-subagent',
    operationKey: digest('f'),
    operationState: 'none',
    causalCapabilityEpochChanged: false,
    observations: [
      observation('subagent', 'absent'),
      observation('workspace', 'matching'),
      observation('control', 'matching'),
      observation('authority', 'matching'),
      observation('trust', 'matching'),
      observation('authorization', 'matching'),
      observation('capability', 'matching')
    ],
    ...overrides
  };
}

function existingSpawnInput(
  operationState: 'claimed' | 'started' | 'terminal-unconsumed' | 'terminal-consumed'
): VerificationSessionResumeConsistencyInputV1 {
  const input = spawnInput({ operationState });
  return {
    ...input,
    observations: input.observations.map((value) => value.domain === 'subagent'
      ? observation('subagent', 'matching')
      : value)
  };
}

describe('Verification Session resume consistency contract', () => {
  test('requires a CAS claim and never grants effect authority after live preflight', () => {
    expect(compileVerificationSessionResumeConsistencyDecisionV1(spawnInput())).toEqual({
      integrationStatus: 'unwired-candidate',
      effectAuthority: 'none',
      decision: 'claim-required',
      reason: 'fresh-claim-required',
      blockingDomains: []
    });
  });

  test('joins or consumes an existing operation without replaying it', () => {
    expect(compileVerificationSessionResumeConsistencyDecisionV1(
      existingSpawnInput('started')
    ).decision).toBe('join-existing');
    expect(compileVerificationSessionResumeConsistencyDecisionV1(
      existingSpawnInput('terminal-unconsumed')
    ).decision).toBe('consume-terminal');
    expect(compileVerificationSessionResumeConsistencyDecisionV1(spawnInput({
      operationState: 'unknown'
    })).decision).toBe('reconcile');
  });

  test('never treats a checkpoint hint as live proof', () => {
    const input = spawnInput();
    expect(compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      observations: input.observations.map((value) => value.domain === 'subagent'
        ? { ...value, source: 'checkpoint-hint' as const }
        : value)
    })).toMatchObject({
      decision: 'blocked',
      reason: 'checkpoint-hint-is-not-live-proof',
      blockingDomains: ['subagent']
    });
  });

  test('seals a stale epoch and blocks unknown or unavailable live owners', () => {
    const input = spawnInput();
    expect(compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      observations: input.observations.map((value) => value.domain === 'trust'
        ? observation('trust', 'changed')
        : value)
    }).decision).toBe('seal-old-epoch');
    expect(compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      observations: input.observations.map((value) => value.domain === 'subagent'
        ? observation('subagent', 'unavailable')
        : value)
    }).decision).toBe('blocked');
  });

  test('retries authenticated not-started only after a causal capability epoch change', () => {
    expect(compileVerificationSessionResumeConsistencyDecisionV1(spawnInput({
      operationState: 'authenticated-not-started'
    })).reason).toBe('not-started-has-no-causal-change');
    expect(compileVerificationSessionResumeConsistencyDecisionV1(spawnInput({
      operationState: 'authenticated-not-started',
      causalCapabilityEpochChanged: true
    })).decision).toBe('claim-required');
  });

  test('never lets an old operation state bypass current live epoch and provider facts', () => {
    const started = existingSpawnInput('started');
    expect(compileVerificationSessionResumeConsistencyDecisionV1({
      ...started,
      observations: started.observations.map((value) => value.domain === 'trust'
        ? observation('trust', 'changed')
        : value)
    }).decision).toBe('seal-old-epoch');
    expect(compileVerificationSessionResumeConsistencyDecisionV1({
      ...started,
      observations: started.observations.map((value) => value.domain === 'subagent'
        ? observation('subagent', 'unavailable')
        : value)
    }).decision).toBe('blocked');
    expect(compileVerificationSessionResumeConsistencyDecisionV1(spawnInput({
      operationState: 'terminal-unconsumed',
      observations: []
    })).decision).toBe('blocked');
  });

  test('rejects duplicate live domains and malformed stable identities', () => {
    const input = spawnInput();
    expect(() => compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      observations: [...input.observations, input.observations[0]!]
    })).toThrow('observation set is invalid');
    expect(() => compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      operationKey: 'sha256:bad'
    })).toThrow('resume identity is invalid');
    expect(() => compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      operationState: 'not-real'
    } as unknown as VerificationSessionResumeConsistencyInputV1)).toThrow('resume identity is invalid');
    expect(() => compileVerificationSessionResumeConsistencyDecisionV1({
      ...input,
      causalCapabilityEpochChanged: 'yes'
    } as unknown as VerificationSessionResumeConsistencyInputV1)).toThrow('resume identity is invalid');
  });
});
