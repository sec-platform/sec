import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { ObservedCommandOutcome } from '../../platform/shared/observed-process.ts';
import { CodexDevelopmentVerificationDigest } from '../../platform/shared/ci-evidence-contract.ts';
import {
  prepareWorkPackageExecutionSnapshotForTests,
  publishWorkPackageExecutionSnapshotOwnerForTests,
  removeWorkPackageExecutionSnapshotForTests,
  runWorkPackageGate,
  workPackageGateAuthorityProbeBudgetForTests,
  workPackageGateCheckpointPublicationDirectoryForTests,
  workPackageGateProbeOutcomeAcceptedForTests,
  workPackageWorktreeDigestForTests,
  type WorkPackageGateDependencies,
  type WorkPackageGateOptions
} from '../../scripts/run-work-package-gate.ts';
import {
  assertWorkPackageGateEvent,
  assertWorkPackageGateEvidence,
  finalizeWorkPackageGateEvent,
  parseFrozenWorkPackageGateSelection,
  type WorkPackageGateChildEvidenceV1,
  type WorkPackageGateResidueCensusV1
} from '../../scripts/work-package-gate-contract.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const worktree = `sha256:${'c'.repeat(64)}`;
const emptyDigest: `sha256:${string}` = `sha256:${'e'.repeat(64)}`;
const emptyIdentitySet = Object.freeze({ count: 0, digest: emptyDigest });
const cleanCensus: WorkPackageGateResidueCensusV1 = Object.freeze({
  workspaceRoots: 0,
  recoveryOwners: 0,
  pendingOwners: 0,
  nativeResults: 0,
  writerLeases: 0,
  appContainerProfiles: emptyIdentitySet,
  aclPresentOwners: emptyIdentitySet
});

test('execution snapshot materializes the exact dirty tree in a detached worktree', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-${randomUUID()}`
  );
  const revision = (value: string): string => {
    const result = spawnSync('git', ['rev-parse', value], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    const snapshotDigest = await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    );
    expect(snapshotDigest).toBe(expectedDigest);
    expect(await readFile(path.join(snapshotRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'))
      .toBe(await readFile(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'));
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot recovery reclaims a registered partial worktree and rebuilds after removal', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-recovery-${randomUUID()}`
  );
  const revision = (value: string): string => {
    const result = spawnSync('git', ['rev-parse', value], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    await publishWorkPackageExecutionSnapshotOwnerForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    );
    const partial = spawnSync('git', ['worktree', 'add', '--detach', snapshotRoot, revision('HEAD')], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(partial.status).toBe(0);
    await writeFile(path.join(snapshotRoot, 'partial-publication.txt'), 'partial', 'utf8');
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
    await expect(readFile(path.join(snapshotRoot, 'partial-publication.txt'), 'utf8')).rejects.toThrow();

    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot recovery preserves a foreign unregistered directory', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-foreign-${randomUUID()}`
  );
  const marker = path.join(snapshotRoot, 'keep.txt');
  const revision = (value: string): string => spawnSync('git', ['rev-parse', value], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  }).stdout.trim();
  try {
    await mkdir(snapshotRoot, { recursive: true });
    await writeFile(marker, 'preserve', 'utf8');
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
    expect(await readFile(marker, 'utf8')).toBe('preserve');
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('execution snapshot recovery preserves a foreign registered worktree without owner authority', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-registered-foreign-${randomUUID()}`
  );
  const revision = (value: string): string => spawnSync('git', ['rev-parse', value], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  }).stdout.trim();
  try {
    const added = spawnSync('git', ['worktree', 'add', '--detach', snapshotRoot, revision('HEAD')], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(added.status).toBe(0);
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
    expect(spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: snapshotRoot,
      encoding: 'utf8',
      windowsHide: true
    }).status).toBe(0);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', snapshotRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    spawnSync('git', ['worktree', 'prune'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('authority probes reject stderr bytes and either stream truncation', () => {
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome())).toBe(true);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
    stderr: { bytes: 1, digest: emptyDigest, observerTruncated: false }
  }))).toBe(false);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
    stdout: { bytes: 0, digest: emptyDigest, observerTruncated: true }
  }))).toBe(false);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
    stderr: { bytes: 0, digest: emptyDigest, observerTruncated: true }
  }))).toBe(false);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome(), 99, 100)).toBe(true);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome(), 100, 100)).toBe(false);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome(), 101, 100)).toBe(false);
});

test('authority probes reserve tree termination inside one absolute deadline', () => {
  expect(workPackageGateAuthorityProbeBudgetForTests(2)).toBeNull();
  expect(workPackageGateAuthorityProbeBudgetForTests(3)).toEqual({
    timeoutMs: 2,
    terminationDeadlineMs: 1,
    terminationGraceMs: 1
  });
  for (const remaining of [1_000, 30_000]) {
    const budget = workPackageGateAuthorityProbeBudgetForTests(remaining);
    expect(budget).not.toBeNull();
    expect(budget!.timeoutMs + budget!.terminationDeadlineMs).toBeLessThanOrEqual(remaining);
    expect(budget!.terminationGraceMs).toBeLessThanOrEqual(budget!.terminationDeadlineMs);
  }
  expect(workPackageGateAuthorityProbeBudgetForTests(1_000)).toEqual({
    timeoutMs: 750,
    terminationDeadlineMs: 250,
    terminationGraceMs: 250
  });
  expect(workPackageGateAuthorityProbeBudgetForTests(30_000)).toEqual({
    timeoutMs: 22_500,
    terminationDeadlineMs: 7_500,
    terminationGraceMs: 5_000
  });
});

function options(name: string): WorkPackageGateOptions {
  return {
    manifestPath: 'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md',
    selectionManifestPath: 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md',
    selectionIndex: 0,
    watchdogMs: 1_800_000,
    cleanupMs: 120_000,
    runDir: `.tmp/${name}`
  };
}

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

function checkpointChild(): WorkPackageGateChildEvidenceV1 {
  const observed = outcome();
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

async function frozenSelection() {
  const gateOptions = options('selection-helper');
  return parseFrozenWorkPackageGateSelection({
    executionManifestSource: await readFile(path.join(repoRoot, gateOptions.manifestPath), 'utf8'),
    executionManifestPath: gateOptions.manifestPath,
    selectionManifestSource: await readFile(
      path.join(repoRoot, gateOptions.selectionManifestPath),
      'utf8'
    ),
    selectionManifestPath: gateOptions.selectionManifestPath,
    selectionIndex: gateOptions.selectionIndex
  });
}

async function writeCheckpoint(
  absoluteRunDir: string,
  patch: Readonly<Record<string, unknown>> = {},
  runId = path.basename(absoluteRunDir)
): Promise<Record<string, unknown>> {
  await mkdir(absoluteRunDir, { recursive: true });
  const resumedChild = patch.childAttempted === true;
  const draft: Record<string, unknown> = {
    schema: 'codex-work-package-gate-checkpoint-v1',
    runId,
    startedAt: '2026-07-14T00:00:00.000Z',
    headSha: head,
    treeSha: tree,
    worktreeBeforeDigest: worktree,
    executionSnapshotDigest: worktree,
    executionSnapshotPrepared: resumedChild,
    executionSnapshotVerified: false,
    executionSnapshotRemoved: false,
    selection: await frozenSelection(),
    before: cleanCensus,
    childAttempted: false,
    child: null,
    recoveryAttempted: false,
    recovery: null,
    residueAfter: null,
    namespaceRemoved: false,
    ...patch
  };
  const checkpoint = {
    ...draft,
    checkpointDigest: CodexDevelopmentVerificationDigest(draft)
  };
  await writeFile(
    path.join(absoluteRunDir, 'checkpoint.json'),
    `${JSON.stringify(checkpoint)}\n`,
    'utf8'
  );
  return checkpoint;
}

function dependencies(
  runChild: WorkPackageGateDependencies['runChild'],
  counters: { census: number; remove: number }
): Partial<WorkPackageGateDependencies> {
  return {
    gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
    worktreeDigest: async () => worktree,
    prepareExecutionSnapshot: async () => worktree,
    removeExecutionSnapshot: async () => true,
    runChild,
    census: async () => {
      counters.census += 1;
      return cleanCensus;
    },
    removeNamespace: async () => {
      counters.remove += 1;
      return true;
    }
  };
}

test('initial checkpoint publication recovers empty and fully written pending directories', async () => {
  for (const mode of ['empty', 'checkpoint'] as const) {
    const name = `synthetic-checkpoint-publication-${mode}-${randomUUID()}`;
    const gateOptions = options(name);
    const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
    const publicationDirectory = workPackageGateCheckpointPublicationDirectoryForTests(
      repoRoot,
      absoluteRunDir
    );
    const counters = { census: 0, remove: 0 };
    let childCalls = 0;
    try {
      if (mode === 'empty') {
        await mkdir(publicationDirectory, { recursive: true });
      } else {
        await writeCheckpoint(publicationDirectory, {}, name);
      }
      const result = await runWorkPackageGate(gateOptions, dependencies(async () => {
        childCalls += 1;
        return outcome();
      }, counters));
      expect(result.evidence.status).toBe('passed');
      expect(childCalls).toBe(1);
      await expect(readFile(path.join(publicationDirectory, 'checkpoint.json'), 'utf8'))
        .rejects.toThrow();
    } finally {
      await rm(absoluteRunDir, { recursive: true, force: true });
      await rm(publicationDirectory, { recursive: true, force: true });
    }
  }
});

test('retry adopts the durable pending checkpoint instead of rebinding its run ID to current repository state', async () => {
  const name = `synthetic-checkpoint-authority-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const publicationDirectory = workPackageGateCheckpointPublicationDirectoryForTests(
    repoRoot,
    absoluteRunDir
  );
  const counters = { census: 0, remove: 0 };
  let childCalls = 0;
  try {
    await writeCheckpoint(publicationDirectory, {}, name);
    const result = await runWorkPackageGate(gateOptions, {
      ...dependencies(async () => {
        childCalls += 1;
        return outcome();
      }, counters),
      gitRevision: (_root, revision) => revision === 'HEAD' ? 'd'.repeat(40) : 'e'.repeat(40),
      worktreeDigest: async () => `sha256:${'f'.repeat(64)}`
    });
    expect(result.evidence.repository.headSha).toBe(head);
    expect(result.evidence.repository.treeSha).toBe(tree);
    expect(result.evidence.repository.worktreeBeforeDigest).toBe(worktree);
    expect(result.evidence.status).toBe('unknown');
    expect(childCalls).toBe(0);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
    await rm(publicationDirectory, { recursive: true, force: true });
  }
});

test('synthetic supervisor runs one frozen Bun child and finalizes digest-valid pass evidence', async () => {
  const name = `synthetic-work-package-pass-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const counters = { census: 0, remove: 0 };
  let childCalls = 0;
  try {
    const result = await runWorkPackageGate(gateOptions, dependencies(
      async (_command, args, runOptions) => {
        childCalls += 1;
        expect(args[0]).toBe('test');
        expect(args.slice(1, -2)).toHaveLength(39);
        expect(args.slice(-2)).toEqual(['--timeout', '600000']);
        expect(runOptions.timeoutMs).toBe(1_800_000);
        expect(String(runOptions.cwd)).toContain(`${path.sep}.tmp${path.sep}gate-execution-snapshots${path.sep}`);
        expect(path.resolve(String(runOptions.cwd))).not.toBe(repoRoot);
        expect(runOptions.env?.SEC_TEST_WORKSPACE_NAMESPACE)
          .toMatch(/^gate-[0-9a-f]{32}-owned$/u);
        return outcome();
      },
      counters
    ));
    expect(result.exitCode).toBe(0);
    expect(result.evidence.status).toBe('passed');
    expect(childCalls).toBe(1);
    expect(counters).toEqual({ census: 3, remove: 1 });
    expect(() => assertWorkPackageGateEvidence(result.evidence)).not.toThrow();
    const readback = JSON.parse(await readFile(path.join(absoluteRunDir, 'evidence.json'), 'utf8'));
    expect(() => assertWorkPackageGateEvidence(readback)).not.toThrow();

    const events = (await readFile(path.join(absoluteRunDir, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    let previous: string | null = null;
    for (const event of events) {
      assertWorkPackageGateEvent(event, previous);
      previous = event.eventDigest;
    }
    expect(events.map((event) => (event as { kind: string }).kind)).toEqual([
      'started', 'recovery', 'residue', 'completed'
    ]);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('synthetic supervisor never probes residue or cleanup after unproven tree termination', async () => {
  const name = `synthetic-work-package-unproven-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const counters = { census: 0, remove: 0 };
  try {
    const result = await runWorkPackageGate(gateOptions, dependencies(
      async () => outcome({
        status: 'termination-unproven',
        trigger: 'timed-out',
        exitCode: null,
        termination: {
          requested: true,
          gracefulAttempted: true,
          forcedAttempted: true,
          childCloseObserved: false,
          streamsDrained: false,
          treeClosed: false
        }
      }),
      counters
    ));
    expect(result.exitCode).toBe(125);
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.residue.after).toBeNull();
    expect(result.evidence.recovery).toEqual({
      attempted: false,
      complete: false,
      reason: 'authority-preserved'
    });
    expect(counters).toEqual({ census: 1, remove: 0 });
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('synthetic supervisor records a proven watchdog timeout without changing per-test timeout', async () => {
  const name = `synthetic-work-package-timeout-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const counters = { census: 0, remove: 0 };
  try {
    const result = await runWorkPackageGate(gateOptions, dependencies(
      async () => outcome({
        status: 'timed-out',
        trigger: 'timed-out',
        exitCode: null,
        termination: {
          requested: true,
          gracefulAttempted: true,
          forcedAttempted: false,
          childCloseObserved: true,
          streamsDrained: true,
          treeClosed: true
        }
      }),
      counters
    ));
    expect(result.exitCode).toBe(124);
    expect(result.evidence.status).toBe('timed-out');
    expect(result.evidence.selection.perTestTimeoutMs).toBe(600_000);
    expect(result.evidence.timeouts.watchdogMs).toBe(1_800_000);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('synthetic supervisor performs one owned recovery before owner-free namespace cleanup', async () => {
  const name = `synthetic-work-package-recovery-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const counters = { census: 0, remove: 0 };
  let recoveryCalls = 0;
  const residueDeadlines: number[] = [];
  const ownedCensus: WorkPackageGateResidueCensusV1 = Object.freeze({
    ...cleanCensus,
    workspaceRoots: 1,
    recoveryOwners: 1
  });
  try {
    const base = dependencies(async () => outcome(), counters);
    const result = await runWorkPackageGate(gateOptions, {
      ...base,
      census: async (_namespaceRoot, deadlineAtMs) => {
        counters.census += 1;
        if (deadlineAtMs !== undefined) residueDeadlines.push(deadlineAtMs);
        return counters.census === 2 ? ownedCensus : cleanCensus;
      },
      recoverOwnedNamespace: async (_namespaceRoot, deadlineAtMs) => {
        recoveryCalls += 1;
        residueDeadlines.push(deadlineAtMs);
        return 'completed';
      },
      removeNamespace: async (_namespaceRoot, deadlineAtMs) => {
        counters.remove += 1;
        residueDeadlines.push(deadlineAtMs);
        return true;
      }
    });
    expect(result.evidence.status).toBe('passed');
    expect(result.evidence.recovery).toEqual({
      attempted: true,
      complete: true,
      reason: 'completed'
    });
    expect(recoveryCalls).toBe(1);
    expect(counters).toEqual({ census: 4, remove: 1 });
    expect(residueDeadlines).toHaveLength(5);
    expect(new Set(residueDeadlines).size).toBe(1);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('resume refuses repository drift before the one allowed child attempt', async () => {
  const name = `synthetic-work-package-drift-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  let childCalls = 0;
  try {
    await writeCheckpoint(absoluteRunDir);
    const result = await runWorkPackageGate(gateOptions, {
      gitRevision: (_root, revision) => revision === 'HEAD' ? 'd'.repeat(40) : 'e'.repeat(40),
      worktreeDigest: async () => `sha256:${'f'.repeat(64)}`,
      prepareExecutionSnapshot: async () => worktree,
      removeExecutionSnapshot: async () => true,
      runChild: async () => {
        childCalls += 1;
        return outcome();
      },
      census: async () => cleanCensus,
      removeNamespace: async () => false
    });
    expect(childCalls).toBe(0);
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.child.started).toBe(false);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('resume preserves journal elapsed time and never reruns a checkpointed child attempt', async () => {
  const name = `synthetic-work-package-resume-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  let childCalls = 0;
  try {
    await writeCheckpoint(absoluteRunDir, {
      childAttempted: true,
      child: checkpointChild()
    });
    const started = finalizeWorkPackageGateEvent({
      sequence: 1,
      kind: 'started',
      elapsedMs: 75_000,
      phase: 'owner-batch',
      stdoutBytes: 0,
      stderrBytes: 0,
      previousDigest: null
    });
    await writeFile(
      path.join(absoluteRunDir, 'events.jsonl'),
      `${JSON.stringify(started)}\n`,
      'utf8'
    );
    const result = await runWorkPackageGate(gateOptions, {
      gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
      worktreeDigest: async () => worktree,
      prepareExecutionSnapshot: async () => worktree,
      removeExecutionSnapshot: async () => true,
      monotonicNowMs: () => 1_000,
      runChild: async () => {
        childCalls += 1;
        return outcome();
      },
      census: async () => cleanCensus,
      removeNamespace: async () => true
    });
    expect(result.evidence.status).toBe('passed');
    expect(childCalls).toBe(0);
    const events = (await readFile(path.join(absoluteRunDir, 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { elapsedMs: number });
    expect(events.every((event, index) => index === 0 || event.elapsedMs >= events[index - 1]!.elapsedMs))
      .toBe(true);
    expect(events.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(75_000);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('resume never repeats a recovery whose durable attempt bit has no terminal outcome', async () => {
  const name = `synthetic-work-package-recovery-resume-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  let recoveryCalls = 0;
  try {
    await writeCheckpoint(absoluteRunDir, {
      childAttempted: true,
      child: checkpointChild(),
      recoveryAttempted: true
    });
    const result = await runWorkPackageGate(gateOptions, {
      gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
      worktreeDigest: async () => worktree,
      prepareExecutionSnapshot: async () => worktree,
      removeExecutionSnapshot: async () => true,
      runChild: async () => outcome(),
      census: async () => cleanCensus,
      recoverOwnedNamespace: async () => {
        recoveryCalls += 1;
        return 'completed';
      },
      removeNamespace: async () => true
    });
    expect(recoveryCalls).toBe(0);
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.recovery).toEqual({
      attempted: true,
      complete: false,
      reason: 'failed'
    });
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('tampered checkpoint digest and contradictory checkpoint state are rejected before child launch', async () => {
  const names = [
    `synthetic-work-package-checkpoint-digest-${randomUUID()}`,
    `synthetic-work-package-checkpoint-state-${randomUUID()}`
  ];
  let childCalls = 0;
  try {
    const digestDir = path.join(repoRoot, options(names[0]!).runDir);
    const digestCheckpoint = await writeCheckpoint(digestDir);
    digestCheckpoint.before = null;
    await writeFile(
      path.join(digestDir, 'checkpoint.json'),
      `${JSON.stringify(digestCheckpoint)}\n`,
      'utf8'
    );
    await expect(runWorkPackageGate(options(names[0]!), {
      runChild: async () => {
        childCalls += 1;
        return outcome();
      }
    })).rejects.toThrow('checkpoint binding');

    const stateDir = path.join(repoRoot, options(names[1]!).runDir);
    await writeCheckpoint(stateDir, { child: checkpointChild() });
    await expect(runWorkPackageGate(options(names[1]!), {
      runChild: async () => {
        childCalls += 1;
        return outcome();
      }
    })).rejects.toThrow('checkpoint binding');
    expect(childCalls).toBe(0);
  } finally {
    for (const name of names) {
      await rm(path.join(repoRoot, options(name).runDir), { recursive: true, force: true });
    }
  }
});

test('an existing unowned run directory is preserved and an invalid run ID fails before child launch', async () => {
  const name = `synthetic-work-package-unowned-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  const markerPath = path.join(absoluteRunDir, 'keep.txt');
  let childCalls = 0;
  const runChild = async (): Promise<ObservedCommandOutcome> => {
    childCalls += 1;
    return outcome();
  };
  try {
    await mkdir(absoluteRunDir, { recursive: true });
    await writeFile(markerPath, 'preserve', 'utf8');
    await expect(runWorkPackageGate(gateOptions, { runChild }))
      .rejects.toThrow('not owned by a checkpoint');
    expect(await readFile(markerPath, 'utf8')).toBe('preserve');
    await expect(runWorkPackageGate(options(`INVALID-${randomUUID()}`), { runChild }))
      .rejects.toThrow('run ID is invalid');
    expect(childCalls).toBe(0);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('unknown ACL census fails closed without calling owned recovery', async () => {
  const name = `synthetic-work-package-acl-unknown-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  let censusCalls = 0;
  let recoveryCalls = 0;
  try {
    const result = await runWorkPackageGate(gateOptions, {
      gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
      worktreeDigest: async () => worktree,
      prepareExecutionSnapshot: async () => worktree,
      removeExecutionSnapshot: async () => true,
      runChild: async () => outcome(),
      census: async () => {
        censusCalls += 1;
        return censusCalls === 1
          ? cleanCensus
          : Object.freeze({ ...cleanCensus, aclPresentOwners: null });
      },
      recoverOwnedNamespace: async () => {
        recoveryCalls += 1;
        return 'completed';
      },
      removeNamespace: async () => true
    });
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.recovery).toEqual({
      attempted: false,
      complete: false,
      reason: 'authority-preserved'
    });
    expect(recoveryCalls).toBe(0);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('Windows case aliases share one crash-safe namespace mutex and cannot launch twice', async () => {
  if (process.platform !== 'win32') return;
  const token = randomUUID().toLowerCase();
  const upper = options(`CaseAlias-${token}/run-${token}`);
  const lower = options(`casealias-${token}/run-${token}`);
  const absoluteRunDir = path.join(repoRoot, upper.runDir);
  let childCalls = 0;
  let releaseChild!: () => void;
  let childEntered!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    childEntered = resolve;
  });
  const shared: Partial<WorkPackageGateDependencies> = {
    gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
    worktreeDigest: async () => worktree,
    prepareExecutionSnapshot: async () => worktree,
    removeExecutionSnapshot: async () => true,
    runChild: async () => {
      childCalls += 1;
      childEntered();
      await release;
      return outcome();
    },
    census: async () => cleanCensus,
    removeNamespace: async () => true
  };
  try {
    const first = runWorkPackageGate(upper, shared);
    await entered;
    const second = runWorkPackageGate(lower, shared);
    await expect(second).rejects.toThrow('live supervisor');
    releaseChild();
    expect((await first).evidence.status).toBe('passed');
    expect(childCalls).toBe(1);
  } finally {
    releaseChild?.();
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('pre-child infrastructure failure finalizes unknown evidence and an identical retry never starts the batch', async () => {
  const name = `synthetic-work-package-final-record-${randomUUID()}`;
  const gateOptions = options(name);
  const absoluteRunDir = path.join(repoRoot, gateOptions.runDir);
  let childCalls = 0;
  const base: Partial<WorkPackageGateDependencies> = {
    gitRevision: (_root, revision) => revision === 'HEAD' ? head : tree,
    worktreeDigest: async () => worktree,
    prepareExecutionSnapshot: async () => worktree,
    removeExecutionSnapshot: async () => true,
    runChild: async () => {
      childCalls += 1;
      return outcome();
    },
    census: async () => {
      throw new Error('injected baseline census failure');
    },
    removeNamespace: async () => false
  };
  try {
    const first = await runWorkPackageGate(gateOptions, base);
    expect(first.evidence.status).toBe('unknown');
    expect(first.evidence.residue.before).toBeNull();
    expect(first.evidence.child.started).toBe(false);
    expect(childCalls).toBe(0);

    const second = await runWorkPackageGate(gateOptions, {
      ...base,
      census: async () => cleanCensus
    });
    expect(second.evidence.evidenceDigest).toBe(first.evidence.evidenceDigest);
    expect(second.exitCode).toBe(first.exitCode);
    expect(childCalls).toBe(0);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});
