import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { normalizeNewlines } from '../../platform/shared/collections.ts';
import {
  WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4,
  WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4,
  WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4,
  assertWorkPackageGateEvent,
  assertWorkPackageGateEventV4,
  assertWorkPackageGateEvidence,
  assertWorkPackageGateEvidenceBundle,
  assertWorkPackageGateEvidenceBundleV4,
  assertWorkPackageGateEvidenceV4,
  assertWorkPackageGateJournal,
  assertWorkPackageGateJournalV4,
  finalizeWorkPackageGateEvent,
  finalizeWorkPackageGateEventV4,
  finalizeWorkPackageGateEvidence,
  finalizeWorkPackageGateEvidenceV4,
  parseFrozenWorkPackageGateSelection,
  parseFrozenWorkPackageGateSelectionV4,
  writeWorkPackageGateJsonAtomic,
  type WorkPackageGateResidueCensusV1,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const executionPath = 'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md';
const executionSourcePath = 'tests/fixtures/work-package-gate-manifests/sm3-r2-bounded-runtime-gate-v1.md';
const selectionPath = 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md';
const selectionSourcePath = 'tests/fixtures/work-package-gate-manifests/sm3-r1-focused-blocker-repair-v1.md';
const executionPathV4 = 'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md';
const executionSourcePathV4 = 'tests/fixtures/work-package-gate-manifests/sm3-r3-actionable-runtime-gate-v4.md';
const emptyIdentitySet = Object.freeze({
  count: 0,
  digest: `sha256:${'0'.repeat(64)}`
});

async function frozenManifest(relativePath: string): Promise<string> {
  return normalizeNewlines(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function frozenSelection() {
  return parseFrozenWorkPackageGateSelection({
    executionManifestSource: await frozenManifest(executionSourcePath),
    executionManifestPath: executionPath,
    selectionManifestSource: await frozenManifest(selectionSourcePath),
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  });
}

async function frozenSelectionV4() {
  return parseFrozenWorkPackageGateSelectionV4({
    executionManifestSource: await frozenManifest(executionSourcePathV4),
    executionManifestPath: executionPathV4,
    selectionManifestSource: await frozenManifest(selectionSourcePath),
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
  const execution = await frozenManifest(executionSourcePath);
  const selection = await frozenManifest(selectionSourcePath);
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

test('tracked R2 evidence remains V1-only and V1/V4 parsers reject each other', async () => {
  const r2Record = JSON.parse(await readFile(path.join(
    repoRoot,
    'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json'
  ), 'utf8')) as Record<string, any>;
  expect(r2Record).toMatchObject({
    schemaVersion: '1',
    profile: 'v0.4-semantic-mutation-apply-r2',
    evidenceBundleValidation: {
      validator: 'assertWorkPackageGateEvidenceBundle',
      result: 'PASS',
      evidenceDigest: 'sha256:73017dde8cdf3416c3cc9a9c993dd14fa3e97162df3de34ba7cc6a92c3119e10',
      journalDigest: 'sha256:b5f783db0d5db901837685589bbc983bf4d300fff5c31ef5f275b92d6a9d6205',
      journalLastSequence: 34,
      localArtifactSha256: WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4
    }
  });
  expect(() => assertWorkPackageGateEvidenceV4({
    schema: 'codex-work-package-gate-evidence-v1'
  })).toThrow();

  const r2Execution = await frozenManifest(executionSourcePath);
  const v4Execution = await frozenManifest(executionSourcePathV4);
  const selection = await frozenManifest(selectionSourcePath);
  expect(() => parseFrozenWorkPackageGateSelectionV4({
    executionManifestSource: r2Execution,
    executionManifestPath: executionPath,
    selectionManifestSource: selection,
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  })).toThrow('exact frozen R1/R3-v4 binding');
  expect(() => parseFrozenWorkPackageGateSelection({
    executionManifestSource: v4Execution,
    executionManifestPath: executionPathV4,
    selectionManifestSource: selection,
    selectionManifestPath: selectionPath,
    selectionIndex: 0
  })).toThrow('exact frozen R1/R2 binding');
});

test('V4 event, evidence, journal and schema finalizers are isolated from V1', async () => {
  const selection = await frozenSelectionV4();
  const empty = Object.freeze({ count: 0, digest: `sha256:${'1'.repeat(64)}` });
  const census = (
    structureReason: 'observed' | 'namespace-absent',
    aclReason: 'observed' | 'namespace-absent'
  ): WorkPackageGateResidueCensusV4 => Object.freeze({
    structure: Object.freeze({
      complete: true,
      reason: structureReason,
      counts: Object.freeze({
        workspaceRoots: 0,
        recoveryOwners: 0,
        pendingOwners: 0,
        nativeResults: 0,
        writerLeases: 0
      }),
      recoveryAuthorities: empty
    }),
    aclPresentOwners: Object.freeze({ complete: true, reason: aclReason, identities: empty })
  });
  const preflight = census('namespace-absent', 'namespace-absent');
  const postChild = census('observed', 'observed');
  const postRecovery = census('observed', 'observed');
  const final = census('namespace-absent', 'namespace-absent');
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
    durationMs: 10,
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
  const diagnostic = {
    status: 'non-actionable',
    selectionIndexes: Object.freeze([] as number[]),
    failureMarkerCount: 0,
    unmappedMarkerCount: 0,
    malformedMarkerCount: 0,
    oversizedLineCount: 0,
    utf8Invalid: false,
    ansiInvalid: false,
    observerTruncated: false,
    parserFailure: false
  } as const;
  const authority = {
    protectedLedgerDigest: WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4,
    runDirectoryIdentityDigest: WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4,
    namespaceIdentityDigest: WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4,
    snapshotIdentityDigest: WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4,
    namespaceRootIdentityDigest: WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4
  };
  const recovery = { attempted: false, complete: true, reason: 'not-needed', authorization: null } as const;
  const residue = {
    preflight,
    postChild,
    postRecovery,
    final,
    namespaceRemovalAttempted: true,
    namespaceRemoved: true
  };
  const startedSubject = {
    runId: 'sm3-r3-v4-work-package-gate',
    selection,
    authority,
    repositoryBefore: {
      headSha: repository.headSha,
      treeSha: repository.treeSha,
      worktreeBeforeDigest: repository.worktreeBeforeDigest,
      executionSnapshotDigest: repository.executionSnapshotDigest
    },
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 }
  };
  const subjects = [
    startedSubject,
    recovery,
    residue,
    { status: 'passed', child, diagnostic, repository, recovery, residue }
  ];
  const events = [
    { kind: 'started' as const, phase: 'preflight', elapsedMs: 0 },
    { kind: 'recovery' as const, phase: 'recovery-complete', elapsedMs: child.durationMs },
    { kind: 'residue' as const, phase: 'residue-census', elapsedMs: child.durationMs },
    { kind: 'completed' as const, phase: 'passed', elapsedMs: 1_000 }
  ].reduce<Array<ReturnType<typeof finalizeWorkPackageGateEventV4>>>((records, item, index) => {
    records.push(finalizeWorkPackageGateEventV4({
      sequence: index + 1,
      kind: item.kind,
      elapsedMs: item.elapsedMs,
      phase: item.phase,
      stdoutBytes: 0,
      stderrBytes: 0,
      subject: subjects[index],
      previousDigest: records.at(-1)?.eventDigest ?? null
    }));
    return records;
  }, []);
  const evidenceDraft = {
    runId: 'sm3-r3-v4-work-package-gate',
    status: 'passed' as const,
    startedAt: '2026-07-14T00:00:00.000Z',
    completedAt: '2026-07-14T00:00:01.000Z',
    durationMs: 1_000,
    selection,
    repository,
    authority,
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 },
    child,
    diagnostic,
    recovery,
    residue,
    journal: { lastSequence: events.length, digest: events.at(-1)!.eventDigest }
  };
  const evidence = finalizeWorkPackageGateEvidenceV4(evidenceDraft);
  const journalSource = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  expect(() => assertWorkPackageGateEventV4(events[0], null)).not.toThrow();
  expect(() => assertWorkPackageGateEvent(events[0])).toThrow();
  expect(() => assertWorkPackageGateEvidenceV4(evidence)).not.toThrow();
  expect(() => assertWorkPackageGateEvidence(evidence)).toThrow();
  expect(() => assertWorkPackageGateEvidenceBundleV4({ evidence, journalSource })).not.toThrow();
  expect(() => assertWorkPackageGateEvidenceBundle({ evidence, journalSource })).toThrow();

  const elapsedTamper = [
    { kind: 'started' as const, phase: 'preflight', elapsedMs: 1 },
    { kind: 'recovery' as const, phase: 'recovery-complete', elapsedMs: child.durationMs },
    { kind: 'residue' as const, phase: 'residue-census', elapsedMs: child.durationMs },
    { kind: 'completed' as const, phase: 'passed', elapsedMs: 1_000 }
  ].reduce<Array<ReturnType<typeof finalizeWorkPackageGateEventV4>>>((records, item, index) => {
    records.push(finalizeWorkPackageGateEventV4({
      sequence: index + 1,
      kind: item.kind,
      elapsedMs: item.elapsedMs,
      phase: item.phase,
      stdoutBytes: index === 0 ? 0 : child.stdout.bytes,
      stderrBytes: index === 0 ? 0 : child.stderr.bytes,
      subject: subjects[index],
      previousDigest: records.at(-1)?.eventDigest ?? null
    }));
    return records;
  }, []);
  const elapsedTamperEvidence = finalizeWorkPackageGateEvidenceV4({
    ...evidenceDraft,
    journal: {
      lastSequence: elapsedTamper.length,
      digest: elapsedTamper.at(-1)!.eventDigest
    }
  });
  expect(() => assertWorkPackageGateEvidenceBundleV4({
    evidence: elapsedTamperEvidence,
    journalSource: `${elapsedTamper.map((event) => JSON.stringify(event)).join('\n')}\n`
  })).toThrow('do not agree');

  const invalidOrder = [
    'started', 'termination', 'deadline', 'recovery', 'residue', 'completed'
  ].reduce<Array<ReturnType<typeof finalizeWorkPackageGateEventV4>>>((records, kind, index) => {
    records.push(finalizeWorkPackageGateEventV4({
      sequence: index + 1,
      kind: kind as 'started' | 'termination' | 'deadline' | 'recovery' | 'residue' | 'completed',
      elapsedMs: index,
      phase: kind,
      stdoutBytes: 0,
      stderrBytes: 0,
      subject: null,
      previousDigest: records.at(-1)?.eventDigest ?? null
    }));
    return records;
  }, []);
  const invalidOrderSource = `${invalidOrder.map((event) => JSON.stringify(event)).join('\n')}\n`;
  expect(() => assertWorkPackageGateJournalV4(invalidOrderSource, {
    lastSequence: invalidOrder.length,
    digest: invalidOrder.at(-1)!.eventDigest
  })).toThrow('event protocol');

  const injectedEvent = finalizeWorkPackageGateEventV4({
    sequence: 1,
    kind: 'started',
    elapsedMs: 0,
    phase: 'preflight',
    stdoutBytes: 0,
    stderrBytes: 0,
    subject: startedSubject,
    previousDigest: null,
    schema: 'codex-work-package-gate-event-v1'
  } as any);
  expect(injectedEvent.schema).toBe('codex-work-package-gate-event-v4');
  const injectedEvidence = finalizeWorkPackageGateEvidenceV4({
    ...evidenceDraft,
    schema: 'codex-work-package-gate-evidence-v1'
  } as any);
  expect(injectedEvidence.schema).toBe('codex-work-package-gate-evidence-v4');

  const dirtyDiagnosticEvidence = finalizeWorkPackageGateEvidenceV4({
    ...evidenceDraft,
    diagnostic: { ...diagnostic, failureMarkerCount: 1 }
  });
  expect(() => assertWorkPackageGateEvidenceV4(dirtyDiagnosticEvidence))
    .toThrow('Passed Work Package gate evidence is incomplete');
});

test('V4 failed recovery preserves and binds its non-empty owner authorization', async () => {
  const selection = await frozenSelectionV4();
  const owner = Object.freeze({ count: 1, digest: `sha256:${'2'.repeat(64)}` });
  const empty = Object.freeze({ count: 0, digest: `sha256:${'1'.repeat(64)}` });
  const postChild: WorkPackageGateResidueCensusV4 = Object.freeze({
    structure: Object.freeze({
      complete: true,
      reason: 'observed',
      counts: Object.freeze({
        workspaceRoots: 1,
        recoveryOwners: 1,
        pendingOwners: 0,
        nativeResults: 0,
        writerLeases: 0
      }),
      recoveryAuthorities: owner
    }),
    aclPresentOwners: Object.freeze({ complete: false, reason: 'host-tool-failed', identities: null })
  });
  const child = {
    status: 'exited', trigger: null, started: true, exitCode: 1, signal: null, durationMs: 1,
    stdout: { bytes: 0, digest: `sha256:${'3'.repeat(64)}`, observerTruncated: false },
    stderr: { bytes: 0, digest: `sha256:${'4'.repeat(64)}`, observerTruncated: false },
    termination: {
      requested: false, gracefulAttempted: false, forcedAttempted: false,
      childCloseObserved: true, streamsDrained: true, treeClosed: true
    }
  };
  const diagnostic = {
    status: 'non-actionable', selectionIndexes: [] as number[], failureMarkerCount: 0,
    unmappedMarkerCount: 0, malformedMarkerCount: 0, oversizedLineCount: 0,
    utf8Invalid: false, ansiInvalid: false, observerTruncated: false, parserFailure: false
  } as const;
  const evidence = finalizeWorkPackageGateEvidenceV4({
    runId: 'sm3-r3-v4-work-package-gate',
    status: 'unknown',
    startedAt: '2026-07-14T00:00:00.000Z',
    completedAt: '2026-07-14T00:00:01.000Z',
    durationMs: 1,
    selection,
    repository: {
      headSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), headShaAfter: null, treeShaAfter: null,
      worktreeBeforeDigest: `sha256:${'5'.repeat(64)}`, worktreeAfterDigest: null,
      executionSnapshotDigest: `sha256:${'5'.repeat(64)}`,
      executionSnapshotAfterDigest: null, executionSnapshotRemoved: false
    },
    authority: {
      protectedLedgerDigest: WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4,
      runDirectoryIdentityDigest: WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4,
      namespaceIdentityDigest: WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4,
      snapshotIdentityDigest: WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4,
      namespaceRootIdentityDigest: WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4
    },
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 },
    child,
    diagnostic,
    recovery: { attempted: true, complete: false, reason: 'failed', authorization: owner },
    residue: {
      preflight: null,
      postChild,
      postRecovery: null,
      final: null,
      namespaceRemovalAttempted: false,
      namespaceRemoved: false
    },
    journal: { lastSequence: 1, digest: `sha256:${'6'.repeat(64)}` }
  });
  expect(() => assertWorkPackageGateEvidenceV4(evidence)).not.toThrow();
  const mismatch = structuredClone(evidence) as Record<string, any>;
  mismatch.recovery.authorization = {
    ...mismatch.recovery.authorization,
    digest: `sha256:${'7'.repeat(64)}`
  };
  const { evidenceDigest: _digest, schema: _schema, ...draft } = mismatch;
  expect(() => assertWorkPackageGateEvidenceV4(finalizeWorkPackageGateEvidenceV4(draft as any)))
    .toThrow('not bound to post-child census');

  const inverse = structuredClone(evidence) as Record<string, any>;
  inverse.recovery = { attempted: false, complete: true, reason: 'not-needed', authorization: null };
  const { evidenceDigest: _inverseDigest, schema: _inverseSchema, ...inverseDraft } = inverse;
  expect(() => assertWorkPackageGateEvidenceV4(finalizeWorkPackageGateEvidenceV4(inverseDraft as any)))
    .toThrow('not bound to post-child census');

  const openTree = structuredClone(evidence) as Record<string, any>;
  openTree.child.termination.treeClosed = false;
  const { evidenceDigest: _openTreeDigest, schema: _openTreeSchema, ...openTreeDraft } = openTree;
  expect(() => assertWorkPackageGateEvidenceV4(finalizeWorkPackageGateEvidenceV4(openTreeDraft as any)))
    .toThrow('before the child tree closed');
});
