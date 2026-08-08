import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createVerificationActionKeyV2,
  type VerificationActionKeyInputV2
} from '../../scripts/codex/verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV2,
  deleteVerificationActionJournalV2,
  readVerificationActionJournalV2,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2
} from '../../scripts/codex/verification-action-journal.ts';

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

test('V2 journal append/readback validates lifecycle and digest chain', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-v2-'));
  try {
    const key = action();
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(2)
    });
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'terminal',
      recordedAt: at(3),
      terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A }
    });
    const readback = readVerificationActionJournalV2(root, key.actionKey);
    expect(readback.schemaState).toBe('current');
    expect(readback.events).toHaveLength(3);
    expect(readback.latestState).toBe('terminal');
    expect(readback.terminal?.status).toBe('passed');
    expect(readback.events[1]!.previousDigest).toBe(readback.events[0]!.eventDigest);
    expect(readback.events[2]!.previousDigest).toBe(readback.events[1]!.eventDigest);
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'invalidated',
      recordedAt: at(4),
      note: 'input changed'
    });
    const invalidated = readVerificationActionJournalV2(root, key.actionKey);
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
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2, `${key.actionKey.slice(7)}.jsonl`);
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, `${original.slice(0, -1)}{"partial":true}`, 'utf8');
    expect(() => readVerificationActionJournalV2(root, key.actionKey)).toThrow(/invalid JSON|partial/);
    writeFileSync(filePath, original.replace('"recordedAt":"2026-08-09T13:00:01.000Z"', '"recordedAt":"2026-08-09T13:00:02.000Z"'), 'utf8');
    expect(() => readVerificationActionJournalV2(root, key.actionKey)).toThrow(/digest mismatch/);
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
    expect(readVerificationActionJournalV2(root, key.actionKey).schemaState).toBe('stale');
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(2)
    });
    const fresh = readVerificationActionJournalV2(root, key.actionKey);
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
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
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
    expect(() => readVerificationActionJournalV2(root, key.actionKey)).toThrow(/schema mismatch|V1 journal records/);
    expect(() => appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(3)
    })).toThrow(/schema mismatch|V1 journal records/);
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
    expect(() => appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(1)
    })).toThrow('must begin with queued');
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'cancelled',
      recordedAt: at(2),
      note: 'cancelled by test'
    });
    expect(() => appendVerificationActionJournalEventV2({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(3)
    })).toThrow('illegal transition');
    deleteVerificationActionJournalV2(root, key.actionKey);
    expect(readVerificationActionJournalV2(root, key.actionKey)).toMatchObject({
      events: [],
      latestState: null,
      terminal: null
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
