import { expect, test } from 'bun:test';

import {
  GENERATED_STATE_REGISTRY,
  createGeneratedStateWorktreeRetirement,
  generatedStateCleanupAllowed,
  generatedStateDomainProviderMaterialDigest,
  generatedStateRuleForPath,
  parseGeneratedStateRegistry,
  type GeneratedStateInventoryEntry
} from './contract.ts';

function entry(
  stateClass: GeneratedStateInventoryEntry['stateClass'],
  registrationState: GeneratedStateInventoryEntry['registrationState'],
  settlement: GeneratedStateInventoryEntry['settlement'],
  cleanupProfiles: GeneratedStateInventoryEntry['cleanupProfiles']
): GeneratedStateInventoryEntry {
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
  expect(generatedStateRuleForPath('node_modules')?.id).toBe('compiler-node-modules');
  expect(generatedStateRuleForPath('.tmp/dependency-installs/c.staging-real')?.id)
    .toBe('compiler-dependency-staging');
  expect(generatedStateRuleForPath('.tmp/codex')).toMatchObject({
    id: 'codex-control-plane-state',
    registration: 'domain-owned',
    physicalForms: [{ settlementEffect: 'domain-owner-only' }]
  });
  expect(generatedStateRuleForPath('.tmp/import-candidate-snapshots')).toBeNull();
  expect(generatedStateRuleForPath(
    '.tmp/import-candidate-snapshots/snapshot-operation-1'
  )?.id).toBe('import-candidate-snapshots');
  expect(generatedStateRuleForPath('.tmp/typecheck')).toBeNull();
  expect(generatedStateRuleForPath('.tmp/reachability-census.json')).toBeNull();
  expect(generatedStateRuleForPath('.tmp/unregistered-surprise')).toBeNull();
  expect(GENERATED_STATE_REGISTRY.rules.some(({ selector }) => (
    selector.kind === 'exact' && selector.path === '.tmp'
  ))).toBeFalse();
});

test('registration and retirement are required before any cleanup profile can authorize a root', () => {
  expect(generatedStateCleanupAllowed({
    entry: entry('rebuildable-derived-cache', 'missing', 'blocked', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowed({
    entry: entry('rebuildable-derived-cache', 'active', 'protected', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowed({
    entry: entry('rebuildable-derived-cache', 'retired', 'ready', ['all-rebuildable']),
    profile: 'all-rebuildable'
  })).toBeTrue();
  expect(generatedStateCleanupAllowed({
    entry: entry('identity-bound-control-state', 'retired', 'ready', []),
    profile: 'all-rebuildable'
  })).toBeFalse();
  expect(generatedStateCleanupAllowed({
    entry: entry('active-ephemeral-workspace', 'retired', 'ready', ['automatic', 'safe']),
    profile: 'automatic'
  })).toBeTrue();
});

test('registry parser rejects ambiguous selectors, unknown fields and invented cleanup profiles', () => {
  const rule = GENERATED_STATE_REGISTRY.rules[0]!;
  const raw = {
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule }, { ...rule, id: 'second-id' }]
  };
  expect(() => parseGeneratedStateRegistry(raw)).toThrow(/selector is duplicate/u);
  expect(() => parseGeneratedStateRegistry({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, cleanupProfiles: ['delete-everything'] }]
  })).toThrow(/cleanupProfiles/u);
  expect(() => parseGeneratedStateRegistry({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, extraAuthority: true }]
  })).toThrow(/keys are not canonical/u);
  expect(() => parseGeneratedStateRegistry({
    schema: 'sec-generated-state-registry-v1',
    rules: [{
      ...rule,
      physicalForms: [{
        kind: 'link',
        contentsPolicy: 'owner-bound-locator',
        settlementEffect: 'domain-owner-only',
        worktreeRetirement: { mode: 'preserve' }
      }]
    }]
  })).toThrow(/cannot generically preserve a locator/u);
  expect(() => parseGeneratedStateRegistry({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, physicalForms: [rule.physicalForms[0], rule.physicalForms[0]] }]
  })).toThrow(/duplicate kinds/u);
  expect(() => parseGeneratedStateRegistry({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, registration: 'required-at-birth', activeOwnerSignal: 'domain-owner-receipt' }]
  })).toThrow(/registration and activeOwnerSignal disagree/u);
});

test('domain worktree retirement receipts bind provider bytes and require no retention root', () => {
  const providerId = 'compiler-dependency-locator';
  const providerReceiptBytes = '{"outcome":"removed"}';
  const receipt = createGeneratedStateWorktreeRetirement({
    operationId: `sha256:${'1'.repeat(64)}`,
    repositoryRoot: 'D:\\repo',
    workspacePath: 'D:\\repo-worktree',
    workspace: { device: '1', inode: '2', objectId: '3' },
    worktree: { branch: 'refs/heads/fix/test', headSha: 'a'.repeat(40), treeSha: 'b'.repeat(40) },
    statusDigest: `sha256:${'2'.repeat(64)}`,
    inventoryDigest: `sha256:${'3'.repeat(64)}`,
    retentionRoot: null,
    entries: [{
      relativePath: 'node_modules',
      source: { device: '4', inode: '5', objectId: '6' },
      inventoryDigest: `sha256:${'4'.repeat(64)}`,
      ruleIds: ['compiler-node-modules'],
      action: 'domain-retired',
      providerId,
      providerPlanDigest: `sha256:${'5'.repeat(64)}`,
      providerReceiptBytes,
      providerReceiptDigest: generatedStateDomainProviderMaterialDigest(
        providerId,
        'receipt',
        providerReceiptBytes
      )
    }],
    blockers: []
  });
  expect(receipt.retentionRoot).toBeNull();
  expect(receipt.entries[0]).toMatchObject({ action: 'domain-retired', providerId });
  const domainEntry = receipt.entries[0]!;
  if (domainEntry.action !== 'domain-retired') throw new Error('Expected domain-retired fixture entry.');
  expect(() => createGeneratedStateWorktreeRetirement({
    ...receipt,
    entries: [{ ...domainEntry, providerReceiptBytes: '{"outcome":"replaced"}' }]
  })).toThrow(/receipt digest is invalid/u);
});
