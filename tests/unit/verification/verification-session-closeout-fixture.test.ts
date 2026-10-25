import { settleResources, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BranchLifecycleInventory } from '../../../src/execution/verification/branch-closeout.ts';
import { authorizeBranchCloseout, createBranchCloseoutPreparation } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA, parsePreparedBranchCloseoutEnvelope, rehydratePreparedBranchCloseoutEnvelope } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { collectBranchLifecycleInventory } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import type { OperationDigest } from '../../../src/execution/operation/semantic.ts';
import {
  compileCloseoutCliProviderShims, prepareCloseoutCliScenario,
  readCloseoutCliHarnessState, writeCloseoutCliHarnessState
} from '../../helpers/closeout-cli/provider.ts';
import { observeCloseoutFixtureWork } from '../../helpers/closeout-cli/work-observation.ts';
import { observeLocalRefCasWithAdmissionDouble } from '../../helpers/main-health-admission-double.ts';
import { createRawTestExecutableFixture } from '../../testkit/raw-process.ts';

// This qualifies the real consumer's setup using synthetic Git and Work
// providers. It does not issue a Session, invoke remote closeout, or test the live Work resolver. Local CAS uses synthetic Git.
test('closeout CLI fixture prepares and rehydrates exact recovery through current owners', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-closeout-fixture-setup-'));
  const cleanup: Parameters<typeof settleResources>[0]['cleanup'][number][] = [
    { label: 'closeout fixture root', settle: () => rmSync(root, { recursive: true, force: true }) }
  ];
  let scopeFailure: ResourceSettlementFailure | undefined;
  try {
    const runtime = createRawTestExecutableFixture();
    cleanup.push({ label: 'raw executable fixture', settle: () => runtime.dispose() });
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
    let environmentFailure: ResourceSettlementFailure | undefined;
    try {
      process.env.PATH = `${shimRoot}${path.delimiter}${previousPath ?? ''}`;
      process.env.SEC_CLOSEOUT_TEST_STATE = prepared.statePath;
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
      const observed = await observeLocalRefCasWithAdmissionDouble({
        preparation: prepared.rehydratedPrepared.preparation,
        operationId: `sha256:${'c'.repeat(64)}` as OperationDigest });
      const result = observed.result;
      expect(observed.admissionChecks).toBe(2);
      expect(observed.realForgedAdmissionRejected).toBe(true);
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

    } catch (error) {
      environmentFailure = { label: 'fixture assertions', error };
      throw error;
    } finally {
      settleResources({ primary: environmentFailure, cleanup: [
        { label: 'previous PATH', settle: () => {
          if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
        } },
        { label: 'previous closeout state', settle: () => {
          if (previousState === undefined) delete process.env.SEC_CLOSEOUT_TEST_STATE;
          else process.env.SEC_CLOSEOUT_TEST_STATE = previousState;
        } }
      ] });
    }

  } catch (error) {
    scopeFailure = { label: 'fixture assertions', error };
    throw error;
  } finally {
    settleResources({ primary: scopeFailure, cleanup });
  }
}, 30_000);

// Exact bounded fixture values, without the hosted TestImpact source graph.
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const PAGE = `sha256:${'a'.repeat(64)}` as const;
const VERIFIED_AT = '2026-08-09T14:01:00.000Z';
const MERGE_AT = '2026-08-09T14:05:00.000Z';

test('rehydrated prepared envelope preserves remote history and composes with closeout authorization', () => {
  const inventory = (root: string, state: 'open' | 'merged'): BranchLifecycleInventory => ({
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: state === 'open' ? VERIFIED_AT : MERGE_AT,
    repository: { root, commonDir: path.join(root, '.git'), fullName: 'sec-platform/sec',
      remote: 'origin', remoteUrl: 'https://github.com/sec-platform/sec.git', defaultBranch: 'main' },
    main: { localSha: state === 'open' ? BASE : '9'.repeat(40),
      remoteSha: state === 'open' ? BASE : '9'.repeat(40) },
    localBranches: [{ branch: 'main', sha: state === 'open' ? BASE : '9'.repeat(40) },
      { branch: 'feat/example', sha: HEAD }],
    remoteBranches: [{ branch: 'main', sha: state === 'open' ? BASE : '9'.repeat(40) },
      { branch: 'feat/example', sha: HEAD }],
    worktrees: [],
    pullRequests: [{ number: 42, headBranch: 'feat/example', headSha: HEAD,
      baseBranch: 'main', baseSha: BASE, state, isDraft: false, isCrossRepository: false,
      url: 'https://github.example/pull/42' }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: false, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true, remotePrune: true,
      fetchPruneTags: true, reason: null },
    unknowns: []
  });
  const hostAbsolute = (...segments: string[]) =>
    path.resolve(path.parse(process.cwd()).root, ...segments);
  const remoteRoot = hostAbsolute('provider', 'sec');
  const localRoot = hostAbsolute('runner', 'sec');
  const remoteRecoveryPath = hostAbsolute('provider-recovery', 'branch.bundle');
  const localRecoveryPath = hostAbsolute('runner-recovery', 'branch.bundle');
  const remoteWorktreePath = hostAbsolute('provider', 'worktree');
  const remoteBefore = inventory(remoteRoot, 'open');
  const localBefore = inventory(localRoot, 'merged');
  const preparation = (root: string, recoveryPath: string, worktrees: string[]) =>
    createBranchCloseoutPreparation({
      preparedAt: VERIFIED_AT,
      repository: { root, commonDir: path.join(root, '.git'), fullName: 'sec-platform/sec',
        remote: 'origin', defaultBranch: 'main' },
      branch: 'feat/example', refState: 'present', expectedHeadSha: HEAD,
      expectedRemoteSha: HEAD, expectedLocalSha: HEAD, expectedPrHeadSha: null,
      pullRequestNumber: 42, pullRequestStateAtPreparation: 'open',
      recovery: { kind: 'bundle', path: recoveryPath, sha256: PAGE,
        verified: true, verifyOutput: 'verified' },
      worktreePathsAtPreparation: worktrees
    });
  const remotePreparation = preparation(remoteRoot, remoteRecoveryPath, [remoteWorktreePath]);
  const localPreparation = preparation(localRoot, localRecoveryPath, []);
  expect(localPreparation.preparationDigest).toBe(remotePreparation.preparationDigest);
  const envelope = (
    prepared: typeof remotePreparation,
    before: BranchLifecycleInventory,
    attempts: readonly Readonly<{ operation: 'recovery-verify'; status: 'success'; detail: string }>[]
  ) => {
    const payload = { schema: BRANCH_CLOSEOUT_PREPARED_ENVELOPE_SCHEMA,
      preparation: prepared, before, attempts: [...attempts], foreignWorktreeObservations: [] };
    return parsePreparedBranchCloseoutEnvelope(`${JSON.stringify({ ...payload,
      envelopeDigest: branchLifecycleDigest(payload) }, null, 2)}\n`);
  };
  const remote = envelope(remotePreparation, remoteBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'provider verified' }]);
  const local = envelope(localPreparation, localBefore,
    [{ operation: 'recovery-verify', status: 'success', detail: 'runner verified' }]);
  const rehydrated = rehydratePreparedBranchCloseoutEnvelope({ remote, local });
  expect(rehydrated.before).toEqual(remoteBefore);
  expect(rehydrated.before).not.toEqual(localBefore);
  expect(rehydrated.preparation.repository.root).toBe(localRoot);
  expect(rehydrated.preparation.recovery.path).toBe(localRecoveryPath);
  expect(rehydrated.preparation.worktreePathsAtPreparation).toEqual([]);
  expect(rehydrated.foreignWorktreeObservations).toHaveLength(1);
  expect(JSON.stringify(rehydrated.foreignWorktreeObservations)).not.toContain(JSON.stringify(remoteWorktreePath).slice(1, -1));
  expect(rehydrated.attempts).toEqual(local.attempts);
  expect(rehydrated.preparation.preparationDigest).toBe(remotePreparation.preparationDigest);
  const authorization = authorizeBranchCloseout({
    preparation: rehydrated.preparation,
    request: { capability: BRANCH_REF_CLOSEOUT_CAPABILITY, disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${'9'.repeat(40)}` } },
    before: rehydrated.before,
    current: localBefore,
    foreignWorktreeObservationDigests: rehydrated.foreignWorktreeObservations
      .map(({ observationDigest }) => observationDigest)
  });
  expect(authorization.blockers).toContain('external-maintainer-disposition-required');
  expect(authorization.remoteAction).toBe('blocked');
  expect(authorization.localAction).toBe('blocked');
});
