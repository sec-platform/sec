import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../platform/shared/canonical-primitives.ts';
import { runCommandBytes } from '../../platform/shared/process.ts';
import {
  assertGeneratedStateWorktreeRetirementEffectStartV1,
  generatedStateProducerHooksV1,
  inspectGeneratedStateV1,
  planGeneratedStateCleanupV1,
  settleGeneratedStateForWorktreeRetirementV1,
  settleGeneratedStateV1
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

test('worktree retirement preserves every registry-covered ignored root outside the target and binds Effect-start identity', async () => {
  const fixture = await registeredWorktreeFixture();
  await mkdir(path.join(fixture.workspaceRoot, '.sec', 'import-transform-transactions', 'accepted'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.sec', 'import-transform-transactions', 'accepted', 'journal.jsonl'), '{}');
  await mkdir(path.join(fixture.workspaceRoot, '.shared-deps'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.shared-deps', 'cache.bin'), 'cache');
  await mkdir(path.join(fixture.workspaceRoot, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module');
  await mkdir(path.join(fixture.workspaceRoot, '.tmp', 'dependency-installs', 'compiler-backups'), { recursive: true });
  await mkdir(path.join(fixture.workspaceRoot, '.tmp', 'codex'), { recursive: true });
  await mkdir(path.join(fixture.workspaceRoot, '.tmp', 'import-candidate-snapshots'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, '.tmp', 'test-impact-cache.json'), '{}');

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
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual([
    '.sec/import-transform-transactions', '.shared-deps', '.tmp', 'node_modules'
  ]);
  const persistedReceipt = JSON.parse(JSON.stringify(canonicalJson(receipt))) as NonNullable<typeof receipt>;
  for (const relativePath of ['.sec/import-transform-transactions', '.shared-deps', '.tmp', 'node_modules']) {
    expect(await absent(path.join(fixture.workspaceRoot, relativePath))).toBe(true);
  }
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
  await mkdir(path.join(fixture.workspaceRoot, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(fixture.workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module');
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
  expect(receipt!.entries.map(({ relativePath }) => relativePath)).toEqual(['.shared-deps', 'node_modules']);
  expect(await absent(path.join(fixture.workspaceRoot, '.shared-deps'))).toBe(true);
  expect(await absent(path.join(fixture.workspaceRoot, 'node_modules'))).toBe(true);
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

test('reparse roots and changed-after-inventory generations are protected', async () => {
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
    blockers: ['registration-missing', 'root-is-link-or-reparse']
  });
  await unlink(fixtureRoot(repositoryRoot));

  const generatedRoot = fixtureRoot(repositoryRoot);
  const replacementRoot = path.join(repositoryRoot, '.tmp', 'replacement');
  await mkdir(generatedRoot);
  await mkdir(replacementRoot);
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
});

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
