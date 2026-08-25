import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';

import {
  createVerificationActionCallbackEffectProviderV1
} from '../../platform/dev-runner/verification-action-executor.ts';
import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createDevelopmentCriticalPathStaticAnalysisReadbackV2,
  createDevelopmentCriticalPathStaticClosureV1,
  createDevelopmentCriticalPathWholeDeltaSubjectV1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1,
  type DevelopmentCriticalPathDigest
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  createCiVerificationLocalExecutionEnvironmentV2,
  type CiVerificationActionCandidateV1,
  type CiVerificationProducerGateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionEvidenceV1,
  createVerificationActionExecutionBindingV1,
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  createVerificationActionTerminalV2,
  VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
  type VerificationActionEffectCapabilityV1,
  type VerificationActionEffectProviderV1,
  type VerificationActionExecutionBudgetV1,
  type VerificationActionKeyInputV2
} from '../../platform/shared/verification-action-contract.ts';
import type { RuntimeStateJournalFileSystemV1 } from '../../tooling/sec-dev/runtime-state-journal-filesystem.ts';
import {
  acquireVerificationActionClaimV1,
  appendVerificationActionJournalEventV2 as appendJournalEvent,
  commitVerificationActionEvidenceTerminalUnderClaimV1,
  publishVerificationActionEvidenceV1,
  publishVerificationActionStartReceiptV1,
  readVerificationActionJournalV2 as readJournal
} from '../../tooling/sec-dev/verification-action-journal.ts';
import {
  executeLocalVerificationActionDagV2,
  VerificationActionRunnerV2,
  type VerificationActionDeadlinePortV1,
  type VerificationActionProviderPhaseV1,
  type VerificationActionStaticAdmissionProviderV1,
  type VerificationActionStaticAdmissionRequestV1
} from '../../tooling/sec-dev/verification-action-runner.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const BASE_SHA = '1'.repeat(40);
const BASE_TREE_SHA = '2'.repeat(40);
const HEAD_SHA = '3'.repeat(40);
const HEAD_TREE_SHA = '4'.repeat(40);
const PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS = 30_000;
const compilerRoot = path.resolve(import.meta.dir, '../..');

function exactCompilerTrackedDigest(repositoryPath: string): `sha256:${string}` {
  return sha256({ schema: 'runner-pure-input-v1', repositoryPath }) as `sha256:${string}`;
}

const memoryJournalFileSystems = new Map<string, RuntimeStateJournalFileSystemV1>();

function canonicalTestRoot(repositoryRoot: string): string {
  const physical = path.resolve(repositoryRoot);
  return process.platform === 'win32' ? physical.toLowerCase() : physical;
}

function createMemoryJournalFileSystem(repositoryRoot: string): RuntimeStateJournalFileSystemV1 {
  const rootPath = path.join(canonicalTestRoot(repositoryRoot), '.pure-verification-runtime-state');
  const files = new Map<string, string>();
  const canonical = (filePath: string) => path.resolve(filePath);
  return Object.freeze({
    rootPath,
    exists: (filePath: string) => files.has(canonical(filePath)),
    readText: (filePath: string) => {
      const value = files.get(canonical(filePath));
      if (value === undefined) throw new Error(`in-memory Runtime State file is absent: ${filePath}`);
      return value;
    },
    ensureDirectory: () => undefined,
    appendFsyncCas: (filePath: string, expectedText: string, text: string) => {
      const key = canonical(filePath);
      const current = files.get(key) ?? '';
      if (current !== expectedText) return false;
      files.set(key, `${current}${text}`);
      return true;
    },
    createExclusiveFsync: (filePath: string, text: string) => {
      const key = canonical(filePath);
      if (files.has(key)) return false;
      files.set(key, text);
      return true;
    },
    replaceFsyncCas: (filePath: string, expectedText: string | null, text: string) => {
      const key = canonical(filePath);
      const current = files.get(key);
      if (expectedText === null ? current !== undefined : current !== expectedText) return false;
      files.set(key, text);
      return true;
    },
    deleteFsyncCas: (filePath: string, expectedText: string) => {
      const key = canonical(filePath);
      if (files.get(key) !== expectedText) return false;
      return files.delete(key);
    },
    listOrdinaryFiles: (directoryPath: string, maximumEntries: number) => {
      const directory = `${canonical(directoryPath)}${path.sep}`;
      const entries = [...files.keys()].filter((filePath) =>
        filePath.startsWith(directory) && !filePath.slice(directory.length).includes(path.sep));
      if (entries.length > maximumEntries) throw new Error('in-memory Runtime State census exceeds bound');
      return Object.freeze(entries.sort());
    },
    replaceFsync: (filePath: string, text: string) => { files.set(canonical(filePath), text); },
    deleteIfPresent: (filePath: string) => files.delete(canonical(filePath))
  });
}

function journalFs(repositoryRoot: string): RuntimeStateJournalFileSystemV1 {
  const key = canonicalTestRoot(repositoryRoot);
  let fs = memoryJournalFileSystems.get(key);
  if (fs === undefined) {
    fs = createMemoryJournalFileSystem(repositoryRoot);
    memoryJournalFileSystems.set(key, fs);
  }
  return fs;
}

function pureRunner(options: Readonly<{
  deadlinePort?: VerificationActionDeadlinePortV1;
}> = {}): VerificationActionRunnerV2 {
  return new VerificationActionRunnerV2({
    runtimeStatePortProvider: (repositoryRoot) => journalFs(repositoryRoot),
    repositoryRootIdentityProvider: canonicalTestRoot,
    deadlinePort: options.deadlinePort,
    executionBindingProvider: {
      observe: (input) => {
        const physical = (root: string, role: string) => Object.freeze({
          schema: 'sec-physical-no-follow-v1' as const,
          path: path.resolve(root),
          finalPath: path.resolve(root),
          device: 'test-device',
          inode: role,
          objectId: `test-object-${role}`
        });
        return createVerificationActionExecutionBindingV1({
          actionKey: input.action.actionKey,
          actionPlanDigest: input.actionPlanDigest,
          actionPlanClosureDigest: input.actionPlanClosureDigest,
          staticClosureDigest: input.closure.closureDigest,
          staticGenerationDigest: input.closure.analysisReadback.staticGeneration.generationDigest,
          runtimeStateRoot: physical(input.runtimeStateRepositoryRoot, 'runtime'),
          staticAuthorityRoot: {
            physical: physical(input.staticAuthorityRepositoryRoot, 'static'),
            headSha: input.closure.analysisReadback.repository.headSha,
            headTreeSha: input.closure.analysisReadback.repository.headTreeSha
          },
          physicalExecutionRoot: {
            physical: physical(input.physicalExecutionRepositoryRoot, 'execution'),
            headSha: input.closure.analysisReadback.repository.headSha,
            headTreeSha: input.closure.analysisReadback.repository.headTreeSha
          },
          providerRevision: input.providerRevision
        });
      },
      assertCurrent: () => undefined
    }
  });
}

function deterministicDeadlineAt(
  targetPhase: VerificationActionProviderPhaseV1
): VerificationActionDeadlinePortV1 {
  return Object.freeze({
    async run<T>(input: Readonly<{
      phase: VerificationActionProviderPhaseV1;
      timeoutMs: number;
      timeoutError: () => Error;
      run: (signal: AbortSignal) => Promise<T>;
    }>): Promise<T> {
      const controller = new AbortController();
      const pending = input.run(controller.signal);
      if (input.phase !== targetPhase) return pending;
      const error = input.timeoutError();
      controller.abort(error);
      void pending.catch(() => undefined);
      throw error;
    }
  });
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
  requiredCheapPreflightActionKeys: readonly `sha256:${string}`[],
  executionBudget: VerificationActionExecutionBudgetV1 = VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
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
    inputClosure: [{ path: inputPath, digest: exactCompilerTrackedDigest(inputPath) }],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local',
      contractRevision: 'verification-result-v1',
      executionBudget
    },
    requiredCheapPreflightActionKeys,
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1',
    staticProofRequirement: 'bounded-action-admission'
  };
  return createVerificationActionKeyV2(input);
}

function preflightAction(inputPath = 'platform/shared/verification-action-contract.ts') {
  return createAction('cheap-preflight', inputPath, []);
}

function action(
  kind = 'runner-contract',
  inputPath = 'platform/shared/verification-action-contract.ts',
  executionBudget: VerificationActionExecutionBudgetV1 = VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
) {
  // The runner tests exercise admission, join and settlement semantics, not
  // ActionKey uniqueness. Reuse one producer identity across isolated roots
  // so the exact-tree analyzer is paid once; the reuse test's two terminal
  // branches remain distinct because that distinction is part of its subject.
  const semanticKind = kind === 'passed-action' || kind === 'failed-action'
    ? kind
    : 'runner-contract';
  return kind === 'cheap-preflight'
    ? preflightAction(inputPath)
    : createAction(semanticKind, inputPath, [preflightAction(inputPath).actionKey], executionBudget);
}

function seedPassedPreflight(repositoryRoot: string, inputPath = 'platform/shared/verification-action-contract.ts'): void {
  seedTerminalPreflight(repositoryRoot, inputPath, {
    status: 'passed', reasonCode: 'executed-success', resultDigest: null
  });
}

function seedFailedPreflight(repositoryRoot: string, inputPath = 'platform/shared/verification-action-contract.ts'): void {
  seedTerminalPreflight(repositoryRoot, inputPath, {
    status: 'failed', reasonCode: 'executed-failure', resultDigest: null
  });
}

function seedTerminalPreflight(
  repositoryRoot: string,
  inputPath: string,
  terminal: ReturnType<typeof createVerificationActionTerminalV2>
): void {
  const preflight = preflightAction(inputPath);
  const current = readVerificationActionJournalV2(repositoryRoot, preflight.actionKey);
  if (current.latestState === 'terminal' || current.latestState === 'reused') return;
  const fs = journalFs(repositoryRoot);
  const ownerToken = `preflight-fixture-${terminal.status}`;
  const actionPlanDigest = DIGEST_A;
  const staticClosureDigest = `sha256:${'b'.repeat(64)}` as const;
  const startedAt = '2026-08-09T13:00:01.000Z';
  const finishedAt = '2026-08-09T13:00:03.000Z';
  expect(acquireVerificationActionClaimV1({
    fs,
    action: preflight,
    ownerToken,
    now: '2026-08-09T13:00:00.000Z',
    leaseDurationMs: 60_000
  }).disposition).toBe('acquired');
  publishVerificationActionStartReceiptV1({
    fs,
    receipt: {
      actionKey: preflight.actionKey,
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      providerRevision: preflight.environment.providerRevision,
      startedAt
    }
  });
  appendVerificationActionJournalEventV2({ repositoryRoot, action: preflight, state: 'queued', recordedAt: startedAt });
  appendVerificationActionJournalEventV2({
    repositoryRoot,
    action: preflight,
    state: 'running',
    recordedAt: '2026-08-09T13:00:02.000Z'
  });
  const evidence = publishVerificationActionEvidenceV1({
    fs,
    evidence: {
      actionKey: preflight.actionKey,
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      providerRevision: preflight.environment.providerRevision,
      capabilityDigest: `sha256:${'c'.repeat(64)}`,
      terminal,
      evidenceRefs: [`fixture://preflight/${terminal.status}`],
      startedAt,
      finishedAt
    }
  });
  expect(commitVerificationActionEvidenceTerminalUnderClaimV1({
    fs,
    action: preflight,
    ownerToken,
    now: finishedAt,
    actionPlanDigest,
    executionBindingDigest: DIGEST_A,
    staticClosureDigest,
    evidence
  })).not.toBeNull();
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

const exactCompilerIdentity = Object.freeze({
  headSha: '1'.repeat(40),
  headTreeSha: '2'.repeat(40)
});

const STATIC_PRODUCER = Object.freeze({
  identity: 'tooling/sec-dev/development-critical-path.ts',
  revision: 'sec-development-critical-path-static-analyzer-v3',
  sourceDigest: DIGEST_A
});
const STATIC_OWNER_RECORDS = Object.freeze([...DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1]
  .map((dimension) => Object.freeze({
    recordId: `runner-test-owner-${dimension}`,
    path: `docs/test/${dimension}.md`,
    domain: `runner-test-${dimension}`,
    owns: [`runner-test.${dimension}`]
  }))
  .sort((left, right) => left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0));

function staticOwner(dimension: typeof DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1[number]) {
  const owner = STATIC_OWNER_RECORDS.find(({ recordId }) =>
    recordId === `runner-test-owner-${dimension}`);
  if (owner === undefined) throw new Error(`missing runner test owner ${dimension}`);
  return owner;
}

function pureStaticReadback(plan: ReturnType<typeof runnablePlan> | ReturnType<typeof cheapPlan>) {
  const wholeDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'bounded-action-admission',
    base: {
      commitSha: exactCompilerIdentity.headSha,
      treeSha: exactCompilerIdentity.headTreeSha,
      inventoryDigest: DIGEST_A
    },
    head: {
      commitSha: exactCompilerIdentity.headSha,
      treeSha: exactCompilerIdentity.headTreeSha,
      inventoryDigest: DIGEST_A
    },
    changes: [],
    requiredOwners: [],
    ownerProjections: [],
    consumers: [],
    producer: STATIC_PRODUCER,
    unknowns: []
  });
  return createDevelopmentCriticalPathStaticAnalysisReadbackV2({
    producerSourceDigest: DIGEST_A,
    repository: {
      headSha: exactCompilerIdentity.headSha,
      headTreeSha: exactCompilerIdentity.headTreeSha,
      objectFormat: 'sha1',
      trackedClean: true,
      trackedPathCount: 1,
      trackedByteCount: 1,
      inventoryDigest: DIGEST_A
    },
    manifest: {
      path: '<runner-pure-test>',
      digest: DIGEST_A,
      authorityRefsDigest: DIGEST_A,
      ownedPathsDigest: DIGEST_A,
      forbiddenPathsDigest: DIGEST_A
    },
    ownerRegistry: {
      digest: DIGEST_A,
      ownerClosureDigest: DIGEST_A,
      recordsDigest: sha256(STATIC_OWNER_RECORDS) as DevelopmentCriticalPathDigest,
      records: STATIC_OWNER_RECORDS
    },
    actionKey: plan.action.actionKey,
    actionPlanDigest: sha256(plan) as DevelopmentCriticalPathDigest,
    actionPlanClosureDigest: DIGEST_A,
    producerClosurePaths: ['tooling/sec-dev/development-critical-path.ts'],
    producerClosureDigest: DIGEST_A,
    sourceInventoryDigest: DIGEST_A,
    moduleGraphDigest: DIGEST_A,
    unresolvedModuleFiles: [],
    wholeDelta,
    dimensionInputs: Object.fromEntries(
      DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1.map((dimension) => [dimension, {
        claim: {
          owner: staticOwner(dimension),
          producer: STATIC_PRODUCER,
          subjectDigest: DIGEST_A
        },
        input: { dimension },
        coverage: 'bounded-census-complete',
        coverageBasis: 'producer-exact',
        stopCondition: 'tracked-owner-surface-exhausted',
        defectClasses: [],
        unknowns: []
      }])
    ) as unknown as Parameters<typeof createDevelopmentCriticalPathStaticAnalysisReadbackV2>[0]['dimensionInputs']
  });
}

const PURE_STATIC_ADMISSION_PROVIDER: VerificationActionStaticAdmissionProviderV1 = Object.freeze({
  providerRevision: 'runner-test-pure-static-admission-v1',
  derive: ({ plan, actionPlanClosureDigest, dependencyEvidence }: VerificationActionStaticAdmissionRequestV1) => {
    if (actionPlanClosureDigest !== DIGEST_A) throw new Error('runner test closure digest drifted');
    return createDevelopmentCriticalPathStaticClosureV1(
      plan,
      pureStaticReadback(plan as ReturnType<typeof runnablePlan> | ReturnType<typeof cheapPlan>),
      actionPlanClosureDigest,
      dependencyEvidence
    );
  },
  assertCurrent: () => undefined
});

type TestTerminal = Parameters<typeof createVerificationActionTerminalV2>[0];
type TestExecutor = () => TestTerminal | Promise<TestTerminal>;
type TestExecutionInput = Omit<
  Parameters<VerificationActionRunnerV2['execute']>[0],
  'effectProvider' | 'runtimeStateRepositoryRoot' | 'staticAuthorityRepositoryRoot' |
  'physicalExecutionRepositoryRoot'
> & Readonly<{
  /** Test-owned Runtime State root; never interpreted as source authority. */
  repositoryRoot: string;
  staticAuthorityRepositoryRoot?: string;
  /** Test-only source for the explicit provider fixture below. */
  executor?: TestExecutor;
  effectProvider?: VerificationActionEffectProviderV1;
}>;

function effectProviderForTest(executor: TestExecutor): VerificationActionEffectProviderV1 {
  return createVerificationActionCallbackEffectProviderV1({
    providerRevision: 'local',
    execute: async () => {
      return {
        terminal: createVerificationActionTerminalV2(await executor()),
        evidenceRefs: ['test://verification-action/effect']
      };
    }
  });
}

const testEffectProviders = new Map<string, VerificationActionEffectProviderV1>();

function execute(
  runner: VerificationActionRunnerV2,
  input: TestExecutionInput
) {
  const { executor, effectProvider, repositoryRoot, staticAuthorityRepositoryRoot, ...rest } = input;
  let provider = effectProvider;
  if (provider === undefined && executor !== undefined) {
    const providerKey = `${repositoryRoot}\0${rest.action.actionKey}`;
    provider = testEffectProviders.get(providerKey);
    if (provider === undefined) {
      provider = effectProviderForTest(executor);
      testEffectProviders.set(providerKey, provider);
    }
  }
  const withProvider = {
    ...rest,
    runtimeStateRepositoryRoot: repositoryRoot,
    staticAuthorityRepositoryRoot: staticAuthorityRepositoryRoot ?? compilerRoot,
    physicalExecutionRepositoryRoot: repositoryRoot,
    effectProvider: provider
  };
  return runner.execute(input.plan === undefined
    ? withProvider
    : {
        ...withProvider,
        actionPlanClosureDigest: DIGEST_A,
        staticAdmissionProvider: PURE_STATIC_ADMISSION_PROVIDER
      });
}

let logicalRootSequence = 0;

afterEach(() => {
  testEffectProviders.clear();
  memoryJournalFileSystems.clear();
});

function root(): string {
  logicalRootSequence += 1;
  return path.resolve('runner-pure-root', String(logicalRootSequence));
}

function releaseLogicalRoot(repositoryRoot: string): void {
  memoryJournalFileSystems.delete(canonicalTestRoot(repositoryRoot));
  for (const providerKey of testEffectProviders.keys()) {
    if (providerKey.startsWith(`${repositoryRoot}\0`)) testEffectProviders.delete(providerKey);
  }
}

test('concurrent callers in different execution domains join one physical executor invocation', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action();
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const executor = async () => {
      invocations += 1;
      await held;
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const first = execute(runner, {
      repositoryRoot,
      action: key,
      executionDomain: 'domain-a',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    await Promise.resolve();
    const second = execute(runner, {
      repositoryRoot,
      action: key,
      executionDomain: 'domain-b',
      plan: runnablePlan(key, repositoryRoot),
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
    releaseLogicalRoot(repositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('same ActionKey in different physical repositories executes independently', async () => {
  const firstRepositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('same-semantic-key-different-root');
    let invocations = 0;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondHeld = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
    const first = execute(runner, {
      repositoryRoot: firstRepositoryRoot,
      action: key,
      plan: runnablePlan(key, firstRepositoryRoot),
      executor: async () => {
        invocations += 1;
        markFirstStarted();
        await firstHeld;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await firstStarted;
    const second = execute(runner, {
      repositoryRoot: secondRepositoryRoot,
      action: key,
      plan: runnablePlan(key, secondRepositoryRoot),
      executor: async () => {
        invocations += 1;
        markSecondStarted();
        await secondHeld;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await secondStarted;
    expect(invocations).toBe(2);
    releaseFirst();
    releaseSecond();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.disposition).toBe('executed');
    expect(secondResult.disposition).toBe('executed');
    expect(firstResult.physicalExecution).toBe(true);
    expect(secondResult.physicalExecution).toBe(true);
    expect(readVerificationActionJournalV2(firstRepositoryRoot, key.actionKey).latestState)
      .toBe('terminal');
    expect(readVerificationActionJournalV2(secondRepositoryRoot, key.actionKey).latestState)
      .toBe('terminal');
  } finally {
    releaseLogicalRoot(firstRepositoryRoot);
    releaseLogicalRoot(secondRepositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('missing execution plan fails closed before any physical execution', async () => {
  const repositoryRoot = root();
  try {
    const key = action('missing-plan-action');
    let invocations = 0;
    const result = await execute(pureRunner(), {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('a serializable caller-crafted static DTO cannot authorize journal or executor Effect', async () => {
  const repositoryRoot = root();
  try {
    const key = preflightAction();
    const plan = cheapPlan(key);
    let invocations = 0;
    const result = await pureRunner().execute({
      runtimeStateRepositoryRoot: repositoryRoot,
      staticAuthorityRepositoryRoot: compilerRoot,
      physicalExecutionRepositoryRoot: repositoryRoot,
      action: key,
      plan,
      actionPlanClosureDigest: DIGEST_A,
      staticAnalysis: Object.freeze({
        schema: 'sec-development-critical-path-static-analysis-authority-v2',
        readback: Object.freeze({})
      }) as Parameters<VerificationActionRunnerV2['execute']>[0]['staticAnalysis'],
      effectProvider: effectProviderForTest(() => {
        invocations += 1;
        return { status: 'passed', reasonCode: 'executed-success', resultDigest: null };
      })
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('was not issued by the exact-tree analyzer');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).events).toEqual([]);
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
});

test('producer-derived static census blocks an empty tracked closure before journal or executor Effect', async () => {
  const repositoryRoot = root();
  try {
    const populated = preflightAction();
    const { schema: _schema, actionKey: _actionKey, ...input } = populated;
    const key = createVerificationActionKeyV2({ ...input, inputClosure: [] });
    const plan = cheapPlan(key);
    let invocations = 0;
    const result = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan,
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('pre-effect-static-closure-blocked');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState).toBeNull();
  } finally {
    releaseLogicalRoot(repositoryRoot);
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
    await expect(execute(pureRunner(), {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('a non-runnable concurrent caller cannot join an authorized physical flight', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('caller-local-plan-action');
    seedFailedPreflight(secondRepositoryRoot);
    let invocations = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const running = execute(runner, {
      repositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        invocations += 1;
        markStarted();
        await held;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await started;
    const blocked = await execute(runner, {
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    const missing = await execute(runner, {
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
    releaseLogicalRoot(repositoryRoot);
    releaseLogicalRoot(secondRepositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('same-owner cycle cannot bypass guard by changing executionDomain', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('reentrant-action');
    let invocations = 0;
    let nested: Promise<Awaited<ReturnType<VerificationActionRunnerV2['execute']>>> | null = null;
    const executor = () => {
      invocations += 1;
      nested = execute(runner, {
        repositoryRoot,
        action: key,
        executionDomain: 'different-domain',
        plan: runnablePlan(key, repositoryRoot),
        executor
      });
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await execute(runner, {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('awaited nested same-key execution is rejected without self-join deadlock', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('awaited-reentrant-action');
    let invocations = 0;
    const executor = async () => {
      invocations += 1;
      const nested = await execute(runner, {
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
    const result = await execute(runner, {
      repositoryRoot,
      action: key,
      executionDomain: 'awaited-initial-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    expect(result.disposition).toBe('executed');
    expect(invocations).toBe(1);
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
});

test('nested execution cannot override its inherited ownerToken', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('owner-token-override-action');
    let invocations = 0;
    const executor = async () => {
      invocations += 1;
      await expect(execute(runner, {
        repositoryRoot,
        action: key,
        ownerToken: 'different-owner',
        executionDomain: 'different-domain',
        plan: runnablePlan(key, repositoryRoot),
        executor
      })).rejects.toThrow('ownerToken cannot override the inherited execution owner');
      return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
    };
    const result = await execute(runner, {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('caller-forged terminal-passed state without a journal fact cannot start an expensive action', async () => {
  const repositoryRoot = root();
  try {
    const key = action('missing-machine-preflight-fact');
    let invocations = 0;
    const result = await execute(pureRunner(), {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('fresh terminal success reuses without execution and terminal failure never becomes PASS', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const passed = action('passed-action');
    let passedInvocations = 0;
    let passedObservations = 0;
    let passedReleases = 0;
    const passedProvider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: passed.environment.providerRevision,
      execute: () => {
        passedInvocations += 1;
        return { terminal: createVerificationActionTerminalV2({
          status: 'passed', reasonCode: 'executed-success', resultDigest: null
        }) };
      },
      observe: () => {
        passedObservations += 1;
        return null;
      },
      release: () => { passedReleases += 1; }
    });
    const first = await execute(runner, {
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed, repositoryRoot),
      effectProvider: passedProvider
    });
    const effectsAfterFirst = Object.freeze({
      executions: passedInvocations,
      observations: passedObservations,
      releases: passedReleases
    });
    const reused = await execute(runner, {
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed, repositoryRoot),
      effectProvider: passedProvider
    });
    expect(first.disposition).toBe('executed');
    expect(reused.disposition).toBe('reused');
    expect(effectsAfterFirst).toEqual({ executions: 1, observations: 1, releases: 1 });
    expect({
      executions: passedInvocations,
      observations: passedObservations,
      releases: passedReleases
    }).toEqual(effectsAfterFirst);

    const failed = action('failed-action');
    let failedInvocations = 0;
    await execute(runner, {
      repositoryRoot,
      action: failed,
      plan: runnablePlan(failed, repositoryRoot),
      executor: () => {
        failedInvocations += 1;
        return { status: 'failed' as const, reasonCode: 'executed-failure' as const, resultDigest: null };
      }
    });
    const failedReuse = await execute(runner, {
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
    releaseLogicalRoot(repositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('provider release failure preserves durable terminal Evidence as settlement-pending and never replays', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('settlement-pending-action');
    let physicalStarts = 0;
    const provider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: key.environment.providerRevision,
      execute: () => {
        physicalStarts += 1;
        return {
          terminal: createVerificationActionTerminalV2({
            status: 'passed',
            reasonCode: 'executed-success',
            resultDigest: null
          }),
          evidenceRefs: ['test://verification-action/settlement-pending']
        };
      },
      release: () => {
        throw new Error('provider resource still retained');
      }
    });
    const input = {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      effectProvider: provider
    } as const;
    const first = await execute(runner, input);
    const second = await execute(runner, input);
    expect(first.disposition).toBe('blocked');
    expect(first.state).toBe('terminal');
    expect(first.terminal?.status).toBe('passed');
    expect(first.evidence?.evidenceRefs).toContain('test://verification-action/settlement-pending');
    expect(first.reason).toContain('terminal-settlement-pending');
    expect(second.disposition).toBe('blocked');
    expect(second.state).toBe('terminal');
    expect(second.terminal?.status).toBe('passed');
    expect(second.evidence?.evidenceDigest).toBe(first.evidence?.evidenceDigest);
    expect(physicalStarts).toBe(1);
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('provider release phase budget aborts settlement while preserving terminal Evidence', async () => {
  const repositoryRoot = root();
  try {
    const key = action(
      'release-phase-timeout-action',
      'platform/shared/verification-action-contract.ts',
      {
        ...VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
        providerReleaseTimeoutMs: 50
      }
    );
    const releaseSignals: AbortSignal[] = [];
    const provider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: key.environment.providerRevision,
      execute: () => ({
        terminal: createVerificationActionTerminalV2({
          status: 'passed', reasonCode: 'executed-success', resultDigest: null
        }),
        evidenceRefs: ['test://verification-action/release-phase-timeout']
      }),
      release: async ({ signal }) => {
        releaseSignals.push(signal);
        return await new Promise<never>(() => undefined);
      }
    });
    const result = await execute(pureRunner({
      deadlinePort: deterministicDeadlineAt('release')
    }), {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      effectProvider: provider
    });
    expect(result).toMatchObject({
      disposition: 'blocked', state: 'terminal', physicalExecution: true
    });
    expect(result.terminal?.status).toBe('passed');
    expect(result.evidence?.evidenceRefs).toContain('test://verification-action/release-phase-timeout');
    expect(result.reason).toContain('terminal-settlement-pending');
    expect(result.reason).toContain('provider release exceeded its phase budget of 50ms');
    expect(releaseSignals[0]?.aborted).toBe(true);
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
}, 5_000);

test('provider Effect diagnostics are bounded and never projected as an unearned terminal', async () => {
  const repositoryRoot = root();
  try {
    const key = action('diagnostic-action');
    const result = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: () => {
        throw new Error(`line one\nline two\t${'x'.repeat(2000)}`);
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.terminal).toBeNull();
    expect(result.reason).toContain('verification-action-effect-failed: verification action failed: line one line two');
    expect(result.reason?.length).toBeLessThanOrEqual(1024);
    const journal = readVerificationActionJournalV2(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('running');
    expect(journal.terminal).toBeNull();
    expect(journal.events.at(-1)?.note).toBeNull();
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
});

test('runner absolute budget returns a typed block even when a provider ignores cancellation', async () => {
  const repositoryRoot = root();
  try {
    const key = action('provider-ignores-cancellation', 'platform/shared/verification-action-contract.ts', {
      ...VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
      absoluteTimeoutMs: 150,
      stallTimeoutMs: 75,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024
    });
    const observedSignals: AbortSignal[] = [];
    const provider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: 'local',
      execute: async ({ signal }) => {
        observedSignals.push(signal);
        return await new Promise<never>(() => undefined);
      }
    });
    const result = await execute(pureRunner({
      deadlinePort: deterministicDeadlineAt('execute')
    }), {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      effectProvider: provider
    });
    expect(result).toMatchObject({
      disposition: 'blocked', state: 'running', physicalExecution: true
    });
    expect(result.reason).toContain('exceeded its absolute execution budget of 150ms');
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey)).toMatchObject({
      latestState: 'running',
      terminal: null
    });
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
}, 5_000);

test('restart settles durably published provider Evidence without replaying Effect', async () => {
  const repositoryRoot = root();
  const interruptedAt = '2026-08-25T10:00:01.000Z';
  const restartedAt = '2026-08-25T10:00:03.000Z';
  try {
    const key = action('restart-evidence-action');
    const plan = runnablePlan(key, repositoryRoot);
    let interruptedEffectInvocations = 0;
    const publishingProvider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: 'local',
      now: () => new Date(interruptedAt),
      execute: async () => ({
        terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: null },
        evidenceRefs: ['test://verification-action/restart-evidence']
      })
    });
    const interruptedProvider: VerificationActionEffectProviderV1 = Object.freeze({
      ...publishingProvider,
      execute: async (input: Parameters<typeof publishingProvider.execute>[0]) => {
        interruptedEffectInvocations += 1;
        await publishingProvider.execute(input);
        throw new Error('simulated process interruption after durable Evidence publication');
      }
    });
    const interrupted = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan,
      recordedAt: () => interruptedAt,
      leaseDurationMs: 1_000,
      effectProvider: interruptedProvider
    });
    expect(interrupted.disposition).toBe('blocked');
    expect(interrupted.state).toBe('running');
    expect(interrupted.physicalExecution).toBe(true);
    expect(interruptedEffectInvocations).toBe(1);
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).evidence).not.toBeNull();

    let replayedEffectInvocations = 0;
    const releasedCapabilities: Array<VerificationActionEffectCapabilityV1 | null> = [];
    const restartedProvider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: 'local',
      now: () => new Date(restartedAt),
      execute: async () => {
        replayedEffectInvocations += 1;
        return {
          terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: null }
        };
      },
      release: async ({ capability }) => {
        releasedCapabilities.push(capability);
      }
    });
    const recovered = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan,
      recordedAt: () => restartedAt,
      leaseDurationMs: 1_000,
      effectProvider: restartedProvider
    });
    expect(recovered.disposition).toBe('reused');
    expect(recovered.state).toBe('terminal');
    expect(recovered.physicalExecution).toBe(false);
    expect(recovered.terminal?.status).toBe('passed');
    expect(recovered.reason).toContain('recovered provider terminal Evidence without replay');
    expect(replayedEffectInvocations).toBe(0);
    expect(releasedCapabilities).toEqual([null]);
    const journal = readVerificationActionJournalV2(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('terminal');
    expect(journal.evidence?.evidenceDigest).toBe(recovered.evidence?.evidenceDigest);
    expect(journal.events.at(-1)?.note)
      .toBe('recovered provider terminal Evidence after process interruption');
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('restart without durable provider Evidence remains a typed block and never replays Effect', async () => {
  const repositoryRoot = root();
  const interruptedAt = '2026-08-25T10:01:01.000Z';
  const restartedAt = '2026-08-25T10:01:03.000Z';
  try {
    const key = action('restart-without-evidence-action');
    const plan = runnablePlan(key, repositoryRoot);
    let interruptedEffectInvocations = 0;
    const interruptedProvider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: 'local',
      now: () => new Date(interruptedAt),
      execute: async () => {
        interruptedEffectInvocations += 1;
        throw new Error('simulated process interruption before Evidence publication');
      }
    });
    const interrupted = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan,
      recordedAt: () => interruptedAt,
      leaseDurationMs: 1_000,
      effectProvider: interruptedProvider
    });
    expect(interrupted.disposition).toBe('blocked');
    expect(interrupted.state).toBe('running');
    expect(interruptedEffectInvocations).toBe(1);
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).evidence).toBeNull();

    let replayedEffectInvocations = 0;
    const releasedCapabilities: Array<VerificationActionEffectCapabilityV1 | null> = [];
    const restartedProvider = createVerificationActionCallbackEffectProviderV1({
      providerRevision: 'local',
      execute: async () => {
        replayedEffectInvocations += 1;
        return {
          terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: null }
        };
      },
      release: async ({ capability }) => {
        releasedCapabilities.push(capability);
      }
    });
    const recovered = await execute(pureRunner(), {
      repositoryRoot,
      action: key,
      plan,
      recordedAt: () => restartedAt,
      leaseDurationMs: 1_000,
      effectProvider: restartedProvider
    });
    expect(recovered.disposition).toBe('blocked');
    expect(recovered.physicalExecution).toBe(false);
    expect(recovered.reason)
      .toContain('persisted running action has no provable provider terminal; recovery lease retained and blind re-execution is forbidden');
    expect(replayedEffectInvocations).toBe(0);
    expect(releasedCapabilities).toEqual([]);
    const journal = readVerificationActionJournalV2(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('running');
    expect(journal.evidence).toBeNull();
    expect(journal.terminal).toBeNull();
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('cheap preflight failure prevents physical execution', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('expensive-action');
    const dependency = preflightAction();
    seedFailedPreflight(repositoryRoot);
    const plan = createVerificationActionPlanV2({
      action: key,
      executionClass: 'expensive',
      dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
    });
    let invocations = 0;
    const result = await execute(runner, {
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
    releaseLogicalRoot(repositoryRoot);
  }
});

test('dependency closure is re-read after execution and unstable closure discards physical result', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('dependency-race-action');
    let invocations = 0;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = execute(runner, {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        invocations += 1;
        markStarted();
        await held;
        runner.invalidateIfDependent({
          repositoryRoot,
          action: preflightAction(),
          changedInputPaths: null,
          note: 'preflight changed during action'
        });
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    await started;
    const joining = execute(runner, {
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: () => {
        invocations += 1;
        return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
      }
    });
    // The runner's journal authority is already warm. Drain the bounded
    // promise-assimilation chain so the concurrent caller crosses that
    // resolved authority await and observes the live flight before the owner
    // mutates its dependency closure. No timer or physical Effect is involved.
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    release();
    const [result, joined] = await Promise.all([running, joining]);
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('blocked');
    expect(result.physicalExecution).toBe(true);
    expect(result.reason).toContain('dependency closure');
    expect(joined.disposition).toBe('blocked');
    expect(joined.physicalExecution).toBe(false);
    expect(joined.reason).toContain('dependency closure changed while awaiting');
    expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState).toBe('invalidated');
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
});

test('input invalidation discards an in-flight physical result', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = action('invalidated-action');
    let release!: () => void;
    let markStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const running = execute(runner, {
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
      changedInputPaths: ['platform/shared/verification-action-contract.ts']
    });
    expect(invalidated.latestState).toBe('invalidated');
    release();
    const result = await running;
    expect(result.disposition).toBe('blocked');
    expect(result.terminal).toBeNull();
    expect(result.physicalExecution).toBe(true);
  } finally {
    releaseLogicalRoot(repositoryRoot);
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
      const result = await execute(pureRunner(), {
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor: () => {
          invocations += 1;
          return { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null };
        }
      });
      expect(result.disposition).toBe('blocked');
      expect(result.reason).toContain('no provable provider terminal');
      expect(invocations).toBe(0);
      expect(readVerificationActionJournalV2(repositoryRoot, key.actionKey).latestState)
        .toBe(state);
    } finally {
    releaseLogicalRoot(repositoryRoot);
    }
  }
});

function localDagFixture(environment = createCiVerificationLocalExecutionEnvironmentV2({
  os: 'win32',
  arch: 'x64',
  bunVersion: '1.3.14'
}), identity: Partial<Pick<CiVerificationActionCandidateV1,
  'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha'>> = {}) {
  const manifestPath = 'docs/work-packages/local-feedback-v1.md';
  const trackedDigest = (_repositoryPath: string) => DIGEST_A;
  const candidate: CiVerificationActionCandidateV1 = {
    baseSha: BASE_SHA,
    baseTreeSha: BASE_TREE_SHA,
    headSha: HEAD_SHA,
    headTreeSha: HEAD_TREE_SHA,
    manifestPath,
    manifestDigest: trackedDigest(manifestPath),
    scopeAuthorizationRevision: `sha256:${'b'.repeat(64)}`,
    profile: 'quick',
    toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      { path: '.bun-version', digest: trackedDigest('.bun-version') },
      { path: 'bun.lock', digest: trackedDigest('bun.lock') },
      { path: 'bunfig.toml', digest: trackedDigest('bunfig.toml') },
      { path: 'package.json', digest: trackedDigest('package.json') }
    ],
    ...identity
  };
  const gates: readonly CiVerificationProducerGateV1[] = [Object.freeze({
    id: 'typecheck',
    phase: 'quick',
    argv: Object.freeze(['bun', 'run', 'typecheck']),
    runtime: 'bun',
    environment: Object.freeze({ SEC_LOCAL_FEEDBACK: DIGEST_A }),
    coveredScopeIds: Object.freeze(['gate:typecheck'])
  })];
  return {
    environment,
    closure: buildCiVerificationActionPlanClosureV1({ candidate, gates })
  };
}

test('local quick DAG rejects hosted/environment drift and distinct environments produce disjoint ActionKeys', async () => {
  const local = localDagFixture();
  const secondLocal = localDagFixture();
  const hosted = localDagFixture(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2);
  expect(local.closure.actions[0]!.action.actionKey).toBe(secondLocal.closure.actions[0]!.action.actionKey);
  expect(local.closure.actions[0]!.action.actionKey).not.toBe(hosted.closure.actions[0]!.action.actionKey);
  await expect(executeLocalVerificationActionDagV2({
    authorityRoot: compilerRoot,
    candidateRoot: compilerRoot,
    actionPlanClosure: hosted.closure,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
    inspectRepository: () => ({
      headSha: HEAD_SHA,
      headTreeSha: HEAD_TREE_SHA,
      trackedClean: true,
      gitCommonDirectory: compilerRoot
    }),
    executeNormalizedOperation: () => 0
  })).rejects.toThrow('canonical local execution environment');
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('cheap actions can be scheduled without an ActionKey cost field', async () => {
  const repositoryRoot = root();
  try {
    const runner = pureRunner();
    const key = preflightAction('platform/shared/verification-action-contract.ts');
    const result = await execute(runner, {
      repositoryRoot,
      action: key,
      plan: cheapPlan(key),
      executor: () => ({ status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: null })
    });
    expect(result.disposition).toBe('executed');
    expect(result.terminal?.status).toBe('passed');
  } finally {
    releaseLogicalRoot(repositoryRoot);
  }
});
