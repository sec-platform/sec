import { expect, test } from 'bun:test';

import {
  compileMissingOrStalePlanV1
} from '../../src/adapters/self-hosting/control/development-critical-path/action-plan.ts';
import type {
  CriticalPathDigest
} from '../../src/adapters/self-hosting/control/development-critical-path/common.ts';
import {
  compileMainDeltaProposalV1
} from '../../src/adapters/self-hosting/control/development-critical-path/main-delta.ts';
import {
  compileOperationalTerminalProjectionV1
} from '../../src/adapters/self-hosting/control/development-critical-path/operational-terminal.ts';
import {
  compileProviderEnsurePlanV1,
  type ProviderEnsurePlanV1
} from '../../src/adapters/self-hosting/control/development-critical-path/provider-ensure.ts';

const d = (character: string): CriticalPathDigest => `sha256:${character.repeat(64)}`;

test('MissingOrStale partitions each required ActionKey exactly once and ignores input ordering', () => {
  const required = [d('a'), d('b'), d('c'), d('d'), d('e'), d('f')];
  const observations = [
    { actionKey: d('f'), state: 'unknown' as const, observationRef: 'action:f', ownerRevision: 'journal:f' },
    { actionKey: d('c'), state: 'in-flight' as const, observationRef: 'action:c', ownerRevision: 'journal:c' },
    { actionKey: d('a'), state: 'fresh-pass' as const, observationRef: 'action:a', ownerRevision: 'journal:a' },
    { actionKey: d('e'), state: 'stale' as const, observationRef: 'action:e', ownerRevision: 'journal:e' },
    { actionKey: d('b'), state: 'fresh-failure' as const, observationRef: 'action:b', ownerRevision: 'journal:b' },
    { actionKey: d('d'), state: 'missing' as const, observationRef: 'action:d', ownerRevision: 'journal:d' }
  ];
  const first = compileMissingOrStalePlanV1({ requiredClosure: { state: 'required', ref: 'impact:required', ownerRevision: 'impact:r1', actionKeys: required }, observations });
  const second = compileMissingOrStalePlanV1({
    requiredClosure: { state: 'required', ref: 'impact:required', ownerRevision: 'impact:r1', actionKeys: [...required].reverse() },
    observations: [...observations].reverse()
  });

  expect(second).toEqual(first);
  expect(first.status).toBe('blocked');
  expect(first.requiredClosureRef).toBe('impact:required');
  expect(first.requiredClosureRevision).toBe('impact:r1');
  expect(first.requiredClosureState).toBe('required');
  expect(first.observations.map(({ actionKey }) => actionKey)).toEqual(required);
  expect(first.reusePass).toEqual([d('a')]);
  expect(first.reuseFailure).toEqual([d('b')]);
  expect(first.join).toEqual([d('c')]);
  expect(first.execute).toEqual([d('d'), d('e')]);
  expect(first.blocked).toEqual([d('f')]);
  expect(first.blockerRefs).toEqual(['action:f']);
});

test('MissingOrStale rejects duplicate, missing, or outside-closure observations', () => {
  const observation = {
    actionKey: d('a'),
    state: 'fresh-pass' as const,
    observationRef: 'action:a',
    ownerRevision: 'journal:a'
  };
  expect(() => compileMissingOrStalePlanV1({
    requiredClosure: { state: 'required', ref: 'impact:required', ownerRevision: 'impact:r1', actionKeys: [d('a')] },
    observations: [observation, observation]
  })).toThrow(/duplicate ActionKey/u);
  expect(() => compileMissingOrStalePlanV1({
    requiredClosure: { state: 'required', ref: 'impact:required', ownerRevision: 'impact:r1', actionKeys: [d('a'), d('b')] },
    observations: [observation]
  })).toThrow(/exactly one owner observation/u);
  expect(() => compileMissingOrStalePlanV1({
    requiredClosure: { state: 'required', ref: 'impact:required', ownerRevision: 'impact:r1', actionKeys: [d('a')] },
    observations: [{ ...observation, actionKey: d('b') }]
  })).toThrow(/outside the required closure/u);
});



test('MissingOrStale keeps #188 not-applicable separate from unresolved and never executes unknown closure', () => {
  const notApplicable = compileMissingOrStalePlanV1({
    requiredClosure: {
      state: 'not-applicable',
      ref: 'impact:not-applicable',
      ownerRevision: 'impact:r2',
      actionKeys: []
    },
    observations: []
  });
  expect(notApplicable).toMatchObject({
    status: 'ready',
    requiredClosureState: 'not-applicable',
    execute: [],
    blockerRefs: []
  });

  const unresolved = compileMissingOrStalePlanV1({
    requiredClosure: {
      state: 'unresolved',
      ref: 'impact:unresolved',
      ownerRevision: 'impact:r3',
      actionKeys: []
    },
    observations: []
  });
  expect(unresolved).toMatchObject({
    status: 'blocked',
    requiredClosureState: 'unresolved',
    execute: [],
    blockerRefs: ['impact:unresolved']
  });

  expect(() => compileMissingOrStalePlanV1({
    requiredClosure: {
      state: 'unresolved',
      ref: 'impact:unresolved',
      ownerRevision: 'impact:r3',
      actionKeys: [d('a')]
    },
    observations: []
  })).toThrow(/cannot expose an executable Action subset/u);
});

test('MainDelta is only a proposal when tree, owner revisions, and main-only closure all remain exact', () => {
  const eligible = compileMainDeltaProposalV1({
    verifiedCandidateTree: 'a'.repeat(40),
    mergedMainTree: 'a'.repeat(40),
    equivalenceClosure: {
      state: 'complete',
      observationRef: 'main-delta:closure',
      owners: [
        {
          ownerRef: 'owner:verification-policy',
          observationRef: 'owner:verification-policy:observation',
          state: 'known',
          verifiedRevision: 'policy:r1',
          currentRevision: 'policy:r1'
        },
        {
          ownerRef: 'owner:provider',
          observationRef: 'owner:provider:observation',
          state: 'known',
          verifiedRevision: 'provider:r7',
          currentRevision: 'provider:r7'
        }
      ]
    },
    mainOnlyClosure: {
      state: 'known',
      observationRef: 'main-only:closure',
      actionKeys: [d('b'), d('a')]
    }
  });
  expect(eligible.disposition).toBe('main-delta-eligible');
  expect(eligible.mainOnlyActionKeys).toEqual([d('a'), d('b')]);

  const drifted = compileMainDeltaProposalV1({
    verifiedCandidateTree: 'a'.repeat(40),
    mergedMainTree: 'b'.repeat(40),
    equivalenceClosure: {
      state: 'complete',
      observationRef: 'main-delta:closure',
      owners: [{
        ownerRef: 'owner:provider',
        observationRef: 'owner:provider:observation',
        state: 'known',
        verifiedRevision: 'provider:r7',
        currentRevision: 'provider:r8'
      }]
    },
    mainOnlyClosure: {
      state: 'unknown',
      observationRef: 'main-only:closure',
      actionKeys: [d('a')]
    }
  });
  expect(drifted.disposition).toBe('full-main-health-required');
  expect(drifted.mainOnlyActionKeys).toEqual([]);
  expect(drifted.reasonCodes).toEqual(expect.arrayContaining([
    'verified-tree-differs-from-merged-tree',
    'owner-revision-drift',
    'main-only-closure-unknown'
  ]));
});

function provider(
  overrides: Partial<{
    image: 'ready' | 'missing' | 'mismatch' | 'unknown';
    container: 'running' | 'stopped' | 'missing' | 'mismatch' | 'unknown';
    runnerRegistration: 'registered' | 'missing' | 'mismatch' | 'unknown';
    runnerProcess: 'running' | 'stopped' | 'missing' | 'mismatch' | 'unknown';
    ledger: 'current' | 'missing' | 'mismatch' | 'unknown';
  }> = {}
): ProviderEnsurePlanV1 {
  return compileProviderEnsurePlanV1({
    providerRef: 'provider:linux-verification',
    capabilityRef: 'capability:verification',
    roleRef: 'role:runner',
    image: { state: overrides.image ?? 'ready', observationRef: 'provider:image' },
    container: { state: overrides.container ?? 'running', observationRef: 'provider:container' },
    runnerRegistration: {
      state: overrides.runnerRegistration ?? 'registered',
      observationRef: 'provider:runner-registration'
    },
    runnerProcess: {
      state: overrides.runnerProcess ?? 'running',
      observationRef: 'provider:runner-process'
    },
    ledger: { state: overrides.ledger ?? 'current', observationRef: 'provider:ledger' }
  });
}

test('ProviderEnsure returns one ordered next operation without minting destructive authority', () => {
  expect(provider()).toMatchObject({
    status: 'ready',
    target: {
      providerRef: 'provider:linux-verification',
      capabilityRef: 'capability:verification',
      roleRef: 'role:runner'
    }
  });
  expect(provider({ image: 'missing', container: 'missing' }).nextAction?.kind).toBe('ensure-image');
  expect(provider({ container: 'missing' }).nextAction?.kind).toBe('create-container');
  expect(provider({ container: 'stopped' }).nextAction?.kind).toBe('start-container');
  expect(provider({ runnerRegistration: 'missing' }).nextAction?.kind).toBe('register-runner');
  expect(provider({ runnerProcess: 'stopped' }).nextAction?.kind).toBe('start-runner-process');
  expect(provider({ ledger: 'missing' }).nextAction?.kind).toBe('publish-provider-ledger');

  const mismatch = provider({ container: 'mismatch' });
  expect(mismatch.status).toBe('blocked');
  expect(mismatch.nextAction).toBeNull();
  expect(mismatch.blockerRefs).toEqual(['provider:container']);
  expect(() => compileProviderEnsurePlanV1({
    providerRef: 'provider:linux-verification',
    capabilityRef: 'capability:verification',
    roleRef: 'role:runner',
    image: { state: 'corrupt' as never, observationRef: 'provider:image' },
    container: { state: 'running', observationRef: 'provider:container' },
    runnerRegistration: { state: 'registered', observationRef: 'provider:runner-registration' },
    runnerProcess: { state: 'running', observationRef: 'provider:runner-process' },
    ledger: { state: 'current', observationRef: 'provider:ledger' }
  })).toThrow(/image state is invalid/u);
});

test('Operational terminal separates known quarantined GC from physical clean', () => {
  const dependencies = [
    { ownerRef: 'owner:branch', state: 'terminal' as const, receiptRef: 'receipt:branch' },
    { ownerRef: 'owner:worktree', state: 'terminal' as const, receiptRef: 'receipt:worktree' }
  ];
  const clean = compileOperationalTerminalProjectionV1({
    namespace: { state: 'detached', observationRef: 'namespace:detached' },
    dependencies,
    residue: { state: 'absent', observationRef: 'residue:absent' },
    retirementAuthorization: { state: 'not-required', authorityRef: 'gc:not-required' },
    gcSettlement: { state: 'completed', settlementRef: 'gc:completed' }
  });
  expect(clean).toMatchObject({
    operationalState: 'terminal',
    physicalClean: true,
    gcState: 'completed'
  });

  const quarantined = compileOperationalTerminalProjectionV1({
    namespace: { state: 'detached', observationRef: 'namespace:detached' },
    dependencies: [...dependencies].reverse(),
    residue: { state: 'exact-owned-quarantine', observationRef: 'residue:quarantine' },
    retirementAuthorization: { state: 'authorized', authorityRef: 'gc:authority' },
    gcSettlement: { state: 'pending', settlementRef: 'gc:pending' }
  });
  expect(quarantined).toMatchObject({
    operationalState: 'terminal',
    physicalClean: false,
    gcState: 'pending',
    reasonCodes: ['operational-terminal-gc-pending'],
    gcBlockerRefs: []
  });
});

test('Operational terminal blocks active owners, foreign residue, missing authority, and unknown GC', () => {
  const base = {
    namespace: { state: 'detached' as const, observationRef: 'namespace:detached' },
    dependencies: [{ ownerRef: 'owner:branch', state: 'terminal' as const, receiptRef: 'receipt:branch' }],
    residue: { state: 'exact-owned-quarantine' as const, observationRef: 'residue:quarantine' },
    retirementAuthorization: { state: 'authorized' as const, authorityRef: 'gc:authority' },
    gcSettlement: { state: 'pending' as const, settlementRef: 'gc:pending' }
  };
  expect(compileOperationalTerminalProjectionV1({
    ...base,
    dependencies: [{ ownerRef: 'owner:branch', state: 'active', receiptRef: 'receipt:branch' }]
  }).operationalState).toBe('blocked');
  expect(compileOperationalTerminalProjectionV1({
    ...base,
    residue: { state: 'foreign', observationRef: 'residue:foreign' }
  }).reasonCodes).toContain('foreign-residue');
  expect(compileOperationalTerminalProjectionV1({
    ...base,
    retirementAuthorization: { state: 'missing', authorityRef: 'gc:missing' }
  }).reasonCodes).toContain('retirement-authorization-missing');
  expect(compileOperationalTerminalProjectionV1({
    ...base,
    gcSettlement: { state: 'unknown', settlementRef: 'gc:unknown' }
  }).reasonCodes).toContain('gc-settlement-unknown');
  const physicallyBlocked = compileOperationalTerminalProjectionV1({
    ...base,
    gcSettlement: { state: 'blocked', settlementRef: 'gc:blocked' }
  });
  expect(physicallyBlocked).toMatchObject({
    operationalState: 'terminal',
    physicalClean: false,
    gcState: 'blocked',
    blockerRefs: [],
    gcBlockerRefs: ['gc:blocked']
  });
  expect(() => compileOperationalTerminalProjectionV1({
    ...base,
    namespace: { state: 'corrupt' as never, observationRef: 'namespace:corrupt' }
  })).toThrow(/namespace state is invalid/u);
});
