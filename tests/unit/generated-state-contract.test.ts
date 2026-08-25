import { expect, test } from 'bun:test';

import {
  GENERATED_STATE_REGISTRY_V1,
  createGeneratedStateResourceReceiptV1,
  createGeneratedStateResourceRegistrationV1,
  createGeneratedStateWorktreeRetirementV1,
  generatedStateCleanupAllowedV1,
  generatedStateDigestV1,
  generatedStateDomainProviderMaterialDigestV1,
  generatedStateResourceReclaimabilityV1,
  generatedStateRuleForPathV1,
  parseGeneratedStateRegistryV1,
  parseGeneratedStateResourceRegistrationV1,
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

function terminalResourceRegistration(
  active: ReturnType<typeof createGeneratedStateResourceRegistrationV1>
) {
  const { registrationDigest: _registrationDigest, ...activeMaterial } = active;
  const outcomeDigest = generatedStateDigestV1({
    schema: 'sec-generated-state-resource-terminal-outcome-v1',
    resourceId: active.resourceId,
    outcome: 'contract-test-terminal'
  });
  const material = {
    ...activeMaterial,
    lease: { ...active.lease, state: 'released' as const },
    terminalObligation: {
      state: 'satisfied' as const,
      settlementRef: generatedStateDigestV1({
        schema: 'sec-generated-state-resource-terminal-v1',
        resourceId: active.resourceId,
        registrationDigest: active.registrationDigest,
        outcomeDigest
      }),
      outcomeDigest
    },
    phase: 'operational-terminal' as const
  };
  return parseGeneratedStateResourceRegistrationV1({
    ...material,
    registrationDigest: generatedStateDigestV1(material)
  });
}

test('registry maps stable producer roots without a catch-all tmp rule', () => {
  expect(generatedStateRuleForPathV1('node_modules')?.id).toBe('compiler-node-modules');
  expect(generatedStateRuleForPathV1('.tmp/dependency-installs/c.staging-real')?.id)
    .toBe('compiler-dependency-staging');
  expect(generatedStateRuleForPathV1('.tmp/codex')).toMatchObject({
    id: 'codex-control-plane-state',
    registration: 'domain-owned',
    physicalForms: [{ settlementEffect: 'domain-owner-only' }]
  });
  expect(generatedStateRuleForPathV1('.tmp/import-candidate-snapshots')).toBeNull();
  expect(generatedStateRuleForPathV1('.sec/import-authoring-freeze')).toMatchObject({
    id: 'import-authoring-freeze',
    producer: 'import-authoring-freeze',
    reconstruction: 'producer-recompute'
  });
  expect(generatedStateRuleForPathV1(
    '.tmp/import-candidate-snapshots/snapshot-operation-1'
  )?.id).toBe('import-candidate-snapshots');
  expect(generatedStateRuleForPathV1('.tmp/test-impact-cache.json')).toBeNull();
  expect(generatedStateRuleForPathV1('.shared-deps')).toMatchObject({
    id: 'shared-dependency-cache',
    owner: 'project-runtime',
    stateClass: 'external-provider-cache',
    registration: 'required-at-birth'
  });
  expect(generatedStateRuleForPathV1('.shared-deps/test-impact-cache.json')).toBeNull();
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
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, physicalForms: [rule.physicalForms[0], rule.physicalForms[0]] }]
  })).toThrow(/duplicate kinds/u);
  expect(() => parseGeneratedStateRegistryV1({
    schema: 'sec-generated-state-registry-v1',
    rules: [{ ...rule, registration: 'required-at-birth', activeOwnerSignal: 'domain-owner-receipt' }]
  })).toThrow(/registration and activeOwnerSignal disagree/u);
});

test('domain worktree retirement receipts bind provider bytes and require no retention root', () => {
  const providerId = 'compiler-dependency-locator';
  const providerReceiptBytes = '{"outcome":"removed"}';
  const receipt = createGeneratedStateWorktreeRetirementV1({
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
      providerReceiptDigest: generatedStateDomainProviderMaterialDigestV1(
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
  expect(() => createGeneratedStateWorktreeRetirementV1({
    ...receipt,
    entries: [{ ...domainEntry, providerReceiptBytes: '{"outcome":"replaced"}' }]
  })).toThrow(/receipt digest is invalid/u);
});

test('resource birth binds one owner lease, physical identity and consumer-zero retention', () => {
  const rule = GENERATED_STATE_REGISTRY_V1.rules.find(({ id }) => id === 'compiler-dependency-staging');
  if (rule === undefined) throw new Error('generated-state fixture rule is absent.');
  const registration = createGeneratedStateResourceRegistrationV1({
    resourceId: `sha256:${'1'.repeat(64)}`,
    repositoryRoot: 'D:\\repo',
    workspace: { device: '1', inode: '2', objectId: '3' },
    rule,
    relativePath: '.tmp/dependency-installs/c.staging-contract',
    root: { device: '4', inode: '5', objectId: '6' },
    rootKind: 'directory',
    operationId: 'operation:contract'
  });

  expect(registration).toMatchObject({
    phase: 'active',
    lease: { state: 'held', owner: rule.owner, operationId: 'operation:contract' },
    retention: { policy: 'consumer-zero', consumers: [] },
    terminalObligation: { state: 'open', settlementRef: null, outcomeDigest: null },
    transitionEpoch: 0
  });
  expect(parseGeneratedStateResourceRegistrationV1(JSON.parse(JSON.stringify(registration))))
    .toEqual(registration);
  expect(generatedStateResourceReclaimabilityV1({
    registration,
    observedRoot: registration.root,
    observedKind: 'directory'
  })).toBe('blocked');
  expect(() => parseGeneratedStateResourceRegistrationV1({
    ...registration,
    lease: { ...registration.lease, owner: 'foreign-owner' }
  })).toThrow(/lease is not bound|digest is invalid/u);
  expect(() => parseGeneratedStateResourceRegistrationV1({
    ...registration,
    transitionEpoch: 1
  })).toThrow(/digest is invalid/u);
  expect(() => parseGeneratedStateResourceRegistrationV1({
    ...registration,
    terminalObligation: { state: 'open', settlementRef: null }
  })).toThrow(/keys are not canonical/u);
});

test('resource reclaimability distinguishes explicit missing from unresolved null observations', () => {
  const rule = GENERATED_STATE_REGISTRY_V1.rules.find(({ id }) => id === 'compiler-dependency-staging');
  if (rule === undefined) throw new Error('generated-state fixture rule is absent.');
  const nullRoot = createGeneratedStateResourceRegistrationV1({
    resourceId: `sha256:${'4'.repeat(64)}`,
    repositoryRoot: 'D:\\repo',
    workspace: { device: '1', inode: '2', objectId: '3' },
    rule,
    relativePath: '.tmp/dependency-installs/c.staging-contract-null-root',
    root: null,
    rootKind: null,
    operationId: 'operation:contract-null-root'
  });
  const boundRoot = { device: '4', inode: '5', objectId: '6' } as const;
  const nonNullRoot = createGeneratedStateResourceRegistrationV1({
    resourceId: `sha256:${'5'.repeat(64)}`,
    repositoryRoot: 'D:\\repo',
    workspace: { device: '1', inode: '2', objectId: '3' },
    rule,
    relativePath: '.tmp/dependency-installs/c.staging-contract-bound-root',
    root: boundRoot,
    rootKind: 'directory',
    operationId: 'operation:contract-bound-root'
  });
  const terminalNullRoot = terminalResourceRegistration(nullRoot);
  const terminalNonNullRoot = terminalResourceRegistration(nonNullRoot);

  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNullRoot,
    observedRoot: null,
    observedKind: 'missing'
  })).toBe('eligible');
  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNullRoot,
    observedRoot: null,
    observedKind: null
  })).toBe('unknown');
  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNonNullRoot,
    observedRoot: null,
    observedKind: 'missing'
  })).toBe('eligible');
  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNonNullRoot,
    observedRoot: null,
    observedKind: null
  })).toBe('unknown');
  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNonNullRoot,
    observedRoot: boundRoot,
    observedKind: 'directory'
  })).toBe('eligible');
  expect(generatedStateResourceReclaimabilityV1({
    registration: terminalNonNullRoot,
    observedRoot: null,
    observedKind: 'directory'
  })).toBe('unknown');
});

test('resource receipts keep operational terminal, physical clean and GC pending disjoint', () => {
  const base = {
    resourceId: `sha256:${'2'.repeat(64)}` as const,
    registrationDigest: `sha256:${'3'.repeat(64)}` as const,
    repositoryRoot: 'D:\\repo',
    workspace: { device: '1', inode: '2', objectId: '3' },
    relativePath: '.tmp/dependency-installs/c.staging-receipt',
    phase: 'operational-terminal' as const,
    operationalTerminal: true,
    consumerCount: 0,
    observedRoot: { device: '4', inode: '5', objectId: '6' },
    blockers: [] as const
  };
  const pending = createGeneratedStateResourceReceiptV1({
    ...base,
    physicalClean: false,
    gcPending: true,
    reclaimability: 'eligible'
  });
  expect(pending).toMatchObject({ operationalTerminal: true, physicalClean: false, gcPending: true });
  const clean = createGeneratedStateResourceReceiptV1({
    ...base,
    physicalClean: true,
    gcPending: false,
    reclaimability: 'eligible',
    observedRoot: null
  });
  expect(clean).toMatchObject({ operationalTerminal: true, physicalClean: true, gcPending: false });
  expect(() => createGeneratedStateResourceReceiptV1({
    ...base,
    physicalClean: true,
    gcPending: true,
    reclaimability: 'eligible'
  })).toThrow(/physicalClean/u);
});
