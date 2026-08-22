import { expect, test } from 'bun:test';

import {
  GENERATED_STATE_REGISTRY_V1,
  generatedStateCleanupAllowedV1,
  generatedStateRuleForPathV1,
  parseGeneratedStateRegistryV1,
  type GeneratedStateInventoryEntryV1
} from '../../platform/shared/generated-state-contract.ts';

function entry(
  stateClass: GeneratedStateInventoryEntryV1['stateClass'],
  registrationState: GeneratedStateInventoryEntryV1['registrationState'],
  settlement: GeneratedStateInventoryEntryV1['settlement'],
  cleanupProfiles: GeneratedStateInventoryEntryV1['cleanupProfiles']
): GeneratedStateInventoryEntryV1 {
  return Object.freeze({
    relativePath: 'node_modules',
    kind: 'directory',
    ruleId: 'compiler-node-modules',
    owner: 'compiler-dependency-runtime',
    stateClass,
    registrationState,
    cleanupProfiles,
    settlement,
    blockers: Object.freeze([]),
    physicalIdentity: Object.freeze({ device: '1', inode: '2', objectId: '3' }),
    registrationDigest: `sha256:${'a'.repeat(64)}`
  });
}

test('registry maps stable producer roots without a catch-all tmp rule', () => {
  expect(generatedStateRuleForPathV1('node_modules')?.id).toBe('compiler-node-modules');
  expect(generatedStateRuleForPathV1('.tmp/dependency-installs/c.staging-real')?.id)
    .toBe('compiler-dependency-staging');
  expect(generatedStateRuleForPathV1('.tmp/codex')).toBeNull();
  expect(generatedStateRuleForPathV1('.tmp/import-candidate-snapshots')).toBeNull();
  expect(generatedStateRuleForPathV1(
    '.tmp/import-candidate-snapshots/snapshot-operation-1'
  )?.id).toBe('import-candidate-snapshots');
  expect(generatedStateRuleForPathV1('.tmp/test-impact-cache.json')).toMatchObject({
    id: 'test-impact-cache',
    registration: 'domain-owned',
    settlementEffect: 'domain-owner-only'
  });
  expect(generatedStateRuleForPathV1('.tmp/typecheck')).toBeNull();
  expect(generatedStateRuleForPathV1('.tmp/reachability-census.json')).toBeNull();
  expect(generatedStateRuleForPathV1('.tmp/unregistered-surprise')).toBeNull();
  expect(GENERATED_STATE_REGISTRY_V1.rules.some(({ selector }) => (
    selector.kind === 'exact' && selector.path === '.tmp'
  ))).toBeFalse();
});

test('registration and retirement are required before any cleanup profile can authorize a root', () => {
  expect(generatedStateCleanupAllowedV1({
    entry: entry('rebuildable-derived-cache', 'missing', 'blocked', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowedV1({
    entry: entry('rebuildable-derived-cache', 'active', 'protected', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowedV1({
    entry: entry('rebuildable-derived-cache', 'retired', 'ready', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeTrue();
  expect(generatedStateCleanupAllowedV1({
    entry: entry('identity-bound-control-state', 'retired', 'ready', []),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowedV1({
    entry: entry('active-ephemeral-workspace', 'retired', 'ready', ['automatic', 'safe']),
    profile: 'automatic'
  })).toBeTrue();
});

test('registry parser rejects ambiguous selectors, unknown fields and invented cleanup profiles', () => {
  const rule = GENERATED_STATE_REGISTRY_V1.rules[0]!;
  const raw = {
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule }, { ...rule, id: 'second-id' }]
  };
  expect(() => parseGeneratedStateRegistryV1(raw)).toThrow(/selector is duplicate/u);
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, cleanupProfiles: ['delete-everything'] }]
  })).toThrow(/cleanupProfiles/u);
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, extraAuthority: true }]
  })).toThrow(/keys are not canonical/u);
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, contentsPolicy: 'ordinary-file' }]
  })).toThrow(/rootKind and contentsPolicy disagree/u);
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, registration: 'required-at-birth', activeOwnerSignal: 'domain-owner-receipt' }]
  })).toThrow(/registration and activeOwnerSignal disagree/u);
});
