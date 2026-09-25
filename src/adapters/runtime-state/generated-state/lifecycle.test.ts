import { afterEach, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../../contracts/canonical.ts';
import { compilerDependencyLocatorWorktreeRetirementProvider } from '../../toolchain/dependencies/test/runtime.ts';
import { runCommandBytes } from '../physical/runtime/process.ts';
import { generatedStateDomainProviderMaterialDigest } from './contract.ts';
import {
  assertGeneratedStateCleanupContinuationReceipt,
  assertGeneratedStateDisposalReceipt,
  assertGeneratedStateRetirementObservation,
  assertGeneratedStateWorktreeRetirementEffectStart,
  consumeGeneratedStateWorktreeRetirementEffectAuthority,
  continueGeneratedStateCleanup,
  createGeneratedStateCleanupOperationSession,
  GeneratedStateProducerBindingBlockedError,
  generatedStateProducerHooks,
  inspectGeneratedState,
  planGeneratedStateCleanup,
  settleGeneratedState,
  settleGeneratedStateForWorktreeRetirement,
  type GeneratedStateWorktreeRetirementProvider
} from './lifecycle.ts';

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
  await writeFile(path.join(repositoryRoot, '.gitignore'), '.sec/\n.tmp/\nnode_modules/\n');
  await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'tracked\n');
  await git(repositoryRoot, ['add', '.gitignore', 'tracked.txt']);
  await git(repositoryRoot, [
    '-c',
    'user.email=sec@example.invalid',
    '-c',
    'user.name=SEC Test',
    'commit',
    '-m',
    'fixture'
  ]);
  await git(repositoryRoot, ['worktree', 'add', '-b', 'candidate', workspaceRoot]);
  const revision = await runCommandBytes('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], {
    cwd: workspaceRoot
  });
  const [headSha, treeSha, ...unexpected] = Buffer.from(revision.stdout)
    .toString('utf8')
    .trim()
    .split(/\r?\n/u);
  if (revision.code !== 0 || headSha === undefined || treeSha === undefined || unexpected.length > 0) {
    throw new Error('Generated-state fixture revision observation failed.');
  }
  return {
    repositoryRoot,
    workspaceRoot,
    headSha,
    treeSha,
    options: { environment: { ...process.env, SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot } }
  } as const;
}

async function retiredWorktreeGeneratedRoot(
  fixture: Awaited<ReturnType<typeof registeredWorktreeFixture>>
): Promise<string> {
  const target = path.join(fixture.workspaceRoot, ...LIFECYCLE_FIXTURE_PATH.split('/'));
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot, workspaceRoot: fixture.workspaceRoot },
    fixture.options
  );
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'worktree-retirement-fixture');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'worktree-retirement-owner-completed');
  return target;
}


test('inspect is zero-write and protects one ignored unknown root', async () => {
  const { cacheRoot, options, repositoryRoot, stateRoot } = await fixture();
  await mkdir(path.join(repositoryRoot, '.tmp', 'mystery'), { recursive: true });

  const inventory = await inspectGeneratedState({ repositoryRoot }, options);

  expect(inventory.entries.find(({ relativePath }) => relativePath === '.tmp/mystery')).toMatchObject({
    stateClass: 'unknown-unclassified',
    settlement: 'blocked',
    blockers: ['unknown-generated-state']
  });
  expect(await absent(stateRoot)).toBe(true);
  expect(await absent(cacheRoot)).toBe(true);
});

test('producer inventory and retirement readback stay bound to their creation-time roots and runtime store', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'owned');
  const producerInput = { repositoryRoot, workspaceRoot: repositoryRoot };
  const producerEnvironment = { ...options.environment };
  const producerOptions = { environment: producerEnvironment };
  const owner = generatedStateProducerHooks(producerInput, producerOptions);
  await owner.born(LIFECYCLE_FIXTURE_PATH, 'root-bound-inventory-owner');

  producerInput.repositoryRoot = path.join(path.dirname(repositoryRoot), 'foreign-repository');
  producerInput.workspaceRoot = path.join(path.dirname(repositoryRoot), 'foreign-workspace');
  producerEnvironment.SEC_STATE_HOME = path.join(path.dirname(repositoryRoot), 'mutated-state');
  producerEnvironment.SEC_CACHE_HOME = path.join(path.dirname(repositoryRoot), 'mutated-cache');
  producerOptions.environment = {
    ...producerEnvironment,
    SEC_STATE_HOME: path.join(path.dirname(repositoryRoot), 'replacement-state'),
    SEC_CACHE_HOME: path.join(path.dirname(repositoryRoot), 'replacement-cache')
  };

  const foreign = generatedStateProducerHooks({ repositoryRoot }, {
    ...options,
    environment: {
      ...options.environment,
      SEC_STATE_HOME: path.join(path.dirname(repositoryRoot), 'foreign-state'),
      SEC_CACHE_HOME: path.join(path.dirname(repositoryRoot), 'foreign-cache')
    }
  });
  const ownedEntry = (await owner.inspect([LIFECYCLE_FIXTURE_PATH])).entries[0];
  const foreignEntry = (await foreign.inspect([LIFECYCLE_FIXTURE_PATH])).entries[0];

  expect(ownedEntry).toMatchObject({
    relativePath: LIFECYCLE_FIXTURE_PATH,
    registrationState: 'active',
    settlement: 'protected',
    blockers: ['owner-active']
  });
  expect(foreignEntry).toMatchObject({
    relativePath: LIFECYCLE_FIXTURE_PATH,
    registrationState: 'missing',
    settlement: 'protected',
    blockers: ['registration-missing']
  });
  expect((await owner.observeRetirement(LIFECYCLE_FIXTURE_PATH)).status).toBe('active');
  expect((await foreign.observeRetirement(LIFECYCLE_FIXTURE_PATH)).status).toBe('mismatch');
});

test('worktree retirement preserves one covered ignored root outside the target and binds Effect-start identity', async () => {
  const fixture = await registeredWorktreeFixture();
  const generatedRoot = await retiredWorktreeGeneratedRoot(fixture);

  const receipt = await settleGeneratedStateForWorktreeRetirement(
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
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual([LIFECYCLE_FIXTURE_PATH]);
  const persistedReceipt = JSON.parse(JSON.stringify(canonicalJson(receipt))) as NonNullable<typeof receipt>;
  expect(await absent(generatedRoot)).toBe(true);
  expect(() =>
    assertGeneratedStateWorktreeRetirementEffectStart({
      receipt: persistedReceipt,
      repositoryRoot: fixture.repositoryRoot,
      workspaceRoot: fixture.workspaceRoot,
      expectedBranch: 'candidate',
      expectedHeadSha: fixture.headSha,
      expectedTreeSha: fixture.treeSha
    })
  ).not.toThrow();

  await mkdir(generatedRoot, { recursive: true });
  expect(() =>
    assertGeneratedStateWorktreeRetirementEffectStart({
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
  const generatedRoot = await retiredWorktreeGeneratedRoot(fixture);
  const input = {
    repositoryRoot: fixture.repositoryRoot,
    workspaceRoot: fixture.workspaceRoot,
    expectedBranch: 'candidate',
    expectedHeadSha: fixture.headSha,
    expectedTreeSha: fixture.treeSha
  } as const;
  let interrupted = false;

  await expect(settleGeneratedStateForWorktreeRetirement(input, {
    ...fixture.options,
    afterWorktreeRetirementRelocation: (relativePath) => {
      if (!interrupted) {
        interrupted = true;
        throw new Error(`fixture interruption after ${relativePath}`);
      }
    }
  })).rejects.toThrow('fixture interruption');

  const receipt = await settleGeneratedStateForWorktreeRetirement(input, fixture.options);
  expect(receipt).toMatchObject({ terminal: 'completed' });
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual([LIFECYCLE_FIXTURE_PATH]);
  expect(await absent(generatedRoot)).toBe(true);
});

test('worktree retirement delegates an exact locator to its domain provider and preserves the external generation', async () => {
  const fixture = await registeredWorktreeFixture();
  const generationRoot = path.join(path.dirname(fixture.repositoryRoot), 'external-generation');
  await mkdir(generationRoot);
  await writeFile(path.join(generationRoot, 'sentinel.txt'), 'preserve');
  const locatorPath = path.join(fixture.workspaceRoot, 'node_modules');
  await symlink(generationRoot, locatorPath, process.platform === 'win32' ? 'junction' : 'dir');
  const lifecycle = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot, workspaceRoot: fixture.workspaceRoot },
    fixture.options
  );
  await lifecycle.born('node_modules', 'compiler-dependency-bridge:fixture');
  const input = {
    repositoryRoot: fixture.repositoryRoot,
    workspaceRoot: fixture.workspaceRoot,
    expectedBranch: 'candidate',
    expectedHeadSha: fixture.headSha,
    expectedTreeSha: fixture.treeSha
  } as const;

  const providerId = 'compiler-dependency-locator';
  const concurrentProducer = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot, workspaceRoot: fixture.workspaceRoot },
    fixture.options
  );
  let retiredRegistration: Parameters<typeof concurrentProducer.restore>[1] | null = null;
  const provider: GeneratedStateWorktreeRetirementProvider =
  Object.freeze<GeneratedStateWorktreeRetirementProvider>({
    id: providerId,
    plan: async ({ registration, source }) => {
      expect(registration.phase).toBe('active');
      const bytes = JSON.stringify(canonicalJson({ schema: 'fixture-locator-plan-v1', source }));
      return Object.freeze({
        bytes,
        digest: generatedStateDomainProviderMaterialDigest(providerId, 'plan', bytes)
      });
    },
    retire: async (authority) => {
      const { planBytes, planDigest, registration } =
        consumeGeneratedStateWorktreeRetirementEffectAuthority(authority, providerId);
      expect(() => consumeGeneratedStateWorktreeRetirementEffectAuthority(authority, providerId))
        .toThrow('forged, stale, replayed');
      expect(registration.phase).toBe('retired');
      retiredRegistration = registration.registrationDigest;
      expect(planDigest).toBe(generatedStateDomainProviderMaterialDigest(providerId, 'plan', planBytes));
      await expect(concurrentProducer.restore(
        'node_modules',
        registration.registrationDigest,
        registration.root,
        'concurrent-producer-restore'
      )).rejects.toThrow('mutation lease is unavailable');
      const outcome = await absent(locatorPath) ? 'resumed-absent' : 'removed';
      if (outcome === 'removed') await unlink(locatorPath);
      const bytes = JSON.stringify(canonicalJson({ schema: 'fixture-locator-receipt-v1', outcome }));
      return Object.freeze({
        bytes,
        digest: generatedStateDomainProviderMaterialDigest(providerId, 'receipt', bytes)
      });
    }
  });
  let interrupted = false;
  await expect(settleGeneratedStateForWorktreeRetirement(input, {
    ...fixture.options,
    worktreeRetirementProviders: [provider],
    afterWorktreeRetirementProviderEffect: () => {
      if (interrupted) return;
      interrupted = true;
      throw new Error('fixture interruption after provider effect');
    }
  })).rejects.toThrow('fixture interruption after provider effect');
  expect(await absent(locatorPath)).toBe(true);
  const receipt = await settleGeneratedStateForWorktreeRetirement(input, {
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
  if (retiredRegistration === null) throw new Error('Fixture provider did not observe one retired registration.');
  await expect(concurrentProducer.restore(
    'node_modules',
    retiredRegistration,
    (await lifecycle.observeRetirement('node_modules')).physical!,
    'post-retirement-restore'
  )).rejects.toThrow('physical preimage differs');
});

for (const mutation of ['ordinary-directory', 'retargeted-link'] as const) {
  test(`compiler locator retirement preserves a ${mutation} replacement made after its durable plan`, async () => {
    const fixture = await registeredWorktreeFixture();
    const generationRoot = path.join(path.dirname(fixture.repositoryRoot), `external-generation-${mutation}`);
    await mkdir(generationRoot);
    await writeFile(path.join(generationRoot, 'sentinel.txt'), 'preserve');
    const locatorPath = path.join(fixture.workspaceRoot, 'node_modules');
    await symlink(generationRoot, locatorPath, process.platform === 'win32' ? 'junction' : 'dir');
    const lifecycle = generatedStateProducerHooks(
      { repositoryRoot: fixture.repositoryRoot, workspaceRoot: fixture.workspaceRoot },
      fixture.options
    );
    await lifecycle.born('node_modules', `compiler-dependency-bridge:${mutation}`);
    const parkedLocator = `${locatorPath}.planned`;
    const replacementGeneration = path.join(path.dirname(fixture.repositoryRoot), `replacement-${mutation}`);
    const provider = Object.freeze<GeneratedStateWorktreeRetirementProvider>({
      id: compilerDependencyLocatorWorktreeRetirementProvider.id,
      plan: async (input) => {
        const plan = await compilerDependencyLocatorWorktreeRetirementProvider.plan(input);
        await rename(locatorPath, parkedLocator);
        if (mutation === 'ordinary-directory') {
          await mkdir(locatorPath);
        } else {
          await mkdir(replacementGeneration);
          await symlink(replacementGeneration, locatorPath, process.platform === 'win32' ? 'junction' : 'dir');
        }
        return plan;
      },
      retire: (authority) => compilerDependencyLocatorWorktreeRetirementProvider.retire(authority)
    });
    await expect(settleGeneratedStateForWorktreeRetirement({
      repositoryRoot: fixture.repositoryRoot,
      workspaceRoot: fixture.workspaceRoot,
      expectedBranch: 'candidate',
      expectedHeadSha: fixture.headSha,
      expectedTreeSha: fixture.treeSha
    }, {
      ...fixture.options,
      worktreeRetirementProviders: [provider]
    })).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
    const replacement = await lstat(locatorPath);
    expect(mutation === 'ordinary-directory' ? replacement.isDirectory() : replacement.isSymbolicLink()).toBeTrue();
    expect(await absent(parkedLocator)).toBe(false);
    expect(await absent(path.join(generationRoot, 'sentinel.txt'))).toBe(false);
  });
}

test('worktree retirement blocks one unknown ignored descendant before moving any root', async () => {
  const fixture = await registeredWorktreeFixture();
  await mkdir(path.join(fixture.workspaceRoot, '.sec', 'foreign-dir'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.sec', 'foreign-dir', 'keep.txt'), 'foreign');
  const generatedRoot = await retiredWorktreeGeneratedRoot(fixture);

  await expect(
    settleGeneratedStateForWorktreeRetirement(
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
  expect(await absent(path.join(generatedRoot, 'cache.bin'))).toBe(false);
});

test('birth and retirement are owner-generated and make only the exact retired root selectable', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  let clock = new Date('2026-08-23T01:00:00.000Z');
  const lifecycle = generatedStateProducerHooks(
    { repositoryRoot },
    { ...options, clock: () => clock }
  );
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-1');
  const activeInventory = await inspectGeneratedState({ repositoryRoot }, options);
  expect(activeInventory.blockers).toEqual([]);
  expect(activeInventory.entries.find(
    ({ relativePath }) => relativePath === LIFECYCLE_FIXTURE_PATH
  )).toMatchObject({ registrationState: 'active', settlement: 'protected' });

  clock = new Date('2026-08-23T01:01:00.000Z');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');
  const inventory = await inspectGeneratedState({ repositoryRoot }, options);
  expect(planGeneratedStateCleanup({ inventory, profile: 'automatic' })).toEqual({
    selected: [LIFECYCLE_FIXTURE_PATH],
    protected: []
  });
});

test('fresh registration storage is retained before first birth and rejects state-root replacement', async () => {
  const { options, repositoryRoot, stateRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);

  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'fresh-registration-store');
  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({ registrationState: 'active' });

  await rename(stateRoot, `${stateRoot}-replaced`);
  await mkdir(stateRoot);
  await expect(lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'state-root-replaced'))
    .rejects.toBeDefined();
});

test('Runtime State admission rejects an in-repository root before creating it', async () => {
  const { cacheRoot, options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  const inRepositoryStateRoot = path.join(repositoryRoot, '.runtime-state-must-not-exist');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, {
    ...options,
    environment: {
      ...options.environment,
      SEC_CACHE_HOME: cacheRoot,
      SEC_STATE_HOME: inRepositoryStateRoot
    }
  });

  await expect(lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'invalid-in-repository-runtime-state'))
    .rejects.toThrow('must remain outside the repository worktree');
  expect(await absent(inRepositoryStateRoot)).toBe(true);
});

test('a forged-valid physical preimage cannot self-sign without an existing registration', async () => {
  const { cacheRoot, options, repositoryRoot, stateRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'foreign-preimage');
  const inventory = await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);
  const physical = inventory.entries[0]!.physicalIdentity;
  expect(physical).not.toBeNull();
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);

  await expect(lifecycle.bind(LIFECYCLE_FIXTURE_PATH, {
    owner: 'compiler-dependency-runtime',
    producer: 'stage-compiler-dependency-generation',
    ruleId: 'compiler-dependency-staging',
    physical: physical!
  })).rejects.toBeInstanceOf(GeneratedStateProducerBindingBlockedError);
  await expect(lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'forged-retirement'))
    .rejects.toThrow(/same producer session/u);
  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({ registrationState: 'missing', settlement: 'protected' });
  expect(await absent(stateRoot)).toBe(true);
  expect(await absent(cacheRoot)).toBe(true);
  expect(await absent(path.join(generatedRoot, 'cache.bin'))).toBe(false);
});

test('a fresh producer process can bind an active registration and restore only its exact retired predecessor', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const owner = generatedStateProducerHooks({ repositoryRoot }, options);
  await owner.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-issued-generation');
  const active = (await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]!;
  expect(active.registrationState).toBe('active');
  if (active.physicalIdentity === null || active.registrationDigest === null) {
    throw new Error('Fixture birth did not produce an exact active registration identity.');
  }

  const resumed = generatedStateProducerHooks({ repositoryRoot }, options);
  const bound = await resumed.bind(LIFECYCLE_FIXTURE_PATH, {
    owner: 'compiler-dependency-runtime',
    producer: 'stage-compiler-dependency-generation',
    ruleId: 'compiler-dependency-staging',
    physical: active.physicalIdentity
  });
  expect(bound.registrationDigest).toBe(active.registrationDigest);
  const retired = await resumed.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-retired');
  if (retired === undefined) throw new Error('Fixture retirement did not return its exact registration receipt.');
  expect(retired.phase).toBe('retired');

  await expect(resumed.restore(
    LIFECYCLE_FIXTURE_PATH,
    retired.registrationDigest,
    { ...active.physicalIdentity, inode: `${active.physicalIdentity.inode}-foreign` },
    'wrong-physical-restore'
  )).rejects.toBeInstanceOf(GeneratedStateProducerBindingBlockedError);
  const restored = await resumed.restore(
    LIFECYCLE_FIXTURE_PATH,
    retired.registrationDigest,
    active.physicalIdentity,
    'exact-predecessor-restore'
  );
  expect(restored.phase).toBe('active');
  expect(restored.root).toEqual(active.physicalIdentity);
  expect(restored.registrationDigest).not.toBe(retired.registrationDigest);
});

test('retirement observation distinguishes exact active, retired-present, settled, absent and mismatch states', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'retirement-observation-fixture');
  const inspected = (await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]!;
  if (inspected.physicalIdentity === null) throw new Error('Fixture physical identity is unavailable.');
  const expected = {
    owner: 'compiler-dependency-runtime',
    producer: 'stage-compiler-dependency-generation',
    ruleId: 'compiler-dependency-staging',
    physical: inspected.physicalIdentity
  } as const;
  const active = await lifecycle.observeRetirement(LIFECYCLE_FIXTURE_PATH, expected);
  expect(active.status).toBe('active');
  expect(() => assertGeneratedStateRetirementObservation(
    structuredClone(active)
  )).toThrow('was not issued by its owner');
  const mismatch = await lifecycle.observeRetirement(LIFECYCLE_FIXTURE_PATH, {
    ...expected,
    physical: { ...expected.physical, inode: `${expected.physical.inode}-foreign` }
  });
  expect(mismatch.status).toBe('mismatch');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'retirement-observation-retired');
  expect((await lifecycle.observeRetirement(LIFECYCLE_FIXTURE_PATH, expected)).status)
    .toBe('retired-present');
  const receipt = await lifecycle.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'retirement-observation-retired',
    profile: 'automatic'
  });
  expect(() => assertGeneratedStateDisposalReceipt(receipt)).not.toThrow();
  expect(() => assertGeneratedStateDisposalReceipt(structuredClone(receipt)))
    .toThrow('was not issued by its owner');
  expect(receipt).toMatchObject({ profile: 'automatic', terminal: 'disposed' });
  expect((await lifecycle.observeRetirement(LIFECYCLE_FIXTURE_PATH, expected)).status)
    .toBe('retired-domain-settled');
  expect((await lifecycle.observeRetirement(
    '.tmp/dependency-installs/c.staging-lifecycle-absent',
    undefined
  )).status).toBe('absent');
});

test('profile-bound disposal recovers its exact durable intent and issues one terminal receipt', async () => {
  const { options, repositoryRoot } = await fixture();
  await mkdir(fixtureRoot(repositoryRoot), { recursive: true });
  await writeFile(path.join(fixtureRoot(repositoryRoot), 'cache.bin'), 'cache');
  let interrupted = false;
  const owner = generatedStateProducerHooks({ repositoryRoot }, {
    ...options,
    afterQuarantineEffect: () => {
      if (!interrupted) {
        interrupted = true;
        throw new Error('fixture disposal interruption');
      }
    }
  });
  await owner.born(LIFECYCLE_FIXTURE_PATH, 'profile-bound-disposal-interruption');
  await expect(owner.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'profile-bound-disposal',
    profile: 'automatic'
  })).rejects.toThrow('did not reach one terminal physical absence');

  const resumed = generatedStateProducerHooks({ repositoryRoot }, options);
  await expect(resumed.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'profile-bound-disposal-foreign',
    profile: 'automatic'
  })).rejects.toThrow('differs from the owner retirement');
  const receipt = await resumed.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'profile-bound-disposal',
    profile: 'automatic'
  });
  const repeated = await resumed.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'profile-bound-disposal',
    profile: 'automatic'
  });
  expect(() => assertGeneratedStateDisposalReceipt(receipt)).not.toThrow();
  expect(() => assertGeneratedStateDisposalReceipt(repeated)).not.toThrow();
  expect(repeated).toEqual(receipt);
  expect(receipt).toMatchObject({
    profile: 'automatic',
    relativePath: LIFECYCLE_FIXTURE_PATH,
    terminal: 'disposed'
  });
  expect(await absent(fixtureRoot(repositoryRoot))).toBe(true);
  expect((await resumed.observeRetirement(LIFECYCLE_FIXTURE_PATH)).status)
    .toBe('retired-domain-settled');
});

test('a cleanup profile outside the registry leaves the active generation unchanged', async () => {
  const { options, repositoryRoot } = await fixture();
  await mkdir(fixtureRoot(repositoryRoot), { recursive: true });
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'profile-mismatch-preserved');
  await expect(lifecycle.disposed(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'profile-mismatch-preserved',
    profile: 'all-rebuildable'
  })).rejects.toThrow('disposal profile is not owned');
  expect(await absent(fixtureRoot(repositoryRoot))).toBe(false);
  expect((await lifecycle.observeRetirement(LIFECYCLE_FIXTURE_PATH)).status).toBe('active');
});

test('a new caller cannot retire a registration it did not birth or adopt in its producer session', async () => {
  const { options, repositoryRoot } = await fixture();
  await mkdir(fixtureRoot(repositoryRoot), { recursive: true });
  const ownerSession = generatedStateProducerHooks({ repositoryRoot }, options);
  const foreignSession = generatedStateProducerHooks({ repositoryRoot }, options);

  await ownerSession.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-session');
  await expect(foreignSession.retired(LIFECYCLE_FIXTURE_PATH, 'caller-invented-retirement'))
    .rejects.toThrow(/same producer session/u);

  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({ registrationState: 'active', settlement: 'protected' });
});

test('a fresh producer terminalizes only an exact active registration whose physical root is absent', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  const operationId = 'compiler-staging-interrupted-after-delete';
  await mkdir(generatedRoot, { recursive: true });
  const owner = generatedStateProducerHooks({ repositoryRoot }, options);
  await owner.born(LIFECYCLE_FIXTURE_PATH, operationId);
  const active = (await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]!;
  if (active.physicalIdentity === null || active.registrationDigest === null) {
    throw new Error('Fixture birth did not produce one exact active registration.');
  }
  await rm(generatedRoot, { recursive: true });

  const resumed = generatedStateProducerHooks({ repositoryRoot }, options);
  await expect(resumed.settleAbsent(LIFECYCLE_FIXTURE_PATH, {
    owner: 'compiler-dependency-runtime',
    producer: 'stage-compiler-dependency-generation',
    ruleId: 'compiler-dependency-staging',
    physical: { ...active.physicalIdentity, inode: `${active.physicalIdentity.inode}-foreign` }
  }, 'compiler-stage-absent')).rejects.toBeInstanceOf(GeneratedStateProducerBindingBlockedError);
  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({ registrationState: 'active', settlement: 'protected' });

  const receipt = await resumed.settleAbsent(LIFECYCLE_FIXTURE_PATH, {
    owner: 'compiler-dependency-runtime',
    producer: 'stage-compiler-dependency-generation',
    ruleId: 'compiler-dependency-staging',
    physical: active.physicalIdentity
  }, 'compiler-stage-absent');
  expect(receipt).toMatchObject({
    schema: 'sec-generated-state-absent-registration-settlement-v1',
    relativePath: LIFECYCLE_FIXTURE_PATH,
    registrationDigest: active.registrationDigest,
    physical: active.physicalIdentity,
    outcome: 'compiler-stage-absent',
    terminal: 'disposed'
  });
  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).entries[0]).toMatchObject({
    blockers: [],
    kind: 'missing',
    registrationState: 'missing'
  });
});

test('cleanup quarantines, bounded-deletes and reads back one retired physical generation', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  await mkdir(path.join(repositoryRoot, '.tmp', 'foreign-sibling'));
  await writeFile(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'), 'foreign');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-2');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedState({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);

  expect(receipt.terminal).toBe('completed');
  expect(receipt.selected).toEqual([LIFECYCLE_FIXTURE_PATH]);
  expect(receipt.attempts.map(({ action }) => action)).toEqual(['quarantined', 'deleted']);
  expect(await absent(generatedRoot)).toBe(true);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
  expect((await inspectGeneratedState({
    repositoryRoot,
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options)).blockers).toEqual([]);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'foreign-sibling', 'keep.txt'))).toBe(false);
});

test('producer hooks omit quarantine without an owner-issued cleanup operation', async () => {
  const { options, repositoryRoot } = await fixture();
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  expect(Reflect.has(lifecycle, 'quarantine')).toBe(false);
  expect(Reflect.get(lifecycle, 'quarantine')).toBeUndefined();
});

test('producer hooks expose quarantine only for the exact live cleanup operation', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  const signal = new AbortController().signal;
  const cleanupOperation = createGeneratedStateCleanupOperationSession({
    deadlineAtMonotonicMs: performance.now() + 30_000,
    signal
  });
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, {
    ...options,
    cleanupOperation
  });
  expect(typeof lifecycle.quarantine).toBe('function');
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-capability');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');
  const receipt = await lifecycle.quarantine(LIFECYCLE_FIXTURE_PATH, {
    outcome: 'compiler-staging-capability-cleanup',
    profile: 'automatic'
  });
  expect(receipt.terminal).toBe('completed');
  expect(await absent(generatedRoot)).toBe(true);
});

test('producer quarantine rejects cloned, foreign and expired cleanup operations before effect', async () => {
  for (const cleanupOperation of [
    Object.freeze({ ...createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000
    }) }),
    Object.freeze({ deadlineAtMonotonicMs: performance.now() + 30_000 }),
    createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: 1,
      monotonicNowMs: () => 2
    })
  ]) {
    const { options, repositoryRoot } = await fixture();
    const generatedRoot = fixtureRoot(repositoryRoot);
    await mkdir(generatedRoot, { recursive: true });
    await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
    const owner = generatedStateProducerHooks({ repositoryRoot }, options);
    await owner.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-invalid-capability');
    await owner.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');
    const lifecycle = generatedStateProducerHooks({ repositoryRoot }, {
      ...options,
      cleanupOperation
    });
    await expect(lifecycle.quarantine(LIFECYCLE_FIXTURE_PATH, {
      outcome: 'compiler-staging-invalid-capability',
      profile: 'automatic'
    })).rejects.toThrow(/not owner-issued|exceeded the cleanup operation budget/u);
    expect(await absent(generatedRoot)).toBe(false);
  }
});

test('unregistered reparse roots are protected without following their targets', async () => {
  const { options, repositoryRoot } = await fixture();
  const outside = path.join(path.dirname(repositoryRoot), 'outside');
  await mkdir(outside);
  await mkdir(path.join(repositoryRoot, '.tmp'), { recursive: true });
  await mkdir(path.dirname(fixtureRoot(repositoryRoot)), { recursive: true });
  await symlink(outside, fixtureRoot(repositoryRoot), 'junction');
  const linked = await inspectGeneratedState({
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
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-race');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedState({
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
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-interrupted');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const interrupted = await settleGeneratedState({
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

  const resumed = await settleGeneratedState({
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH]
  }, options);
  expect(resumed.terminal).toBe('completed');
  expect(resumed.attempts.map(({ action }) => action)).toEqual(['deleted']);
  expect(await absent(path.join(repositoryRoot, '.tmp', 'generated-state-quarantine'))).toBe(true);
});

test('bounded quarantine returns one resumable receipt across capacity, abort, deadline, and zero-repeat', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-bounded-quarantine');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const partial = await continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH],
    operation: createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000,
      maximumBytes: 1024,
      maximumEntries: 1
    })
  });
  assertGeneratedStateCleanupContinuationReceipt(partial);
  expect(partial).toMatchObject({ terminal: 'continuation-required', blockers: [] });
  expect(await absent(generatedRoot)).toBe(true);

  const aborted = new AbortController();
  aborted.abort();
  for (const operation of [
    createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000,
      signal: aborted.signal
    }),
    createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: 1,
      monotonicNowMs: () => 2
    })
  ]) {
    const receipt = await continueGeneratedStateCleanup({
      lifecycleOptions: options,
      repositoryRoot,
      profile: 'automatic',
      relativePaths: [LIFECYCLE_FIXTURE_PATH],
      operation
    });
    expect(receipt.terminal).toBe('continuation-required');
  }

  const completed = await continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH],
    operation: createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000
    })
  });
  expect(completed.terminal).toBe('completed');
  const repeated = await continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH],
    operation: createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000
    })
  });
  expect(repeated).toMatchObject({ terminal: 'completed', quarantined: [], blockers: [] });
});

test('bounded quarantine preserves a replaced continuation root as foreign residue', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  await mkdir(path.join(generatedRoot, 'nested'), { recursive: true });
  await writeFile(path.join(generatedRoot, 'nested', 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-bounded-foreign');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');
  const partial = await continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH],
    operation: createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000,
      maximumEntries: 1
    })
  });
  const quarantined = partial.quarantined[0]!;
  const quarantinePath = path.join(
    repositoryRoot,
    '.tmp',
    'generated-state-quarantine',
    `q-${quarantined.registrationDigest.slice('sha256:'.length, 'sha256:'.length + 48)}`
  );
  await rename(quarantinePath, `${quarantinePath}-original`);
  await mkdir(quarantinePath);
  await writeFile(path.join(quarantinePath, 'foreign.txt'), 'foreign');

  const blocked = await continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot,
    profile: 'automatic',
    relativePaths: [LIFECYCLE_FIXTURE_PATH],
    operation: createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + 30_000
    })
  });
  expect(blocked.terminal).toBe('blocked');
  expect(blocked.blockers).toContain(`${LIFECYCLE_FIXTURE_PATH}:cleanup-continuation-quarantine-invalid`);
  expect(await absent(path.join(quarantinePath, 'foreign.txt'))).toBe(false);
});

test('a foreign quarantine entry prevents a completed physical settlement', async () => {
  const { options, repositoryRoot } = await fixture();
  const generatedRoot = fixtureRoot(repositoryRoot);
  const quarantineRoot = path.join(repositoryRoot, '.tmp', 'generated-state-quarantine');
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'cache.bin'), 'cache');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot }, options);
  await lifecycle.born(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-operation-foreign-quarantine');
  await lifecycle.retired(LIFECYCLE_FIXTURE_PATH, 'compiler-staging-owner-completed');

  const receipt = await settleGeneratedState({
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
