import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import { authorizeBranchCloseout } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { collectBranchLifecycleInventory } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY, type BranchCloseoutAttempt } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { deleteHostedLocalRefCas } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import type { SecOperationDigest } from '../../src/execution/operation/semantic.ts';
import {
  compileCloseoutCliProviderShims, prepareCloseoutCliScenario,
  readCloseoutCliHarnessState, writeCloseoutCliHarnessState
} from '../helpers/closeout-cli/provider.ts';
import { observeCloseoutFixtureWork } from '../helpers/closeout-cli/work-observation.ts';
import { createRawTestExecutableFixture } from '../testkit/raw-process.ts';

// This qualifies the real consumer's setup using synthetic Git and Work
// providers. It does not issue a Session, invoke remote closeout, or test the live Work resolver. Local CAS uses synthetic Git.
test('closeout CLI fixture prepares and rehydrates exact recovery through current owners', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-closeout-fixture-setup-'));
  const runtime = createRawTestExecutableFixture();
  try {
    const shimRoot = compileCloseoutCliProviderShims(root, runtime.command);
    const prepared = prepareCloseoutCliScenario({ shimRoot,
      harnessRoot: path.join(root, 'repositories'), recoveryHarnessRoot: path.join(root, 'recovery'),
      name: 'setup', baseSha: '1'.repeat(40), headSha: '2'.repeat(40),
      manifestPath: 'config/repository/work-packages/closeout-fixture.md' });
    expect(prepared.prepared.preparation.recovery.path)
      .not.toBe(prepared.rehydratedPrepared.preparation.recovery.path);
    expect(prepared.prepared.preparation.preparationDigest)
      .toBe(prepared.rehydratedPrepared.preparation.preparationDigest);
    expect(prepared.prepared.before.activeWorkPackage.state).toBe('active');
    expect(prepared.rehydratedPrepared.before).toEqual(prepared.prepared.before);
    const bytes = readFileSync(prepared.rehydratedPrepared.preparation.recovery.path);
    expect(bytes).toEqual(prepared.recoveryBundleBytes);
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
      .toBe(prepared.prepared.preparation.recovery.sha256);
    expect(readCloseoutCliHarnessState(prepared.statePath)).toMatchObject({
      activeWorkPackageSelected: false, inventoryPrState: 'MERGED', recoveryFetchCount: 1,
      refOnlyFetchCount: 0, remoteDeleteCount: 0, localDeleteCount: 0, commentPostCount: 0
    });
    const previousPath = process.env.PATH;
    const previousState = process.env.SEC_CLOSEOUT_TEST_STATE;
    process.env.PATH = `${shimRoot}${path.delimiter}${previousPath ?? ''}`;
    process.env.SEC_CLOSEOUT_TEST_STATE = prepared.statePath;
    try {
      const executable = path.join(shimRoot, process.platform === 'win32' ? 'git.exe' : 'git');
      const common = spawnSync(executable, ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: prepared.root, encoding: 'utf8', timeout: 5_000 });
      expect(common.status).toBe(0);
      expect(common.stdout).toBe(`${path.join(prepared.root, '.git')}\n`);
      const wrong = spawnSync(executable, ['update-ref', '--no-deref', '--stdin'], {
        cwd: prepared.root, encoding: 'utf8', timeout: 5_000,
        input: `start\ndelete refs/heads/feat/example ${'3'.repeat(40)}\nprepare\ncommit\n`
      });
      expect(wrong.status).not.toBe(0);
      expect(readCloseoutCliHarnessState(prepared.statePath).localDeleteCount).toBe(0);
      const attempts: BranchCloseoutAttempt[] = [];
      const result = await withWorkspaceWriteLease(path.join(prepared.root, '.git'), undefined,
        async lease => await deleteHostedLocalRefCas(prepared.rehydratedPrepared.preparation,
          attempts, lease, `sha256:${'c'.repeat(64)}` as SecOperationDigest));
      expect(result).toMatchObject({ status: 'success' });
      expect(readCloseoutCliHarnessState(prepared.statePath)).toMatchObject({
        localPresent: false, localDeleteCount: 1, localRefObservationCount: 2,
        remoteDeleteCount: 0, commentPostCount: 0
      });
      // Model the post-delete state without asking discovery to retain all historical PRs.
      const state = readCloseoutCliHarnessState(prepared.statePath);
      state.remotePresent = false;
      writeCloseoutCliHarnessState(prepared.statePath, state);
      const scope = { repositoryRoot: prepared.root,
        activeWorkPackageObservation: observeCloseoutFixtureWork(prepared.root) };
      expect(collectBranchLifecycleInventory(scope).pullRequests).toEqual([]);
      const targetScope = { ...scope, mergedCloseoutTarget: { number: 42,
        headBranch: 'feat/example', headSha: '2'.repeat(40), baseBranch: 'main' } };
      const current = collectBranchLifecycleInventory(targetScope);
      expect(current.unknowns).toEqual([]);
      expect(current.pullRequests).toHaveLength(1);
      expect(current.pullRequests[0]).toMatchObject({ number: 42, state: 'merged', headSha: '2'.repeat(40) });
      const authorize = (inventory: typeof current) => authorizeBranchCloseout({
        preparation: prepared.rehydratedPrepared.preparation,
        before: prepared.rehydratedPrepared.before, current: inventory,
        request: { capability: BRANCH_REF_CLOSEOUT_CAPABILITY, disposition: 'merged',
          durableGoal: { kind: 'main', reference: `main@${'9'.repeat(40)}` } }
      });
      expect(authorize(current)).toMatchObject({ remoteAction: 'already-absent', localAction: 'already-absent', blockers: [] });
      // Exact lookup remains available even when discovery has no corresponding row.
      state.listPullRequestOverrides = [];
      writeCloseoutCliHarnessState(prepared.statePath, state);
      expect(collectBranchLifecycleInventory(targetScope).pullRequests).toHaveLength(1);
      delete state.listPullRequestOverrides;
      for (const mismatch of [{ number: 43 }, { headRefOid: '3'.repeat(40) },
        { state: 'OPEN' }, { url: 'https://github.com/foreign/repository/pull/42' }]) {
        state.exactPullRequestOverride = mismatch;
        writeCloseoutCliHarnessState(prepared.statePath, state);
        const rejected = collectBranchLifecycleInventory(targetScope);
        expect(rejected.unknowns.join(' ')).toContain('Merged closeout exact PR identity');
        expect(authorize(rejected).blockers.length).toBeGreaterThan(0);
      }
      delete state.exactPullRequestOverride;
      const listed = { number: 42, headRefName: 'feat/example', headRefOid: '2'.repeat(40),
        baseRefName: 'main', baseRefOid: '1'.repeat(40), state: 'MERGED', isDraft: false,
        isCrossRepository: false, url: 'https://github.com/sec-platform/sec/pull/42' };
      state.listPullRequestOverrides = [listed, listed];
      writeCloseoutCliHarnessState(prepared.statePath, state);
      expect(collectBranchLifecycleInventory(targetScope).unknowns.join(' ')).toContain('duplicated');

    } finally {
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
      if (previousState === undefined) delete process.env.SEC_CLOSEOUT_TEST_STATE;
      else process.env.SEC_CLOSEOUT_TEST_STATE = previousState;
    }

  } finally {
    try { rmSync(root, { recursive: true, force: true }); }
    finally { runtime.dispose(); }
  }
}, 30_000);
