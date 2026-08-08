import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createVerificationActionKeyV1,
  createVerificationActionPlanV1,
  type VerificationActionKeyInputV1
} from '../../scripts/codex/verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV1,
  readVerificationActionJournalV1
} from '../../scripts/codex/verification-action-journal.ts';
import { VerificationActionRunnerV1 } from '../../scripts/codex/verification-action-runner.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;

function action(kind = 'runner-contract', inputPath = 'scripts/codex/example.ts') {
  const input: VerificationActionKeyInputV1 = {
    actionKind: kind,
    producer: { identity: 'runner-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      declaredEnvironment: []
    },
    inputClosure: [{ path: inputPath, digest: DIGEST_A }],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local',
      contractRevision: 'verification-result-v1'
    },
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1'
  };
  return createVerificationActionKeyV1(input);
}

function runnablePlan(key: ReturnType<typeof action>) {
  const preflight = action('cheap-preflight');
  return createVerificationActionPlanV1({
    action: key,
    expensive: true,
    dependencies: [{
      actionKey: preflight.actionKey,
      kind: 'cheap-preflight',
      state: 'terminal-passed'
    }]
  });
}

function root(): string {
  return mkdtempSync(path.join(tmpdir(), 'sec-action-runner-'));
}

test('concurrent callers join one physical executor invocation', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV1();
    const secondRunner = new VerificationActionRunnerV1();
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
      executionDomain: 'test-domain',
      plan: runnablePlan(key),
      executor
    });
    await Promise.resolve();
    const second = secondRunner.execute({
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'test-domain',
      plan: runnablePlan(key),
      executor
    });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(invocations).toBe(1);
    expect(firstResult.disposition).toBe('executed');
    expect(secondResult.disposition).toBe('joined');
    expect(firstResult.terminal?.status).toBe('passed');
    expect(readVerificationActionJournalV1(repositoryRoot, key.actionKey).latestState).toBe('terminal');
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
    const result = await new VerificationActionRunnerV1().execute({
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

test('forged non-boolean expensive plan fails closed before any physical execution', async () => {
  const repositoryRoot = root();
  try {
    const key = action('forged-plan-action');
    let invocations = 0;
    const forgedPlan = {
      ...runnablePlan(key),
      expensive: 'true'
    } as never;
    await expect(new VerificationActionRunnerV1().execute({
      repositoryRoot,
      action: key,
      plan: forgedPlan,
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    })).rejects.toThrow('expensive must be a boolean');
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('a non-runnable concurrent caller cannot join an authorized physical flight', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV1();
    const key = action('caller-local-plan-action');
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key),
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
      plan: createVerificationActionPlanV1({
        action: key,
        expensive: true,
        dependencies: [{
          actionKey: action('cheap-preflight').actionKey,
          kind: 'cheap-preflight',
          state: 'terminal-failed'
        }]
      }),
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

test('reentrant same-key dispatch joins after the live flight is registered', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV1();
    const key = action('reentrant-action');
    let invocations = 0;
    let nested: ReturnType<VerificationActionRunnerV1['execute']> | null = null;
    const executor = () => {
      invocations += 1;
      nested = runner.execute({
        repositoryRoot,
        action: key,
        executionDomain: 'reentrant-domain',
        plan: runnablePlan(key),
        executor
      });
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'reentrant-domain',
      plan: runnablePlan(key),
      executor
    });
    const joined = await nested!;
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('executed');
    expect(joined.disposition).toBe('joined');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('fresh terminal success reuses without execution and terminal failure never becomes PASS', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV1();
    const passed = action('passed-action');
    let passedInvocations = 0;
    const first = await runner.execute({
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed),
      executor: () => {
        passedInvocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    const reused = await runner.execute({
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed),
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
      plan: runnablePlan(failed),
      executor: () => {
        failedInvocations += 1;
        return { status: 'failed' as const, reasonCode: 'executed-failure' as const, resultDigest: null };
      }
    });
    const failedReuse = await runner.execute({
      repositoryRoot,
      action: failed,
      plan: runnablePlan(failed),
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
    const result = await new VerificationActionRunnerV1().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key),
      executor: () => {
        throw new Error(`line one\nline two\t${'x'.repeat(2000)}`);
      }
    });
    expect(result.disposition).toBe('executed');
    expect(result.terminal?.status).toBe('failed');
    expect(result.reason).toContain('executor threw: line one line two');
    expect(result.reason?.length).toBeLessThanOrEqual(1024);
    const journal = readVerificationActionJournalV1(repositoryRoot, key.actionKey);
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
    const runner = new VerificationActionRunnerV1();
    const key = action('expensive-action');
    const dependency = action('cheap-preflight');
    const plan = createVerificationActionPlanV1({
      action: key,
      expensive: true,
      dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight', state: 'terminal-failed' }]
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

test('input invalidation discards an in-flight physical result', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunnerV1();
    const key = action('invalidated-action');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key),
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

test('persisted running action without a live owner fails closed on restart', async () => {
  const repositoryRoot = root();
  try {
    const key = action('orphaned-action');
    appendVerificationActionJournalEventV1({ repositoryRoot, action: key, state: 'queued' });
    appendVerificationActionJournalEventV1({ repositoryRoot, action: key, state: 'running' });
    let invocations = 0;
    const result = await new VerificationActionRunnerV1().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('no live execution owner');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournalV1(repositoryRoot, key.actionKey).latestState)
      .toBe('invalidated');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('persisted queued action without a live owner fails closed on restart', async () => {
  const repositoryRoot = root();
  try {
    const key = action('queued-orphaned-action');
    appendVerificationActionJournalEventV1({ repositoryRoot, action: key, state: 'queued' });
    let invocations = 0;
    const result = await new VerificationActionRunnerV1().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('persisted queued action had no live execution owner');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournalV1(repositoryRoot, key.actionKey).latestState)
      .toBe('invalidated');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
