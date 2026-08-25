import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../platform/shared/canonical-primitives.ts';
import { generatedStateDomainProviderMaterialDigestV1 } from '../../platform/shared/generated-state-contract.ts';
import { runCommandBytes } from '../../platform/shared/process.ts';
import {
  addGeneratedStateResourceConsumerV1,
  assertGeneratedStateWorktreeRetirementEffectStartV1,
  bindGeneratedStateResourceIdentityV1,
  generatedStateProducerHooksV1,
  inspectGeneratedStateV1,
  markGeneratedStateOperationalTerminalV1,
  observeGeneratedStateResourceV1,
  planGeneratedStateCleanupV1,
  registerGeneratedStateResourceBirthV1,
  removeGeneratedStateResourceConsumerV1,
  settleGeneratedStateForWorktreeRetirementV1,
  settleGeneratedStateResourceV1,
  settleGeneratedStateV1,
  type GeneratedStateWorktreeRetirementProviderV1
} from '../../tooling/sec-dev/generated-state-lifecycle.ts';

const roots: string[] = [];
const LIFECYCLE_FIXTURE_PATH = '.tmp/dependency-installs/c.staging-lifecycle-fixture';

function fixtureRoot(repositoryRoot: string): string {
  return path.join(repositoryRoot, ...LIFECYCLE_FIXTURE_PATH.split('/'));
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture() {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-state-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  await mkdir(repositoryRoot);
  const environment = {
    ...process.env,
    SEC_STATE_HOME: stateRoot,
    SEC_CACHE_HOME: cacheRoot
  };
  const options = {
    environment,
    runGit: async () => ({ code: 1, stdout: new Uint8Array(), stderr: 'not registered' })
  } as const;
  return { cacheRoot, options, repositoryRoot, stateRoot };
}

async function absent(target: string): Promise<boolean> {
  return stat(target).then(() => false, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return true;
    throw error;
  });
}

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runCommandBytes('git', args, { cwd });
  if (result.code !== 0) {
    throw new Error(Buffer.from(result.stderr).toString('utf8'));
  }
}

async function registeredWorktreeFixture() {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-worktree-retirement-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const workspaceRoot = path.join(hostRoot, 'candidate');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  await mkdir(repositoryRoot);
  await git(repositoryRoot, ['init', '-b', 'main']);
  await git(repositoryRoot, ['config', 'user.email', 'sec@example.invalid']);
  await git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
  await writeFile(path.join(repositoryRoot, '.gitignore'), '.sec/\n.shared-deps/\n.tmp/\nnode_modules/\n');
  await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'tracked\n');
  await git(repositoryRoot, ['add', '.gitignore', 'tracked.txt']);
  await git(repositoryRoot, ['commit', '-m', 'fixture']);
  await git(repositoryRoot, ['worktree', 'add', '-b', 'candidate', workspaceRoot]);
  const head = await runCommandBytes('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot });
  const tree = await runCommandBytes('git', ['rev-parse', 'HEAD^{tree}'], { cwd: workspaceRoot });
  return {
    repositoryRoot,
    workspaceRoot,
    headSha: Buffer.from(head.stdout).toString('utf8').trim(),
    treeSha: Buffer.from(tree.stdout).toString('utf8').trim(),
    options: { environment: { ...process.env, SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot } }
  } as const;
}

test('inspect is zero-write and protects one ignored unknown root', async () => {
  const { cacheRoot, options, repositoryRoot, stateRoot } = await fixture();
  await mkdir(path.join(repositoryRoot, '.tmp', 'mystery'), { recursive: true });

  const inventory = await inspectGeneratedStateV1({ repositoryRoot }, options);

  expect(inventory.entries.find(({ relativePath }) => relativePath === '.tmp/mystery')).toMatchObject({
    stateClass: 'unknown-unclassified',
    settlement: 'blocked',
    blockers: ['unknown-generated-state']
  });
  expect(await absent(stateRoot)).toBe(true);
  expect(await absent(cacheRoot)).toBe(true);
});

test('worktree retirement preserves one covered ignored root outside the target and binds Effect-start identity', async () => {
  const fixture = await registeredWorktreeFixture();
  await mkdir(path.join(fixture.workspaceRoot, '.shared-deps'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.shared-deps', 'cache.bin'), 'cache');

  const receipt = await settleGeneratedStateForWorktreeRetirementV1(
    {
      repositoryRoot: fixture.repositoryRoot,
      workspaceRoot: fixture.workspaceRoot,
      expectedBranch: 'candidate',
      expectedHeadSha: fixture.headSha,
      expectedTreeSha: fixture.treeSha
    },
    fixture.options
  );

  expect(receipt).not.toBeNull();
  expect(receipt).toMatchObject({ terminal: 'completed' });
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual(['.shared-deps']);
  const persistedReceipt = JSON.parse(JSON.stringify(canonicalJson(receipt))) as NonNullable<typeof receipt>;
  expect(await absent(path.join(fixture.workspaceRoot, '.shared-deps'))).toBe(true);
  expect(() =>
    assertGeneratedStateWorktreeRetirementEffectStartV1({
      receipt: persistedReceipt,
      repositoryRoot: fixture.repositoryRoot,
      workspaceRoot: fixture.workspaceRoot,
      expectedBranch: 'candidate',
      expectedHeadSha: fixture.headSha,
      expectedTreeSha: fixture.treeSha
    })
  ).not.toThrow();

  await mkdir(path.join(fixture.workspaceRoot, '.shared-deps'));
  expect(() =>
    assertGeneratedStateWorktreeRetirementEffectStartV1({
      receipt: persistedReceipt,
      repositoryRoot: fixture.repositoryRoot,
      workspaceRoot: fixture.workspaceRoot,
      expectedBranch: 'candidate',
      expectedHeadSha: fixture.headSha,
      expectedTreeSha: fixture.treeSha
    })
  ).toThrow('source reappeared');
});

test('worktree retirement resumes the exact durable intent after interruption between root relocations', async () => {
  const fixture = await registeredWorktreeFixture();
  await mkdir(path.join(fixture.workspaceRoot, '.shared-deps'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.shared-deps', 'cache.bin'), 'cache');
  const input = {
    repositoryRoot: fixture.repositoryRoot,
    workspaceRoot: fixture.workspaceRoot,
    expectedBranch: 'candidate',
    expectedHeadSha: fixture.headSha,
    expectedTreeSha: fixture.treeSha
  } as const;
  let interrupted = false;

  await expect(settleGeneratedStateForWorktreeRetirementV1(input, {
    ...fixture.options,
    afterWorktreeRetirementRelocation: (relativePath) => {
      if (!interrupted) {
        interrupted = true;
        throw new Error(`fixture interruption after ${relativePath}`);
      }
    }
  })).rejects.toThrow('fixture interruption');

  const receipt = await settleGeneratedStateForWorktreeRetirementV1(input, fixture.options);
  expect(receipt).toMatchObject({ terminal: 'completed' });
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual(['.shared-deps']);
  expect(await absent(path.join(fixture.workspaceRoot, '.shared-deps'))).toBe(true);
});

test('worktree retirement delegates an exact locator to its domain provider and preserves the external generation', async () => {
  const fixture = await registeredWorktreeFixture();
  const generationRoot = path.join(path.dirname(fixture.repositoryRoot), 'external-generation');
  await mkdir(generationRoot);
  await writeFile(path.join(generationRoot, 'sentinel.txt'), 'preserve');
  const locatorPath = path.join(fixture.workspaceRoot, 'node_modules');
  await symlink(generationRoot, locatorPath, process.platform === 'win32' ? 'junction' : 'dir');
  const lifecycle = generatedStateProducerHooksV1(
    { repositoryRoot: fixture.repositoryRoot, workspaceRoot: fixture.workspaceRoot },
    fixture.options
  );
  await lifecycle.born('node_modules', 'compiler-dependency-bridge:fixture');
  await lifecycle.retired('node_modules', 'external-generation-bridge-ready');
  const input = {
    repositoryRoot: fixture.repositoryRoot,
    workspaceRoot: fixture.workspaceRoot,
    expectedBranch: 'candidate',
    expectedHeadSha: fixture.headSha,
    expectedTreeSha: fixture.treeSha
  } as const;

  await expect(settleGeneratedStateForWorktreeRetirementV1(input, fixture.options))
    .rejects.toThrow('provider is unavailable or ambiguous');
  expect(await absent(locatorPath)).toBe(false);

  const providerId = 'compiler-dependency-locator';
  const provider: GeneratedStateWorktreeRetirementProviderV1 =
  Object.freeze<GeneratedStateWorktreeRetirementProviderV1>({
    id: providerId,
    plan: async ({ source }) => {
      const bytes = JSON.stringify(canonicalJson({ schema: 'fixture-locator-plan-v1', source }));
      return Object.freeze({
        bytes,
        digest: generatedStateDomainProviderMaterialDigestV1(providerId, 'plan', bytes)
      });
    },
    retire: async ({ planBytes, planDigest }) => {
      expect(planDigest).toBe(generatedStateDomainProviderMaterialDigestV1(providerId, 'plan', planBytes));
      const outcome = await absent(locatorPath) ? 'resumed-absent' : 'removed';
      if (outcome === 'removed') await unlink(locatorPath);
      const bytes = JSON.stringify(canonicalJson({ schema: 'fixture-locator-receipt-v1', outcome }));
      return Object.freeze({
        bytes,
        digest: generatedStateDomainProviderMaterialDigestV1(providerId, 'receipt', bytes)
      });
    }
  });
  let interrupted = false;
  await expect(settleGeneratedStateForWorktreeRetirementV1(input, {
    ...fixture.options,
    worktreeRetirementProviders: [provider],
    afterWorktreeRetirementProviderEffect: () => {
      if (interrupted) return;
      interrupted = true;
      throw new Error('fixture interruption after provider effect');
    }
  })).rejects.toThrow('fixture interruption after provider effect');
  expect(await absent(locatorPath)).toBe(true);
  const receipt = await settleGeneratedStateForWorktreeRetirementV1(input, {
    ...fixture.options,
    worktreeRetirementProviders: [provider]
  });
  expect(receipt).toMatchObject({
    terminal: 'completed',
    retentionRoot: null,
    entries: [{ relativePath: 'node_modules', action: 'domain-retired', providerId }]
  });
  expect(await absent(locatorPath)).toBe(true);
  expect(await absent(path.join(generationRoot, 'sentinel.txt'))).toBe(false);
});

test('worktree retirement blocks one unknown ignored descendant before moving any root', async () => {
  const fixture = await registeredWorktreeFixture();
  await mkdir(path.join(fixture.workspaceRoot, '.sec', 'foreign-dir'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.sec', 'foreign-dir', 'keep.txt'), 'foreign');
  await mkdir(path.join(fixture.workspaceRoot, '.shared-deps'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.shared-deps', 'cache.bin'), 'cache');

  await expect(
    settleGeneratedStateForWorktreeRetirementV1(
      {
        repositoryRoot: fixture.repositoryRoot,
        workspaceRoot: fixture.workspaceRoot,
        expectedBranch: 'candidate',
        expectedHeadSha: fixture.headSha,
        expectedTreeSha: fixture.treeSha
      },
      fixture.options
    )
  ).rejects.toThrow('unknown ignored root');
  expect(await absent(path.join(fixture.workspaceRoot, '.sec', 'foreign-dir', 'keep.txt'))).toBe(false);
  expect(await absent(path.join(fixture.workspaceRoot, '.shared-deps', 'cache.bin'))).toBe(false);
});

test('birth and retirement are owner-generated and make only the exact retired root selectable', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  let clock = new Date('2026-08-23T01:00:00.000Z');
  const lifecycle = generatedStateProducerHooksV1(
    { repositoryRoot },
    { ...options, clock: () => clock }
  );
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-1');
  const activeInventory = await inspectGeneratedStateV1({ repositoryRoot }, options);
  expect(activeInventory.blockers).toEqual([]);
  expect(activeInventory.entries.find(
    ({ relativePath }) => relativePath === LIFECYCLE_FIXTURE_PATH
  )).toMatchObject({ registrationState: 'active', settlement: 'protected' });

  clock = new Date('2026-08-23T01:01:00.000Z');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');
  const inventory = await inspectGeneratedStateV1({ repositoryRoot }, options);
  expect(planGeneratedStateCleanupV1({ inventory, profile: 'automatic' })).toEqual({
    selected: [LIFECYCLE_FIXTURE_PATH],
    protected: []
  });
});

test('a new caller cannot retire a registration it did not birth or adopt in its producer session', async () => {
  const { options, repositoryRoot } = await fixture();
  await mkdir(fixtureRoot(repositoryRoot), { recursive: true });
  const ownerSession = generatedStateProducerHooksV1({ repositoryRoot }, options);
  const foreignSession = generatedStateProducerHooksV1({ repositoryRoot }, options);

  await ownerSession.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-session');
  await expect(foreignSession.retired(LIFECYCLE_FIXTURE_PATH, 'caller-invented-retirement'))
    .rejects.toThrow(/same producer session/u);

  expect((await inspectGeneratedStateV1({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({ registrationState: 'active', settlement: 'protected' });
});

test('cleanup quarantines, bounded-deletes and reads back one retired physical generation', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  await mkdir(path.join(repositoryRoot, '.tmp', 'foreign-sibling'));
  await writeFile(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'), 'foreign');
  const lifecycle = generatedStateProducerHooksV1({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-2');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);

  expect(receipt.terminal).toBe('completed');
  expect(receipt.selected).toEqual([LIFECYCLE_FIXTURE_PATH]);
  expect(receipt.attempts.map(({ action }) => action)).toEqual(['quarantined', 'deleted']);
  expect(await absent(generatedRoot)).toBe(true);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
  expect((await inspectGeneratedStateV1({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).blockers).toEqual([]);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'))).toBe(false);
});

test('unregistered reparse roots are protected without following their targets', async () => {
  const { options, repositoryRoot } = await fixture();
  const outside = path.join(path.dirname(repositoryRoot), 'outside');
  await mkdir(outside);
  await mkdir(path.join(repositoryRoot, '.tmp'), { recursive: true });
  await mkdir(path.dirname(fixtureRoot(repositoryRoot)), { recursive: true });
  await symlink(outside, fixtureRoot(repositoryRoot), 'junction');
  const linked = await inspectGeneratedStateV1({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);
  expect(linked.entries[0]).toMatchObject({
    kind: 'link',
    settlement: 'protected',
    blockers: ['registration-missing', 'root-kind-differs-from-policy']
  });
});

test('a generation replaced after inventory is preserved as residue', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  const replacementRoot = path.join(repositoryRoot, '.tmp', 'replacement');
  await mkdir(generatedRoot, { recursive: true });
  await mkdir(replacementRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'original.txt'), 'original');
  await writeFile(path.join(replacementRoot, 'replacement.txt'), 'replacement');
  const lifecycle = generatedStateProducerHooksV1({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-race');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, {
    ...options,
    beforeCleanupEffect: async () => {
      await rename(generatedRoot, path.join(repositoryRoot, '.tmp', 'original-moved'));
      await rename(replacementRoot, generatedRoot);
    }
  });

  expect(receipt.terminal).toBe('partial-residue');
  expect(receipt.blockers).toEqual([
    `${LIFECYCLE_FIXTURE_PATH}:changed-after-inventory-or-unsupported-kind`
  ]);
  expect(await absent(path.join(generatedRoot, 'replacement.txt'))).toBe(false);
}, 10_000);

test('an interrupted quarantine resumes from durable intent without rediscovering ownership', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooksV1({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-interrupted');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const interrupted = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, {
    ...options,
    afterQuarantineEffect: () => {
      throw new Error('injected process interruption');
    }
  });
  expect(interrupted.terminal).toBe('partial-residue');
  expect(await absent(generatedRoot)).toBe(true);

  const resumed = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);
  expect(resumed.terminal).toBe('completed');
  expect(resumed.attempts.map(({ action }) => action)).toEqual(['deleted']);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
});

test('a foreign quarantine entry prevents a completed physical settlement', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  const quarantineRoot = path.join(repositoryRoot, '.tmp', 'generated-state-quarantine');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooksV1({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-foreign-quarantine');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedStateV1({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, {
    ...options,
    afterQuarantineEffect: async () => {
      await mkdir(path.join(quarantineRoot, 'foreign-residue'));
      await writeFile(path.join(quarantineRoot, 'foreign-residue', 'keep.txt'), 'foreign');
    }
  });

  expect(receipt.terminal).toBe('partial-residue');
  expect(receipt.blockers).toEqual(['.tmp/generated-state-quarantine:physical-residue']);
  expect(await absent(generatedRoot)).toBe(true);
  expect(await absent(path.join(quarantineRoot, 'foreign-residue', 'keep.txt'))).toBe(false);
});

test('resource birth is durable before effect, then reaches operational terminal and consumer-zero physical clean', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-spine';
  const root = fixtureRoot(repositoryRoot).replace('c.staging-lifecycle-fixture', 'c.staging-resource-spine');
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-spine-operation'
  }, options);
  expect(born).toMatchObject({
    phase: 'active',
    root: null,
    lease: { state: 'held' },
    retention: { policy: 'consumer-zero', consumers: [] },
    terminalObligation: { state: 'open' }
  });

  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'cache.bin'), 'resource-cache');
  const bound = await bindGeneratedStateResourceIdentityV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId
  }, options);
  expect(bound.root).not.toBeNull();

  const activeReceipt = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(activeReceipt).toMatchObject({
    phase: 'active',
    operationalTerminal: false,
    physicalClean: false,
    gcPending: false,
    reclaimability: 'blocked'
  });

  const withConsumer = await addGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    consumerId: 'verification-action:resource-spine'
  }, options);
  const terminal = await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  expect(terminal).toMatchObject({
    phase: 'operational-terminal',
    lease: { state: 'released' },
    terminalObligation: { state: 'satisfied' }
  });

  const retained = await observeGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(retained).toMatchObject({
    operationalTerminal: true,
    physicalClean: false,
    gcPending: false,
    reclaimability: 'blocked',
    blockers: ['consumer-active']
  });

  await removeGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    consumerId: 'verification-action:resource-spine',
    consumerCredential: withConsumer.retention.consumers[0]!.credential
  }, options);
  const clean = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(clean).toMatchObject({
    operationalTerminal: true,
    physicalClean: true,
    gcPending: false,
    reclaimability: 'eligible'
  });
  expect(await absent(root)).toBe(true);
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).reclaimability)
    .toBe('unknown');
}, 20_000);

test('resource delete crash resumes from the current registration without a receipt history scan', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-crash';
  const root = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(root, { recursive: true });
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-crash-operation'
  }, options);
  const terminal = await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  let interrupted = false;
  await expect(settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, {
    ...options,
    afterResourceDeleteEffect: () => {
      if (interrupted) return;
      interrupted = true;
      throw new Error('resource crash after physical delete');
    }
  })).rejects.toThrow('resource crash after physical delete');
  expect(await absent(root)).toBe(true);
  const resumed = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: terminal.resourceId
  }, options);
  expect(resumed).toMatchObject({ physicalClean: true, gcPending: false });
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .toBeNull();
}, 20_000);

test('eligible resource residue is bounded as GC pending and retries from the current receipt', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-gc-pending';
  const root = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(root, { recursive: true });
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-gc-pending-operation'
  }, options);
  await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  const pending = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, {
    ...options,
    beforeResourceDeleteEffect: () => {
      throw new Error('temporary physical delete failure');
    }
  });
  expect(pending).toMatchObject({
    operationalTerminal: true,
    physicalClean: false,
    gcPending: true,
    reclaimability: 'eligible'
  });
  expect(await absent(root)).toBe(false);
  const resumed = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(resumed).toMatchObject({ physicalClean: true, gcPending: false });
  expect(await absent(root)).toBe(true);
}, 20_000);

test('resource no-follow uncertainty retains an unbound terminal registration', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-null-root-nofollow';
  const parent = path.join(repositoryRoot, '.tmp', 'dependency-installs');
  await mkdir(parent, { recursive: true });
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-null-root-nofollow-operation'
  }, options);
  const withConsumer = await addGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    consumerId: 'consumer:null-root-nofollow'
  }, options);
  await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  await removeGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    consumerId: 'consumer:null-root-nofollow',
    consumerCredential: withConsumer.retention.consumers[0]!.credential
  }, options);

  const retainedParent = path.join(repositoryRoot, '.tmp', 'dependency-installs-retained');
  await rename(parent, retainedParent);
  const outside = path.join(repositoryRoot, '.tmp', 'dependency-installs-outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'must-retain.txt'), 'retain');
  await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');

  const observed = await observeGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(observed).toMatchObject({
    registration: { root: null },
    reclaimability: 'unknown',
    operationalTerminal: true,
    physicalClean: false,
    gcPending: false,
    blockers: ['physical-identity-unknown']
  });
  const settled = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, options);
  expect(settled).toMatchObject({
    reclaimability: 'unknown',
    physicalClean: false,
    gcPending: false,
    blockers: ['physical-identity-unknown']
  });
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .not.toBeNull();
  expect(await absent(path.join(outside, 'must-retain.txt'))).toBe(false);
}, 20_000);

test('resource GC pending cannot survive a no-follow identity failure as eligible', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-bound-root-nofollow';
  const parent = path.join(repositoryRoot, '.tmp', 'dependency-installs');
  const root = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(parent, { recursive: true });
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-bound-root-nofollow-operation'
  }, options);
  await mkdir(root, { recursive: true });
  const bound = await bindGeneratedStateResourceIdentityV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId
  }, options);
  await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  const pending = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId
  }, {
    ...options,
    beforeResourceDeleteEffect: () => {
      throw new Error('temporary physical delete failure');
    }
  });
  expect(pending).toMatchObject({
    reclaimability: 'eligible',
    physicalClean: false,
    gcPending: true
  });
  const retainedParent = path.join(repositoryRoot, '.tmp', 'dependency-installs-retained');
  await rename(parent, retainedParent);
  const outside = path.join(repositoryRoot, '.tmp', 'dependency-installs-outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'must-retain-bound.txt'), 'retain');
  await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');

  const observed = await observeGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: bound.resourceId
  }, options);
  expect(observed).toMatchObject({
    reclaimability: 'unknown',
    physicalClean: false,
    gcPending: false,
    blockers: ['physical-identity-unknown']
  });
  const retained = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: bound.resourceId
  }, options);
  expect(retained).toMatchObject({
    reclaimability: 'unknown',
    physicalClean: false,
    gcPending: false,
    blockers: ['physical-identity-unknown']
  });
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .not.toBeNull();
  expect(await absent(path.join(outside, 'must-retain-bound.txt'))).toBe(false);
}, 20_000);

test('resource current transitions reject a stale concurrent registration update', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-cas';
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-cas-operation'
  }, options);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstEnteredResolve!: () => void;
  const firstEntered = new Promise<void>((resolve) => { firstEnteredResolve = resolve; });
  let paused = false;
  const firstOptions = {
    ...options,
    beforeResourceRegistrationCommitEffect: async () => {
      if (paused) return;
      paused = true;
      firstEnteredResolve();
      await firstGate;
    }
  };
  const firstAttempt = addGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    consumerId: 'consumer:first'
  }, firstOptions);
  await firstEntered;
  const second = await addGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    consumerId: 'consumer:second'
  }, options);
  releaseFirst();
  await expect(firstAttempt).rejects.toThrow(/current CAS/u);
  expect(second.retention.consumers.map(({ consumerId }) => consumerId)).toEqual(['consumer:second']);
}, 20_000);

test('resource consumer removal requires the owner-issued release credential', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-consumer-credential';
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-consumer-credential-operation'
  }, options);
  const withConsumer = await addGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    consumerId: 'consumer:credential-bound'
  }, options);
  await expect(removeGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    consumerId: 'consumer:credential-bound',
    consumerCredential: `sha256:${'f'.repeat(64)}`
  }, options)).rejects.toThrow(/owner-issued/u);
  const released = await removeGeneratedStateResourceConsumerV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    consumerId: 'consumer:credential-bound',
    consumerCredential: withConsumer.retention.consumers[0]!.credential
  }, options);
  expect(released.retention.consumers).toEqual([]);
}, 20_000);

test('resource terminal retries are idempotent only for the same outcome digest', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-terminal-conflict';
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-terminal-conflict-operation'
  }, options);
  const terminal = await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  const retry = await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  expect(retry.registrationDigest).toBe(terminal.registrationDigest);
  await expect(markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'different-owner-outcome'
  }, options)).rejects.toThrow(/conflicts with the current outcome/u);
}, 20_000);

test('legacy and resource registration are fail-closed until the legacy consumer-zero cutover', async () => {
  const { options, repositoryRoot } = await fixture();
  const resourceFirstPath = '.tmp/dependency-installs/c.staging-resource-authority-first';
  const legacyFirstPath = '.tmp/dependency-installs/c.staging-legacy-authority-first';
  await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath: resourceFirstPath,
    operationId: 'resource-authority-first-operation'
  }, options);
  await mkdir(path.join(repositoryRoot, ...resourceFirstPath.split('/')), { recursive: true });
  const hooks = generatedStateProducerHooksV1({ repositoryRoot }, options);
  await expect(hooks.born(resourceFirstPath, 'legacy-after-resource')).rejects
    .toThrow(/legacy admission is blocked/u);

  const legacyRoot = path.join(repositoryRoot, ...legacyFirstPath.split('/'));
  await mkdir(legacyRoot, { recursive: true });
  await hooks.born(legacyFirstPath, 'legacy-authority-first-operation');
  await expect(registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath: legacyFirstPath,
    operationId: 'resource-after-legacy'
  }, options)).rejects.toThrow(/legacy registration reaches consumer-zero/u);
}, 20_000);

test('resource retirement keeps the registration anchor through pointer-delete crashes', async () => {
  const { options, repositoryRoot } = await fixture();
  const relativePath = '.tmp/dependency-installs/c.staging-resource-anchor-recovery';
  const root = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(root, { recursive: true });
  const born = await registerGeneratedStateResourceBirthV1({
    repositoryRoot,
    relativePath,
    operationId: 'resource-anchor-recovery-operation'
  }, options);
  const terminal = await markGeneratedStateOperationalTerminalV1({
    repositoryRoot,
    relativePath,
    resourceId: born.resourceId,
    leaseId: born.lease.leaseId,
    outcome: 'owner-settled'
  }, options);
  let intentFaulted = false;
  await expect(settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: terminal.resourceId
  }, {
    ...options,
    afterResourceAnchorRetirementEffect: (phase) => {
      if (phase === 'intent' && !intentFaulted) {
        intentFaulted = true;
        throw new Error('fixture crash after intent retirement');
      }
    }
  })).rejects.toThrow('fixture crash after intent retirement');
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .not.toBeNull();

  let receiptFaulted = false;
  await expect(settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: terminal.resourceId
  }, {
    ...options,
    afterResourceAnchorRetirementEffect: (phase) => {
      if (phase === 'receipt' && !receiptFaulted) {
        receiptFaulted = true;
        throw new Error('fixture crash after receipt retirement');
      }
    }
  })).rejects.toThrow('fixture crash after receipt retirement');
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .not.toBeNull();

  const recovered = await settleGeneratedStateResourceV1({
    repositoryRoot,
    relativePath,
    resourceId: terminal.resourceId
  }, options);
  expect(recovered).toMatchObject({ physicalClean: true, gcPending: false });
  expect((await observeGeneratedStateResourceV1({ repositoryRoot, relativePath }, options)).registration)
    .toBeNull();
  expect(await absent(root)).toBe(true);
}, 30_000);
