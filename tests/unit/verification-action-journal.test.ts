import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PHYSICAL_MUTATION_LEASE_SCHEMA_V1 } from '../../platform/shared/physical-mutation-lease.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  createVerificationActionKeyV2,
  type VerificationActionKeyInputV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  createRuntimeStateJournalFileSystemV1,
  runtimeStateJournalMutationLeaseNameV1
} from '../../tooling/sec-dev/runtime-state-journal-filesystem.ts';
import {
  acquireVerificationActionClaimV1,
  appendVerificationActionJournalEventV2,
  deleteVerificationActionJournalV2,
  readVerificationActionClaimV1,
  readVerificationActionJournalV2,
  releaseVerificationActionClaimV1,
  renewVerificationActionClaimV1,
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
      contractRevision: 'verification-result-v1'
    },
    requiredCheapPreflightActionKeys: [DIGEST_A],
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1'
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
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'queued' as const, recordedAt: at(1)
    }));
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'running' as const, recordedAt: at(2)
    }));
    appendVerificationActionJournalEventV2(withStateRoot(root, {
      repositoryRoot: 'R:/repo', action: key, state: 'terminal' as const, recordedAt: at(3),
      terminal: { status: 'passed' as const, reasonCode: 'executed-success' as const, resultDigest: DIGEST_A }
    }));
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

test('illegal transitions are rejected and deleting the journal returns a clean empty projection', () => {
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
    deleteVerificationActionJournalV2(journalFs(root), key.actionKey);
    expect(readVerificationActionJournalV2(journalFs(root), key.actionKey)).toMatchObject({
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
