import { expect, test } from 'bun:test';

import {
  GENERATED_STATE_REGISTRY_V1,
  createGeneratedStateInventoryV1,
  generatedStateCleanupAllowedV1,
  generatedStateRuleForPathV1,
  parseGeneratedStateRegistryV1,
  projectGeneratedStateEnclosingWorkspaceRetirementV1,
  type GeneratedStateInventoryEntryV1,
  type GeneratedStateInventoryV1
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

test('enclosing workspace retirement admits only recomputable roots and empty recovery containers', () => {
  const entries: GeneratedStateInventoryV1['entries'] = Object.freeze([
    {
      ...entry('external-provider-cache', 'missing', 'protected', ['all-rebuildable']),
      relativePath: '.shared-deps',
      ruleId: 'shared-dependency-cache',
      owner: 'project-runtime',
      blockers: Object.freeze(['registration-missing'])
    },
    {
      ...entry('rebuildable-derived-cache', 'active', 'protected', ['all-rebuildable']),
      blockers: Object.freeze(['owner-active'])
    },
    {
      ...entry('recovery-authority', 'not-required', 'protected', []),
      relativePath: '.tmp/dependency-installs/compiler-backups',
      ruleId: 'compiler-dependency-backups',
      owner: 'compiler-dependency-runtime',
      registrationDigest: null
    },
    {
      ...entry('rebuildable-derived-cache', 'not-required', 'protected', []),
      relativePath: '.tmp/test-impact-cache.json',
      kind: 'file',
      ruleId: 'test-impact-cache',
      owner: 'semantic-test-impact',
      registrationDigest: null
    }
  ]);
  const inventory = createGeneratedStateInventoryV1({
    repositoryRoot: 'D:/Project/sec',
    workspace: { device: '1', inode: '2', objectId: '3' },
    workspaceRegistration: 'registered' as const,
    entries,
    blockers: Object.freeze(['.shared-deps:registration-missing'])
  });
  const ready = projectGeneratedStateEnclosingWorkspaceRetirementV1({
    inventory,
    ignoredRoots: ['.shared-deps', '.tmp', 'node_modules'],
    physicallyEmptyRoots: ['.tmp/dependency-installs/compiler-backups']
  });
  expect(ready.status).toBe('ready');
  expect(ready.admitted.map(({ relativePath }) => relativePath)).toEqual([
    '.shared-deps',
    '.tmp/dependency-installs/compiler-backups',
    '.tmp/test-impact-cache.json',
    'node_modules'
  ]);
  const blocked = projectGeneratedStateEnclosingWorkspaceRetirementV1({
    inventory: createGeneratedStateInventoryV1({
      repositoryRoot: inventory.repositoryRoot,
      workspace: inventory.workspace,
      workspaceRegistration: inventory.workspaceRegistration,
      entries: Object.freeze([...entries, {
        ...entry('unknown-unclassified', 'missing', 'blocked', []),
        relativePath: '.tmp/unknown',
        ruleId: null,
        owner: null,
        blockers: Object.freeze(['unknown-generated-state']),
        registrationDigest: null
      }]),
      blockers: inventory.blockers
    }),
    ignoredRoots: ['.tmp'],
    physicallyEmptyRoots: ['.tmp/dependency-installs/compiler-backups']
  });
  expect(blocked.status).toBe('blocked');
  expect(blocked.blockers).toContain('.tmp/unknown:unknown-or-unbound');
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
