import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, createCiVerificationLocalExecutionEnvironment, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/verification/action/contract/ci.ts';
import { createVerificationActionKey, createVerificationActionPlan, type VerificationActionKeyDigest, type VerificationActionKeyInput } from '../../src/verification/action/contract/action.ts';
import {
  createBranchLifecycleGitChildEnvironment
} from '../../src/control/branch-lifecycle/branch-lifecycle-command.ts';
import { createRuntimeStateJournalFileSystem } from '../../src/runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../src/runtime-state/workspace-state/paths.ts';
import {
  appendVerificationActionJournalEvent as appendJournalEvent,
  readVerificationActionJournal as readJournal
} from '../../src/verification/action/journal.ts';
import {
  executeLocalVerificationActionDag,
  VerificationActionRunner
} from '../../src/verification/action/runner.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const BASE_SHA = '1'.repeat(40);
const BASE_TREE_SHA = '2'.repeat(40);
const HEAD_SHA = '3'.repeat(40);
const HEAD_TREE_SHA = '4'.repeat(40);
const PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS = 30_000;

function journalFs(repositoryRoot: string) {
  const root = resolveSecWorkspaceRuntimeRoots({ repositoryRoot }).workspaceStateRoot;
  return createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(root, 'VerificationAction runner test journal root').target
  );
}

function readVerificationActionJournalV2(
  repositoryRoot: string,
  actionKey: Parameters<typeof readJournal>[1]
) {
  return readJournal(journalFs(repositoryRoot), actionKey);
}

function appendVerificationActionJournalEventV2(
  input: Omit<Parameters<typeof appendJournalEvent>[0], 'fs'> & { repositoryRoot: string }
) {
  const { repositoryRoot, ...event } = input;
  return appendJournalEvent({ ...event, fs: journalFs(repositoryRoot) });
}

function createAction(
  kind: string,
  inputPath: string,
  requiredCheapPreflightActionKeys: readonly `sha256:${string}`[]
) {
  const input: VerificationActionKeyInput = {
    actionKind: kind,
    producer: { identity: 'runner-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [{ path: inputPath, digest: DIGEST_A }],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local',
      contractRevision: 'verification-result-v1'
    },
    requiredCheapPreflightActionKeys,
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1'
  };
  return createVerificationActionKey(input);
}

function preflightAction(inputPath = 'scripts/codex/example.ts') {
  return createAction('cheap-preflight', inputPath, []);
}

function action(kind = 'runner-contract', inputPath = 'scripts/codex/example.ts') {
  return kind === 'cheap-preflight'
    ? preflightAction(inputPath)
    : createAction(kind, inputPath, [preflightAction(inputPath).actionKey]);
}

function seedPassedPreflight(repositoryRoot: string, inputPath = 'scripts/codex/example.ts'): void {
  const preflight = preflightAction(inputPath);
  const current = readVerificationActionJournalV2(repositoryRoot, preflight.actionKey);
  if (current.latestState === 'terminal' || current.latestState === 'reused') return;
  appendVerificationActionJournalEventV2({ repositoryRoot, action: preflight, state: 'queued' });
  appendVerificationActionJournalEventV2({ repositoryRoot, action: preflight, state: 'running' });
  appendVerificationActionJournalEventV2({
    repositoryRoot,
    action: preflight,
    state: 'terminal',
    terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: null }
  });
}

function seedFailedPreflight(repositoryRoot: string, inputPath = 'scripts/codex/example.ts'): void {
  const preflight = preflightAction(inputPath);
  const current = readVerificationActionJournalV2(repositoryRoot, preflight.actionKey);
  if (current.latestState === 'terminal' || current.latestState === 'reused') return;
  appendVerificationActionJournalEventV2({ repositoryRoot, action: preflight, state: 'queued' });
  appendVerificationActionJournalEventV2({ repositoryRoot, action: preflight, state: 'running' });
  appendVerificationActionJournalEventV2({
    repositoryRoot,
    action: preflight,
    state: 'terminal',
    terminal: { status: 'failed', reasonCode: 'executed-failure', resultDigest: null }
  });
}

function runnablePlan(key: ReturnType<typeof action>, repositoryRoot?: string) {
  if (repositoryRoot !== undefined) seedPassedPreflight(repositoryRoot);
  const preflight = preflightAction();
  return createVerificationActionPlan({
    action: key,
    executionClass: 'expensive',
    dependencies: [{ actionKey: preflight.actionKey, kind: 'cheap-preflight' }]
  });
}

function cheapPlan(key: ReturnType<typeof preflightAction>) {
  return createVerificationActionPlan({
    action: key,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
}

const runtimeRoots = new Set<string>();

afterEach(() => {
  for (const runtimeRoot of runtimeRoots) rmSync(runtimeRoot, { recursive: true, force: true });
  runtimeRoots.clear();
});

function root(): string {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-runner-v2-'));
  const workspaceStateRoot = resolveSecWorkspaceRuntimeRoots({ repositoryRoot }).workspaceStateRoot;
  mkdirSync(workspaceStateRoot, { recursive: true });
  runtimeRoots.add(workspaceStateRoot);
  return repositoryRoot;
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function inspectRepository(repositoryRoot: string) {
  const read = (args: readonly string[]) => {
    const result = spawnSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: createBranchLifecycleGitChildEnvironment(process.env),
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(String(result.stderr || result.stdout));
    return String(result.stdout).trim();
  };
  return {
    headSha: read(['rev-parse', 'HEAD']),
    headTreeSha: read(['rev-parse', 'HEAD^{tree}']),
    trackedClean:
      read(['diff', '--name-only', '--ignore-cr-at-eol']) === ''
      && read(['diff', '--cached', '--name-only', '--ignore-cr-at-eol']) === ''
      && read(['ls-files', '--others', '--exclude-standard']) === '',
    gitCommonDirectory: realpathSync.native(read([
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]))
  };
}

test('concurrent callers in different execution domains join one physical executor invocation', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const secondRunner = new VerificationActionRunner();
    const key = action();
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const executor = async () => {
      invocations += 1;
      await held;
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const first = runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'domain-a',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    await Promise.resolve();
    const second = secondRunner.execute({
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'domain-b',
      plan: runnablePlan(key, secondRepositoryRoot),
      executor
    });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(invocations).toBe(1);
    expect(firstResult.disposition).toBe('executed');
    expect(secondResult.disposition).toBe('joined');
    expect(firstResult.terminal?.status).toBe('passed');
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState).toBe('terminal');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(secondRepositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('missing execution plan fails closed before any physical execution', async () => {
  const repositoryRoot = root();
  try {
    const key = action('missing-plan-action');
    let invocations = 0;
    const result = await new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('explicit action plan required');
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('forged scheduler lane fails closed before any physical execution', async () => {
  const repositoryRoot = root();
  try {
    const key = action('forged-plan-action');
    const forgedPlan = {
      ...runnablePlan(key, repositoryRoot),
      executionClass: 'cheap-preflight'
    } as never;
    let invocations = 0;
    await expect(new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: forgedPlan,
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    })).rejects.toThrow('must match required cheap-preflight topology');
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('a non-runnable concurrent caller cannot join an authorized physical flight', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('caller-local-plan-action');
    seedFailedPreflight(secondRepositoryRoot);
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        invocations += 1;
        await held;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await Promise.resolve();
    const blocked = await runner.execute({
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    const missing = await runner.execute({
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(blocked.disposition).toBe('blocked');
    expect(blocked.reason).toContain('cheap-preflight');
    expect(missing.disposition).toBe('blocked');
    expect(missing.reason).toContain('explicit action plan required');
    expect(invocations).toBe(1);
    release();
    await running;
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(secondRepositoryRoot, { recursive: true, force: true });
  }
});

test('same-owner cycle cannot bypass guard by changing executionDomain', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('reentrant-action');
    let invocations = 0;
    let nested: Promise<Awaited<ReturnType<VerificationActionRunner['execute']>>> | null = null;
    const executor = () => {
      invocations += 1;
      nested = runner.execute({
        repositoryRoot,
        action: key,
        executionDomain: 'different-domain',
        plan: runnablePlan(key, repositoryRoot),
        executor
      });
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'initial-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    const nestedResult = await nested!;
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('executed');
    expect(nestedResult.disposition).toBe('blocked');
    expect(nestedResult.reason).toContain('reentrant-cycle');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('awaited nested same-key execution is rejected without self-join deadlock', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('awaited-reentrant-action');
    let invocations = 0;
    const executor = async () => {
      invocations += 1;
      const nested = await runner.execute({
        repositoryRoot,
        action: key,
        executionDomain: 'awaited-different-domain',
        plan: runnablePlan(key, repositoryRoot),
        executor
      });
      expect(nested.disposition).toBe('blocked');
      expect(nested.reason).toContain('reentrant-cycle');
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'awaited-initial-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    expect(result.disposition).toBe('executed');
    expect(invocations).toBe(1);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('nested execution cannot override its inherited ownerToken', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('owner-token-override-action');
    let invocations = 0;
    const executor = async () => {
      invocations += 1;
      await expect(runner.execute({
        repositoryRoot,
        action: key,
        ownerToken: 'different-owner',
        executionDomain: 'different-domain',
        plan: runnablePlan(key, repositoryRoot),
        executor
      })).rejects.toThrow('ownerToken cannot override the inherited execution owner');
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      ownerToken: 'outer-owner',
      executionDomain: 'outer-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('executed');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('caller-forged terminal-passed state without a journal fact cannot start an expensive action', async () => {
  const repositoryRoot = root();
  try {
    const key = action('missing-machine-preflight-fact');
    let invocations = 0;
    const result = await new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('is unknown');
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('fresh terminal success reuses without execution and terminal failure never becomes PASS', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const passed = action('passed-action');
    let passedInvocations = 0;
    const first = await runner.execute({
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed, repositoryRoot),
      executor: () => {
        passedInvocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    const reused = await runner.execute({
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed, repositoryRoot),
      executor: () => {
        passedInvocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(first.disposition).toBe('executed');
    expect(reused.disposition).toBe('reused');
    expect(passedInvocations).toBe(1);

    const failed = action('failed-action');
    let failedInvocations = 0;
    await runner.execute({
      repositoryRoot,
      action: failed,
      plan: runnablePlan(failed, repositoryRoot),
      executor: () => {
        failedInvocations += 1;
        return { status: 'failed' as const, reasonCode: 'executed-failure' as const, resultDigest: null };
      }
    });
    const failedReuse = await runner.execute({
      repositoryRoot,
      action: failed,
      plan: runnablePlan(failed, repositoryRoot),
      executor: () => {
        failedInvocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(failedReuse.disposition).toBe('reused');
    expect(failedReuse.terminal?.status).toBe('failed');
    expect(failedReuse.reason).toContain('never projected as PASS');
    expect(failedInvocations).toBe(1);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('identity execution derives one plan and reuses its terminal without physical execution', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const actionInput: VerificationActionKeyInput = {
      actionKind: 'identity-runner-test',
      producer: { identity: 'runner-test', revision: 'identity-executor' },
      operation: {
        identity: 'identity-runner',
        revision: 'identity-normalizer',
        semanticDigest: DIGEST_A,
        workingDirectory: '.',
        declaredEnvironment: [{ name: 'provider', digest: DIGEST_A }]
      },
      inputClosure: [{ path: 'tests/unit/verification-action-runner.test.ts', digest: DIGEST_A }],
      environment: {
        toolchainRevision: 'bun',
        providerRevision: 'native-checker',
        contractRevision: 'identity-runner'
      },
      requiredCheapPreflightActionKeys: [],
      upstreamActionKeys: [],
      resultSchemaRevision: 'identity-terminal'
    };
    let invocations = 0;
    const execute = () => runner.executeIdentity({
      repositoryRoot,
      actionInput,
      executionClass: 'cheap-preflight',
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: DIGEST_A };
      }
    });
    const first = await execute();
    const second = await execute();
    expect(first.disposition).toBe('executed');
    expect(second.disposition).toBe('reused');
    expect(second.physicalExecution).toBe(false);
    expect(second.terminal?.status).toBe('passed');
    expect(invocations).toBe(1);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('executor diagnostics are journal-safe and bounded when failures contain controls or long text', async () => {
  const repositoryRoot = root();
  try {
    const key = action('diagnostic-action');
    const result = await new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: () => {
        throw new Error(`line one\nline two\t${'x'.repeat(2000)}`);
      }
    });
    expect(result.disposition).toBe('executed');
    expect(result.terminal?.status).toBe('failed');
    expect(result.reason).toContain('executor threw: line one line two');
    expect(result.reason?.length).toBeLessThanOrEqual(1024);
    const journal = readVerificationActionJournalV2(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('terminal');
    expect(journal.events.at(-1)?.note).toBe(result.reason);
    expect(journal.events.at(-1)?.note).not.toMatch(/[\u0000-\u001f]/u);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('cheap preflight failure prevents physical execution', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('expensive-action');
    const dependency = preflightAction();
    seedFailedPreflight(repositoryRoot);
    const plan = createVerificationActionPlan({
      action: key,
      executionClass: 'expensive',
      dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
    });
    let invocations = 0;
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      plan,
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.terminal).toBeNull();
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('dependency closure is re-read after execution and unstable closure discards physical result', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('dependency-race-action');
    let invocations = 0;
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: () => {
        invocations += 1;
        runner.invalidateIfDependent({
          repositoryRoot,
          action: preflightAction(),
          changedInputPaths: null,
          note: 'preflight changed during action'
        });
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('blocked');
    expect(result.physicalExecution).toBe(true);
    expect(result.reason).toContain('dependency closure');
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState).toBe('invalidated');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('input invalidation discards an in-flight physical result', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('invalidated-action');
    let release!: () => void;
    let markStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        markStarted();
        await held;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await started;
    const invalidated = runner.invalidateIfDependent({
      repositoryRoot,
      action: key,
      changedInputPaths: ['scripts/codex/example.ts']
    });
    expect(invalidated.latestState).toBe('invalidated');
    release();
    const result = await running;
    expect(result.disposition).toBe('blocked');
    expect(result.terminal).toBeNull();
    expect(result.physicalExecution).toBe(true);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('persisted running and queued actions without a terminal permanently block blind re-execution', async () => {
  for (const [state, kind] of [['running', 'orphaned-action'], ['queued', 'queued-orphaned-action']] as const) {
    const repositoryRoot = root();
    try {
      const key = action(kind);
      appendVerificationActionJournalEventV2({ repositoryRoot, action: key, state: 'queued' });
      if (state === 'running') {
        appendVerificationActionJournalEventV2({ repositoryRoot, action: key, state: 'running' });
      }
      let invocations = 0;
      const result = await new VerificationActionRunner().execute({
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor: () => {
          invocations += 1;
          return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
        }
      });
      expect(result.disposition).toBe('blocked');
      expect(result.reason).toContain('no provable terminal');
      expect(invocations).toBe(0);
      expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState)
        .toBe(state);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  }
});

function localDagFixture(environment = createCiVerificationLocalExecutionEnvironment({
  os: 'win32',
  arch: 'x64',
  bunVersion: '1.3.14'
}), identity: Partial<Pick<CiVerificationActionCandidate,
  'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha'>> = {}) {
  const candidate: CiVerificationActionCandidate = {
    baseSha: BASE_SHA,
    baseTreeSha: BASE_TREE_SHA,
    headSha: HEAD_SHA,
    headTreeSha: HEAD_TREE_SHA,
    manifestPath: 'docs/work-packages/local-feedback-v1.md',
    manifestDigest: DIGEST_A,
    scopeAuthorizationRevision: `sha256:${'b'.repeat(64)}`,
    profile: 'quick',
    toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      { path: '.bun-version', digest: DIGEST_A },
      { path: 'bun.lock', digest: DIGEST_A },
      { path: 'bunfig.toml', digest: DIGEST_A },
      { path: 'package.json', digest: DIGEST_A }
    ],
    ...identity
  };
  const gates: readonly CiVerificationProducerGate[] = [Object.freeze({
    id: 'typecheck',
    phase: 'quick',
    argv: Object.freeze(['bun', 'run', 'typecheck']),
    runtime: 'bun',
    environment: Object.freeze({ SEC_LOCAL_FEEDBACK: DIGEST_A }),
    coveredScopeIds: Object.freeze(['gate:typecheck'])
  })];
  return {
    environment,
    closure: buildCiVerificationActionPlanClosure({ candidate, gates })
  };
}

test('local quick DAG keeps journal authority separate from the detached candidate executor and reuses terminals', async () => {
  const authorityRoot = root();
  const candidateRoot = root();
  try {
    const fixture = localDagFixture();
    let physicalExecutions = 0;
    const inspectRepository = (repositoryRoot: string) => ({
      headSha: repositoryRoot === candidateRoot ? HEAD_SHA : BASE_SHA,
      headTreeSha: repositoryRoot === candidateRoot ? HEAD_TREE_SHA : BASE_TREE_SHA,
      trackedClean: true,
      gitCommonDirectory: authorityRoot
    });
    const first = await executeLocalVerificationActionDag({
      authorityRoot,
      candidateRoot,
      actionPlanClosure: fixture.closure,
      executionEnvironment: fixture.environment,
      inspectRepository,
      executeNormalizedOperation: () => {
        physicalExecutions += 1;
        return 0;
      }
    });
    const reused = await executeLocalVerificationActionDag({
      authorityRoot,
      candidateRoot,
      actionPlanClosure: fixture.closure,
      executionEnvironment: fixture.environment,
      inspectRepository,
      executeNormalizedOperation: () => {
        physicalExecutions += 1;
        return 0;
      }
    });
    expect(first.status).toBe('passed');
    expect(first.actionResults[0]?.disposition).toBe('executed');
    expect(reused.actionResults[0]?.disposition).toBe('reused');
    expect(reused.terminalDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(physicalExecutions).toBe(1);
    expect(readVerificationActionJournalV2(
      authorityRoot,
      fixture.closure.actions[0]!.action.actionKey
    ).latestState).toBe('terminal');
  } finally {
    rmSync(authorityRoot, { recursive: true, force: true });
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test('local quick DAG binds the intended detached worktree under hostile ambient Git steering without index refresh', async () => {
  const workspaceRoot = root();
  const authorityRoot = path.join(workspaceRoot, 'authority');
  const candidateRoot = path.join(workspaceRoot, 'candidate');
  const decoyRoot = path.join(workspaceRoot, 'decoy');
  try {
    git(workspaceRoot, ['init', authorityRoot]);
    git(authorityRoot, ['config', 'user.name', 'SEC Runner']);
    git(authorityRoot, ['config', 'user.email', 'sec-runner@example.invalid']);
    writeFileSync(path.join(authorityRoot, '.gitignore'), '.tmp/\n', 'utf8');
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'candidate\n', 'utf8');
    git(authorityRoot, ['add', '.gitignore', 'tracked.txt']);
    git(authorityRoot, ['commit', '-m', 'candidate']);
    const headSha = git(authorityRoot, ['rev-parse', 'HEAD']);
    const headTreeSha = git(authorityRoot, ['rev-parse', 'HEAD^{tree}']);
    git(authorityRoot, ['worktree', 'add', '--detach', candidateRoot, headSha]);
    const originalBranch = git(authorityRoot, ['symbolic-ref', '--short', 'HEAD']);
    git(authorityRoot, ['switch', '-c', 'replacement-view']);
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'replacement\n', 'utf8');
    git(authorityRoot, ['add', 'tracked.txt']);
    git(authorityRoot, ['commit', '-m', 'replacement object view']);
    const replacementCommit = git(authorityRoot, ['rev-parse', 'HEAD']);
    git(authorityRoot, ['switch', originalBranch]);
    git(authorityRoot, ['replace', headSha, replacementCommit]);
    expect(git(authorityRoot, ['rev-parse', 'HEAD^{tree}'])).not.toBe(headTreeSha);
    expect(git(authorityRoot, ['show', `${headSha}:tracked.txt`])).toBe('replacement');
    const canonicalBlob = spawnSync('git', ['show', `${headSha}:tracked.txt`], {
      cwd: authorityRoot,
      encoding: 'buffer',
      windowsHide: true,
      env: createBranchLifecycleGitChildEnvironment(process.env)
    });
    expect(canonicalBlob.status).toBe(0);
    expect(canonicalBlob.stdout.toString('utf8').trim()).toBe('candidate');

    git(workspaceRoot, ['init', decoyRoot]);
    git(decoyRoot, ['config', 'user.name', 'SEC Decoy']);
    git(decoyRoot, ['config', 'user.email', 'sec-decoy@example.invalid']);
    writeFileSync(path.join(decoyRoot, 'decoy.txt'), 'decoy\n', 'utf8');
    git(decoyRoot, ['add', 'decoy.txt']);
    git(decoyRoot, ['commit', '-m', 'decoy']);
    const decoyGitDirectory = git(decoyRoot, [
      'rev-parse', '--path-format=absolute', '--absolute-git-dir'
    ]);
    const decoyIndex = git(decoyRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const authorityIndex = git(authorityRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const candidateIndex = git(candidateRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const snapshot = (indexPath: string) => {
      const stat = statSync(indexPath);
      return Object.freeze({
        bytes: readFileSync(indexPath),
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    };
    const authorityBefore = snapshot(authorityIndex);
    const candidateBefore = snapshot(candidateIndex);
    const future = new Date(Date.now() + 5_000);
    utimesSync(path.join(candidateRoot, 'tracked.txt'), future, future);

    const hostileEnvironment: Readonly<Record<string, string>> = {
      GIT_DIR: decoyGitDirectory,
      GIT_WORK_TREE: decoyRoot,
      GIT_COMMON_DIR: decoyGitDirectory,
      GIT_INDEX_FILE: decoyIndex,
      GIT_OBJECT_DIRECTORY: path.join(decoyGitDirectory, 'objects'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: decoyRoot
    };
    const priorEnvironment = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(hostileEnvironment)) {
      priorEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const fixture = localDagFixture(undefined, {
        baseSha: headSha,
        baseTreeSha: headTreeSha,
        headSha,
        headTreeSha
      });
      const result = await executeLocalVerificationActionDag({
        authorityRoot,
        candidateRoot,
        actionPlanClosure: fixture.closure,
        executionEnvironment: fixture.environment,
        inspectRepository,
        executeNormalizedOperation: () => 0
      });
      expect(result.status).toBe('passed');
      writeFileSync(path.join(candidateRoot, 'tracked.txt'), 'dirty\n', 'utf8');
      await expect(executeLocalVerificationActionDag({
        authorityRoot,
        candidateRoot,
        actionPlanClosure: fixture.closure,
        executionEnvironment: fixture.environment,
        inspectRepository,
        executeNormalizedOperation: () => 0
      })).rejects.toThrow('exact clean candidate head and tree');
      for (const [indexPath, before] of [
        [authorityIndex, authorityBefore],
        [candidateIndex, candidateBefore]
      ] as const) {
        const after = snapshot(indexPath);
        expect(after.bytes).toEqual(before.bytes);
        expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs })
          .toEqual({
            dev: before.dev,
            ino: before.ino,
            size: before.size,
            mtimeMs: before.mtimeMs
          });
      }
    } finally {
      for (const [name, value] of priorEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}, 180_000);

test('local quick DAG rejects hosted/environment drift and distinct environments produce disjoint ActionKeys', async () => {
  const authorityRoot = root();
  const candidateRoot = root();
  try {
    const local = localDagFixture();
    const secondLocal = localDagFixture();
    const hosted = localDagFixture(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT);
    expect(local.closure.actions[0]!.action.actionKey).toBe(secondLocal.closure.actions[0]!.action.actionKey);
    expect(local.closure.actions[0]!.action.actionKey).not.toBe(hosted.closure.actions[0]!.action.actionKey);
    await expect(executeLocalVerificationActionDag({
      authorityRoot,
      candidateRoot,
      actionPlanClosure: hosted.closure,
      executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
      inspectRepository: () => ({
        headSha: HEAD_SHA,
        headTreeSha: HEAD_TREE_SHA,
        trackedClean: true,
        gitCommonDirectory: authorityRoot
      }),
      executeNormalizedOperation: () => 0
    })).rejects.toThrow('canonical local execution environment');
  } finally {
    rmSync(authorityRoot, { recursive: true, force: true });
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test('cheap actions can be scheduled without an ActionKey cost field', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = preflightAction('scripts/codex/cheap.ts');
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      plan: cheapPlan(key),
      executor: () => ({ status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null })
    });
    expect(result.disposition).toBe('executed');
    expect(result.terminal?.status).toBe('passed');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
