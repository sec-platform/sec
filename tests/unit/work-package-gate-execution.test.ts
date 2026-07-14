import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { CodexDevelopmentVerificationDigest } from '../../platform/shared/ci-evidence-contract.ts';
import type { ObservedCommandOutcome } from '../../platform/shared/observed-process.ts';
import {
  prepareWorkPackageExecutionSnapshotForTests,
  publishWorkPackageExecutionSnapshotOwnerForTests,
  removeWorkPackageExecutionSnapshotForTests,
  runWorkPackageGate,
  workPackageGateAuthorityProbeBudgetForTests,
  workPackageGateCheckpointPublicationDirectoryForTests,
  workPackageGateFailureIndexForTests,
  workPackageGateNamespaceMutexNameForTests,
  workPackageGateNamespaceStructureForTests,
  workPackageGateProbeOutcomeAcceptedForTests,
  workPackageGateProtectedPathAuthorityForTests,
  workPackageGateProtectedLedgerDigestForTests,
  workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests,
  workPackageGateRecoveryRecordAuthorityPathForTests,
  workPackageGateRecoveryRecordEntryPathForTests,
  workPackageGateTerminalCompletionAuthorityPathsForTests,
  workPackageGateTerminalOrderEntryKindForTests,
  workPackageWorktreeDigestForTests,
  type WorkPackageGateCrashStageV4,
  type WorkPackageGateDependencies,
  type WorkPackageGateOptions
} from '../../scripts/run-work-package-gate.ts';
import {
  WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4,
  WORK_PACKAGE_GATE_RUN_DIRECTORY_V4,
  assertWorkPackageGateEvidenceBundleV4,
  assertWorkPackageGateEvidenceV4,
  finalizeWorkPackageGateEventV4,
  type WorkPackageGateChildEvidenceV1,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const worktree = `sha256:${'c'.repeat(64)}`;
const emptyDigest: `sha256:${string}` = `sha256:${'e'.repeat(64)}`;
const v4Options: WorkPackageGateOptions = Object.freeze({
  manifestPath: 'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md',
  selectionManifestPath: 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md',
  selectionIndex: 0,
  watchdogMs: 1_800_000,
  cleanupMs: 120_000,
  runDir: WORK_PACKAGE_GATE_RUN_DIRECTORY_V4
});
const v4RunDir = path.join(repoRoot, ...WORK_PACKAGE_GATE_RUN_DIRECTORY_V4.split('/'));
const v4PendingDir = workPackageGateCheckpointPublicationDirectoryForTests(repoRoot, v4RunDir);

test('Windows namespace mutex is global across interactive and service sessions', () => {
  expect(workPackageGateNamespaceMutexNameForTests(v4RunDir))
    .toMatch(/^Global\\sec-work-package-gate-[0-9a-f]{32}-owned$/u);
});

const fakeProtectedPathAuthority = Object.freeze([
  ['.tmp/sm3-r2-work-package-gate', true],
  ['.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned', true],
  ['.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned.owner-v1.json', true],
  [
    '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned/' +
      '.tmp/test-workspaces/gate-d4ecb7717e828f3111ae866fa084e957-owned',
    true
  ],
  ['.tmp/sm3-r3-work-package-gate', false],
  ['.tmp/sm3-r3-v2-work-package-gate', false],
  ['.tmp/sm3-r3-v3-work-package-gate', false],
  ['.tmp/test-workspaces', true]
].map(([relativePath, required]) => Object.freeze({
  path: path.join(repoRoot, ...(relativePath as string).split('/')),
  required: required as boolean
})));

async function cleanV4Publications(): Promise<void> {
  await rm(v4RunDir, { recursive: true, force: true });
  await rm(v4PendingDir, { recursive: true, force: true });
}

beforeEach(cleanV4Publications);
afterEach(cleanV4Publications);

function revision(value: string): string {
  const result = spawnSync('git', ['rev-parse', value], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

test('execution snapshot materializes the exact dirty tree in a detached worktree', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-${randomUUID()}`
  );
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
    expect(await readFile(path.join(snapshotRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'))
      .toBe(await readFile(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'));
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot recovery reclaims an owned registered partial worktree', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-recovery-${randomUUID()}`
  );
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    await publishWorkPackageExecutionSnapshotOwnerForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    );
    expect(spawnSync('git', ['worktree', 'add', '--detach', snapshotRoot, revision('HEAD')], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }).status).toBe(0);
    await writeFile(path.join(snapshotRoot, 'partial-publication.txt'), 'partial', 'utf8');
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
    await expect(readFile(path.join(snapshotRoot, 'partial-publication.txt'), 'utf8')).rejects.toThrow();
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot recovery preserves foreign directory and registered worktree', async () => {
  const roots = [
    path.join(repoRoot, '.tmp', 'gate-execution-snapshots', `foreign-dir-${randomUUID()}`),
    path.join(repoRoot, '.tmp', 'gate-execution-snapshots', `foreign-worktree-${randomUUID()}`)
  ];
  try {
    await mkdir(roots[0]!, { recursive: true });
    await writeFile(path.join(roots[0]!, 'keep.txt'), 'preserve', 'utf8');
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      roots[0]!,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
    expect(await readFile(path.join(roots[0]!, 'keep.txt'), 'utf8')).toBe('preserve');

    expect(spawnSync('git', ['worktree', 'add', '--detach', roots[1]!, revision('HEAD')], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }).status).toBe(0);
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      roots[1]!,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', roots[1]!], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

function outcome(overrides: Partial<ObservedCommandOutcome> = {}): ObservedCommandOutcome {
  return {
    status: 'exited',
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 10,
    stdout: { bytes: 0, digest: emptyDigest, observerTruncated: false },
    stderr: { bytes: 0, digest: emptyDigest, observerTruncated: false },
    termination: {
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    },
    ...overrides
  };
}

function childEvidence(observed: ObservedCommandOutcome): WorkPackageGateChildEvidenceV1 {
  return Object.freeze({
    status: observed.status,
    trigger: observed.trigger ?? null,
    started: observed.started,
    exitCode: observed.exitCode,
    signal: observed.signal,
    durationMs: observed.durationMs,
    stdout: observed.stdout,
    stderr: observed.stderr,
    termination: observed.termination
  });
}

test('authority probes fail closed on stderr, truncation, deadline, and exhausted cleanup budget', () => {
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome())).toBe(true);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
    stderr: { bytes: 1, digest: emptyDigest, observerTruncated: false }
  }))).toBe(false);
  for (const stream of ['stdout', 'stderr'] as const) {
    expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
      [stream]: { bytes: 0, digest: emptyDigest, observerTruncated: true }
    }))).toBe(false);
  }
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome(), 100, 100)).toBe(false);
  expect(workPackageGateAuthorityProbeBudgetForTests(2)).toBeNull();
  expect(workPackageGateAuthorityProbeBudgetForTests(1_000)).toEqual({
    timeoutMs: 750,
    terminationDeadlineMs: 250,
    terminationGraceMs: 250
  });
  const capped = workPackageGateAuthorityProbeBudgetForTests(30_000)!;
  expect(capped.timeoutMs + capped.terminationDeadlineMs).toBe(30_000);
  expect(capped.terminationGraceMs).toBe(5_000);
});

test('R2 sidecar and terminal completion authority are bound to exact frozen values and paths', () => {
  const frozenOwner = Object.freeze({
    headSha: 'f29ecb73ac64aaae23b7989688c4a3ca79593d43',
    treeSha: 'dcdc37f6353a61a6770f930c54a25c22200a8829',
    worktreeDigest: 'sha256:6468cf74715c883051ce85bab5d2fd8bbad8e170d73efc48225cb906fb93740c'
  });
  expect(workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests(frozenOwner)).toBe(true);
  for (const key of ['headSha', 'treeSha', 'worktreeDigest'] as const) {
    expect(workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests({
      ...frozenOwner,
      [key]: key === 'worktreeDigest' ? `sha256:${'0'.repeat(64)}` : '0'.repeat(40)
    })).toBe(false);
  }

  const transactionRoot = path.join(
    repoRoot,
    '.tmp',
    'workspace',
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'a'.repeat(64)
  );
  const terminalOrder = path.join(
    repoRoot,
    '.tmp',
    'workspace',
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order'
  );
  expect(workPackageGateTerminalCompletionAuthorityPathsForTests(transactionRoot, 42)).toEqual([
    terminalOrder,
    path.join(terminalOrder, '000000000042.json'),
    path.join(terminalOrder, '.sequence-head.json')
  ]);
  expect(() => workPackageGateTerminalCompletionAuthorityPathsForTests(transactionRoot, 0)).toThrow(
    'terminal sequence'
  );
  expect(workPackageGateRecoveryRecordAuthorityPathForTests(
    transactionRoot,
    7,
    'rolled-back'
  )).toBe(path.join(transactionRoot, 'records', '000007-rolled-back.json'));
  expect(workPackageGateRecoveryRecordAuthorityPathForTests(
    transactionRoot,
    1_000_000,
    'verified'
  )).toBe(path.join(transactionRoot, 'records', '1000000-verified.json'));
  expect(workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '1000000-verified.json'
  )).toBe(path.join(transactionRoot, 'records', '1000000-verified.json'));
  expect(() => workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '01000000-verified.json'
  )).toThrow('noncanonical');
  expect(() => workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '.generation.tmp'
  )).toThrow('unknown entry');
  expect(workPackageGateTerminalOrderEntryKindForTests('.sequence-head.json')).toBe('sequence-head');
  expect(workPackageGateTerminalOrderEntryKindForTests('000000000002.json')).toBe('receipt');
  expect(() => workPackageGateTerminalOrderEntryKindForTests('.completion.tmp')).toThrow('unknown entry');
});

test('production collector binds retained recovery generations and their terminal receipts', async () => {
  const authority = await workPackageGateProtectedPathAuthorityForTests(repoRoot);
  const required = new Set(authority.filter((entry) => entry.required).map((entry) => path.resolve(entry.path)));
  const retainedWorkspace = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    'gate-d4ecb7717e828f3111ae866fa084e957-owned',
    '.tmp',
    'test-workspaces',
    'gate-d4ecb7717e828f3111ae866fa084e957-owned',
    'engineering-compiler-sm3-terminal-retention-fSCj2d'
  );
  const recoveryTransaction = path.join(
    retainedWorkspace,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'e16b6426e3e9f84bea8c592c447a623f9f0029a2e1ada2c33f160e7b27f0536d'
  );
  const terminalOrder = path.join(
    retainedWorkspace,
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order'
  );
  expect(required.has(path.join(recoveryTransaction, 'records', '000003-verified.json'))).toBe(true);
  expect(required.has(path.join(terminalOrder, '000000000002.json'))).toBe(true);
  expect(required.has(path.join(terminalOrder, '.sequence-head.json'))).toBe(true);
});

function identitySet(values: readonly string[]) {
  const canonical = [...new Set(values)].sort();
  return Object.freeze({ count: canonical.length, digest: CodexDevelopmentVerificationDigest(canonical) });
}

function census(input: {
  readonly reason?: 'observed' | 'namespace-absent';
  readonly workspaceRoots?: number;
  readonly recoveryOwners?: number;
  readonly pendingOwners?: number;
  readonly nativeResults?: number;
  readonly writerLeases?: number;
  readonly authorities?: readonly string[];
  readonly acl?: 'empty' | 'unknown';
} = {}): WorkPackageGateResidueCensusV4 {
  const reason = input.reason ?? 'observed';
  const authorities = input.authorities ?? [];
  const empty = identitySet([]);
  return Object.freeze({
    structure: Object.freeze({
      complete: true,
      reason,
      counts: Object.freeze({
        workspaceRoots: input.workspaceRoots ?? 0,
        recoveryOwners: input.recoveryOwners ?? 0,
        pendingOwners: input.pendingOwners ?? 0,
        nativeResults: input.nativeResults ?? 0,
        writerLeases: input.writerLeases ?? 0
      }),
      recoveryAuthorities: identitySet(authorities)
    }),
    aclPresentOwners: input.acl === 'unknown'
      ? Object.freeze({ complete: false, reason: 'host-tool-failed', identities: null })
      : Object.freeze({
        complete: true,
        reason: reason === 'namespace-absent' ? 'namespace-absent' : 'observed',
        identities: empty
      })
  });
}

const absentCensus = census({ reason: 'namespace-absent' });
const cleanCensus = census();

interface GateCounters {
  child: number;
  census: number;
  recovery: number;
  namespaceRemoval: number;
  snapshotRemoval: number;
  snapshotPreparation: number;
}

function fakeDependencies(input: {
  readonly censuses?: readonly WorkPackageGateResidueCensusV4[];
  readonly child?: ObservedCommandOutcome;
  readonly childOutput?: readonly { readonly stream: 'stdout' | 'stderr'; readonly bytes: Uint8Array }[];
  readonly recovery?: 'not-needed' | 'completed' | 'failed';
  readonly crashStage?: WorkPackageGateCrashStageV4;
} = {}): { readonly overrides: Partial<WorkPackageGateDependencies>; readonly counters: GateCounters } {
  const counters: GateCounters = {
    child: 0,
    census: 0,
    recovery: 0,
    namespaceRemoval: 0,
    snapshotRemoval: 0,
    snapshotPreparation: 0
  };
  const censuses = input.censuses ?? [absentCensus, cleanCensus, cleanCensus, absentCensus];
  let censusIndex = 0;
  let now = 0;
  const overrides: Partial<WorkPackageGateDependencies> = {
    protectedPathAuthority: async () => fakeProtectedPathAuthority,
    gitRevision: (_root, value) => value === 'HEAD' ? head : tree,
    worktreeDigest: async () => worktree,
    prepareExecutionSnapshot: async () => {
      counters.snapshotPreparation += 1;
      return worktree;
    },
    removeExecutionSnapshot: async () => {
      counters.snapshotRemoval += 1;
      return true;
    },
    runChild: async (_command, _args, options) => {
      counters.child += 1;
      for (const output of input.childOutput ?? []) options.onOutput?.(output.stream, output.bytes);
      return input.child ?? outcome();
    },
    census: async () => {
      counters.census += 1;
      const value = censuses[Math.min(censusIndex, censuses.length - 1)];
      censusIndex += 1;
      if (!value) throw new Error('missing fake census');
      return value;
    },
    sideEffectCensus: async (stage) => {
      counters.census += 1;
      const logicalIndex = stage === 'child' ? 0 : stage === 'recovery' ? 1 :
        stage === 'namespace-removal' ? 2 : 3;
      const value = censuses[Math.min(logicalIndex, censuses.length - 1)];
      if (!value) throw new Error('missing fake side-effect census');
      return value;
    },
    recoverOwnedNamespace: async () => {
      counters.recovery += 1;
      return input.recovery ?? 'completed';
    },
    removeNamespace: async () => {
      counters.namespaceRemoval += 1;
      return true;
    },
    wallClock: () => new Date('2026-07-14T00:00:00.000Z'),
    monotonicNowMs: () => ++now,
    afterCheckpoint: async (stage) => {
      if (stage === input.crashStage) throw new Error(`synthetic crash: ${stage}`);
    }
  };
  return { overrides, counters };
}

function rawJsonDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

async function ownerRecords(workspaceRoot: string, transactionRoot: string): Promise<{
  readonly recovery: Readonly<Record<string, unknown>>;
  readonly provisional: Readonly<Record<string, unknown>>;
}> {
  const stagingRoot = path.join(transactionRoot, 'workspace');
  const workspaceCanonical = await realpath(workspaceRoot);
  const workspaceMetadata = await stat(workspaceCanonical);
  const workspaceIdentityDigest = rawJsonDigest({
    domain: 'workspace-write-lease-workspace-identity-v1',
    canonical: workspaceCanonical,
    dev: String(workspaceMetadata.dev),
    ino: String(workspaceMetadata.ino)
  });
  const stagingCanonical = await realpath(stagingRoot);
  const stagingMetadata = await lstat(stagingRoot);
  const foldedStaging = process.platform === 'win32'
    ? path.resolve(stagingCanonical).toLocaleLowerCase('en-US')
    : path.resolve(stagingCanonical);
  const stagingIdentityDigest = rawJsonDigest({
    domain: 'windows-appcontainer-staging-identity-v1',
    canonical: foldedStaging,
    dev: String(stagingMetadata.dev),
    ino: String(stagingMetadata.ino)
  });
  const rootDigest = rawJsonDigest({
    domain: 'windows-appcontainer-staging-path-v1',
    path: foldedStaging
  }).slice(7, 19);
  const identityDigest = rawJsonDigest({
    domain: 'windows-appcontainer-profile-identity-v1',
    stagingIdentityDigest
  }).slice(7, 31);
  const appContainerName = `sec.sm3.${rootDigest}.${identityDigest}`;
  return Object.freeze({
    recovery: Object.freeze({
      formatVersion: 'windows-appcontainer-recovery-owner-v1',
      workspaceIdentityDigest,
      stagingIdentityDigest,
      stagingDirectoryName: 'workspace',
      runtimeRelativePath: '.sm3r',
      resultFileName: '.semantic-mutation-appcontainer-result-v1.json',
      appContainerName,
      appContainerSid: 'S-1-15-2-1-2-3-4-5-6-7'
    }),
    provisional: Object.freeze({
      formatVersion: 'windows-appcontainer-provisional-owner-v1',
      workspaceIdentityDigest,
      stagingIdentityDigest,
      stagingDirectoryName: 'workspace',
      hostBunConfigRelativePath: '.sm3h',
      appContainerName
    })
  });
}

test('diagnostic parser is stream-local, raw-byte bounded, and fail closed', () => {
  const files = ['tests/unit/alpha.test.ts', 'tests/unit/beta.test.ts'];
  const failed = childEvidence(outcome({ status: 'exited', exitCode: 1 }));
  const actionable = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.' },
    { stream: 'stdout', chunk: 'test.ts:\r\n\u001b[31m  (fail) case\u001b[0m' }
  ], failed);
  expect(actionable).toMatchObject({
    status: 'actionable',
    selectionIndexes: [0],
    failureMarkerCount: 1,
    unmappedMarkerCount: 0
  });

  const crossStream = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.test.ts\n' },
    { stream: 'stderr', chunk: '(fail) cross stream\n' }
  ], failed);
  expect(crossStream).toMatchObject({ status: 'non-actionable', unmappedMarkerCount: 1 });

  for (const invalid of [
    [{ stream: 'stdout' as const, chunk: new Uint8Array([0xc3, 0x28, 0x0a]) }],
    [{ stream: 'stdout' as const, chunk: '\u001b[2J(fail) invalid ANSI\n' }],
    [{ stream: 'stdout' as const, chunk: `${'x'.repeat(8 * 1024 + 1)}\n` }],
    [{ stream: 'stdout' as const, chunk: 'tests/unit/alpha.test.ts\n(failure) malformed\n' }]
  ]) {
    expect(workPackageGateFailureIndexForTests(files, invalid, failed).status).toBe('non-actionable');
  }
  const reset = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.test.ts\nC:\\repo\\tests\\unit\\beta.test.ts\n(fail) reset\n' }
  ], failed);
  expect(reset.unmappedMarkerCount).toBe(1);
  const truncated = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: new Uint8Array(1024 * 1024 + 1) }
  ], failed);
  expect(truncated.observerTruncated).toBe(true);
  expect(truncated.status).toBe('non-actionable');
});

test('namespace scanner authorizes only canonical bound owner records and rejects ambiguous files', async () => {
  const namespaceRoot = path.join(repoRoot, '.tmp', `synthetic-owner-census-${randomUUID()}`);
  const workspaceRoot = path.join(namespaceRoot, 'workspace-a');
  const transactionRoot = path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'a'.repeat(64)
  );
  const stagingRoot = path.join(transactionRoot, 'workspace');
  const recoveryName = '.semantic-mutation-appcontainer-owner-v1.json';
  const provisionalName = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
  try {
    await mkdir(stagingRoot, { recursive: true });
    const records = await ownerRecords(workspaceRoot, transactionRoot);
    for (const [name, record, expected] of [
      [recoveryName, records.recovery, { recoveryOwners: 1, pendingOwners: 0 }],
      [`${recoveryName}.pending-v1`, records.recovery, { recoveryOwners: 0, pendingOwners: 1 }],
      [provisionalName, records.provisional, { recoveryOwners: 0, pendingOwners: 1 }],
      [`${provisionalName}.pending-v1`, records.provisional, { recoveryOwners: 0, pendingOwners: 1 }]
    ] as const) {
      const marker = path.join(transactionRoot, name);
      await writeFile(marker, JSON.stringify(record), 'utf8');
      const scanned = await workPackageGateNamespaceStructureForTests(namespaceRoot);
      expect(scanned.counts).toMatchObject(expected);
      expect(scanned.recoveryAuthorityIdentities).toHaveLength(1);
      await rm(marker, { force: true });
    }

    const malformed = path.join(transactionRoot, recoveryName);
    await writeFile(malformed, '{}', 'utf8');
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot))
      .rejects.toThrow('owner schema');
    await rm(malformed, { force: true });

    const source = path.join(transactionRoot, 'owner-source.json');
    await writeFile(source, JSON.stringify(records.recovery), 'utf8');
    await link(source, malformed);
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot))
      .rejects.toThrow(/identity|regular file/);
  } finally {
    await rm(namespaceRoot, { recursive: true, force: true });
  }
});

test('public runner accepts only exact V4 manifest and run identity before child launch', async () => {
  for (const invalid of [
    { ...v4Options, manifestPath: 'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md' },
    { ...v4Options, runDir: '.tmp/sm3-r3-work-package-gate' },
    { ...v4Options, runDir: '.tmp/sm3-r3-v2-work-package-gate' },
    { ...v4Options, runDir: '.tmp/sm3-r3-v3-work-package-gate' }
  ]) {
    const { overrides, counters } = fakeDependencies();
    await expect(runWorkPackageGate(invalid, overrides)).rejects.toThrow('exact V4 authority');
    expect(counters.child).toBe(0);
  }
});

test('protected ledger drift stops before checkpoint publication and child launch', async () => {
  const { overrides, counters } = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, {
    ...overrides,
    readBytes: async (filePath) => filePath.endsWith('sm3-r2-bounded-runtime-gate-v1.md')
      ? Buffer.from('drift')
      : readFile(filePath)
  })).rejects.toThrow('protected ledger drifted');
  expect(counters.child).toBe(0);
  await expect(readFile(path.join(v4RunDir, 'checkpoint.json'), 'utf8')).rejects.toThrow();
});

test('custody ledger canonicalizes checkout CRLF while local artifacts remain byte-exact', async () => {
  const custodyPath = 'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json';
  const checkoutBytes = await readFile(path.join(repoRoot, ...custodyPath.split('/')));
  expect(workPackageGateProtectedLedgerDigestForTests('custody', checkoutBytes))
    .toBe(WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4[custodyPath]);

  const lf = Buffer.from('first\nsecond\n', 'utf8');
  const crlf = Buffer.from('first\r\nsecond\r\n', 'utf8');
  expect(workPackageGateProtectedLedgerDigestForTests('custody', crlf))
    .toBe(workPackageGateProtectedLedgerDigestForTests('custody', lf));
  expect(workPackageGateProtectedLedgerDigestForTests('custody', Buffer.from('first\nchanged\n', 'utf8')))
    .not.toBe(workPackageGateProtectedLedgerDigestForTests('custody', lf));
  expect(workPackageGateProtectedLedgerDigestForTests('local-artifact', crlf))
    .not.toBe(workPackageGateProtectedLedgerDigestForTests('local-artifact', lf));
});

test('dynamic protected authority additions are fatal after consuming the attempt and suppressing the side effect', async () => {
  const { overrides, counters } = fakeDependencies();
  let collections = 0;
  await expect(runWorkPackageGate(v4Options, {
    ...overrides,
    protectedPathAuthority: async () => {
      collections += 1;
      return collections === 1
        ? fakeProtectedPathAuthority
        : Object.freeze([
          ...fakeProtectedPathAuthority,
          Object.freeze({
            path: path.join(repoRoot, '.tmp', 'synthetic-new-protected-record.json'),
            required: false
          })
        ]);
    }
  })).rejects.toThrow('protected path authority changed');
  expect(collections).toBeGreaterThanOrEqual(2);
  expect(counters).toMatchObject({
    child: 0,
    recovery: 0,
    namespaceRemoval: 0,
    snapshotRemoval: 0,
    snapshotPreparation: 0
  });
});

test('post-attempt authority drift is fatal and suppresses child launch and namespace deletion', async () => {
  for (const stage of ['child-attempted', 'namespace-removal-attempted'] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    let drifted = false;
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      protectedPathAuthority: async () => drifted
        ? Object.freeze([
          ...fakeProtectedPathAuthority,
          Object.freeze({
            path: path.join(repoRoot, '.tmp', `synthetic-${stage}-protected-record.json`),
            required: false
          })
        ])
        : fakeProtectedPathAuthority,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) drifted = true;
      }
    })).rejects.toThrow('protected path authority changed');
    if (stage === 'child-attempted') expect(fake.counters.child).toBe(0);
    if (stage === 'namespace-removal-attempted') expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }
});

test('post-attempt ACL disposition drift does not block owned recovery or authorized deletion', async () => {
  const owner = 'recovery-owner:workspace/.sec/transaction';
  const fake = fakeDependencies({
    censuses: [
      absentCensus,
      census({ recoveryOwners: 1, authorities: [owner], acl: 'unknown' }),
      cleanCensus,
      absentCensus
    ],
    recovery: 'completed'
  });
  const defaultSideEffectCensus = fake.overrides.sideEffectCensus!;
  const result = await runWorkPackageGate(v4Options, {
    ...fake.overrides,
    sideEffectCensus: async (stage, namespaceRoot, deadlineAtMs, probeAcl) => {
      if (stage === 'recovery') {
        return census({ recoveryOwners: 1, authorities: [owner] });
      }
      if (stage === 'namespace-removal') return census({ acl: 'unknown' });
      return defaultSideEffectCensus(stage, namespaceRoot, deadlineAtMs, probeAcl);
    }
  });
  expect(result.evidence.status).toBe('passed');
  expect(fake.counters.recovery).toBe(1);
  expect(fake.counters.namespaceRemoval).toBe(1);
});

test('post-attempt run directory drift is fatal and never overwritten by stale checkpoint state', async () => {
  const fake = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, {
    ...fake.overrides,
    afterCheckpoint: async (stage) => {
      if (stage === 'child-attempted') {
        await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
      }
    }
  })).rejects.toThrow('foreign content');
  expect(fake.counters.child).toBe(0);
  expect(await readFile(path.join(v4RunDir, 'foreign.txt'), 'utf8')).toBe('foreign');
});

test('post-attempt candidate namespace drift suppresses child launch and pending-publication drift is fatal', async () => {
  for (const drift of ['namespace-census', 'pending-publication'] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    const defaultSideEffectCensus = fake.overrides.sideEffectCensus!;
    const running = runWorkPackageGate(v4Options, {
      ...fake.overrides,
      sideEffectCensus: async (stage, namespaceRoot, deadlineAtMs, probeAcl) =>
        drift === 'namespace-census' && stage === 'child'
          ? census({ nativeResults: 1 })
          : defaultSideEffectCensus(stage, namespaceRoot, deadlineAtMs, probeAcl),
      afterCheckpoint: async (stage) => {
        if (drift === 'pending-publication' && stage === 'child-attempted') {
          await mkdir(v4PendingDir, { recursive: true });
        }
      }
    });
    if (drift === 'pending-publication') {
      await expect(running).rejects.toThrow('pending checkpoint publication reappeared');
    } else {
      expect((await running).evidence.status).toBe('unknown');
    }
    expect(fake.counters.child).toBe(0);
  }
});

test('post-attempt run directory drift is fatal during terminal publications', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) {
          await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
        }
      }
    })).rejects.toThrow('foreign content');
    expect(fake.counters.child).toBe(1);
    expect(await readFile(path.join(v4RunDir, 'foreign.txt'), 'utf8')).toBe('foreign');
  }
});

test('post-attempt pending publication drift is fatal during terminal publications', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) {
          await mkdir(v4PendingDir, { recursive: true });
        }
      }
    })).rejects.toThrow('pending checkpoint publication reappeared');
    expect(fake.counters.child).toBe(1);
    expect(await lstat(v4PendingDir)).toBeDefined();
  }
});

test('publication replay revalidates authority before completing the durable terminal journal attempt', async () => {
  const crashed = fakeDependencies({ crashStage: 'completed-event-publication-attempted' });
  await expect(runWorkPackageGate(v4Options, crashed.overrides))
    .rejects.toThrow('synthetic crash: completed-event-publication-attempted');
  const journalBeforeResume = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
  expect(journalBeforeResume).not.toContain('"kind":"completed"');
  await mkdir(v4PendingDir, { recursive: true });

  await expect(runWorkPackageGate(v4Options, {
    ...crashed.overrides,
    afterCheckpoint: async () => undefined
  })).rejects.toThrow('pending checkpoint publication reappeared');
  expect(await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8')).toBe(journalBeforeResume);
  expect(await Bun.file(path.join(v4RunDir, 'evidence.json')).exists()).toBe(false);
  expect(crashed.counters.child).toBe(1);
});

test('advanced pending checkpoint cannot be adopted as an initial publication', async () => {
  const completed = fakeDependencies();
  await runWorkPackageGate(v4Options, completed.overrides);
  const advanced = await readFile(path.join(v4RunDir, 'checkpoint.json'), 'utf8');
  await cleanV4Publications();
  await mkdir(v4PendingDir, { recursive: true });
  await writeFile(path.join(v4PendingDir, 'checkpoint.json'), advanced, 'utf8');

  const fresh = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, fresh.overrides))
    .rejects.toThrow('exact initial publication');
  expect(fresh.counters.child).toBe(0);
});

test('existing run directory rejects foreign content and journal subject drift before side effects', async () => {
  {
    const fake = fakeDependencies({ crashStage: 'snapshot-preparation-attempted' });
    await expect(runWorkPackageGate(v4Options, fake.overrides))
      .rejects.toThrow('synthetic crash: snapshot-preparation-attempted');
    await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('foreign content');
    expect(fake.counters.child).toBe(0);
    expect(fake.counters.recovery).toBe(0);
    expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }

  await cleanV4Publications();
  const fake = fakeDependencies({ crashStage: 'snapshot-preparation-attempted' });
  await expect(runWorkPackageGate(v4Options, fake.overrides))
    .rejects.toThrow('synthetic crash: snapshot-preparation-attempted');
  const checkpointPath = path.join(v4RunDir, 'checkpoint.json');
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as Record<string, any>;
  const original = checkpoint.journal.events[0];
  const tampered = finalizeWorkPackageGateEventV4({
    sequence: original.sequence,
    kind: original.kind,
    elapsedMs: original.elapsedMs,
    phase: original.phase,
    stdoutBytes: original.stdoutBytes,
    stderrBytes: original.stderrBytes,
    subject: { tampered: true },
    previousDigest: original.previousDigest
  });
  checkpoint.journal.events = [tampered];
  checkpoint.journal.digest = tampered.eventDigest;
  const { checkpointDigest: _checkpointDigest, ...draft } = checkpoint;
  checkpoint.checkpointDigest = CodexDevelopmentVerificationDigest(draft);
  await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8');
  await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('canonical state prefix');
  expect(fake.counters.child).toBe(0);
  expect(fake.counters.recovery).toBe(0);
  expect(fake.counters.namespaceRemoval).toBe(0);
  expect(fake.counters.snapshotRemoval).toBe(0);
});

test('V4 pass evidence is exact, replayable, and never launches a second child', async () => {
  const fake = fakeDependencies();
  const first = await runWorkPackageGate(v4Options, fake.overrides);
  expect(first.evidence.schema).toBe('codex-work-package-gate-evidence-v4');
  expect(first.evidence.status).toBe('passed');
  expect(fake.counters).toMatchObject({
    child: 1,
    recovery: 0,
    namespaceRemoval: 1,
    snapshotRemoval: 1
  });
  expect(() => assertWorkPackageGateEvidenceV4(first.evidence)).not.toThrow();
  const journalSource = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
  expect(() => assertWorkPackageGateEvidenceBundleV4({
    evidence: first.evidence,
    journalSource
  })).not.toThrow();

  const second = await runWorkPackageGate(v4Options, fake.overrides);
  expect(second.evidence.evidenceDigest).toBe(first.evidence.evidenceDigest);
  expect(fake.counters.child).toBe(1);
  expect(fake.counters.namespaceRemoval).toBe(1);
  expect(fake.counters.snapshotRemoval).toBe(1);
});

test('four owner kinds alone authorize one recovery; ACL unknown does not block it', async () => {
  for (const [kind, recoveryOwners, pendingOwners] of [
    ['recovery-owner', 1, 0],
    ['recovery-owner-pending', 0, 1],
    ['provisional-owner', 0, 1],
    ['provisional-owner-pending', 0, 1]
  ] as const) {
    await cleanV4Publications();
    const authority = `${kind}:workspace/.sec/transaction`;
    const fake = fakeDependencies({
      censuses: [
        absentCensus,
        census({ recoveryOwners, pendingOwners, authorities: [authority], acl: 'unknown' }),
        census({ acl: 'unknown' }),
        absentCensus
      ],
      recovery: 'completed'
    });
    const result = await runWorkPackageGate(v4Options, fake.overrides);
    expect(result.evidence.status).toBe('passed');
    expect(result.evidence.recovery.authorization).toEqual(identitySet([authority]));
    expect(fake.counters.recovery).toBe(1);
    expect(fake.counters.namespaceRemoval).toBe(1);
  }
});

test('native result or lease residue never authorizes recovery or deletion', async () => {
  for (const residue of [census({ nativeResults: 1 }), census({ writerLeases: 1 })]) {
    await cleanV4Publications();
    const fake = fakeDependencies({ censuses: [absentCensus, residue, residue] });
    const result = await runWorkPackageGate(v4Options, fake.overrides);
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.recovery.reason).toBe('not-needed');
    expect(fake.counters.recovery).toBe(0);
    expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }
});

test('status algebra distinguishes actionable failure, non-actionable exit, and timeout', async () => {
  const failureBytes = Buffer.from('tests/unit/semantic-mutation.test.ts\n(fail) deterministic\n');
  const actionable = fakeDependencies({
    child: outcome({
      status: 'exited',
      exitCode: 1,
      stdout: {
        bytes: failureBytes.byteLength,
        digest: `sha256:${createHash('sha256').update(failureBytes).digest('hex')}`,
        observerTruncated: false
      }
    }),
    childOutput: [{ stream: 'stdout', bytes: failureBytes }]
  });
  expect((await runWorkPackageGate(v4Options, actionable.overrides)).evidence.status).toBe('failed');

  await cleanV4Publications();
  const nonActionable = fakeDependencies({ child: outcome({ status: 'exited', exitCode: 1 }) });
  expect((await runWorkPackageGate(v4Options, nonActionable.overrides)).evidence.status).toBe('unknown');

  await cleanV4Publications();
  const timedOut = fakeDependencies({
    child: outcome({
      status: 'timed-out',
      trigger: 'timed-out',
      exitCode: null,
      termination: {
        requested: true,
        gracefulAttempted: true,
        forcedAttempted: true,
        childCloseObserved: true,
        streamsDrained: true,
        treeClosed: true
      }
    })
  });
  expect((await runWorkPackageGate(v4Options, timedOut.overrides)).evidence.status).toBe('timed-out');
});

test('unknown-result side-effect attempt bits are never replayed', async () => {
  for (const stage of [
    'child-attempted',
    'recovery-attempted',
    'namespace-removal-attempted',
    'snapshot-removal-attempted'
  ] as const) {
    await cleanV4Publications();
    const owner = 'recovery-owner:workspace/.sec/transaction';
    const fake = fakeDependencies({
      censuses: [
        absentCensus,
        census({ recoveryOwners: 1, authorities: [owner] }),
        cleanCensus,
        absentCensus
      ],
      recovery: 'completed',
      crashStage: stage
    });
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow(`synthetic crash: ${stage}`);
    const countsAfterCrash = { ...fake.counters };
    const resumed = await runWorkPackageGate(v4Options, fake.overrides);
    expect(resumed.evidence.status).toBe('unknown');
    if (stage === 'child-attempted') expect(fake.counters.child).toBe(0);
    else expect(fake.counters.child).toBe(countsAfterCrash.child);
    if (stage === 'recovery-attempted') expect(fake.counters.recovery).toBe(0);
    else expect(fake.counters.recovery).toBe(countsAfterCrash.recovery);
    if (stage === 'namespace-removal-attempted') expect(fake.counters.namespaceRemoval).toBe(0);
    else expect(fake.counters.namespaceRemoval).toBe(countsAfterCrash.namespaceRemoval);
    if (stage === 'snapshot-removal-attempted') expect(fake.counters.snapshotRemoval).toBe(0);
    else expect(fake.counters.snapshotRemoval).toBe(countsAfterCrash.snapshotRemoval);
  }
});

test('checkpoint-bound completed event and evidence publications resume exact bytes only', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies({ crashStage: stage });
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow(`synthetic crash: ${stage}`);
    const childCalls = fake.counters.child;
    const resumed = await runWorkPackageGate(v4Options, fake.overrides);
    expect(resumed.evidence.status).toBe('passed');
    expect(fake.counters.child).toBe(childCalls);
    const journalSource = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
    expect(() => assertWorkPackageGateEvidenceBundleV4({
      evidence: resumed.evidence,
      journalSource
    })).not.toThrow();
  }
});

test('publication replay rejects non-exact evidence bytes without rerunning child', async () => {
  const fake = fakeDependencies();
  await runWorkPackageGate(v4Options, fake.overrides);
  await writeFile(path.join(v4RunDir, 'evidence.json'), '{"tampered":true}', 'utf8');
  await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('evidence bytes');
  expect(fake.counters.child).toBe(1);
});
