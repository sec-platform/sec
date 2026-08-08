import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  type VerificationActionKeyInputV2
} from '../../scripts/codex/verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV2,
  readVerificationActionJournalV2
} from '../../scripts/codex/verification-action-journal.ts';
import { VerificationActionRunnerV2 } from '../../scripts/codex/verification-action-runner.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;

function createAction(
  kind: string,
  inputPath: string,
  requiredCheapPreflightActionKeys: readonly `sha256:${string}`[]
) {
  const input: VerificationActionKeyInputV2 = {
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
  return createVerificationActionKeyV2(input);
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
  return createVerificationActionPlanV2({
    action: key,
    executionClass: 'expensive',
    dependencies: [{ actionKey: preflight.actionKey, kind: 'cheap-preflight' }]
  });
}

function cheapPlan(key: ReturnType<typeof preflightAction>) {
  return createVerificationActionPlanV2({
    action: key,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
}

function root(): string {
  return mkdtempSync(path.join(tmpdir(), 'sec-action-runner-v2-'));
}

test('concurrent callers in different execution domains join one physical executor invocation', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV2();
    const secondRunner = new VerificationActionRunnerV2();
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
});

test('missing execution plan fails closed before any physical execution', async () => {
  const repositoryRoot = root();
  try {
    const key = action('missing-plan-action');
    let invocations = 0;
    const result = await new VerificationActionRunnerV2().execute({
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
    await expect(new VerificationActionRunnerV2().execute({
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
    const runner = new VerificationActionRunnerV2();
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
    const runner = new VerificationActionRunnerV2();
    const key = action('reentrant-action');
    let invocations = 0;
    let nested: Promise<Awaited<ReturnType<VerificationActionRunnerV2['execute']>>> | null = null;
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
    const runner = new VerificationActionRunnerV2();
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
    const runner = new VerificationActionRunnerV2();
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
    const result = await new VerificationActionRunnerV2().execute({
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
    const runner = new VerificationActionRunnerV2();
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

test('executor diagnostics are journal-safe and bounded when failures contain controls or long text', async () => {
  const repositoryRoot = root();
  try {
    const key = action('diagnostic-action');
    const result = await new VerificationActionRunnerV2().execute({
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
    const runner = new VerificationActionRunnerV2();
    const key = action('expensive-action');
    const dependency = preflightAction();
    seedFailedPreflight(repositoryRoot);
    const plan = createVerificationActionPlanV2({
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
    const runner = new VerificationActionRunnerV2();
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
    const runner = new VerificationActionRunnerV2();
    const key = action('invalidated-action');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        await held;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await Promise.resolve();
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

test('persisted running and queued actions without a live owner fail closed on restart', async () => {
  for (const [state, kind] of [['running', 'orphaned-action'], ['queued', 'queued-orphaned-action']] as const) {
    const repositoryRoot = root();
    try {
      const key = action(kind);
      appendVerificationActionJournalEventV2({ repositoryRoot, action: key, state: 'queued' });
      if (state === 'running') {
        appendVerificationActionJournalEventV2({ repositoryRoot, action: key, state: 'running' });
      }
      let invocations = 0;
      const result = await new VerificationActionRunnerV2().execute({
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor: () => {
          invocations += 1;
          return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
        }
      });
      expect(result.disposition).toBe('blocked');
      expect(result.reason).toContain('no live execution owner');
      expect(invocations).toBe(0);
      expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState)
        .toBe('invalidated');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  }
});

test('cheap actions can be scheduled without an ActionKey cost field', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV2();
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
