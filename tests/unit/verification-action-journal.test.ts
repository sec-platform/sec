import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createDevelopmentCriticalPathStaticAnalysisReadbackV2,
  createDevelopmentCriticalPathStaticClosureV1,
  createDevelopmentCriticalPathWholeDeltaSubjectV1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_PRODUCER_REVISION_V1
} from '../../platform/shared/development-critical-path-contract.ts';
import { PHYSICAL_MUTATION_LEASE_SCHEMA_V1 } from '../../platform/shared/physical-mutation-lease.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  encodeVerificationActionDataV2,
  VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
  type VerificationActionKeyInputV2,
  type VerificationActionTerminalV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  createRuntimeStateJournalFileSystemV1,
  runtimeStateJournalMutationLeaseNameV1
} from '../../tooling/sec-dev/runtime-state-journal-filesystem.ts';
import {
  acquireVerificationActionClaimV1,
  appendVerificationActionJournalEventV2,
  assertVerificationActionEvidenceJournalBindingV1,
  commitVerificationActionEvidenceTerminalUnderClaimV1,
  publishVerificationActionEvidenceV1,
  publishVerificationActionSettlementV1,
  publishVerificationActionStartReceiptV1,
  publishVerificationActionStaticClosureV1,
  readDevelopmentCriticalPathStaticGenerationV1,
  readVerificationActionClaimV1,
  readVerificationActionJournalV2,
  readVerificationActionRetainedStaticClosureV1,
  readVerificationActionSettlementV1,
  readVerificationActionStaticClosureV1,
  recoverVerificationActionStaticClosureRetirementV1,
  releaseVerificationActionClaimV1,
  renewVerificationActionClaimV1,
  retireVerificationActionStaticClosureAfterTrustedSettlementV1,
  retireVerificationActionStaticClosureV1,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2
} from '../../tooling/sec-dev/verification-action-journal.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;

function action(): ReturnType<typeof createVerificationActionKeyV2> {
  const input: VerificationActionKeyInputV2 = {
    actionKind: 'journal-contract',
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
      contractRevision: 'verification-result-v1',
      executionBudget: VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
    },
    requiredCheapPreflightActionKeys: [DIGEST_A],
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1',
    staticProofRequirement: 'bounded-action-admission'
  };
  return createVerificationActionKeyV2(input);
}

function at(index: number): string {
  return `2026-08-09T13:00:0${index}.000Z`;
}

function journalFs(root: string) {
  return createRuntimeStateJournalFileSystemV1(
    inspectNoFollowDirectoryChainV1(root, 'VerificationAction journal test root').target
  );
}

function withStateRoot<T extends object>(root: string, input: T) {
  return { ...input, fs: journalFs(root) };
}

function commitTerminalFixture(
  root: string,
  key: ReturnType<typeof action>,
  terminal: VerificationActionTerminalV2,
  options: Readonly<{ providerRevision?: string; ownerToken?: string }> = {}
): void {
  const fs = journalFs(root);
  const actionPlanDigest = DIGEST_A;
  const staticClosureDigest = `sha256:${'b'.repeat(64)}` as const;
  const providerRevision = options.providerRevision ?? key.environment.providerRevision;
  const ownerToken = options.ownerToken ?? 'journal-terminal-fixture-owner';
  expect(acquireVerificationActionClaimV1({
    fs,
    action: key,
    ownerToken,
    now: at(0),
    leaseDurationMs: 60_000
  }).disposition).toBe('acquired');
  publishVerificationActionStartReceiptV1({
    fs,
    receipt: {
      actionKey: key.actionKey,
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      providerRevision,
      startedAt: at(1)
    }
  });
  appendVerificationActionJournalEventV2({ fs, action: key, state: 'queued', recordedAt: at(1) });
  appendVerificationActionJournalEventV2({ fs, action: key, state: 'running', recordedAt: at(2) });
  const evidence = publishVerificationActionEvidenceV1({
    fs,
    evidence: {
      actionKey: key.actionKey,
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      providerRevision,
      capabilityDigest: `sha256:${'c'.repeat(64)}`,
      terminal,
      evidenceRefs: [`fixture://terminal/${terminal.status}`],
      startedAt: at(1),
      finishedAt: at(3)
    }
  });
  expect(commitVerificationActionEvidenceTerminalUnderClaimV1({
    fs,
    action: key,
    ownerToken,
    now: at(3),
    actionPlanDigest,
    executionBindingDigest: DIGEST_A,
    staticClosureDigest,
    evidence
  })).not.toBeNull();
  publishVerificationActionSettlementV1({
    fs,
    evidence,
    phase: 'complete',
    state: 'settled',
    reasonCode: 'settled',
    detail: 'journal terminal fixture settled',
    observedAt: at(3)
  });
}

function staticClosure() {
  const key = action();
  const plan = createVerificationActionPlanV2({
    action: key,
    executionClass: 'expensive',
    dependencies: [{ actionKey: DIGEST_A, kind: 'cheap-preflight' }]
  });
  const ownerRecords = [...DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1]
    .map((dimension) => ({
      recordId: `test-${dimension}`,
      path: `tests/fixtures/${dimension}.json`,
      domain: `test-${dimension}`,
      owns: [dimension]
    }))
    .sort((left, right) => left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0);
  const analysisProducer = {
    identity: 'tooling/sec-dev/development-critical-path.ts',
    revision: DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_PRODUCER_REVISION_V1,
    sourceDigest: DIGEST_A
  } as const;
  const wholeDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    scope: 'bounded-action-admission',
    base: { commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), inventoryDigest: DIGEST_A },
    head: { commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), inventoryDigest: DIGEST_A },
    changes: [],
    requiredOwners: [],
    ownerProjections: [],
    consumers: [],
    producer: analysisProducer,
    unknowns: []
  });
  const analysis = createDevelopmentCriticalPathStaticAnalysisReadbackV2({
    producerSourceDigest: DIGEST_A,
    repository: {
      headSha: '1'.repeat(40), headTreeSha: '2'.repeat(40), objectFormat: 'sha1', trackedClean: true,
      trackedPathCount: 1, trackedByteCount: 1, inventoryDigest: DIGEST_A
    },
    manifest: {
      path: 'docs/work-packages/test.md', digest: DIGEST_A, authorityRefsDigest: DIGEST_A,
      ownedPathsDigest: DIGEST_A, forbiddenPathsDigest: DIGEST_A
    },
    ownerRegistry: {
      digest: DIGEST_A,
      ownerClosureDigest: DIGEST_A,
      recordsDigest: sha256(ownerRecords) as `sha256:${string}`,
      records: ownerRecords
    },
    actionKey: key.actionKey,
    actionPlanDigest: sha256(plan) as `sha256:${string}`,
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
          owner: ownerRecords.find(({ recordId }) => recordId === `test-${dimension}`)!,
          producer: analysisProducer,
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
  return createDevelopmentCriticalPathStaticClosureV1(plan, analysis, DIGEST_A, [{
    actionKey: DIGEST_A, state: 'terminal-passed', observationDigest: DIGEST_A
  }]);
}

test('static closure publication is content-addressed and closeout readback rejects pointer drift', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-closure-'));
  try {
    const fs = journalFs(root);
    const closure = staticClosure();
    const published = publishVerificationActionStaticClosureV1({ fs, closure });
    expect(published).toEqual(closure);
    expect(readDevelopmentCriticalPathStaticGenerationV1(
      fs,
      closure.analysisReadback.staticGeneration.generationDigest
    )).toEqual(closure.analysisReadback.staticGeneration);
    expect(readVerificationActionStaticClosureV1(fs, closure.actionKey)).toEqual(closure);
    const pointerPath = path.join(
      root,
      VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
      'static-current',
      `${closure.actionKey.slice(7)}.json`
    );
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(pointerPath, `${JSON.stringify({ ...pointer, headTreeSha: '3'.repeat(40) })}\n`, 'utf8');
    expect(() => readVerificationActionStaticClosureV1(fs, closure.actionKey)).toThrow(/pointer digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal mutation lease reclaims only an identity-stable owner proven dead', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-lease-recovery-'));
  try {
    const filePath = path.join(root, 'journals', 'action.jsonl');
    mkdirSync(path.dirname(filePath), { recursive: true });
    const lockPath = path.join(
      path.dirname(filePath),
      runtimeStateJournalMutationLeaseNameV1(root, filePath)
    );
    writeFileSync(lockPath, `${JSON.stringify({
      schema: PHYSICAL_MUTATION_LEASE_SCHEMA_V1,
      host: 'journal-test-host',
      pid: 22001,
      processNonce: '11111111-1111-4111-8111-111111111111',
      token: '22222222-2222-4222-8222-222222222222',
      createdAtMs: 1,
      expiresAtMs: 30_001
    })}\n`, 'utf8');

    const recovered = createRuntimeStateJournalFileSystemV1(
      inspectNoFollowDirectoryChainV1(root, 'VerificationAction journal recovery test root').target,
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
      schema: PHYSICAL_MUTATION_LEASE_SCHEMA_V1,
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

test('V2 journal append/readback validates lifecycle and digest chain in external runtime state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-'));
  try {
    const key = action();
    expect(() => appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'terminal' as const, recordedAt: at(3),
      terminal: { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: DIGEST_A }
    }))).toThrow(/owned exclusively/);
    commitTerminalFixture(root, key, {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    });
    const readback = readVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(readback.schemaState).toBe('current');
    expect(readback.events).toHaveLength(3);
    expect(readback.latestState).toBe('terminal');
    expect(readback.terminal?.status).toBe('passed');
    expect(readback.events[1]!.previousDigest).toBe(readback.events[0]!.eventDigest);
    expect(readback.events[2]!.previousDigest).toBe(readback.events[1]!.eventDigest);
    expect(readback.filePath).toBe(path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, `${key.actionKey.slice(7)}.jsonl`));
    expect(readback.filePath).not.toContain('.tmp/codex');
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'invalidated' as const,
      recordedAt: at(4), note: 'input changed'
    }));
    const invalidated = readVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(invalidated.latestState).toBe('invalidated');
    expect(invalidated.terminal).toBeNull();
    expect(invalidated.events[2]!.terminal?.status).toBe('passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider start and terminal Evidence are immutable and bind before journal projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-evidence-v1-'));
  try {
    const key = action();
    const fs = journalFs(root);
    const actionPlanDigest = DIGEST_A;
    const staticClosureDigest = `sha256:${'b'.repeat(64)}` as const;
    const ownerToken = 'evidence-binding-owner';
    expect(acquireVerificationActionClaimV1({
      fs, action: key, ownerToken, now: at(0), leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    publishVerificationActionStartReceiptV1({
      fs,
      receipt: {
        actionKey: key.actionKey,
        actionPlanDigest,
        executionBindingDigest: DIGEST_A,
        staticClosureDigest,
        providerRevision: 'local-test-provider-v1',
        startedAt: at(1)
      }
    });
    appendVerificationActionJournalEventV2({ fs, action: key, state: 'queued', recordedAt: at(1) });
    appendVerificationActionJournalEventV2({ fs, action: key, state: 'running', recordedAt: at(2) });
    const evidence = publishVerificationActionEvidenceV1({
      fs,
      evidence: {
        actionKey: key.actionKey,
        actionPlanDigest,
        executionBindingDigest: DIGEST_A,
        staticClosureDigest,
        providerRevision: 'local-test-provider-v1',
        capabilityDigest: `sha256:${'c'.repeat(64)}`,
        terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A },
        evidenceRefs: ['provider://terminal/1'],
        startedAt: at(2),
        finishedAt: at(3)
      }
    });
    expect(commitVerificationActionEvidenceTerminalUnderClaimV1({
      fs,
      action: key,
      ownerToken,
      now: at(3),
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      evidence
    })).not.toBeNull();
    const readback = readVerificationActionJournalV2(fs, key.actionKey);
    expect(readback.startReceipt?.actionKey).toBe(key.actionKey);
    expect(readback.evidence?.evidenceDigest).toBe(evidence.evidenceDigest);
    expect(assertVerificationActionEvidenceJournalBindingV1({
      journal: readback,
      actionKey: key.actionKey,
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest
    }).evidenceDigest).toBe(evidence.evidenceDigest);
    publishVerificationActionSettlementV1({
      fs,
      evidence,
      phase: 'release',
      state: 'pending',
      reasonCode: 'provider-release-pending',
      detail: 'release pending',
      observedAt: at(3)
    });
    const settled = publishVerificationActionSettlementV1({
      fs,
      evidence,
      phase: 'complete',
      state: 'settled',
      reasonCode: 'settled',
      detail: 'release complete',
      observedAt: at(4)
    });
    expect(readVerificationActionSettlementV1(fs, key.actionKey)).toEqual(settled);
    expect(() => publishVerificationActionSettlementV1({
      fs,
      evidence,
      phase: 'release',
      state: 'pending',
      reasonCode: 'provider-release-failed',
      detail: 'late failure cannot reopen settlement',
      observedAt: at(5)
    })).toThrow(/cannot return to a pending/);
    expect(() => publishVerificationActionEvidenceV1({
      fs,
      evidence: {
        ...evidence,
        terminal: { status: 'failed', reasonCode: 'executed-failure', resultDigest: null }
      }
    })).toThrow(/different binding/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('terminal Evidence cannot become journal terminal without its exact durable start receipt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-missing-start-v1-'));
  try {
    const key = action();
    const fs = journalFs(root);
    const actionPlanDigest = DIGEST_A;
    const staticClosureDigest = `sha256:${'b'.repeat(64)}` as const;
    const ownerToken = 'missing-start-owner';
    expect(acquireVerificationActionClaimV1({
      fs,
      action: key,
      ownerToken,
      now: at(0),
      leaseDurationMs: 60_000
    }).disposition).toBe('acquired');
    appendVerificationActionJournalEventV2({ fs, action: key, state: 'queued', recordedAt: at(1) });
    appendVerificationActionJournalEventV2({ fs, action: key, state: 'running', recordedAt: at(2) });
    const evidence = publishVerificationActionEvidenceV1({
      fs,
      evidence: {
        actionKey: key.actionKey,
        actionPlanDigest,
        executionBindingDigest: DIGEST_A,
        staticClosureDigest,
        providerRevision: 'local-test-provider-v1',
        capabilityDigest: `sha256:${'c'.repeat(64)}`,
        terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A },
        evidenceRefs: ['provider://terminal/missing-start'],
        startedAt: at(2),
        finishedAt: at(3)
      }
    });
    expect(() => commitVerificationActionEvidenceTerminalUnderClaimV1({
      fs,
      action: key,
      ownerToken,
      now: at(3),
      actionPlanDigest,
      executionBindingDigest: DIGEST_A,
      staticClosureDigest,
      evidence
    })).toThrow(/exact durable start receipt/);
    expect(readVerificationActionJournalV2(fs, key.actionKey).latestState).toBe('running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('terminal reuse history is compacted to an immutable bounded lifecycle prefix', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-compaction-'));
  try {
    const key = action();
    const terminal = {
      status: 'passed' as const,
      reasonCode: 'executed-success' as const,
      resultDigest: DIGEST_A
    };
    commitTerminalFixture(root, key, terminal);
    for (let index = 0; index < 12; index += 1) {
      appendVerificationActionJournalEventV2(withStateRoot(root, {
        repositoryRoot: 'R:/repo', action: key, state: 'reused' as const,
        recordedAt: new Date(Date.parse(at(0)) + (4 + index) * 1_000).toISOString(), terminal
      }));
    }
    const compacted = readVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(compacted.events).toHaveLength(4);
    expect(compacted.events.map((event) => event.state))
      .toEqual(['queued', 'running', 'terminal', 'reused']);
    expect(compacted.events[2]!.terminal).toEqual(terminal);
    expect(compacted.events[3]!.note).toMatch(/terminal reuse history compacted; omitted=/u);
    const journalPath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
      `${key.actionKey.slice(7)}.jsonl`);
    const boundedBytes = readFileSync(journalPath, 'utf8').length;
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'cancelled' as const,
      recordedAt: new Date(Date.parse(at(0)) + 20 * 1_000).toISOString(), note: 'terminal cancellation'
    }));
    const cancelled = readVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(cancelled.events).toHaveLength(4);
    expect(cancelled.latestState).toBe('cancelled');
    expect(readFileSync(journalPath, 'utf8').length).toBeLessThanOrEqual(boundedBytes + 256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal rejects corrupt and partial tails before exposing any projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-corrupt-'));
  try {
    const key = action();
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, `${key.actionKey.slice(7)}.jsonl`);
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, `${original.slice(0, -1)}{"partial":true}`, 'utf8');
    expect(() => readVerificationActionJournalV2(journalFs(root), key.actionKey)).toThrow(/invalid JSON|partial/);
    writeFileSync(filePath, original.replace('"recordedAt":"2026-08-09T13:00:01.000Z"', '"recordedAt":"2026-08-09T13:00:02.000Z"'), 'utf8');
    expect(() => readVerificationActionJournalV2(journalFs(root), key.actionKey)).toThrow(/digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('old V1 journal records are stale and cannot be projected into V2', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-stale-'));
  try {
    const key = action();
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, `${key.actionKey.slice(7)}.jsonl`);
    const oldEvent = {
      schema: 'sec-verification-action-journal-event-v1',
      sequence: 1,
      actionKey: key.actionKey,
      action: { ...key, schema: 'sec-verification-action-key-v1' },
      state: 'terminal',
      recordedAt: at(1),
      terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: null },
      note: null,
      previousDigest: null,
      eventDigest: DIGEST_A
    };
    mkdirForFile(filePath);
    writeFileSync(filePath, `${JSON.stringify(oldEvent)}\n`, 'utf8');
    expect(readVerificationActionJournalV2(journalFs(root), key.actionKey).schemaState).toBe('stale');
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(2)
    }));
    const fresh = readVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(fresh.schemaState).toBe('current');
    expect(fresh.latestState).toBe('queued');
    expect(fresh.events).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mixed V2 prefix and V1 tail is corruption, not a disposable stale journal', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-mixed-'));
  try {
    const key = action();
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, `${key.actionKey.slice(7)}.jsonl`);
    const oldTail = {
      schema: 'sec-verification-action-journal-event-v1',
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
    writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}${JSON.stringify(oldTail)}\n`, 'utf8');
    expect(() => readVerificationActionJournalV2(journalFs(root), key.actionKey)).toThrow(/schema mismatch|V1 journal records/);
    expect(() => appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(3)
    }))).toThrow(/schema mismatch|V1 journal records/);
    expect(readFileSync(filePath, 'utf8')).toContain('sec-verification-action-journal-event-v1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mkdirForFile(filePath: string): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
}

function publishTerminalStaticClosure(root: string): ReturnType<typeof staticClosure> {
  const fs = journalFs(root);
  const closure = staticClosure();
  commitTerminalFixture(root, action(), {
    status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
  });
  publishVerificationActionStaticClosureV1({ fs, closure });
  return closure;
}

function staticNamespacePath(root: string, namespace: 'static-current' | 'static-closures', file: string): string {
  return path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, namespace, file);
}

test('illegal transitions are rejected and a caller cannot erase the retained terminal history', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-delete-'));
  try {
    const key = action();
    expect(() => appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(1)
    }))).toThrow('must begin with queued');
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'cancelled' as const,
      recordedAt: at(2), note: 'cancelled by test'
    }));
    expect(() => appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(3)
    }))).toThrow('illegal transition');
    expect(readVerificationActionJournalV2(journalFs(root), key.actionKey)).toMatchObject({
      latestState: 'cancelled', terminal: null
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomic claim joins one live physical owner and rejects wrong-owner release', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-race-'));
  try {
    const key = action();
    const first = acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'owner-a', now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 60_000
    }));
    const second = acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'owner-b', now: '2026-08-09T00:00:01.000Z', leaseDurationMs: 60_000
    }));
    expect(first.disposition).toBe('acquired');
    expect(second.disposition).toBe('joined');
    expect(() => releaseVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey, ownerToken: 'owner-b'
    }))).toThrow('owner mismatch');
    expect(readVerificationActionClaimV1(journalFs(root), key.actionKey)?.ownerToken).toBe('owner-a');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('expired crash lease permanently blocks blind re-execution under the same ActionKey', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-recovery-'));
  try {
    const key = action();
    acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'crashed',
      now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 1_000
    }));
    const blocked = acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'successor', now: '2026-08-09T00:00:02.000Z', leaseDurationMs: 60_000
    }));
    const contender = acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key,
      ownerToken: 'other', now: '2026-08-09T00:00:03.000Z', leaseDurationMs: 60_000
    }));
    expect(blocked.disposition).toBe('blocked');
    expect(blocked.reason).toContain('blind re-execution is forbidden');
    expect(contender.disposition).toBe('blocked');
    expect(readVerificationActionClaimV1(journalFs(root), key.actionKey)?.ownerToken).toBe('crashed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only the current owner can renew a live lease', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-claim-renew-'));
  try {
    const key = action();
    acquireVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, ownerToken: 'owner-a',
      now: '2026-08-09T00:00:00.000Z', leaseDurationMs: 1_000
    }));
    expect(renewVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey,
      ownerToken: 'owner-a', now: '2026-08-09T00:00:00.500Z', leaseDurationMs: 60_000
    }))).toBe(true);
    expect(renewVerificationActionClaimV1(withStateRoot(root, {
      repositoryRoot: 'R:/repo', actionKey: key.actionKey,
      ownerToken: 'owner-b', now: '2026-08-09T00:00:01.000Z', leaseDurationMs: 60_000
    }))).toBe(false);
    expect(readVerificationActionClaimV1(journalFs(root), key.actionKey)?.expiresAt)
      .toBe('2026-08-09T00:01:00.500Z');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement fails closed before reading caller-supplied proof or performing Effect', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-preconditions-'));
  try {
    const closure = staticClosure();
    const fs = journalFs(root);
    publishVerificationActionStaticClosureV1({ fs, closure });
    const poisonCallerFields = {
      actionKey: closure.actionKey,
      get fs(): never { throw new Error('retirement must not request a filesystem capability'); },
      get proof(): never { throw new Error('retirement must not request a caller-authored proof'); }
    } as never;
    expect(retireVerificationActionStaticClosureV1(poisonCallerFields).blockers)
      .toEqual(['production-consumer-unwired']);

    commitTerminalFixture(root, action(), {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    });
    expect(retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey }).blockers)
      .toEqual(['production-consumer-unwired']);
    expect(readVerificationActionStaticClosureV1(fs, closure.actionKey)).not.toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('trusted settlement retires only the active pointer and durably retains closure plus terminal Evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-trusted-retirement-'));
  try {
    const fs = journalFs(root);
    const closure = staticClosure();
    publishVerificationActionStaticClosureV1({ fs, closure });
    commitTerminalFixture(root, action(), {
      status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A
    });
    const retired = retireVerificationActionStaticClosureAfterTrustedSettlementV1({
      fs,
      actionKey: closure.actionKey,
      sessionRevision: DIGEST_A,
      artifactDigest: `sha256:${'b'.repeat(64)}`,
      settlementDigest: `sha256:${'c'.repeat(64)}`
    });
    expect(retired).toMatchObject({
      disposition: 'retired',
      phase: 'pointer-retired-object-retained',
      blockers: []
    });
    expect(readVerificationActionStaticClosureV1(fs, closure.actionKey)).toBeNull();
    expect(readVerificationActionRetainedStaticClosureV1(fs, closure.actionKey)).toEqual(closure);
    expect(readVerificationActionJournalV2(fs, closure.actionKey).evidence).not.toBeNull();
    expect(existsSync(staticNamespacePath(
      root, 'static-closures', `${closure.closureDigest.slice(7)}.json`
    ))).toBe(true);
    expect(retireVerificationActionStaticClosureAfterTrustedSettlementV1({
      fs,
      actionKey: closure.actionKey,
      sessionRevision: DIGEST_A,
      artifactDigest: `sha256:${'b'.repeat(64)}`,
      settlementDigest: `sha256:${'c'.repeat(64)}`
    }).receipt.receiptDigest).toBe(retired.receipt.receiptDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement preserves pointer, object, and journal while production consumer is unwired', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-clean-'));
  try {
    const closure = publishTerminalStaticClosure(root);
    const fs = journalFs(root);
    const result = retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey });
    expect(result.disposition).toBe('blocked');
    expect(result.blockers).toEqual(['production-consumer-unwired']);
    expect(existsSync(staticNamespacePath(root, 'static-current', `${closure.actionKey.slice(7)}.json`))).toBe(true);
    expect(existsSync(staticNamespacePath(root, 'static-closures', `${closure.closureDigest.slice(7)}.json`))).toBe(true);
    expect(existsSync(path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, 'static-retirement', `${closure.actionKey.slice(7)}.json`))).toBe(false);
    expect(existsSync(path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
      `${closure.actionKey.slice(7)}.jsonl`))).toBe(true);
    expect(readVerificationActionStaticClosureV1(fs, closure.actionKey)).not.toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement preserves shared objects without trusting caller-visible reference topology', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-shared-'));
  try {
    const closure = publishTerminalStaticClosure(root);
    const fs = journalFs(root);
    const second = createVerificationActionKeyV2({
      ...({
        actionKind: 'journal-contract',
        producer: { identity: 'journal-test-2', revision: 'r1' },
        operation: {
          identity: 'bun-test', revision: 'normalizer-v1', semanticDigest: DIGEST_A,
          workingDirectory: '.', declaredEnvironment: []
        },
        inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_A }],
        environment: {
          toolchainRevision: 'bun@1.3.14', providerRevision: 'local',
          contractRevision: 'verification-result-v1',
          executionBudget: VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
        },
        requiredCheapPreflightActionKeys: [DIGEST_A], upstreamActionKeys: [],
        resultSchemaRevision: 'sec-verification-result-v1', staticProofRequirement: 'bounded-action-admission'
      } satisfies VerificationActionKeyInputV2)
    });
    const pointerMaterial = {
      schema: 'sec-verification-action-static-closure-pointer-v1' as const,
      actionKey: second.actionKey,
      closureDigest: closure.closureDigest,
      actionPlanDigest: closure.actionPlanDigest,
      headTreeSha: closure.analysisReadback.repository.headTreeSha,
      readbackDigest: closure.analysisReadback.readbackDigest
    };
    const pointer = {
      ...pointerMaterial,
      pointerDigest: `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(pointerMaterial)).digest('hex')}`
    };
    const secondPath = staticNamespacePath(root, 'static-current', `${second.actionKey.slice(7)}.json`);
    mkdirForFile(secondPath);
    writeFileSync(secondPath, `${encodeVerificationActionDataV2(pointer)}\n`, 'utf8');
    const result = retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey });
    expect(result.disposition).toBe('blocked');
    expect(result.blockers).toEqual(['production-consumer-unwired']);
    expect(result.sharedObjectReferences).toBe(0);
    expect(existsSync(staticNamespacePath(root, 'static-closures', `${closure.closureDigest.slice(7)}.json`))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement preserves malformed and unknown namespace entries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-unknown-'));
  try {
    const closure = publishTerminalStaticClosure(root);
    const unknown = staticNamespacePath(root, 'static-current', 'unexpected.txt');
    mkdirForFile(unknown);
    writeFileSync(unknown, 'foreign\n', 'utf8');
    const result = retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey });
    expect(result.disposition).toBe('blocked');
    expect(result.blockers).toEqual(['production-consumer-unwired']);
    expect(existsSync(unknown)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement retains an object replaced under its digest path', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-replaced-'));
  try {
    const closure = publishTerminalStaticClosure(root);
    const objectPath = staticNamespacePath(root, 'static-closures', `${closure.closureDigest.slice(7)}.json`);
    writeFileSync(objectPath, '{}\n', 'utf8');
    const result = retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey });
    expect(result.disposition).toBe('blocked');
    expect(result.blockers).toEqual(['production-consumer-unwired']);
    expect(existsSync(objectPath)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('static closure retirement recovery cannot bypass the unwired production consumer blocker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-static-retirement-recovery-'));
  try {
    const closure = publishTerminalStaticClosure(root);
    const first = retireVerificationActionStaticClosureV1({ actionKey: closure.actionKey });
    expect(first.disposition).toBe('blocked');
    expect(first.blockers).toEqual(['production-consumer-unwired']);
    expect(first.intent).toBeNull();
    expect(existsSync(staticNamespacePath(root, 'static-current', `${closure.actionKey.slice(7)}.json`))).toBe(true);
    expect(existsSync(staticNamespacePath(root, 'static-closures', `${closure.closureDigest.slice(7)}.json`))).toBe(true);
    const recovered = recoverVerificationActionStaticClosureRetirementV1({ actionKey: closure.actionKey });
    expect(recovered.disposition).toBe('blocked');
    expect(recovered.blockers).toEqual(['production-consumer-unwired']);
    expect(existsSync(staticNamespacePath(root, 'static-closures', `${closure.closureDigest.slice(7)}.json`))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
