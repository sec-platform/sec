import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import { PHYSICAL_MUTATION_LEASE_SCHEMA } from '../../src/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { createBoundedProcessDiagnosticObjectReceipt } from '../../src/runtime-state/workspace-state/bounded-process-diagnostic-contract.ts';
import { createRuntimeStateJournalFileSystem, runtimeStateJournalMutationLeaseName } from '../../src/runtime-state/workspace-state/journal-filesystem.ts';
import {
  createVerificationActionKey,
  createVerificationActionTerminal,
  encodeVerificationActionData,
  type VerificationActionKeyInput,
  type VerificationActionTerminal
} from '../../src/verification/action/contract/action.ts';
import {
  acquireVerificationActionClaim,
  appendVerificationActionJournalEvent,
  commitVerificationActionRevocationUnderClaim,
  deleteVerificationActionJournal,
  ensureVerificationActionMachineGlobalCutover,
  inspectLegacyVerificationActionJournalForRecovery,
  migrateLegacyVerificationActionJournalForRecovery,
  readVerificationActionClaim,
  readVerificationActionJournal,
  releaseVerificationActionClaim,
  renewVerificationActionClaim,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY,
  VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
  VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX,
  VERIFICATION_ACTION_MACHINE_CUTOVER_FILE,
  VerificationActionJournalError
} from '../../src/verification/action/journal.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function terminal(actionKey: `sha256:${string}`): VerificationActionTerminal {
  const unsigned = {
    actionKey,
    executionKind: 'non-process' as const,
    status: 'passed' as const,
    reasonCode: 'executed-success' as const,
    boundAttemptDigest: DIGEST_A,
    ownerTerminalReceiptDigest: DIGEST_A,
    diagnosticObjects: []
  };
  return createVerificationActionTerminal({ ...unsigned, resultDigest: digest(unsigned) });
}

function terminalForAttempt(
  actionKey: `sha256:${string}`,
  boundAttemptDigest: `sha256:${string}`,
  ownerTerminalReceiptDigest: `sha256:${string}`
): VerificationActionTerminal {
  const unsigned = {
    actionKey,
    executionKind: 'non-process' as const,
    status: 'passed' as const,
    reasonCode: 'executed-success' as const,
    boundAttemptDigest,
    ownerTerminalReceiptDigest,
    diagnosticObjects: []
  };
  return createVerificationActionTerminal({ ...unsigned, resultDigest: digest(unsigned) });
}

function terminalWithDiagnosticSubject(subjectDigest: `sha256:${string}`): VerificationActionTerminal {
  const receipt = createBoundedProcessDiagnosticObjectReceipt({
    operationIdentityDigest: DIGEST_A,
    executionPlanDigest: DIGEST_A,
    boundAttemptDigest: DIGEST_A,
    subjectDigest,
    settlementDigest: DIGEST_A,
    stream: 'stderr',
    bytes: new TextEncoder().encode('journal diagnostic'),
    retainedUntilUnixMs: 1_900_000_100_000
  });
  const readbackUnsigned = {
    disposition: 'current' as const,
    objectDigest: receipt.objectDigest,
    physicalIdentityDigest: DIGEST_A,
    contentDigest: receipt.contentDigest,
    byteLength: receipt.byteLength
  };
  const diagnosticObjects = [{
    receipt,
    readback: {
      ...readbackUnsigned,
      readbackDigest: digest(readbackUnsigned)
    }
  }];
  const unsigned = {
    actionKey: subjectDigest,
    executionKind: 'process' as const,
    status: 'failed' as const,
    reasonCode: 'executed-failure' as const,
    boundAttemptDigest: DIGEST_A,
    ownerTerminalReceiptDigest: DIGEST_A,
    diagnosticObjects
  };
  return createVerificationActionTerminal({
    ...unsigned,
    resultDigest: digest({
      ...unsigned,
      diagnosticObjects: diagnosticObjects.map(({ receipt: object, readback }) => ({
        objectDigest: object.objectDigest,
        readbackDigest: readback.readbackDigest
      }))
    })
  });
}

function action(identity = 'journal-contract'): ReturnType<typeof createVerificationActionKey> {
  const input: VerificationActionKeyInput = {
    actionKind: identity,
    producer: { identity: 'journal-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_A }],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local',
      contractRevision: 'verification-result-v1'
    },
    requiredCheapPreflightActionKeys: [DIGEST_A],
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1'
  };
  return createVerificationActionKey(input);
}

function at(index: number): string {
  return `2026-08-09T13:00:0${index}.000Z`;
}

function journalFs(root: string) {
  return createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(root, 'VerificationAction journal test root').target
  );
}

function withStateRoot<T extends object>(root: string, input: T) {
  return { ...input, fs: journalFs(root) };
}

test('journal mutation lease reclaims only an identity-stable owner proven dead', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-lease-recovery-'));
  try {
    const filePath = path.join(root, 'journals', 'action.jsonl');
    mkdirSync(path.dirname(filePath), { recursive: true });
    const lockPath = path.join(
      path.dirname(filePath),
      runtimeStateJournalMutationLeaseName(root, filePath)
    );
    writeFileSync(lockPath, `${JSON.stringify({
      schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
      host: 'journal-test-host',
      pid: 22001,
      processNonce: '11111111-1111-4111-8111-111111111111',
      token: '22222222-2222-4222-8222-222222222222',
      createdAtMs: 1,
      expiresAtMs: 30_001
    })}\n`, 'utf8');

    const recovered = createRuntimeStateJournalFileSystem(
      inspectNoFollowDirectoryChain(root, 'VerificationAction journal recovery test root').target,
      {
        now: () => 40_000,
        ownerHost: 'journal-test-host',
        ownerPid: 22002,
        processAlive: (pid) => pid === 22001 ? 'dead' : 'alive',
        processNonce: '33333333-3333-4333-8333-333333333333'
      }
    );
    recovered.replaceFsync(filePath, 'recovered\n');
    expect(readFileSync(filePath, 'utf8')).toBe('recovered\n');
    expect(existsSync(lockPath)).toBe(false);

    writeFileSync(lockPath, `${JSON.stringify({
      schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
      host: 'journal-test-host',
      pid: 22003,
      processNonce: '44444444-4444-4444-8444-444444444444',
      token: '55555555-5555-4555-8555-555555555555',
      createdAtMs: 40_000,
      expiresAtMs: 70_000
    })}\n`, 'utf8');
    expect(() => recovered.replaceFsync(filePath, 'must-not-publish\n'))
      .toThrow('Runtime State journal mutation is contended.');
    expect(readFileSync(filePath, 'utf8')).toBe('recovered\n');
    expect(existsSync(lockPath)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic-bound journal append/readback validates lifecycle and digest chain in external runtime state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-'));
  try {
    const key = action();
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(2)
    }));
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'terminal' as const, recordedAt: at(3),
      terminal: terminal(key.actionKey)
    }));
    const readback = readVerificationActionJournal(journalFs(root), key.actionKey);
    expect(readback.events).toHaveLength(3);
    expect(readback.latestState).toBe('terminal');
    expect(readback.terminal?.status).toBe('passed');
    expect(readback.events[1]!.previousDigest).toBe(readback.events[0]!.eventDigest);
    expect(readback.events[2]!.previousDigest).toBe(readback.events[1]!.eventDigest);
    expect(readback.filePath).toBe(path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY, `${key.actionKey.slice(7)}.jsonl`));
    expect(readback.filePath).not.toContain('.tmp/codex');
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'invalidated' as const,
      recordedAt: at(4), note: 'input changed'
    }));
    const invalidated = readVerificationActionJournal(journalFs(root), key.actionKey);
    expect(invalidated.latestState).toBe('invalidated');
    expect(invalidated.terminal).toBeNull();
    expect(invalidated.events[2]!.terminal?.status).toBe('passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal rejects corrupt and partial tails before exposing any projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-corrupt-'));
  try {
    const key = action();
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY, `${key.actionKey.slice(7)}.jsonl`);
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, `${original.slice(0, -1)}{"partial":true}`, 'utf8');
    expect(() => readVerificationActionJournal(journalFs(root), key.actionKey)).toThrow(/invalid JSON|partial/);
    writeFileSync(filePath, original.replace('"recordedAt":"2026-08-09T13:00:01.000Z"', '"recordedAt":"2026-08-09T13:00:02.000Z"'), 'utf8');
    expect(() => readVerificationActionJournal(journalFs(root), key.actionKey)).toThrow(/digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal and claim readers reject duplicate keys before domain projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-exact-json-'));
  try {
    const key = action();
    const fs = journalFs(root);
    appendVerificationActionJournalEvent({
      fs,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    const journalPath = readVerificationActionJournal(fs, key.actionKey).filePath;
    const canonicalJournal = readFileSync(journalPath, 'utf8');
    writeFileSync(
      journalPath,
      canonicalJournal.replace('{', `{"schema":"${VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA}",`),
      'utf8'
    );
    expect(() => readVerificationActionJournal(fs, key.actionKey)).toThrow('duplicate key');

    writeFileSync(journalPath, canonicalJournal, 'utf8');
    const claimKey = action('claim-exact-json');
    expect(acquireVerificationActionClaim({
      fs,
      action: claimKey,
      ownerToken: 'exact-json-owner',
      now: at(2)
    }).disposition).toBe('acquired');
    const claimPath = `${readVerificationActionJournal(fs, claimKey.actionKey).filePath}.claim.json`;
    const canonicalClaim = readFileSync(claimPath, 'utf8');
    writeFileSync(
      claimPath,
      canonicalClaim.replace('{', `{"schema":"sec-verification-action-terminal-bound-claim",`),
      'utf8'
    );
    expect(() => readVerificationActionClaim(fs, claimKey.actionKey)).toThrow('duplicate key');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a current prefix and foreign-schema tail is corruption, not disposable state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-mixed-'));
  try {
    const key = action();
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY, `${key.actionKey.slice(7)}.jsonl`);
    const foreignTail = {
      schema: 'foreign-verification-action-event',
      sequence: 2,
      actionKey: key.actionKey,
      action: { ...key, schema: 'sec-verification-action-key-v1' },
      state: 'running',
      recordedAt: at(2),
      terminal: null,
      note: null,
      previousDigest: null,
      eventDigest: DIGEST_A
    };
    writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}${JSON.stringify(foreignTail)}\n`, 'utf8');
    expect(() => readVerificationActionJournal(journalFs(root), key.actionKey)).toThrow(/schema mismatch/);
    expect(() => appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(3)
    }))).toThrow(/schema mismatch/);
    expect(readFileSync(filePath, 'utf8')).toContain('foreign-verification-action-event');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mkdirForFile(filePath: string): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
}

function writeLegacyJournal(
  root: string,
  key: ReturnType<typeof action>,
  legacyTerminal: unknown
): string {
  const filePath = path.join(
    root,
    'verification-actions',
    'v2',
    `${key.actionKey.slice(7)}.jsonl`
  );
  mkdirForFile(filePath);
  let previousDigest: `sha256:${string}` | null = null;
  const lines = [
    { state: 'queued' as const, terminal: null, recordedAt: at(1) },
    { state: 'running' as const, terminal: null, recordedAt: at(2) },
    { state: 'terminal' as const, terminal: legacyTerminal, recordedAt: at(3) }
  ].map(({ state, terminal: eventTerminal, recordedAt }, index) => {
    const unsigned = {
      schema: 'sec-verification-action-journal-event-v2' as const,
      sequence: index + 1,
      actionKey: key.actionKey,
      action: key,
      state,
      recordedAt,
      terminal: eventTerminal,
      note: null,
      previousDigest
    };
    const eventDigest = digest(unsigned);
    previousDigest = eventDigest;
    return encodeVerificationActionData({ ...unsigned, eventDigest });
  });
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function writeLegacyPartialJournal(
  root: string,
  key: ReturnType<typeof action>,
  states: readonly ('queued' | 'running' | 'invalidated')[] = ['queued', 'running']
): string {
  const filePath = path.join(
    root,
    'verification-actions',
    'v2',
    `${key.actionKey.slice(7)}.jsonl`
  );
  mkdirForFile(filePath);
  let previousDigest: `sha256:${string}` | null = null;
  const lines = states.map((state, index) => {
    const unsigned = {
      schema: 'sec-verification-action-journal-event-v2' as const,
      sequence: index + 1,
      actionKey: key.actionKey,
      action: key,
      state,
      recordedAt: at(index + 1),
      terminal: null,
      note: state === 'invalidated' ? 'retired attempt invalidated' : null,
      previousDigest
    };
    const eventDigest = digest(unsigned);
    previousDigest = eventDigest;
    return encodeVerificationActionData({ ...unsigned, eventDigest });
  });
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function writeRetiredCanonicalJournal(
  root: string,
  key: ReturnType<typeof action>,
  retiredTerminal: unknown
): string {
  const filePath = path.join(
    root,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${key.actionKey.slice(7)}.jsonl`
  );
  mkdirForFile(filePath);
  let previousDigest: `sha256:${string}` | null = null;
  const lines = [
    { state: 'queued' as const, terminal: null, recordedAt: at(1) },
    { state: 'running' as const, terminal: null, recordedAt: at(2) },
    { state: 'terminal' as const, terminal: retiredTerminal, recordedAt: at(3) }
  ].map(({ state, terminal: eventTerminal, recordedAt }, index) => {
    const unsigned = {
      schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
      sequence: index + 1,
      actionKey: key.actionKey,
      action: key,
      state,
      recordedAt,
      terminal: eventTerminal,
      note: null,
      previousDigest
    };
    const eventDigest = digest(unsigned);
    previousDigest = eventDigest;
    return encodeVerificationActionData({ ...unsigned, eventDigest });
  });
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function writeLegacyClaim(input: Readonly<{
  legacyPath: string;
  actionKey: `sha256:${string}`;
  ownerToken: string;
  acquiredAt: string;
  expiresAt: string;
}>): string {
  const filePath = `${input.legacyPath}.claim.json`;
  writeFileSync(filePath, `${encodeVerificationActionData({
    schema: 'sec-verification-action-claim-v1',
    actionKey: input.actionKey,
    ownerToken: input.ownerToken,
    acquiredAt: input.acquiredAt,
    expiresAt: input.expiresAt
  })}\n`, 'utf8');
  return filePath;
}

function writeLegacySettlementCurrent(input: Readonly<{
  workspaceRoot: string;
  actionKey: `sha256:${string}`;
  state: 'confirmed' | 'settled';
}>): string {
  const reasonCode = input.state === 'confirmed' ? 'settlement-confirmed' : 'settled';
  const unsigned = {
    actionKey: input.actionKey,
    detailDigest: DIGEST_A,
    evidenceDigest: DIGEST_A,
    executionBindingDigest: DIGEST_A,
    observedAt: '2026-08-25T12:00:00.000Z',
    phase: 'complete' as const,
    providerRevision: 'legacy-local-provider',
    reasonCode,
    schema: 'sec-verification-action-settlement-v1' as const,
    state: input.state
  };
  const filePath = path.join(
    input.workspaceRoot,
    'verification-actions',
    'v2',
    'settlement-current',
    `${input.actionKey.slice(7)}.json`
  );
  mkdirForFile(filePath);
  writeFileSync(filePath, `${encodeVerificationActionData({
    ...unsigned,
    receiptDigest: digest(unsigned)
  })}\n`, 'utf8');
  return filePath;
}

function writeLegacyStaticAuxiliary(
  workspaceRoot: string,
  actionKey: `sha256:${string}`
): Readonly<{ closurePath: string; pointerPath: string }> {
  const closureUnsigned = {
    actionKey,
    actionPlan: {},
    actionPlanDigest: DIGEST_A,
    analysisReadback: { readbackDigest: DIGEST_A },
    analysisStage: 'complete',
    dependencyEvidence: [],
    dimensions: [],
    environmentDigest: DIGEST_A,
    invalidationDigest: DIGEST_A,
    openDefectClasses: [],
    operationSemanticDigest: DIGEST_A,
    producer: {},
    proofScope: 'static',
    retirement: null,
    schema: 'sec-development-critical-path-static-closure-v2',
    status: 'ready',
    subjectDigest: DIGEST_A,
    trackedInputDigest: DIGEST_A,
    unknowns: []
  };
  const closureDigest = digest(closureUnsigned);
  const closurePath = path.join(
    workspaceRoot,
    'verification-actions',
    'v2',
    'static-closures',
    `${closureDigest.slice(7)}.json`
  );
  mkdirForFile(closurePath);
  writeFileSync(closurePath, `${encodeVerificationActionData({
    ...closureUnsigned,
    closureDigest
  })}\n`, 'utf8');

  const pointerUnsigned = {
    actionKey,
    actionPlanDigest: DIGEST_A,
    closureDigest,
    headTreeSha: 'a'.repeat(40),
    readbackDigest: DIGEST_A,
    schema: 'sec-verification-action-static-closure-pointer-v1'
  };
  const pointerPath = path.join(
    workspaceRoot,
    'verification-actions',
    'v2',
    'static-current',
    `${actionKey.slice(7)}.json`
  );
  mkdirForFile(pointerPath);
  writeFileSync(pointerPath, `${encodeVerificationActionData({
    ...pointerUnsigned,
    pointerDigest: digest(pointerUnsigned)
  })}\n`, 'utf8');
  return Object.freeze({ closurePath, pointerPath });
}

function machineWorkspaceRoot(stateRoot: string, locatorDigit: string): string {
  const workspaceRoot = path.join(
    stateRoot,
    'workspaces',
    'v1',
    locatorDigit.repeat(64)
  );
  mkdirSync(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

function normalizeTestInventoryPath(absoluteOrRelativePath: string): string {
  return absoluteOrRelativePath.replaceAll('\\', '/');
}

function quarantineFile(stateRoot: string, actionKey: `sha256:${string}`): string {
  return path.join(
    stateRoot,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${actionKey.slice(7)}${VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX}`
  );
}

function mutationPublicationCandidate(input: Readonly<{
  directoryPath: string;
  leaseName: string;
  host?: string;
  pid?: number;
  candidateId?: string;
  derivedPhysicalName?: boolean;
  bytes?: string;
}>): string {
  const filePath = path.join(
    input.directoryPath,
    `${input.derivedPhysicalName === false ? '' : '.'}${input.leaseName}.${input.candidateId ?? randomUUID()}.candidate`
  );
  mkdirForFile(filePath);
  const owner = {
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: input.host ?? hostname(),
    pid: input.pid ?? process.pid,
    processNonce: '11111111-1111-4111-8111-111111111111',
    token: '22222222-2222-4222-8222-222222222222',
    createdAtMs: 1,
    expiresAtMs: 30_001
  };
  writeFileSync(filePath, input.bytes ?? `${JSON.stringify(owner)}\n`, 'utf8');
  return filePath;
}

test('machine cutover inventories auxiliary-only static closure evidence without creating an Action', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-static-auxiliary-'));
  try {
    const key = action('machine-cutover-static-auxiliary');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, 'f');
    const auxiliary = writeLegacyStaticAuxiliary(workspaceRoot, key.actionKey);
    const closureBytes = readFileSync(auxiliary.closurePath, 'utf8');
    const pointerBytes = readFileSync(auxiliary.pointerPath, 'utf8');

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(receipt).toMatchObject({ sourceRecordCount: 2, targetActionCount: 0 });
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey)).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: null
    });
    expect(existsSync(quarantineFile(stateRoot, key.actionKey))).toBe(false);
    expect(readFileSync(auxiliary.closurePath, 'utf8')).toBe(closureBytes);
    expect(readFileSync(auxiliary.pointerPath, 'utf8')).toBe(pointerBytes);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover rejects malformed and foreign auxiliary-only static evidence', () => {
  for (const candidate of ['malformed-pointer', 'foreign-closure'] as const) {
    const stateRoot = mkdtempSync(path.join(tmpdir(), `sec-action-machine-static-${candidate}-`));
    try {
      const key = action(`machine-cutover-static-${candidate}`);
      const workspaceRoot = machineWorkspaceRoot(stateRoot, candidate === 'malformed-pointer' ? '1' : '2');
      const auxiliary = writeLegacyStaticAuxiliary(workspaceRoot, key.actionKey);
      if (candidate === 'malformed-pointer') {
        const pointer = JSON.parse(readFileSync(auxiliary.pointerPath, 'utf8')) as Record<string, unknown>;
        writeFileSync(auxiliary.pointerPath, `${encodeVerificationActionData({
          ...pointer,
          pointerDigest: DIGEST_A
        })}\n`, 'utf8');
      } else {
        const closure = JSON.parse(readFileSync(auxiliary.closurePath, 'utf8')) as Record<string, unknown>;
        writeFileSync(auxiliary.closurePath, `${encodeVerificationActionData({
          ...closure,
          schema: 'foreign-static-closure'
        })}\n`, 'utf8');
      }
      expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
        .toThrow(candidate === 'malformed-pointer'
          ? 'legacy static pointer digest mismatch'
          : 'legacy static closure schema is unknown');
      expect(existsSync(path.join(
        stateRoot,
        VERIFICATION_ACTION_JOURNAL_DIRECTORY,
        VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
      ))).toBe(false);
      expect(existsSync(quarantineFile(stateRoot, key.actionKey))).toBe(false);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  }
});

test('machine cutover consolidates identical workspace Action chains before global admission', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-cutover-'));
  try {
    const key = action('machine-cutover-identical');
    const firstWorkspace = machineWorkspaceRoot(stateRoot, '1');
    const secondWorkspace = machineWorkspaceRoot(stateRoot, '2');
    const firstLegacy = writeLegacyJournal(firstWorkspace, key, terminal(key.actionKey));
    const secondLegacy = writeLegacyJournal(secondWorkspace, key, terminal(key.actionKey));

    const retainedReads: string[] = [];
    const physical = journalFs(stateRoot);
    const instrumented = {
      ...physical,
      observeTextRetained: (
        filePath: string,
        bounds: Parameters<typeof physical.observeTextRetained>[1]
      ) => {
        retainedReads.push(normalizeTestInventoryPath(path.relative(stateRoot, filePath)));
        return physical.observeTextRetained(filePath, bounds);
      }
    };
    const receipt = ensureVerificationActionMachineGlobalCutover(instrumented);
    expect(receipt).toMatchObject({
      sourceRecordCount: 2,
      targetActionCount: 1,
      legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
    });
    expect(retainedReads).toEqual([
      `${VERIFICATION_ACTION_JOURNAL_DIRECTORY}/${VERIFICATION_ACTION_MACHINE_CUTOVER_FILE}`
    ]);
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey)).toMatchObject({
      latestState: 'terminal',
      terminal: terminal(key.actionKey)
    });
    expect(readFileSync(firstLegacy, 'utf8')).toContain('journal-event-v2');
    expect(readFileSync(secondLegacy, 'utf8')).toContain('journal-event-v2');

    const reusedReceipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(reusedReceipt.receiptDigest).toBe(receipt.receiptDigest);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover blocks active claims and divergent workspace chains without publishing a fence', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-cutover-blocked-'));
  try {
    const activeKey = action('machine-cutover-active');
    const activeWorkspace = machineWorkspaceRoot(stateRoot, '3');
    expect(acquireVerificationActionClaim({
      fs: journalFs(activeWorkspace),
      action: activeKey,
      ownerToken: 'active-workspace-owner',
      now: '2026-08-09T00:00:00.000Z',
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow('unresolved physical claim');
    expect(existsSync(quarantineFile(stateRoot, activeKey.actionKey))).toBe(false);
    expect(readVerificationActionJournal(journalFs(stateRoot), activeKey.actionKey).latestState)
      .toBeNull();

    releaseVerificationActionClaim({
      fs: journalFs(activeWorkspace),
      actionKey: activeKey.actionKey,
      ownerToken: 'active-workspace-owner'
    });
    const divergentKey = action('machine-cutover-divergent');
    const firstWorkspace = machineWorkspaceRoot(stateRoot, '4');
    const secondWorkspace = machineWorkspaceRoot(stateRoot, '5');
    writeLegacyJournal(firstWorkspace, divergentKey, terminal(divergentKey.actionKey));
    const secondPath = writeLegacyJournal(
      secondWorkspace,
      divergentKey,
      terminal(divergentKey.actionKey)
    );
    const secondBytes = readFileSync(secondPath, 'utf8');
    writeFileSync(secondPath, secondBytes.replace(at(1), '2026-08-09T13:01:01.000Z'), 'utf8');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow(/digest mismatch|divergent journal chains/);
    expect(readVerificationActionJournal(journalFs(stateRoot), divergentKey.actionKey).latestState)
      .toBeNull();
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover types an active Windows durable publication candidate and succeeds only after it settles', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-publication-active-'));
  try {
    const key = action('machine-cutover-active-publication');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, '8');
    writeLegacyJournal(workspaceRoot, key, terminal(key.actionKey));
    const candidatePath = mutationPublicationCandidate({
      directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
      leaseName: `.journal-mutation-${'a'.repeat(64)}.lock`
    });
    try {
      ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
      throw new Error('Expected active mutation publication to block cutover');
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationActionJournalError);
      expect((error as VerificationActionJournalError).kind).toBe('recovery-required');
      expect((error as Error).message).toContain('active physical mutation publication');
    }
    expect(existsSync(path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
    ))).toBe(false);
    expect(existsSync(path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    ))).toBe(false);

    rmSync(candidatePath);
    expect(ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)).targetActionCount)
      .toBe(1);
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey).latestState)
      .toBe('terminal');
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover exposes its exact double-dot receipt publication candidate as joinable contention', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-publication-join-'));
  try {
    const key = action('machine-cutover-receipt-publication');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, 'a');
    writeLegacyJournal(workspaceRoot, key, terminal(key.actionKey));
    const receiptPath = path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
    );
    const receiptLockName = runtimeStateJournalMutationLeaseName(stateRoot, receiptPath);
    const candidatePath = mutationPublicationCandidate({
      directoryPath: path.dirname(receiptPath),
      leaseName: receiptLockName,
      bytes: ''
    });
    expect(path.basename(candidatePath).startsWith('..journal-mutation-')).toBe(true);
    try {
      ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
      throw new Error('Expected receipt publication contention');
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationActionJournalError);
      expect((error as VerificationActionJournalError).kind).toBe('recovery-required');
      expect((error as Error).message).toEndWith('machine cutover mutation is contended.');
    }
    expect(existsSync(receiptPath)).toBe(false);
    rmSync(candidatePath);
    expect(ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)).targetActionCount)
      .toBe(1);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover preserves stale, foreign, and malformed mutation publication residue without trust', () => {
  const cases = [
    {
      name: 'stale',
      expected: 'stale mutation publication candidate',
      create: (workspaceRoot: string) => mutationPublicationCandidate({
        directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
        leaseName: `.journal-mutation-${'b'.repeat(64)}.lock`,
        pid: 2_147_483_647
      })
    },
    {
      name: 'foreign',
      expected: 'foreign-host mutation publication candidate',
      create: (workspaceRoot: string) => mutationPublicationCandidate({
        directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
        leaseName: `.journal-mutation-${'c'.repeat(64)}.lock`,
        host: 'foreign-verification-host'
      })
    },
    {
      name: 'malformed-name',
      expected: 'malformed mutation publication residue',
      create: (workspaceRoot: string) => mutationPublicationCandidate({
        directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
        leaseName: `.journal-mutation-${'d'.repeat(64)}.lock`,
        candidateId: 'not-a-uuid'
      })
    },
    {
      name: 'single-dot-nonphysical-name',
      expected: 'malformed mutation publication residue',
      create: (workspaceRoot: string) => mutationPublicationCandidate({
        directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
        leaseName: `.journal-mutation-${'f'.repeat(64)}.lock`,
        derivedPhysicalName: false
      })
    },
    {
      name: 'malformed-bytes',
      expected: 'malformed mutation publication candidate',
      create: (workspaceRoot: string) => mutationPublicationCandidate({
        directoryPath: path.join(workspaceRoot, 'verification-actions', 'v2'),
        leaseName: `.journal-mutation-${'e'.repeat(64)}.lock`,
        bytes: '{"foreign":true}\n'
      })
    }
  ] as const;

  for (const candidateCase of cases) {
    const stateRoot = mkdtempSync(path.join(tmpdir(), `sec-action-machine-publication-${candidateCase.name}-`));
    try {
      const key = action(`machine-cutover-publication-${candidateCase.name}`);
      const workspaceRoot = machineWorkspaceRoot(stateRoot, '9');
      writeLegacyJournal(workspaceRoot, key, terminal(key.actionKey));
      const candidatePath = candidateCase.create(workspaceRoot);
      expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
        .toThrow(candidateCase.expected);
      expect(existsSync(candidatePath)).toBe(true);
      expect(existsSync(path.join(
        stateRoot,
        VERIFICATION_ACTION_JOURNAL_DIRECTORY,
        VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
      ))).toBe(false);
      expect(existsSync(path.join(
        stateRoot,
        VERIFICATION_ACTION_JOURNAL_DIRECTORY,
        `${key.actionKey.slice(7)}.jsonl`
      ))).toBe(false);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  }
});

test('machine cutover quarantines an unbound legacy terminal and permanently blocks same-ActionKey execution', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-quarantine-'));
  try {
    const key = action('machine-cutover-quarantine');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, '6');
    const legacyPath = writeLegacyJournal(workspaceRoot, key, {
      status: 'passed',
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A
    });

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    const quarantinePath = quarantineFile(stateRoot, key.actionKey);
    const quarantineBytes = readFileSync(quarantinePath, 'utf8');
    expect(receipt.targetActionCount).toBe(1);
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey))
      .toMatchObject({
        latestState: null,
        terminal: null,
        recoveryDisposition: {
          actionKey: key.actionKey,
          classification: 'legacy-terminal-missing-bound-attempt-and-owner-terminal-receipt',
          reuseDisposition: 'forbidden',
          executionDisposition: 'same-action-key-forbidden',
          legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
        }
      });
    const blocked = acquireVerificationActionClaim({
      fs: journalFs(stateRoot),
      action: key,
      ownerToken: 'must-not-execute',
      now: '2026-08-09T00:00:00.000Z'
    });
    expect(blocked).toMatchObject({
      disposition: 'blocked',
      terminal: null,
      reason: 'legacy Action is quarantined; same-ActionKey execution and reuse are forbidden'
    });
    expect(() => appendVerificationActionJournalEvent({
      fs: journalFs(stateRoot),
      action: key,
      state: 'queued',
      recordedAt: at(4)
    })).toThrow('legacy Action is quarantined');
    expect(existsSync(`${path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    )}.claim.json`)).toBe(false);

    const reused = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(reused.receiptDigest).toBe(receipt.receiptDigest);
    expect(readFileSync(quarantinePath, 'utf8')).toBe(quarantineBytes);

    const legacyBytes = readFileSync(legacyPath);
    rmSync(legacyPath);
    writeFileSync(legacyPath, legacyBytes);
    expect(() => readVerificationActionJournal(journalFs(stateRoot), key.actionKey))
      .toThrow('legacy quarantine source evidence changed');
    expect(existsSync(`${path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    )}.claim.json`)).toBe(false);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover quarantines the exact retired process terminal binding and rejects variants', () => {
  const acceptedRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-retired-process-'));
  try {
    const key = action('machine-cutover-retired-process');
    const workspaceRoot = machineWorkspaceRoot(acceptedRoot, '2');
    writeRetiredCanonicalJournal(workspaceRoot, key, {
      boundAttemptDigest: DIGEST_A,
      diagnosticObjects: [],
      executionKind: 'process',
      ownerTerminalJoinReceiptDigest: DIGEST_A,
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A,
      status: 'passed'
    });

    ensureVerificationActionMachineGlobalCutover(journalFs(acceptedRoot));
    expect(readVerificationActionJournal(journalFs(acceptedRoot), key.actionKey)).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: {
        actionKey: key.actionKey,
        reuseDisposition: 'forbidden',
        executionDisposition: 'same-action-key-forbidden',
        legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
      }
    });
  } finally {
    rmSync(acceptedRoot, { recursive: true, force: true });
  }

  const rejectedRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-retired-process-invalid-'));
  try {
    const key = action('machine-cutover-retired-process-invalid');
    const workspaceRoot = machineWorkspaceRoot(rejectedRoot, '3');
    const retiredPath = writeRetiredCanonicalJournal(workspaceRoot, key, {
      boundAttemptDigest: DIGEST_A,
      diagnosticObjects: [],
      executionKind: 'non-process',
      ownerTerminalJoinReceiptDigest: DIGEST_A,
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A,
      status: 'passed'
    });
    const retiredBytes = readFileSync(retiredPath, 'utf8');

    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(rejectedRoot)))
      .toThrow('retired legacy terminal execution binding is invalid.');
    expect(readFileSync(retiredPath, 'utf8')).toBe(retiredBytes);
    expect(existsSync(quarantineFile(rejectedRoot, key.actionKey))).toBe(false);
    expect(existsSync(path.join(
      rejectedRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
    ))).toBe(false);
  } finally {
    rmSync(rejectedRoot, { recursive: true, force: true });
  }
});

test('machine cutover quarantines only the exact retired input invalidation terminal', () => {
  const acceptedRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-retired-invalidation-'));
  try {
    const key = action('machine-cutover-retired-invalidation');
    const workspaceRoot = machineWorkspaceRoot(acceptedRoot, 'd');
    writeLegacyJournal(workspaceRoot, key, {
      status: 'invalidated',
      reasonCode: 'input-invalidated',
      resultDigest: DIGEST_A
    });
    ensureVerificationActionMachineGlobalCutover(journalFs(acceptedRoot));
    expect(readVerificationActionJournal(journalFs(acceptedRoot), key.actionKey))
      .toMatchObject({
        terminal: null,
        recoveryDisposition: {
          actionKey: key.actionKey,
          reuseDisposition: 'forbidden',
          executionDisposition: 'same-action-key-forbidden'
        }
      });
  } finally {
    rmSync(acceptedRoot, { recursive: true, force: true });
  }

  const rejectedRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-retired-invalidation-invalid-'));
  try {
    const key = action('machine-cutover-retired-invalidation-invalid');
    const workspaceRoot = machineWorkspaceRoot(rejectedRoot, 'e');
    const legacyPath = writeLegacyJournal(workspaceRoot, key, {
      status: 'invalidated',
      reasonCode: 'unrelated-reason',
      resultDigest: DIGEST_A
    });
    const legacyBytes = readFileSync(legacyPath, 'utf8');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(rejectedRoot)))
      .toThrow('legacy terminal status is invalid.');
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyBytes);
    expect(existsSync(quarantineFile(rejectedRoot, key.actionKey))).toBe(false);
  } finally {
    rmSync(rejectedRoot, { recursive: true, force: true });
  }
});

test('machine cutover quarantines only a terminal-dominated expired claim and retains both source files', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-terminal-claim-'));
  try {
    const key = action('machine-cutover-terminal-dominated-claim');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, '8');
    const legacyPath = writeLegacyJournal(workspaceRoot, key, {
      status: 'passed',
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A
    });
    const claimPath = writeLegacyClaim({
      legacyPath,
      actionKey: key.actionKey,
      ownerToken: 'preflight-fixture-passed',
      acquiredAt: '2026-08-09T12:00:00.000Z',
      expiresAt: '2026-08-09T12:01:00.000Z'
    });
    const settlementPath = writeLegacySettlementCurrent({
      workspaceRoot,
      actionKey: key.actionKey,
      state: 'settled'
    });
    const claimBytes = readFileSync(claimPath, 'utf8');

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    const readback = readVerificationActionJournal(journalFs(stateRoot), key.actionKey);
    expect(receipt).toMatchObject({ sourceRecordCount: 3, targetActionCount: 1 });
    expect(readback).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: {
        actionKey: key.actionKey,
        reuseDisposition: 'forbidden',
        executionDisposition: 'same-action-key-forbidden'
      }
    });
    expect(readback.recoveryDisposition?.sourceEvidence.map(({ path: evidencePath }) => evidencePath))
      .toEqual([
        normalizeTestInventoryPath(path.relative(stateRoot, legacyPath)),
        normalizeTestInventoryPath(path.relative(stateRoot, claimPath)),
        normalizeTestInventoryPath(path.relative(stateRoot, settlementPath))
      ]);
    expect(readFileSync(legacyPath, 'utf8')).toContain('journal-event-v2');
    expect(readFileSync(claimPath, 'utf8')).toBe(claimBytes);

    const repeated = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(repeated.receiptDigest).toBe(receipt.receiptDigest);
    expect(acquireVerificationActionClaim({
      fs: journalFs(stateRoot),
      action: key,
      ownerToken: 'must-not-reexecute',
      now: '2026-09-01T00:00:00.000Z'
    }).disposition).toBe('blocked');

    rmSync(claimPath);
    writeFileSync(claimPath, claimBytes, 'utf8');
    expect(() => readVerificationActionJournal(journalFs(stateRoot), key.actionKey))
      .toThrow('legacy quarantine source evidence changed');
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover preserves active claims and quarantines expired abandoned claims without retry', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-claim-negative-'));
  try {
    const activeKey = action('machine-cutover-active-terminal-claim');
    const activeWorkspace = machineWorkspaceRoot(stateRoot, '9');
    expect(acquireVerificationActionClaim({
      fs: journalFs(activeWorkspace),
      action: activeKey,
      ownerToken: 'active-owner',
      now: new Date(Date.now() + 60_000).toISOString(),
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    const activeLegacyPath = writeLegacyJournal(activeWorkspace, activeKey, {
      status: 'passed',
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A
    });
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow('active physical claim');
    expect(existsSync(quarantineFile(stateRoot, activeKey.actionKey))).toBe(false);

    releaseVerificationActionClaim({
      fs: journalFs(activeWorkspace),
      actionKey: activeKey.actionKey,
      ownerToken: 'active-owner'
    });
    rmSync(activeLegacyPath);

    const unterminatedKey = action('machine-cutover-unterminated-expired-claim');
    const unterminatedWorkspace = machineWorkspaceRoot(stateRoot, 'a');
    const unterminatedJournal = writeLegacyPartialJournal(
      unterminatedWorkspace,
      unterminatedKey
    );
    const expiredClaim = writeLegacyClaim({
      legacyPath: unterminatedJournal,
      actionKey: unterminatedKey.actionKey,
      ownerToken: 'expired-without-terminal',
      acquiredAt: '2026-08-09T12:00:00.000Z',
      expiresAt: '2026-08-09T12:01:00.000Z'
    });
    const journalBytes = readFileSync(unterminatedJournal, 'utf8');
    const claimBytes = readFileSync(expiredClaim, 'utf8');
    const invalidatedKey = action('machine-cutover-invalidated-expired-claim');
    const invalidatedWorkspace = machineWorkspaceRoot(stateRoot, 'b');
    const invalidatedJournal = writeLegacyPartialJournal(
      invalidatedWorkspace,
      invalidatedKey,
      ['queued', 'running', 'invalidated']
    );
    const invalidatedClaim = writeLegacyClaim({
      legacyPath: invalidatedJournal,
      actionKey: invalidatedKey.actionKey,
      ownerToken: 'expired-after-invalidation',
      acquiredAt: '2026-08-09T12:00:00.000Z',
      expiresAt: '2026-08-09T12:01:00.000Z'
    });
    const invalidatedJournalBytes = readFileSync(invalidatedJournal, 'utf8');
    const invalidatedClaimBytes = readFileSync(invalidatedClaim, 'utf8');
    const currentKey = action('machine-cutover-current-expired-claim');
    const currentWorkspace = machineWorkspaceRoot(stateRoot, 'c');
    expect(acquireVerificationActionClaim({
      fs: journalFs(currentWorkspace),
      action: currentKey,
      ownerToken: 'expired-current-owner',
      now: '2026-08-09T12:00:00.000Z',
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    appendVerificationActionJournalEvent(withStateRoot(currentWorkspace, {
      repositoryRoot: 'R:/repo', action: currentKey, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEvent(withStateRoot(currentWorkspace, {
      repositoryRoot: 'R:/repo', action: currentKey, state: 'running' as const, recordedAt: at(2)
    }));
    const currentJournal = readVerificationActionJournal(
      journalFs(currentWorkspace),
      currentKey.actionKey
    ).filePath;
    const currentClaim = `${currentJournal}.claim.json`;
    const currentJournalBytes = readFileSync(currentJournal, 'utf8');
    const currentClaimBytes = readFileSync(currentClaim, 'utf8');

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(readVerificationActionJournal(journalFs(stateRoot), unterminatedKey.actionKey))
      .toMatchObject({
        latestState: null,
        terminal: null,
        recoveryDisposition: {
          actionKey: unterminatedKey.actionKey,
          reuseDisposition: 'forbidden',
          executionDisposition: 'same-action-key-forbidden',
          legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
        }
      });
    expect(readVerificationActionJournal(journalFs(stateRoot), invalidatedKey.actionKey))
      .toMatchObject({
        latestState: null,
        terminal: null,
        recoveryDisposition: {
          actionKey: invalidatedKey.actionKey,
          reuseDisposition: 'forbidden',
          executionDisposition: 'same-action-key-forbidden'
        }
      });
    expect(readVerificationActionJournal(journalFs(stateRoot), currentKey.actionKey))
      .toMatchObject({
        latestState: null,
        terminal: null,
        recoveryDisposition: {
          actionKey: currentKey.actionKey,
          reuseDisposition: 'forbidden',
          executionDisposition: 'same-action-key-forbidden'
        }
      });
    expect(readFileSync(unterminatedJournal, 'utf8')).toBe(journalBytes);
    expect(readFileSync(expiredClaim, 'utf8')).toBe(claimBytes);
    expect(readFileSync(invalidatedJournal, 'utf8')).toBe(invalidatedJournalBytes);
    expect(readFileSync(invalidatedClaim, 'utf8')).toBe(invalidatedClaimBytes);
    expect(readFileSync(currentJournal, 'utf8')).toBe(currentJournalBytes);
    expect(readFileSync(currentClaim, 'utf8')).toBe(currentClaimBytes);
    expect(acquireVerificationActionClaim({
      fs: journalFs(stateRoot),
      action: unterminatedKey,
      ownerToken: 'must-not-retry',
      now: '2026-09-01T00:00:00.000Z'
    }).disposition).toBe('blocked');
    expect(ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)).receiptDigest)
      .toBe(receipt.receiptDigest);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover recovers an exact interrupted journal target only through negative quarantine', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-interrupted-target-'));
  try {
    const key = action('machine-cutover-interrupted-target');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, 'd');
    expect(acquireVerificationActionClaim({
      fs: journalFs(workspaceRoot),
      action: key,
      ownerToken: 'expired-interrupted-owner',
      now: '2026-08-09T12:00:00.000Z',
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    appendVerificationActionJournalEvent(withStateRoot(workspaceRoot, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEvent(withStateRoot(workspaceRoot, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(2)
    }));
    const workspaceJournal = readVerificationActionJournal(
      journalFs(workspaceRoot),
      key.actionKey
    ).filePath;
    const workspaceClaim = `${workspaceJournal}.claim.json`;
    const journalBytes = readFileSync(workspaceJournal, 'utf8');
    const claimBytes = readFileSync(workspaceClaim, 'utf8');
    const retainedMachineJournal = path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    );
    mkdirForFile(retainedMachineJournal);
    writeFileSync(retainedMachineJournal, journalBytes, 'utf8');

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey)).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: {
        actionKey: key.actionKey,
        reuseDisposition: 'forbidden',
        executionDisposition: 'same-action-key-forbidden'
      }
    });
    expect(readFileSync(retainedMachineJournal, 'utf8')).toBe(journalBytes);
    expect(readFileSync(workspaceJournal, 'utf8')).toBe(journalBytes);
    expect(readFileSync(workspaceClaim, 'utf8')).toBe(claimBytes);
    expect(acquireVerificationActionClaim({
      fs: journalFs(stateRoot),
      action: key,
      ownerToken: 'must-not-reexecute',
      now: '2026-09-01T00:00:00.000Z'
    }).disposition).toBe('blocked');
    expect(ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)).receiptDigest)
      .toBe(receipt.receiptDigest);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover quarantines divergent terminal attempts while retaining the machine journal as evidence', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-divergent-terminals-'));
  try {
    const key = action('machine-cutover-divergent-terminal-attempts');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, 'e');
    const workspaceJournal = writeRetiredCanonicalJournal(
      workspaceRoot,
      key,
      terminalForAttempt(key.actionKey, DIGEST_A, DIGEST_B)
    );
    const machineJournal = writeRetiredCanonicalJournal(
      stateRoot,
      key,
      terminalForAttempt(key.actionKey, DIGEST_B, DIGEST_A)
    );
    const workspaceBytes = readFileSync(workspaceJournal, 'utf8');
    const machineBytes = readFileSync(machineJournal, 'utf8');
    expect(workspaceBytes).not.toBe(machineBytes);

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(receipt.targetActionCount).toBe(1);
    expect(readFileSync(machineJournal, 'utf8')).toBe(machineBytes);
    expect(readFileSync(workspaceJournal, 'utf8')).toBe(workspaceBytes);
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey)).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: {
        actionKey: key.actionKey,
        reuseDisposition: 'forbidden',
        executionDisposition: 'same-action-key-forbidden',
        legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
      }
    });
    expect(acquireVerificationActionClaim({
      fs: journalFs(stateRoot),
      action: key,
      ownerToken: 'must-not-reuse-divergent-terminal',
      now: '2026-09-01T00:00:00.000Z'
    }).disposition).toBe('blocked');
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('machine cutover quarantines mixed workspace generations without inventing a retained machine target', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-mixed-workspaces-'));
  try {
    const key = action('machine-cutover-mixed-workspaces');
    const terminalWorkspace = machineWorkspaceRoot(stateRoot, '6');
    const abandonedWorkspace = machineWorkspaceRoot(stateRoot, '7');
    writeLegacyJournal(terminalWorkspace, key, terminal(key.actionKey));
    expect(acquireVerificationActionClaim({
      fs: journalFs(abandonedWorkspace),
      action: key,
      ownerToken: 'expired-mixed-owner',
      now: '2026-08-09T12:00:00.000Z',
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    appendVerificationActionJournalEvent(withStateRoot(abandonedWorkspace, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEvent(withStateRoot(abandonedWorkspace, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(2)
    }));

    const receipt = ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot));
    expect(receipt.targetActionCount).toBe(1);
    expect(readVerificationActionJournal(journalFs(stateRoot), key.actionKey)).toMatchObject({
      latestState: null,
      terminal: null,
      recoveryDisposition: {
        reuseDisposition: 'forbidden',
        executionDisposition: 'same-action-key-forbidden'
      }
    });
    expect(existsSync(path.join(
      stateRoot,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    ))).toBe(false);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('quarantine recovery rejects partial, tampered, and foreign evidence before publication', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'sec-action-machine-quarantine-invalid-'));
  try {
    const key = action('machine-cutover-quarantine-invalid');
    const workspaceRoot = machineWorkspaceRoot(stateRoot, '7');
    const legacyPath = writeLegacyJournal(workspaceRoot, key, {
      status: 'failed',
      reasonCode: 'executed-failure',
      resultDigest: DIGEST_A
    });
    const original = readFileSync(legacyPath, 'utf8');
    writeFileSync(legacyPath, original.slice(0, -20), 'utf8');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow(/partial final line|invalid JSON/);
    expect(existsSync(quarantineFile(stateRoot, key.actionKey))).toBe(false);

    writeFileSync(legacyPath, original.replace('executed-failure', 'different-failure'), 'utf8');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow('digest mismatch');
    expect(existsSync(quarantineFile(stateRoot, key.actionKey))).toBe(false);

    writeFileSync(legacyPath, original, 'utf8');
    const quarantinePath = quarantineFile(stateRoot, key.actionKey);
    mkdirForFile(quarantinePath);
    writeFileSync(quarantinePath, 'foreign\n', 'utf8');
    expect(() => ensureVerificationActionMachineGlobalCutover(journalFs(stateRoot)))
      .toThrow('legacy quarantine receipt is not valid JSON');
    expect(readFileSync(quarantinePath, 'utf8')).toBe('foreign\n');
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('legacy journal cutover is one-way, physical-bound, and normal reads use only the new grammar', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-cutover-'));
  try {
    const key = action();
    const legacyPath = writeLegacyJournal(root, key, terminal(key.actionKey));
    expect(inspectLegacyVerificationActionJournalForRecovery(journalFs(root), key.actionKey))
      .toMatchObject({ disposition: 'migratable', eventCount: 3 });
    try {
      readVerificationActionJournal(journalFs(root), key.actionKey);
      throw new Error('Expected legacy evidence to require recovery');
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationActionJournalError);
      expect((error as VerificationActionJournalError).kind).toBe('recovery-required');
    }

    const migrated = migrateLegacyVerificationActionJournalForRecovery(
      journalFs(root),
      key.actionKey
    );
    expect(migrated.latestState).toBe('terminal');
    expect(migrated.terminal?.boundAttemptDigest).toBe(DIGEST_A);
    expect(readFileSync(legacyPath, 'utf8')).toContain('journal-event-v2');
    expect(readVerificationActionJournal(journalFs(root), key.actionKey).terminal)
      .toEqual(migrated.terminal);

    const legacyBytes = readFileSync(legacyPath);
    rmSync(legacyPath);
    writeFileSync(legacyPath, legacyBytes);
    expect(() => readVerificationActionJournal(journalFs(root), key.actionKey))
      .toThrow('legacy source changed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy terminals without bound diagnostics remain typed recovery evidence and publish nothing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-unmigratable-'));
  try {
    const key = action();
    writeLegacyJournal(root, key, {
      status: 'passed',
      reasonCode: 'executed-success',
      resultDigest: DIGEST_A
    });
    expect(inspectLegacyVerificationActionJournalForRecovery(journalFs(root), key.actionKey))
      .toMatchObject({ disposition: 'preserved-unmigratable', eventCount: 3 });
    expect(() => migrateLegacyVerificationActionJournalForRecovery(
      journalFs(root),
      key.actionKey
    )).toThrow('cannot migrate without a diagnostic-bound terminal');
    expect(() => readVerificationActionJournal(journalFs(root), key.actionKey))
      .toThrow('legacy Action evidence requires explicit recovery');
    expect(existsSync(path.join(
      root,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    ))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal admission rejects a terminal carrying another Action diagnostic subject', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-cross-action-'));
  try {
    const key = action();
    appendVerificationActionJournalEvent({
      fs: journalFs(root),
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    appendVerificationActionJournalEvent({
      fs: journalFs(root),
      action: key,
      state: 'running',
      recordedAt: at(2)
    });
    expect(() => appendVerificationActionJournalEvent({
      fs: journalFs(root),
      action: key,
      state: 'terminal',
      recordedAt: at(3),
      terminal: terminalWithDiagnosticSubject(DIGEST_A)
    })).toThrow('does not bind its ActionKey');
    expect(readVerificationActionJournal(journalFs(root), key.actionKey).latestState)
      .toBe('running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy corruption and a foreign canonical target block cutover without overwriting either side', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-cutover-corrupt-'));
  try {
    const key = action();
    const legacyPath = writeLegacyJournal(root, key, terminal(key.actionKey));
    const legacyBytes = readFileSync(legacyPath, 'utf8');
    writeFileSync(legacyPath, legacyBytes.replace('"sequence":2', '"sequence":7'), 'utf8');
    expect(() => inspectLegacyVerificationActionJournalForRecovery(journalFs(root), key.actionKey))
      .toThrow(/identity mismatch|digest mismatch/);
    writeFileSync(legacyPath, legacyBytes, 'utf8');
    const targetPath = path.join(
      root,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY,
      `${key.actionKey.slice(7)}.jsonl`
    );
    mkdirForFile(targetPath);
    writeFileSync(targetPath, 'foreign\n', 'utf8');
    expect(() => migrateLegacyVerificationActionJournalForRecovery(
      journalFs(root),
      key.actionKey
    )).toThrow('canonical target exists without a cutover intent');
    expect(readFileSync(targetPath, 'utf8')).toBe('foreign\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('illegal transitions are rejected and deleting the journal returns a clean empty projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-delete-'));
  try {
    const key = action();
    expect(() => appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(1)
    }))).toThrow('must begin with queued');
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'cancelled' as const,
      recordedAt: at(2), note: 'cancelled by test'
    }));
    expect(() => appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(3)
    }))).toThrow('illegal transition');
    deleteVerificationActionJournal(journalFs(root), key.actionKey);
    expect(readVerificationActionJournal(journalFs(root), key.actionKey)).toMatchObject({
      events: [], latestState: null, terminal: null
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomic claim joins one live physical owner and rejects wrong-owner release', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-race-'));
  try {
    const key = action();
    const first = acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'owner-a', now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 60_000
    }));
    const second = acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'owner-b', now: '2026-08-09T00:00:01.000Z', leaseDurationMs: 60_000
    }));
    expect(first.disposition).toBe('acquired');
    expect(second.disposition).toBe('joined');
    expect(() => releaseVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey, ownerToken: 'owner-b'
    }))).toThrow('owner mismatch');
    expect(readVerificationActionClaim(journalFs(root), key.actionKey)?.ownerToken).toBe('owner-a');
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued',
      recordedAt: '2026-08-09T00:00:02.000Z'
    }));
    appendVerificationActionJournalEvent(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running',
      recordedAt: '2026-08-09T00:00:03.000Z'
    }));
    expect(commitVerificationActionRevocationUnderClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'owner-b',
      now: '2026-08-09T00:00:03.000Z', state: 'cancelled',
      recordedAt: '2026-08-09T00:00:03.000Z', note: 'wrong owner'
    }))).toBeNull();
    expect(readVerificationActionJournal(journalFs(root), key.actionKey).latestState).toBe('running');
    expect(commitVerificationActionRevocationUnderClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'owner-a',
      now: '2026-08-09T00:00:03.000Z', state: 'cancelled',
      recordedAt: '2026-08-09T00:00:03.000Z', note: 'owner settled failure'
    }))?.state).toBe('cancelled');
    expect(readVerificationActionClaim(journalFs(root), key.actionKey)).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('expired crash lease permanently blocks blind re-execution under the same ActionKey', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-recovery-'));
  try {
    const key = action();
    acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'crashed',
      now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 1_000
    }));
    const blocked = acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'successor', now: '2026-08-09T00:00:02.000Z', leaseDurationMs: 60_000
    }));
    const contender = acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'other', now: '2026-08-09T00:00:03.000Z', leaseDurationMs: 60_000
    }));
    expect(blocked.disposition).toBe('blocked');
    expect(blocked.reason).toContain('blind re-execution is forbidden');
    expect(contender.disposition).toBe('blocked');
    expect(readVerificationActionClaim(journalFs(root), key.actionKey)?.ownerToken).toBe('crashed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only the current owner can renew a live lease', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-renew-'));
  try {
    const key = action();
    acquireVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'owner-a',
      now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 1_000
    }));
    expect(renewVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey,
      ownerToken: 'owner-a', now: '2026-08-09T00:00:00.500Z', leaseDurationMs: 60_000
    }))).toBe(true);
    expect(renewVerificationActionClaim(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey,
      ownerToken: 'owner-b', now: '2026-08-09T00:00:01.000Z', leaseDurationMs: 60_000
    }))).toBe(false);
    expect(readVerificationActionClaim(journalFs(root), key.actionKey)?.expiresAt)
      .toBe('2026-08-09T00:01:00.500Z');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
