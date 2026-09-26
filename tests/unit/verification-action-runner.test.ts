import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
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
import { fileURLToPath } from 'node:url';

import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { createBoundedProcessDiagnosticObjectStore } from '../../src/adapters/runtime-state/workspace-state/bounded-process-diagnostic-object.ts';
import { createRuntimeStateJournalFileSystem } from '../../src/adapters/runtime-state/workspace-state/journal-filesystem.ts';
import { resolveWorkspaceRuntimeRoots } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { acquireRuntimeJournalAuthority } from '../../src/adapters/runtime-state/workspace-state/physical-authority.ts';
import {
  createBranchLifecycleGitChildEnvironment
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { createVerificationActionKey, createVerificationActionPlan, createVerificationActionTerminal, issueNonProcessVerificationActionTerminalSettlement, issueVerificationActionOwnerTerminalReceipt, type VerificationActionKey, type VerificationActionKeyDigest, type VerificationActionKeyInput } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, createCiVerificationLocalExecutionEnvironment, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import {
  acquireVerificationActionClaim,
  appendVerificationActionJournalEvent as appendJournalEvent,
  commitVerificationActionTerminalUnderClaim,
  readVerificationActionJournal as readJournal,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY,
  VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
} from '../../src/adapters/verification/platform/action/journal.ts';
import {
  executeLocalVerificationActionDag,
  issueVerificationActionTestProcessIssuerForTests,
  VerificationActionRunner
} from '../../src/adapters/verification/platform/action/runner.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext
} from '../../src/execution/operation/semantic.ts';
import { runRetainedBunTestProcess } from '../testkit/process-resource.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;
const TEST_PROCESS_ISSUER = issueVerificationActionTestProcessIssuerForTests();
const BASE_SHA = '1'.repeat(40);
const BASE_TREE_SHA = '2'.repeat(40);
const HEAD_SHA = '3'.repeat(40);
const HEAD_TREE_SHA = '4'.repeat(40);
const PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS = 30_000;
const CROSS_PROCESS_CHILD_ROOT = process.env.SEC_VERIFICATION_ACTION_CHILD_ROOT;
const CROSS_PROCESS_CHILD_MARKER = process.env.SEC_VERIFICATION_ACTION_CHILD_MARKER;

function issuedSettlement(
  action: VerificationActionKey,
  terminalClass: 'completed' | 'failed' | 'recovery-required' = 'completed',
  deadlineAtUnixMs = 1_900_000_000_000
) {
  if (terminalClass === 'recovery-required') {
    throw new Error('Operation requires owner recovery before terminal projection.');
  }
  const operationPlan = compileSemanticOperationPlan({
    operation: 'verification.action-runner-test',
    intentDigest: action.actionKey,
    decisionDigest: DIGEST_A,
    deadlineAtUnixMs,
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'verification.test-effect',
      contractDigest: DIGEST_A,
      effectKinds: ['process'],
      failureKinds: ['process.failed']
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: DIGEST_A
    })
  });
  const bound = bindSemanticOperation(operationPlan, [compileCapabilityBinding({
    requirementId: 'verification.test-effect',
    contractDigest: DIGEST_A,
    providerIdentityDigest: DIGEST_A
  })]);
  const provider = issueProviderSettlementReceipt(bound, {
    requirementId: 'verification.test-effect',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: terminalClass === 'completed' ? DIGEST_B : DIGEST_C
  });
  const providerSet = compileProviderSettlementSet(bound, [provider]);
  const readback = issueNormalDomainReadbackReceipt(bound, providerSet, {
    readbackContractDigest: DIGEST_A,
    readbackReferenceDigest: DIGEST_B,
    currentPhysicalEpochDigest: DIGEST_C,
    disposition: 'applied'
  });
  const ownerTerminalJoin = issueNormalOwnerTerminalJoinReceipt(
    bound,
    providerSet,
    readback,
    {
      ownerTerminalContractDigest: DIGEST_A,
      ownerTerminalReferenceDigest: terminalClass === 'completed' ? DIGEST_B : DIGEST_C
    }
  );
  const actionTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
    action,
    operation: bound,
    providerSettlementSet: providerSet,
    readback,
    ownerTerminalProjection: ownerTerminalJoin
  });
  return issueNonProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
    status: terminalClass === 'completed' ? 'passed' : 'failed',
    reasonCode: terminalClass === 'completed' ? 'executed-success' : 'executed-failure'
  });
}

test.skipIf(CROSS_PROCESS_CHILD_ROOT === undefined || CROSS_PROCESS_CHILD_MARKER === undefined)(
  'independent process child competes for one durable missing ActionKey claim',
  async () => {
    const key = preflightAction('tests/unit/cross-process-action.ts');
    const result = await new VerificationActionRunner().execute({
      repositoryRoot: CROSS_PROCESS_CHILD_ROOT!,
      action: key,
      plan: cheapPlan(key),
      executor: async () => {
        writeFileSync(CROSS_PROCESS_CHILD_MARKER!, String(process.pid), {
          encoding: 'utf8',
          flag: 'wx'
        });
        await Bun.sleep(400);
        return issuedSettlement(key);
      }
    });
    expect(['executed', 'joined', 'reused'], JSON.stringify(result)).toContain(result.disposition);
  }
);

function journalFs(repositoryRoot: string) {
  const root = resolveWorkspaceRuntimeRoots({ repositoryRoot }).stateRoot;
  return createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(root, 'VerificationAction runner test journal root').target
  );
}

function workspaceJournalFs(repositoryRoot: string) {
  const root = resolveWorkspaceRuntimeRoots({ repositoryRoot }).workspaceStateRoot;
  return createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(
      root,
      'VerificationAction runner legacy workspace journal root'
    ).target
  );
}

function readVerificationActionJournal(
  repositoryRoot: string,
  actionKey: Parameters<typeof readJournal>[1]
) {
  return readJournal(journalFs(repositoryRoot), actionKey);
}

function appendVerificationActionJournalEvent(
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
  const action = createVerificationActionKey(input);
  touchedActionKeys.add(action.actionKey);
  return action;
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
  const current = readVerificationActionJournal(repositoryRoot, preflight.actionKey);
  if (current.latestState === 'terminal' || current.latestState === 'reused') return;
  appendVerificationActionJournalEvent({ repositoryRoot, action: preflight, state: 'queued' });
  appendVerificationActionJournalEvent({ repositoryRoot, action: preflight, state: 'running' });
  appendVerificationActionJournalEvent({
    repositoryRoot,
    action: preflight,
    state: 'terminal',
    terminal: issuedSettlement(preflight, 'completed').terminal
  });
}

function seedFailedPreflight(repositoryRoot: string, inputPath = 'scripts/codex/example.ts'): void {
  const preflight = preflightAction(inputPath);
  const current = readVerificationActionJournal(repositoryRoot, preflight.actionKey);
  if (current.latestState === 'terminal' || current.latestState === 'reused') return;
  appendVerificationActionJournalEvent({ repositoryRoot, action: preflight, state: 'queued' });
  appendVerificationActionJournalEvent({ repositoryRoot, action: preflight, state: 'running' });
  appendVerificationActionJournalEvent({
    repositoryRoot,
    action: preflight,
    state: 'terminal',
    terminal: issuedSettlement(preflight, 'failed').terminal
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
const actionJournalRoots = new Set<string>();
const machineCutoverReceiptPaths = new Set<string>();
const touchedActionKeys = new Set<VerificationActionKeyDigest>();

afterEach(() => {
  for (const journalRoot of actionJournalRoots) {
    for (const actionKey of touchedActionKeys) {
      const actionPath = path.join(
        journalRoot,
        `${actionKey.slice('sha256:'.length)}.jsonl`
      );
      for (const suffix of ['', '.claim.json', '.claim-recovery.lock', '.cutover.json']) {
        rmSync(`${actionPath}${suffix}`, { force: true });
      }
    }
  }
  actionJournalRoots.clear();
  for (const receiptPath of machineCutoverReceiptPaths) rmSync(receiptPath, { force: true });
  machineCutoverReceiptPaths.clear();
  touchedActionKeys.clear();
  for (const runtimeRoot of runtimeRoots) rmSync(runtimeRoot, { recursive: true, force: true });
  runtimeRoots.clear();
});

function root(): string {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-runner-v2-'));
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot });
  const workspaceStateRoot = roots.workspaceStateRoot;
  const actionJournalRoot = path.join(roots.stateRoot, VERIFICATION_ACTION_JOURNAL_DIRECTORY);
  actionJournalRoots.add(actionJournalRoot);
  machineCutoverReceiptPaths.add(path.join(
    actionJournalRoot,
    VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
  ));
  mkdirSync(workspaceStateRoot, { recursive: true });
  runtimeRoots.add(workspaceStateRoot);
  return repositoryRoot;
}

function diagnosticReadOperation() {
  const requirementId = 'verification.action-diagnostic-readback';
  const contractDigest = DIGEST_C;
  const plan = compileSemanticOperationPlan({
    operation: 'verification.action-diagnostic-readback',
    intentDigest: DIGEST_A,
    decisionDigest: DIGEST_B,
    deadlineAtUnixMs: Date.now() + 30_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: 32 * 1024 * 1024 }
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['diagnostic.readback-failed']
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  return {
    requirementId,
    operation: bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId,
      contractDigest,
      providerIdentityDigest: DIGEST_B
    })])
  };
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

test('closed runner rejects new execution before acquiring runtime resources', async () => {
  const runner = new VerificationActionRunner();
  await runner.close();
  await runner.close();
  const key = action('closed-runner-admission');
  await expect(runner.execute({
    repositoryRoot: process.cwd(),
    action: key,
    plan: cheapPlan(key),
    executor: async () => issuedSettlement(key)
  })).rejects.toThrow('VerificationActionRunner is closing or closed.');
});

test('concurrent callers in different execution domains join one physical executor invocation', async () => {
  const repositoryRoot = root();
  const runner = new VerificationActionRunner();
  const secondRunner = new VerificationActionRunner();
  try {
    const key = action();
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const executor = async () => {
      invocations += 1;
      await held;
      return issuedSettlement(key);
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
      repositoryRoot,
      action: key,
      executionDomain: 'domain-b',
      plan: runnablePlan(key, repositoryRoot),
      executor
    });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(invocations).toBe(1);
    expect(new Set([firstResult.disposition, secondResult.disposition])).toEqual(
      new Set(['executed', 'joined'])
    );
    expect([firstResult, secondResult].every(({ terminal }) => terminal?.status === 'passed')).toBeTrue();
    expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState).toBe('terminal');
  } finally {
    await Promise.all([runner.close(), secondRunner.close()]);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('runner completes machine cutover before reusing a workspace terminal without execution', async () => {
  const repositoryRoot = root();
  const runner = new VerificationActionRunner();
  try {
    const key = preflightAction('tests/unit/workspace-terminal-cutover.ts');
    const legacyFs = workspaceJournalFs(repositoryRoot);
    appendJournalEvent({ fs: legacyFs, action: key, state: 'queued' });
    appendJournalEvent({ fs: legacyFs, action: key, state: 'running' });
    appendJournalEvent({
      fs: legacyFs,
      action: key,
      state: 'terminal',
      terminal: issuedSettlement(key).terminal
    });
    let invocations = 0;
    const result = await runner.execute({
      repositoryRoot,
      action: key,
      plan: cheapPlan(key),
      executor: () => {
        invocations += 1;
        return issuedSettlement(key);
      }
    });
    expect(result.disposition).toBe('reused');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState)
      .toBe('terminal');
    expect(readJournal(legacyFs, key.actionKey).latestState).toBe('terminal');
  } finally {
    await runner.close();
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('equal ActionKeys in distinct workspaces join one machine-global physical claim and terminal', async () => {
  const firstRepositoryRoot = root();
  const secondRepositoryRoot = root();
  const firstRunner = new VerificationActionRunner();
  const secondRunner = new VerificationActionRunner();
  try {
    const key = action();
    let invocations = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const execute = (
      runner: VerificationActionRunner,
      repositoryRoot: string,
      executionDomain: string
    ) => runner.execute({
        repositoryRoot,
        action: key,
        executionDomain,
        plan: runnablePlan(key, repositoryRoot),
        executor: async () => {
          invocations += 1;
          await held;
          return issuedSettlement(key);
        }
      });
    const firstPromise = execute(firstRunner, firstRepositoryRoot, 'workspace-a');
    await Promise.resolve();
    const secondPromise = execute(secondRunner, secondRepositoryRoot, 'workspace-b');
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(invocations).toBe(1);
    expect(new Set([first.disposition, second.disposition])).toEqual(
      new Set(['executed', 'joined'])
    );
    const firstReadback = readVerificationActionJournal(firstRepositoryRoot, key.actionKey);
    const secondReadback = readVerificationActionJournal(secondRepositoryRoot, key.actionKey);
    expect(firstReadback.filePath).toBe(secondReadback.filePath);
    expect(firstReadback.latestState).toBe('terminal');
    expect(secondReadback.terminal).toEqual(firstReadback.terminal);
  } finally {
    await Promise.all([firstRunner.close(), secondRunner.close()]);
    rmSync(firstRepositoryRoot, { recursive: true, force: true });
    rmSync(secondRepositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('distinct ActionKeys retain independent machine-global physical claims', async () => {
  const firstRepositoryRoot = root();
  const secondRepositoryRoot = root();
  const firstRunner = new VerificationActionRunner();
  const secondRunner = new VerificationActionRunner();
  try {
    const firstKey = preflightAction('tests/unit/global-action-a.ts');
    const secondKey = preflightAction('tests/unit/global-action-b.ts');
    let firstInvocations = 0;
    let secondInvocations = 0;
    const [first, second] = await Promise.all([
      firstRunner.execute({
        repositoryRoot: firstRepositoryRoot,
        action: firstKey,
        plan: cheapPlan(firstKey),
        executor: () => {
          firstInvocations += 1;
          return issuedSettlement(firstKey);
        }
      }),
      secondRunner.execute({
        repositoryRoot: secondRepositoryRoot,
        action: secondKey,
        plan: cheapPlan(secondKey),
        executor: () => {
          secondInvocations += 1;
          return issuedSettlement(secondKey);
        }
      })
    ]);
    expect(firstInvocations).toBe(1);
    expect(secondInvocations).toBe(1);
    expect(first.disposition).toBe('executed');
    expect(second.disposition).toBe('executed');
    expect(readVerificationActionJournal(firstRepositoryRoot, firstKey.actionKey).filePath)
      .not.toBe(readVerificationActionJournal(secondRepositoryRoot, secondKey.actionKey).filePath);
  } finally {
    await Promise.all([firstRunner.close(), secondRunner.close()]);
    rmSync(firstRepositoryRoot, { recursive: true, force: true });
    rmSync(secondRepositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('an expired global claim observed from another workspace blocks blind restart', async () => {
  const ownerRepositoryRoot = root();
  const contenderRepositoryRoot = root();
  const key = preflightAction('tests/unit/global-expired-claim.ts');
  const ownerFs = journalFs(ownerRepositoryRoot);
  const runner = new VerificationActionRunner();
  try {
    expect(acquireVerificationActionClaim({
      fs: ownerFs,
      action: key,
      ownerToken: 'lost-global-owner',
      now: '2026-08-09T00:00:00.000Z',
      leaseDurationMs: 1_000
    }).disposition).toBe('acquired');
    let invocations = 0;
    const result = await runner.execute({
      repositoryRoot: contenderRepositoryRoot,
      action: key,
      plan: cheapPlan(key),
      recordedAt: () => '2026-08-09T00:00:02.000Z',
      executor: () => {
        invocations += 1;
        return issuedSettlement(key);
      }
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('expired physical owner');
    expect(invocations).toBe(0);
    expect(readVerificationActionJournal(ownerRepositoryRoot, key.actionKey).filePath)
      .toBe(readVerificationActionJournal(contenderRepositoryRoot, key.actionKey).filePath);
  } finally {
    await runner.close();
    rmSync(ownerRepositoryRoot, { recursive: true, force: true });
    rmSync(contenderRepositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('durable cross-process join waits for the authenticated owner terminal without a second execution', async () => {
  const repositoryRoot = root();
  try {
    const key = preflightAction('tests/unit/durable-join.ts');
    const fs = journalFs(repositoryRoot);
    const ownerToken = 'durable-owner';
    const now = new Date().toISOString();
    const claim = acquireVerificationActionClaim({
      fs,
      action: key,
      ownerToken,
      now,
      leaseDurationMs: 5_000
    });
    expect(claim.disposition).toBe('acquired');
    appendJournalEvent({ fs, action: key, state: 'queued', recordedAt: now });
    appendJournalEvent({ fs, action: key, state: 'running', recordedAt: now });
    let physicalExecutions = 0;
    const joined = new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: cheapPlan(key),
      deadlineAtUnixMs: Date.now() + 4_000,
      executor: () => {
        physicalExecutions += 1;
        return issuedSettlement(key);
      }
    });
    const terminal = issuedSettlement(key);
    const publish = setTimeout(() => {
      commitVerificationActionTerminalUnderClaim({
        fs,
        action: key,
        ownerToken,
        now: new Date().toISOString(),
        terminal: terminal.terminal,
        note: 'producer-owned-settlement'
      });
    }, 500);
    publish.unref();

    let result: Awaited<typeof joined>;
    try {
      result = await joined;
    } finally {
      clearTimeout(publish);
    }
    expect(result).toMatchObject({
      disposition: 'joined',
      state: 'terminal',
      terminal: { status: 'passed' },
      physicalExecution: false,
      subordinateSettlement: 'producer-owned-settlement'
    });
    expect(physicalExecutions).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('durable cross-process join deadline blocks without polling or a second execution', async () => {
  const repositoryRoot = root();
  try {
    const key = preflightAction('tests/unit/durable-join-deadline.ts');
    const fs = journalFs(repositoryRoot);
    const now = new Date().toISOString();
    expect(acquireVerificationActionClaim({
      fs,
      action: key,
      ownerToken: 'durable-owner',
      now,
      leaseDurationMs: 5_000
    }).disposition).toBe('acquired');
    appendJournalEvent({ fs, action: key, state: 'queued', recordedAt: now });
    appendJournalEvent({ fs, action: key, state: 'running', recordedAt: now });
    let physicalExecutions = 0;

    const result = await new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: cheapPlan(key),
      deadlineAtUnixMs: Date.now() + 50,
      executor: () => {
        physicalExecutions += 1;
        return issuedSettlement(key);
      }
    });

    expect(result).toMatchObject({
      disposition: 'blocked',
      state: null,
      terminal: null,
      physicalExecution: false,
      reason: 'joined durable Action wait exhausted its absolute deadline'
    });
    expect(physicalExecutions).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}, PHYSICAL_RUNTIME_AUTHORITY_TEST_TIMEOUT_MS);

test('independent processes in distinct workspaces share one machine-global physical start', async () => {
  const firstRepositoryRoot = root();
  const secondRepositoryRoot = root();
  const markerPath = path.join(firstRepositoryRoot, 'physical-start.marker');
  try {
    const command = [
      process.execPath,
      'test',
      fileURLToPath(import.meta.url),
      '--test-name-pattern',
      '^independent process child competes for one durable missing ActionKey claim$'
    ];
    const environment = {
      ...process.env,
      SEC_VERIFICATION_ACTION_CHILD_MARKER: markerPath
    };
    const first = Bun.spawn(command, {
      cwd: process.cwd(),
      env: {
        ...environment,
        SEC_VERIFICATION_ACTION_CHILD_ROOT: firstRepositoryRoot
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const second = Bun.spawn(command, {
      cwd: process.cwd(),
      env: {
        ...environment,
        SEC_VERIFICATION_ACTION_CHILD_ROOT: secondRepositoryRoot
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const firstExit = await first.exited;
    const secondExit = await second.exited;
    const firstOutput = `${await new Response(first.stdout).text()}${await new Response(first.stderr).text()}`;
    const secondOutput = `${await new Response(second.stdout).text()}${await new Response(second.stderr).text()}`;
    expect(firstExit, firstOutput).toBe(0);
    expect(secondExit, secondOutput).toBe(0);
    expect(existsSync(markerPath)).toBe(true);
    const actionKey = preflightAction('tests/unit/cross-process-action.ts').actionKey;
    const firstReadback = readVerificationActionJournal(firstRepositoryRoot, actionKey);
    const secondReadback = readVerificationActionJournal(secondRepositoryRoot, actionKey);
    expect(firstReadback.filePath).toBe(secondReadback.filePath);
    expect(firstReadback.latestState).toBe('terminal');
    expect(secondReadback.terminal).toEqual(firstReadback.terminal);
  } finally {
    rmSync(firstRepositoryRoot, { recursive: true, force: true });
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
        return issuedSettlement(key);
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
        return issuedSettlement(key);
      }
    })).rejects.toThrow('must match required cheap-preflight topology');
    expect(invocations).toBe(0);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('a caller without an authorized plan cannot join a cross-workspace physical flight', async () => {
  const repositoryRoot = root();
  const secondRepositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('caller-local-plan-action');
    let invocations = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const running = runner.execute({
      repositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      plan: runnablePlan(key, repositoryRoot),
      executor: async () => {
        invocations += 1;
        markStarted();
        await held;
        return issuedSettlement(key);
      }
    });
    await started;
    const missing = await runner.execute({
      repositoryRoot: secondRepositoryRoot,
      action: key,
      executionDomain: 'caller-local-plan-domain',
      executor: () => {
        invocations += 1;
        return issuedSettlement(key);
      }
    });
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
      return issuedSettlement(key);
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
      return issuedSettlement(key);
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
      return issuedSettlement(key);
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
        return issuedSettlement(key);
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
        return issuedSettlement(passed);
      }
    });
    const reused = await runner.execute({
      repositoryRoot,
      action: passed,
      plan: runnablePlan(passed, repositoryRoot),
      executor: () => {
        passedInvocations += 1;
        return issuedSettlement(passed);
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
        return issuedSettlement(failed, 'failed');
      }
    });
    const failedReuse = await runner.execute({
      repositoryRoot,
      action: failed,
      plan: runnablePlan(failed, repositoryRoot),
      executor: () => {
        failedInvocations += 1;
        return issuedSettlement(failed);
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
      executor: ({ action }) => {
        invocations += 1;
        return issuedSettlement(action);
      }
    });
    const first = await execute();
    const second = await execute();
    expect(first.disposition).toBe('executed');
    expect(second.disposition).toBe('reused');
    expect(second.physicalExecution).toBe(false);
    expect(second.terminal?.status).toBe('passed');
    expect(second.subordinateSettlement).toBeNull();
    expect(invocations).toBe(1);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('producer subordinate settlement is atomically journaled and replayed without execution', async () => {
  const repositoryRoot = root();
  try {
    const runner = new VerificationActionRunner();
    const key = action('subordinate-settlement');
    const subordinate = JSON.stringify({
      setup: { status: 'complete' },
      execution: { status: 'failed', reason: 'process-exit', exitCode: 2 },
      cleanup: { status: 'physically-clean' },
      readback: { status: 'current' }
    });
    let invocations = 0;
    const execute = () => runner.execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: ({ action, recordSubordinateSettlement }) => {
        invocations += 1;
        recordSubordinateSettlement(subordinate);
        return issuedSettlement(action, 'failed');
      }
    });

    const first = await execute();
    expect(first.disposition).toBe('executed');
    expect(first.subordinateSettlement).toBe(subordinate);
    const journal = readVerificationActionJournal(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('terminal');
    expect(journal.events.at(-1)?.note).toBe(subordinate);

    const reused = await execute();
    expect(reused.disposition).toBe('reused');
    expect(reused.subordinateSettlement).toBe(subordinate);
    expect(invocations).toBe(1);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('subordinate settlement registration rejects unbounded or duplicate projections before terminal commit', async () => {
  for (const [name, register] of [
    ['unbounded', (record: (note: string) => void) => record('x'.repeat(1025))],
    ['duplicate', (record: (note: string) => void) => {
      record('{"setup":{"status":"complete"}}');
      record('{"execution":{"status":"complete"}}');
    }]
  ] as const) {
    const repositoryRoot = root();
    try {
      const runner = new VerificationActionRunner();
      const key = action(`subordinate-${name}`);
      const result = await runner.execute({
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor: ({ action, recordSubordinateSettlement }) => {
          register(recordSubordinateSettlement);
          return issuedSettlement(action);
        }
      });
      expect(result.disposition).toBe('blocked');
      expect(result.state).toBe('cancelled');
      expect(result.terminal).toBeNull();
      expect(result.subordinateSettlement).toBeNull();
      expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState).toBe('cancelled');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  }
});

test('executor failure is durably cancelled and its diagnostic is bounded', async () => {
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
    expect(result.disposition).toBe('blocked');
    expect(result.state).toBe('cancelled');
    expect(result.terminal).toBeNull();
    expect(result.reason).toContain('executor threw: line one line two');
    const journal = readVerificationActionJournal(repositoryRoot, key.actionKey);
    expect(journal.latestState).toBe('cancelled');
    expect(journal.events.at(-1)?.note).toBe(result.reason);
    expect(Buffer.byteLength(result.reason ?? '', 'utf8')).toBeLessThanOrEqual(1024);
    expect(result.reason).not.toMatch(/[\u0000-\u001f]/u);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('non-issued and recovery-required executor results durably cancel without a terminal', async () => {
  for (const kind of ['plain-terminal', 'recovery-required'] as const) {
    const repositoryRoot = root();
    try {
      const key = action(kind);
      const executor = kind === 'plain-terminal'
        ? () => ({
            status: 'passed' as const,
            reasonCode: 'executed-success' as const,
            resultDigest: null
          })
        : () => issuedSettlement(key, 'recovery-required');
      const result = await new VerificationActionRunner().execute({
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor
      });
      expect(result.disposition).toBe('blocked');
      expect(result.state).toBe('cancelled');
      expect(result.terminal).toBeNull();
      expect(result.reason).toContain('durably cancelled');
      expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState)
        .toBe('cancelled');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
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
        return issuedSettlement(key);
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
        return issuedSettlement(key);
      }
    });
    expect(invocations).toBe(1);
    expect(result.disposition).toBe('blocked');
    expect(result.physicalExecution).toBe(true);
    expect(result.reason).toContain('dependency closure');
    expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState).toBe('invalidated');
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
        return issuedSettlement(key);
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

test('persisted running and queued actions without a live owner are durably cancelled', async () => {
  for (const [state, kind] of [['running', 'orphaned-action'], ['queued', 'queued-orphaned-action']] as const) {
    const repositoryRoot = root();
    try {
      const key = action(kind);
      appendVerificationActionJournalEvent({ repositoryRoot, action: key, state: 'queued' });
      if (state === 'running') {
        appendVerificationActionJournalEvent({ repositoryRoot, action: key, state: 'running' });
      }
      let invocations = 0;
      const result = await new VerificationActionRunner().execute({
        repositoryRoot,
        action: key,
        plan: runnablePlan(key, repositoryRoot),
        executor: () => {
          invocations += 1;
          return issuedSettlement(key);
        }
      });
      expect(result.disposition).toBe('blocked');
      expect(result.reason).toContain('durably cancelled');
      expect(invocations).toBe(0);
      expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState)
        .toBe('cancelled');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  }
});

test('executor failure settles the durable action as cancelled before releasing its claim', async () => {
  const repositoryRoot = root();
  try {
    const key = action('executor-failure-cancelled');
    const result = await new VerificationActionRunner().execute({
      repositoryRoot,
      action: key,
      plan: runnablePlan(key, repositoryRoot),
      executor: () => {
        throw new Error('provider setup failed');
      }
    });
    expect(result).toMatchObject({
      disposition: 'blocked',
      physicalExecution: true,
      state: 'cancelled',
      terminal: null
    });
    expect(result.reason).toContain('durably cancelled');
    expect(readVerificationActionJournal(repositoryRoot, key.actionKey).latestState)
      .toBe('cancelled');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
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
    manifestPath: 'config/repository/work-packages/local-feedback-v1.md',
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
  const closure = buildCiVerificationActionPlanClosure({ candidate, gates });
  for (const plan of closure.actions) touchedActionKeys.add(plan.action.actionKey);
  return {
    environment,
    closure
  };
}

test.skipIf(process.platform !== 'win32')(
  'local quick DAG keeps journal authority separate from the detached candidate executor and reuses terminals',
  async () => {
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
      testProcessIssuer: TEST_PROCESS_ISSUER,
      testProcessProvider: (_operation, process) => {
        physicalExecutions += 1;
        return runRetainedBunTestProcess(process, candidateRoot, {
          script: "console.log('recoverable stdout'); console.error('recoverable stderr')"
        });
      },
    });
    const reused = await executeLocalVerificationActionDag({
      authorityRoot,
      candidateRoot,
      actionPlanClosure: fixture.closure,
      executionEnvironment: fixture.environment,
      inspectRepository,
      testProcessIssuer: TEST_PROCESS_ISSUER,
      testProcessProvider: (_operation, process) => {
        physicalExecutions += 1;
        return runRetainedBunTestProcess(process, candidateRoot);
      },
    });
    expect(first.status).toBe('passed');
    expect(first.actionResults[0]?.disposition).toBe('executed');
    const terminal = first.actionResults[0]?.terminal;
    expect(terminal?.diagnosticObjects.map(({ receipt }) => receipt.stream))
      .toEqual(['stderr', 'stdout']);
    expect(terminal?.boundAttemptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(terminal?.diagnosticObjects.every(({ receipt }) => (
      receipt.subjectDigest === fixture.closure.actions[0]!.action.actionKey
      && receipt.boundAttemptDigest === terminal?.boundAttemptDigest
    ))).toBe(true);
    expect(new Set(
      terminal?.diagnosticObjects.map(({ receipt }) => receipt.settlementDigest)
    ).size).toBe(1);
    expect(reused.actionResults[0]?.disposition).toBe('reused');
    expect(reused.actionResults[0]?.terminal).toEqual(terminal);
    expect(reused.terminalDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(physicalExecutions).toBe(1);
    expect(readVerificationActionJournal(
      authorityRoot,
      fixture.closure.actions[0]!.action.actionKey
    ).latestState).toBe('terminal');
    if (terminal === undefined || terminal === null) {
      throw new Error('Expected persisted terminal diagnostics');
    }
    expect(() => createVerificationActionTerminal({
      ...terminal,
      diagnosticObjects: terminal.diagnosticObjects.map((entry, index) => index === 0
        ? { ...entry, readback: { ...entry.readback, readbackDigest: DIGEST_A } }
        : entry)
    })).toThrow('does not bind the exact diagnostic object');
    const readAuthority = await acquireRuntimeJournalAuthority({ repositoryRoot: authorityRoot });
    try {
      const store = createBoundedProcessDiagnosticObjectStore({
        authority: readAuthority,
        repositoryRoot: authorityRoot
      });
      const readOperation = diagnosticReadOperation();
      const outputs: Record<string, string> = {};
      for (const { receipt } of terminal.diagnosticObjects) {
        const readback = await store.read({ ...readOperation, receipt });
        expect(readback.status).toBe('available');
        if (readback.status === 'available') {
          outputs[receipt.stream] = new TextDecoder().decode(readback.bytes).trim();
        }
      }
      expect(outputs).toEqual({
        stderr: 'recoverable stderr',
        stdout: 'recoverable stdout'
      });
    } finally {
      await readAuthority.release();
    }
  } finally {
    rmSync(authorityRoot, { recursive: true, force: true });
    rmSync(candidateRoot, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'local quick DAG meters one real process and commits a terminal only after process settlement and domain readback',
  async () => {
    const authorityRoot = root();
    const candidateRoot = root();
    try {
      const fixture = localDagFixture();
      let secondStartFailure = '';
      const inspectRepository = (repositoryRoot: string) => ({
        headSha: repositoryRoot === candidateRoot ? HEAD_SHA : BASE_SHA,
        headTreeSha: repositoryRoot === candidateRoot ? HEAD_TREE_SHA : BASE_TREE_SHA,
        trackedClean: true,
        gitCommonDirectory: authorityRoot
      });
      const result = await executeLocalVerificationActionDag({
        authorityRoot,
        candidateRoot,
        actionPlanClosure: fixture.closure,
        executionEnvironment: fixture.environment,
        inspectRepository,
        testProcessIssuer: TEST_PROCESS_ISSUER,
        testProcessProvider: async (_operation, process) => {
          const first = await runRetainedBunTestProcess(process, candidateRoot);
          try {
            await runRetainedBunTestProcess(process, candidateRoot);
          } catch (error) {
            secondStartFailure = error instanceof Error ? error.message : String(error);
          }
          return first;
        }
      });
      expect(secondStartFailure).toContain('process budget is exhausted');
      expect(result.status).toBe('passed');
      expect(result.actionResults[0]?.terminal?.status).toBe('passed');
    } finally {
      rmSync(authorityRoot, { recursive: true, force: true });
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'local quick DAG enforces the operation deadline and cancellation without minting a terminal',
  async () => {
    for (const mode of ['deadline', 'cancel'] as const) {
      const authorityRoot = root();
      const candidateRoot = root();
      try {
        const fixture = localDagFixture();
        const controller = new AbortController();
        const result = await executeLocalVerificationActionDag({
          authorityRoot,
          candidateRoot,
          actionPlanClosure: fixture.closure,
          executionEnvironment: fixture.environment,
          deadlineAtUnixMs: mode === 'deadline' ? Date.now() + 1_000 : undefined,
          signal: controller.signal,
          inspectRepository: (repositoryRoot) => ({
            headSha: repositoryRoot === candidateRoot ? HEAD_SHA : BASE_SHA,
            headTreeSha: repositoryRoot === candidateRoot ? HEAD_TREE_SHA : BASE_TREE_SHA,
            trackedClean: true,
            gitCommonDirectory: authorityRoot
          }),
          testProcessIssuer: TEST_PROCESS_ISSUER,
          testProcessProvider: async (_operation, process) => {
            const cancellation = mode === 'cancel'
              ? setTimeout(() => controller.abort(), 50)
              : undefined;
            try {
              return await runRetainedBunTestProcess(
                process,
                candidateRoot,
                { script: 'setInterval(() => {}, 1_000)' }
              );
            } finally {
              if (cancellation !== undefined) clearTimeout(cancellation);
            }
          }
        });
        expect(result.status).toBe('blocked');
        expect(result.actionResults[0]?.terminal).toBeNull();
        expect(result.actionResults[0]?.reason).toMatch(
          mode === 'deadline' ? /timed out|deadline|aborted/u : /aborted|cancelled/u
        );
      } finally {
        rmSync(authorityRoot, { recursive: true, force: true });
        rmSync(candidateRoot, { recursive: true, force: true });
      }
    }
  },
  30_000
);

test.skipIf(process.platform !== 'win32')(
  'local quick DAG rejects output-budget over-admission and records a failed process terminal',
  async () => {
    for (const mode of ['output-budget', 'provider-failure'] as const) {
      const authorityRoot = root();
      const candidateRoot = root();
      try {
        const modeHeadSha = mode === 'output-budget' ? HEAD_SHA : `6${HEAD_SHA.slice(1)}`;
        const modeHeadTreeSha = mode === 'output-budget' ? HEAD_TREE_SHA : `7${HEAD_TREE_SHA.slice(1)}`;
        const fixture = localDagFixture(undefined, {
          headSha: modeHeadSha,
          headTreeSha: modeHeadTreeSha
        });
        const result = await executeLocalVerificationActionDag({
          authorityRoot,
          candidateRoot,
          actionPlanClosure: fixture.closure,
          executionEnvironment: fixture.environment,
          inspectRepository: (repositoryRoot) => ({
            headSha: repositoryRoot === candidateRoot ? modeHeadSha : BASE_SHA,
            headTreeSha: repositoryRoot === candidateRoot ? modeHeadTreeSha : BASE_TREE_SHA,
            trackedClean: true,
            gitCommonDirectory: authorityRoot
          }),
          testProcessIssuer: TEST_PROCESS_ISSUER,
          testProcessProvider: (_operation, process) => runRetainedBunTestProcess(
            process,
            candidateRoot,
            mode === 'output-budget'
              ? { maxStdoutBytes: process.maxStdoutBytes + 1 }
              : { script: 'process.exit(7)' }
          )
        });
        if (mode === 'output-budget') {
          expect(result.status).toBe('blocked');
          expect(result.actionResults[0]?.terminal).toBeNull();
          expect(result.actionResults[0]?.reason).toContain('output-byte admission exceeds');
        } else {
          expect(result.status).toBe('failed');
          expect(result.actionResults[0]?.terminal?.status).toBe('failed');
        }
      } finally {
        rmSync(authorityRoot, { recursive: true, force: true });
        rmSync(candidateRoot, { recursive: true, force: true });
      }
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'local quick DAG refuses raw provider output and candidate readback drift',
  async () => {
  for (const mode of ['raw-provider-output', 'candidate-readback-drift'] as const) {
    const authorityRoot = root();
    const candidateRoot = root();
    try {
      const modeHeadSha = mode === 'raw-provider-output' ? HEAD_SHA : `8${HEAD_SHA.slice(1)}`;
      const modeHeadTreeSha = mode === 'raw-provider-output' ? HEAD_TREE_SHA : `9${HEAD_TREE_SHA.slice(1)}`;
      const fixture = localDagFixture(undefined, {
        headSha: modeHeadSha,
        headTreeSha: modeHeadTreeSha
      });
      let candidateObservations = 0;
      const inspectRepository = (repositoryRoot: string) => {
        if (repositoryRoot === authorityRoot) {
          return {
            headSha: BASE_SHA,
            headTreeSha: BASE_TREE_SHA,
            trackedClean: true,
            gitCommonDirectory: authorityRoot
          };
        }
        candidateObservations += 1;
        return {
          headSha: modeHeadSha,
          headTreeSha: mode === 'candidate-readback-drift' && candidateObservations > 1
            ? `5${modeHeadTreeSha.slice(1)}`
            : modeHeadTreeSha,
          trackedClean: true,
          gitCommonDirectory: authorityRoot
        };
      };
      const result = await executeLocalVerificationActionDag({
        authorityRoot,
        candidateRoot,
        actionPlanClosure: fixture.closure,
        executionEnvironment: fixture.environment,
        inspectRepository,
        testProcessIssuer: TEST_PROCESS_ISSUER,
        testProcessProvider: mode === 'raw-provider-output'
          ? (() => 0 as never)
          : (_operation, process) => runRetainedBunTestProcess(process, candidateRoot)
      });
      expect(result.status).toBe('blocked');
      expect(result.actionResults[0]?.terminal).toBeNull();
      expect(result.actionResults[0]?.reason).toContain(
        mode === 'raw-provider-output'
          ? 'did not return one physical process result'
          : 'candidate readback drifted'
      );
      expect(readVerificationActionJournal(
        authorityRoot,
        fixture.closure.actions[0]!.action.actionKey
      ).latestState).toBe(mode === 'candidate-readback-drift' ? 'invalidated' : 'cancelled');
    } finally {
      rmSync(authorityRoot, { recursive: true, force: true });
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'local quick DAG binds the intended detached worktree under hostile ambient Git steering without index refresh',
  async () => {
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
        testProcessIssuer: TEST_PROCESS_ISSUER,
        testProcessProvider: (_operation, process) =>
          runRetainedBunTestProcess(process, candidateRoot)
      });
      expect(result.status).toBe('passed');
      writeFileSync(path.join(candidateRoot, 'tracked.txt'), 'dirty\n', 'utf8');
      await expect(executeLocalVerificationActionDag({
        authorityRoot,
        candidateRoot,
        actionPlanClosure: fixture.closure,
        executionEnvironment: fixture.environment,
        inspectRepository,
        testProcessIssuer: TEST_PROCESS_ISSUER,
        testProcessProvider: (_operation, process) =>
          runRetainedBunTestProcess(process, candidateRoot)
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
  },
  180_000
);

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
      testProcessIssuer: TEST_PROCESS_ISSUER,
      testProcessProvider: (_operation, process) =>
        runRetainedBunTestProcess(process, candidateRoot)
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
      executor: () => issuedSettlement(key)
    });
    expect(result.disposition).toBe('executed');
    expect(result.terminal?.status).toBe('passed');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
