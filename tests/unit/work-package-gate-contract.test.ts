import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertWorkPackageGateEvent,
  assertWorkPackageGateEvidence,
  assertWorkPackageGateEvidenceBundle,
  assertWorkPackageGateJournal,
  finalizeWorkPackageGateEvent,
  finalizeWorkPackageGateEvidence,
  parseFrozenWorkPackageGateSelection,
  writeWorkPackageGateJsonAtomic,
  type WorkPackageGateResidueCensusV1
} from '../../scripts/work-package-gate-contract.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const executionPath = 'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md';
const selectionPath = 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md';
const emptyIdentitySet = Object.freeze({
  count: 0,
  digest: `sha256:${'0'.repeat(64)}`
});

async function frozenSelection() {
  return parseFrozenWorkPackageGateSelection({
    executionManifestSource: await readFile(path.join(repoRoot, executionPath), 'utf8'),
    executionManifestPath: executionPath,
    selectionManifestSource: await readFile(path.join(repoRoot, selectionPath), 'utf8'),
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  });
}

const cleanCensus: WorkPackageGateResidueCensusV1 = Object.freeze({
  workspaceRoots: 0,
  recoveryOwners: 0,
  pendingOwners: 0,
  nativeResults: 0,
  writerLeases: 0,
  appContainerProfiles: emptyIdentitySet,
  aclPresentOwners: emptyIdentitySet
});

test('gate selection derives exactly one canonical 39-file argv from the R1 frozen manifest', async () => {
  const selection = await frozenSelection();
  expect(selection.executionManifestId).toBe('sm3-r2-bounded-runtime-gate-v1');
  expect(selection.selectionManifestId).toBe('sm3-r1-focused-blocker-repair-v1');
  expect(selection.argv.slice(0, 2)).toEqual(['bun', 'test']);
  expect(selection.argv.slice(-2)).toEqual(['--timeout', '600000']);
  expect(selection.testFileCount).toBe(39);
  expect(selection.testFiles).toHaveLength(39);
  expect(new Set(selection.testFiles).size).toBe(39);
});

test('gate selection rejects timeout drift and duplicate owner files', async () => {
  const execution = await readFile(path.join(repoRoot, executionPath), 'utf8');
  const selection = await readFile(path.join(repoRoot, selectionPath), 'utf8');
  expect(() => parseFrozenWorkPackageGateSelection({
    executionManifestSource: execution.replace('tracking: issue-106', 'tracking: issue-107'),
    executionManifestPath: executionPath,
    selectionManifestSource: selection,
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  })).toThrow('exact frozen R1/R2 binding');
  expect(() => parseFrozenWorkPackageGateSelection({
    executionManifestSource: execution,
    executionManifestPath: executionPath,
    selectionManifestSource: selection.replace('--timeout 600000', '--timeout 600001'),
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  })).toThrow();
  const first = 'tests/unit/semantic-mutation.test.ts';
  const second = 'tests/unit/semantic-mutation-source-adapter.test.ts';
  expect(() => parseFrozenWorkPackageGateSelection({
    executionManifestSource: execution,
    executionManifestPath: executionPath,
    selectionManifestSource: selection.replace(second, first),
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  })).toThrow();
});

test('gate journal binds event order and previous digest', () => {
  const first = finalizeWorkPackageGateEvent({
    sequence: 1,
    kind: 'started',
    elapsedMs: 0,
    phase: 'preflight',
    stdoutBytes: 0,
    stderrBytes: 0,
    previousDigest: null
  });
  const second = finalizeWorkPackageGateEvent({
    sequence: 2,
    kind: 'heartbeat',
    elapsedMs: 15_000,
    phase: 'owner-batch',
    stdoutBytes: 10,
    stderrBytes: 0,
    previousDigest: first.eventDigest
  });
  expect(() => assertWorkPackageGateEvent(first, null)).not.toThrow();
  expect(() => assertWorkPackageGateEvent(second, first.eventDigest)).not.toThrow();
  expect(() => assertWorkPackageGateEvent(second, null)).toThrow('hash chain');
  const recovery = finalizeWorkPackageGateEvent({
    sequence: 3,
    kind: 'recovery',
    elapsedMs: 16_000,
    phase: 'recovery-complete',
    stdoutBytes: 10,
    stderrBytes: 0,
    subject: { complete: true },
    previousDigest: second.eventDigest
  });
  const residue = finalizeWorkPackageGateEvent({
    sequence: 4,
    kind: 'residue',
    elapsedMs: 16_100,
    phase: 'residue-census',
    stdoutBytes: 10,
    stderrBytes: 0,
    subject: { after: cleanCensus },
    previousDigest: recovery.eventDigest
  });
  const completed = finalizeWorkPackageGateEvent({
    sequence: 5,
    kind: 'completed',
    elapsedMs: 16_200,
    phase: 'passed',
    stdoutBytes: 10,
    stderrBytes: 0,
    subject: { status: 'passed' },
    previousDigest: residue.eventDigest
  });
  const journal = [first, second, recovery, residue, completed]
    .map((event) => JSON.stringify(event)).join('\n') + '\n';
  expect(() => assertWorkPackageGateJournal(journal, {
    lastSequence: 5,
    digest: completed.eventDigest
  })).not.toThrow();
  expect(() => assertWorkPackageGateJournal(journal, {
    lastSequence: 5,
    digest: first.eventDigest
  })).toThrow('final binding');
});

test('final evidence rejects argv and digest tamper and survives atomic readback', async () => {
  const selection = await frozenSelection();
  const repository = {
    headSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    headShaAfter: 'a'.repeat(40),
    treeShaAfter: 'b'.repeat(40),
    worktreeBeforeDigest: `sha256:${'c'.repeat(64)}`,
    worktreeAfterDigest: `sha256:${'c'.repeat(64)}`,
    executionSnapshotDigest: `sha256:${'c'.repeat(64)}`,
    executionSnapshotAfterDigest: `sha256:${'c'.repeat(64)}`,
    executionSnapshotRemoved: true
  };
  const child = {
    status: 'exited',
    trigger: null,
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 900,
    stdout: { bytes: 0, digest: `sha256:${'d'.repeat(64)}`, observerTruncated: false },
    stderr: { bytes: 0, digest: `sha256:${'e'.repeat(64)}`, observerTruncated: false },
    termination: {
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }
  };
  const recoveryEvidence = { attempted: false, complete: true, reason: 'not-needed' } as const;
  const residueEvidence = { before: cleanCensus, after: cleanCensus, namespaceRemoved: true };
  const subjectFor = (kind: 'started' | 'recovery' | 'residue' | 'completed'): unknown => {
    switch (kind) {
      case 'recovery': return recoveryEvidence;
      case 'residue': return residueEvidence;
      case 'completed': return { status: 'passed', child, repository };
      default: return undefined;
    }
  };
  const journalEvents = [
    { kind: 'started' as const, phase: 'preflight' },
    { kind: 'recovery' as const, phase: 'recovery-complete' },
    { kind: 'residue' as const, phase: 'residue-census' },
    { kind: 'completed' as const, phase: 'passed' }
  ].reduce<Array<ReturnType<typeof finalizeWorkPackageGateEvent>>>((events, item, index) => {
    events.push(finalizeWorkPackageGateEvent({
      sequence: index + 1,
      kind: item.kind,
      elapsedMs: index,
      phase: item.phase,
      stdoutBytes: 0,
      stderrBytes: 0,
      subject: subjectFor(item.kind),
      previousDigest: events.at(-1)?.eventDigest ?? null
    }));
    return events;
  }, []);
  const journalSource = `${journalEvents.map((event) => JSON.stringify(event)).join('\n')}\n`;
  const evidence = finalizeWorkPackageGateEvidence({
    runId: 'synthetic-gate',
    status: 'passed',
    startedAt: '2026-07-14T00:00:00.000Z',
    completedAt: '2026-07-14T00:00:01.000Z',
    durationMs: 1_000,
    selection,
    repository,
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 },
    child,
    recovery: recoveryEvidence,
    residue: residueEvidence,
    journal: { lastSequence: 4, digest: journalEvents.at(-1)!.eventDigest }
  });
  expect(() => assertWorkPackageGateEvidence(evidence)).not.toThrow();
  expect(() => assertWorkPackageGateEvidenceBundle({ evidence, journalSource })).not.toThrow();
  const tampered = structuredClone(evidence) as Record<string, any>;
  [tampered.selection.argv[2], tampered.selection.argv[3]] = [
    tampered.selection.argv[3],
    tampered.selection.argv[2]
  ];
  expect(() => assertWorkPackageGateEvidence(tampered)).toThrow('selection proof');

  const passedWithTimeout = structuredClone(evidence) as Record<string, any>;
  passedWithTimeout.child.trigger = 'timed-out';
  expect(() => assertWorkPackageGateEvidence(passedWithTimeout))
    .toThrow('Passed Work Package gate evidence is incomplete');

  const timedOutWithoutDrain = structuredClone(evidence) as Record<string, any>;
  timedOutWithoutDrain.status = 'timed-out';
  timedOutWithoutDrain.child.status = 'timed-out';
  timedOutWithoutDrain.child.trigger = 'timed-out';
  timedOutWithoutDrain.child.exitCode = null;
  timedOutWithoutDrain.child.termination.requested = true;
  timedOutWithoutDrain.child.termination.streamsDrained = false;
  timedOutWithoutDrain.child.termination.treeClosed = false;
  expect(() => assertWorkPackageGateEvidence(timedOutWithoutDrain))
    .toThrow('Timed-out Work Package gate evidence is inconsistent');

  const contradictoryRecovery = structuredClone(evidence) as Record<string, any>;
  contradictoryRecovery.recovery = { attempted: false, complete: true, reason: 'completed' };
  expect(() => assertWorkPackageGateEvidence(contradictoryRecovery))
    .toThrow('recovery state is contradictory');

  const contradictoryTermination = structuredClone(evidence) as Record<string, any>;
  contradictoryTermination.child.termination.forcedAttempted = true;
  expect(() => assertWorkPackageGateEvidence(contradictoryTermination))
    .toThrow('termination state is contradictory');

  const mismatchedEvents = [
    { kind: 'started' as const, phase: 'preflight' },
    { kind: 'recovery' as const, phase: 'authority-preserved' },
    { kind: 'residue' as const, phase: 'residue-census' },
    { kind: 'completed' as const, phase: 'passed' }
  ].reduce<Array<ReturnType<typeof finalizeWorkPackageGateEvent>>>((events, item, index) => {
    events.push(finalizeWorkPackageGateEvent({
      sequence: index + 1,
      kind: item.kind,
      elapsedMs: index,
      phase: item.phase,
      stdoutBytes: 0,
      stderrBytes: 0,
      subject: subjectFor(item.kind),
      previousDigest: events.at(-1)?.eventDigest ?? null
    }));
    return events;
  }, []);
  const { schema: _schema, evidenceDigest: _digest, ...evidenceDraft } = evidence;
  const mismatchedEvidence = finalizeWorkPackageGateEvidence({
    ...evidenceDraft,
    journal: {
      lastSequence: mismatchedEvents.length,
      digest: mismatchedEvents.at(-1)!.eventDigest
    }
  });
  const mismatchedJournal = `${mismatchedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`;
  expect(() => assertWorkPackageGateEvidenceBundle({
    evidence: mismatchedEvidence,
    journalSource: mismatchedJournal
  })).toThrow('do not agree');

  const samePhaseRecoveryDraft = structuredClone(evidenceDraft) as typeof evidenceDraft;
  const samePhaseRecovery = finalizeWorkPackageGateEvidence({
    ...samePhaseRecoveryDraft,
    recovery: { attempted: true, complete: true, reason: 'completed' },
    journal: evidence.journal
  });
  expect(() => assertWorkPackageGateEvidenceBundle({
    evidence: samePhaseRecovery,
    journalSource
  })).toThrow('do not agree');

  const alteredCensus = structuredClone(cleanCensus) as WorkPackageGateResidueCensusV1;
  (alteredCensus.appContainerProfiles as { digest: string }).digest = `sha256:${'9'.repeat(64)}`;
  const samePhaseResidue = finalizeWorkPackageGateEvidence({
    ...evidenceDraft,
    residue: { before: alteredCensus, after: alteredCensus, namespaceRemoved: true },
    journal: evidence.journal
  });
  expect(() => assertWorkPackageGateEvidenceBundle({
    evidence: samePhaseResidue,
    journalSource
  })).toThrow('do not agree');

  const lifecycleChild = {
    ...child,
    status: 'lifecycle-failed',
    trigger: 'lifecycle-failed',
    exitCode: null,
    termination: {
      requested: true,
      gracefulAttempted: false,
      forcedAttempted: true,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }
  };
  const lifecycleItems = [
    { kind: 'started' as const, phase: 'preflight', subject: undefined },
    { kind: 'termination' as const, phase: 'tree-close', subject: lifecycleChild.termination },
    { kind: 'recovery' as const, phase: 'recovery-complete', subject: recoveryEvidence },
    { kind: 'residue' as const, phase: 'residue-census', subject: residueEvidence },
    {
      kind: 'completed' as const,
      phase: 'unknown',
      subject: { status: 'unknown', child: lifecycleChild, repository }
    }
  ];
  const lifecycleEvents = lifecycleItems.reduce<
    Array<ReturnType<typeof finalizeWorkPackageGateEvent>>
  >((events, item, index) => {
    events.push(finalizeWorkPackageGateEvent({
      sequence: index + 1,
      kind: item.kind,
      elapsedMs: index,
      phase: item.phase,
      stdoutBytes: 0,
      stderrBytes: 0,
      subject: item.subject,
      previousDigest: events.at(-1)?.eventDigest ?? null
    }));
    return events;
  }, []);
  const lifecycleJournal = `${lifecycleEvents.map((event) => JSON.stringify(event)).join('\n')}\n`;
  const lifecycleEvidence = finalizeWorkPackageGateEvidence({
    ...evidenceDraft,
    status: 'unknown',
    child: lifecycleChild,
    journal: {
      lastSequence: lifecycleEvents.length,
      digest: lifecycleEvents.at(-1)!.eventDigest
    }
  });
  expect(() => assertWorkPackageGateEvidenceBundle({
    evidence: lifecycleEvidence,
    journalSource: lifecycleJournal
  })).not.toThrow();
  const changedTerminationChild = structuredClone(lifecycleChild);
  changedTerminationChild.termination.gracefulAttempted = true;
  const samePhaseTermination = finalizeWorkPackageGateEvidence({
    ...evidenceDraft,
    status: 'unknown',
    child: changedTerminationChild,
    journal: lifecycleEvidence.journal
  });
  expect(() => assertWorkPackageGateEvidenceBundle({
    evidence: samePhaseTermination,
    journalSource: lifecycleJournal
  })).toThrow('do not agree');

  const outputPath = path.join(repoRoot, '.tmp', `synthetic-gate-contract-${process.pid}.json`);
  try {
    await writeWorkPackageGateJsonAtomic(outputPath, evidence, assertWorkPackageGateEvidence);
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(evidence);
    const invalidReplacement = structuredClone(evidence) as Record<string, any>;
    invalidReplacement.child.started = false;
    await expect(writeWorkPackageGateJsonAtomic(
      outputPath,
      invalidReplacement,
      assertWorkPackageGateEvidence
    )).rejects.toThrow();
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(evidence);
  } finally {
    await rm(outputPath, { force: true });
  }
});
