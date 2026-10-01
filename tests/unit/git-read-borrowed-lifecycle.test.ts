import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueGitReadAuthorityOperation } from '../../src/adapters/providers/git-read/authority.ts';
import { createAuthorityGitReadSession, retainGitReadPhysicalProviderInternal } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { assertGitPhysicalProviderCurrentInternal, assertGitPhysicalProviderReceipt, closeGitPhysicalProvider } from '../../src/adapters/providers/git/physical-provider.ts';
import { runObservedCommand } from '../../src/adapters/runtime-state/physical/runtime/observed-process.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { issueSecOperationRequirementBindingContext } from '../../src/execution/operation/requirement-binding-context.ts';
import { settleResourcesAsync, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';
import { createRawTestExecutableFixture } from '../testkit/raw-process.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Native execution only: these tests borrow an actual owner-issued process
// session. No close monkey-patch or structural stand-in can establish ownership.
function parent(root: string) {
  const operation = issueGitReadAuthorityOperation({ cwd: root, budget: {} });
  const requirement = operation.plan.execution.requirements.find(value => value.effectKinds.includes('process'))!;
  const session = openProcessResourceSession({ operation, requirementBindingContext: issueSecOperationRequirementBindingContext({
    operation, requirementId: requirement.id,
    resourceCeilings: operation.plan.execution.aggregateBudgets.filter(({ resource }) =>
      resource === 'duration-ms' || resource === 'processes' || resource === 'input-bytes' || resource === 'output-bytes')
  }) });
  return { operation, session };
}

for (const cause of ['missing-root', 'cancelled', 'executable-budget'] as const) {
  test(`Git ${cause} admission refuses without closing the borrowed parent`, () => withTempWorkspace(async root => {
    const owner = parent(root);
    try {
      const resolution = createAuthorityGitReadSession({
        cwd: cause === 'missing-root' ? path.join(root, 'missing') : root,
        operation: owner.operation, processSession: owner.session,
        budget: cause === 'executable-budget' ? { maxExecutableBytes: 1 } : {},
        ...(cause === 'cancelled' ? { signal: AbortSignal.abort() } : {})
      });
      assert.equal(resolution.status, 'unavailable');
      if (cause === 'executable-budget' && resolution.status === 'unavailable') {
        assert.equal(resolution.reason, 'git-session-executable-budget-exhausted');
      }
      assert.equal(owner.session.signal.aborted, false);
      assert.ok(Number.isSafeInteger(owner.session.cooperativeDeadlineAtUnixMs()));
    } finally { assertProcessResourceSessionReceipt(owner.session.close()); }
  }, 'sec-git-borrowed-'), DEFAULT_TEST_TIMEOUT_MS);
}

test('an owned Git session retains its process count after the real child and session close', () => withTempWorkspace(async root => {
  const operation = issueGitReadAuthorityOperation({ cwd: root, budget: {} });
  const resolution = createAuthorityGitReadSession({ cwd: root, operation, budget: {} });
  assert.equal(resolution.status, 'ready');
  if (resolution.status !== 'ready') throw new Error('Native Git admission is required for this test');
  const session = resolution.session;
  try {
    assert.throws(() => retainGitReadPhysicalProviderInternal(session));
    assert.equal((await session.run(['--version'])).kind, 'completed');
  }
  finally {
    const receipt = await session.close!();
    assert.equal(receipt.processCount, 1); assert.equal(session.processCount, receipt.processCount);
    assert.equal(await session.close!(), receipt);
  }
}, 'sec-git-closed-count-'), DEFAULT_TEST_TIMEOUT_MS);

test('borrowed physical provider rejects ledger, environment and cwd transplants without disposal', () => withTempWorkspace(async root => {
  const owner = parent(root), other = parent(root);
  const initial = createAuthorityGitReadSession({ cwd: root, operation: owner.operation, processSession: owner.session, budget: {} });
  assert.equal(initial.status, 'ready');
  if (initial.status !== 'ready') throw new Error('Native Git admission is required');
  const physical = retainGitReadPhysicalProviderInternal(initial.session);
  try {
    await initial.session.close!();
    for (const changed of [
      { operation: other.operation, processSession: other.session },
      // Equal fields and borrowed methods cannot impersonate the actual ledger.
      { processSession: { ...owner.session } },
      { environment: { SEC_PROVIDER_BINDING_TEST: 'changed' } },
      { cwd: path.dirname(root) }
    ]) {
      const rejected = createAuthorityGitReadSession({ cwd: root, operation: owner.operation,
        processSession: owner.session, physicalProvider: physical, budget: {}, ...changed });
      assert.equal(rejected.status, 'unavailable');
      assertGitPhysicalProviderCurrentInternal(physical);
    }
    const borrowed = createAuthorityGitReadSession({ cwd: root, operation: owner.operation,
      processSession: owner.session, physicalProvider: physical, budget: {} });
    assert.equal(borrowed.status, 'ready');
    if (borrowed.status !== 'ready') throw new Error('Exact native borrowing is required');
    assert.equal(borrowed.session.executableBytes, 0);
    assert.equal((await borrowed.session.run(['--version'])).kind, 'completed');
    await borrowed.session.close!();
    assertGitPhysicalProviderCurrentInternal(physical);
    assert.throws(() => retainGitReadPhysicalProviderInternal(borrowed.session));
  } finally {
    assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(physical), physical);
    assertProcessResourceSessionReceipt(owner.session.close());
    assertProcessResourceSessionReceipt(other.session.close());
  }
}, 'sec-git-provider-binding-'), DEFAULT_TEST_TIMEOUT_MS);

// Fault interception stays in this child process. All capability issuance,
// retained handles, process ledgers, commands and settlement remain native.
test('operation provider ownership survives phase closure and settles every failure path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-git-operation-owner-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const source = (relative: string) => JSON.stringify(path.join(repo, relative));
  const executable = createRawTestExecutableFixture();
  let settled = false;
  const script = `
    import assert from 'node:assert/strict';
    import { copyFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
    import path from 'node:path';
    import { mock } from 'bun:test';
    const physicalModule = ${source('src/adapters/providers/git/physical-provider.ts')};
    const physical = await import(physicalModule);
    const nativeOpen = physical.openGitPhysicalProvider;
    const nativeClose = physical.closeGitPhysicalProvider;
    const nativeCurrent = physical.assertGitPhysicalProviderCurrentInternal;
    const processModule = ${source('src/adapters/runtime-state/physical/runtime/process-resource-session.ts')};
    const processes = await import(processModule);
    const nativeProcessOpen = processes.openProcessResourceSession;
    const retainModule = ${source('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')};
    const retained = await import(retainModule);
    const retainFile = retained.retainNoFollowOrdinaryFile;
    const retainDirectory = retained.retainNoFollowDirectoryForChildProcess;
    const primary = new Error('phase callback rejection');
    const borrowFailure = new Error('borrowed phase close fence');
    const rootFailure = new Error('root physical receipt failure');
    let failBorrow = false, failRoot = false;
    let opened = [], closed = [], ledgers = [], handles = [];
    mock.module(retainModule, () => ({ ...retained,
      retainNoFollowOrdinaryFile: (...args) => {
        const handle = retainFile(...args);
        if (args[3] === 'Git physical provider executable') handles.push(handle);
        return handle;
      },
      retainNoFollowDirectoryForChildProcess: (...args) => {
        const handle = retainDirectory(...args);
        if (args[2] === 'Git physical provider working directory') handles.push(handle);
        return handle;
      }
    }));
    mock.module(processModule, () => ({ ...processes,
      openProcessResourceSession: input => {
        const ledger = nativeProcessOpen(input); ledgers.push(ledger); return ledger;
      }
    }));
    mock.module(physicalModule, () => ({ ...physical,
      openGitPhysicalProvider: input => {
        const result = nativeOpen(input);
        if (result.status === 'ready') opened.push(result.capability);
        return result;
      },
      assertGitPhysicalProviderCurrentInternal: capability => {
        nativeCurrent(capability);
        if (failBorrow) throw borrowFailure;
      },
      closeGitPhysicalProvider: capability => {
        closed.push(capability);
        const receipt = nativeClose(capability);
        if (failRoot) throw rootFailure;
        return receipt;
      }
    }));
    const { withAuthorityGitReadOperation } = await import(${source('src/adapters/providers/git-read/authority.ts')});
    const { resolveGitReadSessionBudget, isolatedGitReadEnvironment } = await import(${source('src/adapters/providers/git-read/runtime/session.ts')});
    const { resolveExecutableLocator } = await import(${source('src/adapters/runtime-state/physical/runtime/process.ts')});
    const budget = resolveGitReadSessionBudget(undefined), root = ${JSON.stringify(root)};
    const input = () => ({ cwd: root, budget, deadlineAtUnixMs: Date.now() + budget.deadlineMs });
    const failures = error => error instanceof AggregateError ? error.errors.flatMap(failures) : [error];
    const assertSettled = () => {
      assert.equal(opened.length, 1); assert.deepEqual(closed, opened);
      assert.equal(ledgers.length, 1); assert.equal(handles.length, 2);
      assert.throws(() => nativeCurrent(opened[0]));
      assert.throws(() => ledgers[0].cooperativeDeadlineAtUnixMs());
      for (const handle of handles) assert.throws(() => handle.assertCurrent());
    };
    const reset = () => { opened = []; closed = []; ledgers = []; handles = []; failBorrow = false; failRoot = false; };

    await assert.rejects(withAuthorityGitReadOperation({ ...input(), budget: { ...budget, maxSettlementAttempts: 1 } },
      scope => scope.runPhase('no-close-capacity', async () => { throw new Error('callback must not be admitted'); })));
    assert.equal(opened.length, 0); assert.equal(closed.length, 0); assert.equal(handles.length, 0);
    assert.equal(ledgers.length, 1); assert.throws(() => ledgers[0].cooperativeDeadlineAtUnixMs());
    reset();
    assert.equal(await withAuthorityGitReadOperation({ ...input(), budget: { ...budget, maxSettlementAttempts: 1 } },
      async () => 'no phase'), 'no phase');
    assert.equal(opened.length, 0); assert.equal(closed.length, 0); assert.equal(handles.length, 0);
    assert.equal(ledgers.length, 1); assert.throws(() => ledgers[0].cooperativeDeadlineAtUnixMs());
    reset();

    await withAuthorityGitReadOperation(input(), async scope => {
      for (const phase of ['request', 'freeze-candidate', 'normalization-source', 'normalization-readback', 'final-readback']) {
        await scope.runPhase(phase, async session => {
          assert.equal((await session.run(['--version'])).kind, 'completed');
          assert.equal(closed.length, 0);
        });
        assert.equal(opened.length, 1); assert.equal(closed.length, 0);
        nativeCurrent(opened[0]);
      }
    });
    assertSettled();

    reset();
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const admitted = new Promise(resolve => { entered = resolve; });
    const pending = withAuthorityGitReadOperation(input(), async scope => {
      void scope.runPhase('detached', async session => {
        entered(); await gate;
        assert.equal((await session.run(['--version'])).kind, 'completed');
      });
    });
    await admitted; assert.equal(closed.length, 0); nativeCurrent(opened[0]);
    release(); await pending; assertSettled();

    reset();
    await assert.rejects(withAuthorityGitReadOperation(input(), async scope => {
      await scope.runPhase('caller-failure', async () => { throw primary; });
    }), error => error === primary);
    assertSettled();

    reset();
    await assert.rejects(withAuthorityGitReadOperation(input(), async scope => {
      await scope.runPhase('borrow-close-failure', async () => {
        failBorrow = true; failRoot = true; throw primary;
      });
    }), error => {
      const causes = failures(error);
      assert.ok(causes.includes(primary)); assert.ok(causes.includes(borrowFailure)); assert.ok(causes.includes(rootFailure));
      return true;
    });
    assertSettled();

    reset();
    await assert.rejects(withAuthorityGitReadOperation(input(), async scope => {
      await scope.runPhase('successful-value', async () => 'result');
      failRoot = true;
      return 'must not escape before root settlement';
    }), error => failures(error).includes(rootFailure));
    assertSettled();

    reset();
    const cancellation = new AbortController();
    await assert.rejects(withAuthorityGitReadOperation({ ...input(), signal: cancellation.signal }, async scope => {
      await scope.runPhase('cancelled', async () => cancellation.abort());
    }));
    assertSettled();

    reset();
    // Replacement is tested only against this child's own executable copy.
    // Windows excludes replacement while retained; Linux detects the changed
    // lexical identity at the next phase and still retires both held handles.
    const bin = path.join(root, 'bin'); mkdirSync(bin);
    const env = isolatedGitReadEnvironment();
    const installed = resolveExecutableLocator('git', { pathValue: env.PATH ?? '', cwd: root });
    const privateGit = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git');
    copyFileSync(installed, privateGit);
    let nextEntered = false;
    const replaced = withAuthorityGitReadOperation({ ...input(), environment: { PATH: bin } }, async scope => {
      await scope.runPhase('before-replacement', async session => assert.equal(session.verifyExecutable(), true));
      if (process.platform === 'win32') {
        assert.throws(() => renameSync(privateGit, privateGit + '.old'));
      } else {
        renameSync(privateGit, privateGit + '.old'); copyFileSync(installed, privateGit);
      }
      await scope.runPhase('after-replacement', async session => { nextEntered = true; assert.equal(session.verifyExecutable(), true); });
    });
    if (process.platform === 'win32') { await replaced; assert.equal(nextEntered, true); }
    else { await assert.rejects(replaced); assert.equal(nextEntered, false); }
    assertSettled();
    unlinkSync(privateGit);
    console.log('native retained provider lifecycle settled');
  `;
  let primary: ResourceSettlementFailure | undefined;
  try {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const outcome = await runObservedCommand(executable.command, ['--no-env-file', '--eval', script], {
      cwd: root, envMode: 'replace', env: { ...process.env },
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS, maxObservedOutputBytes: 64 * 1024,
      onOutput: (stream, chunk) => (stream === 'stdout' ? stdout : stderr).push(Buffer.from(chunk))
    });
    settled = outcome.termination.treeClosed && outcome.termination.childCloseObserved && outcome.termination.streamsDrained;
    assert.equal(settled, true); assert.equal(outcome.status, 'exited');
    assert.equal(outcome.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).toString().trim(), 'native retained provider lifecycle settled');
  } catch (error) { primary = { label: 'native-provider-lifecycle', error }; }
  await settleResourcesAsync({ primary, cleanup: settled ? [
    { label: 'native-child-executable', settle: () => executable.dispose() },
    { label: 'native-child-workspace', settle: () => rm(root, { recursive: true, force: true }) }
  ] : [] });
}, DEFAULT_TEST_TIMEOUT_MS);
