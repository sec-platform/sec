import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createVerificationActionKeyV1,
  type VerificationActionKeyInputV1
} from '../../scripts/codex/verification-action-contract.ts';
import {
  appendVerificationActionJournalEventV1,
  deleteVerificationActionJournalV1,
  readVerificationActionJournalV1,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY
} from '../../scripts/codex/verification-action-journal.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;

function action(): ReturnType<typeof createVerificationActionKeyV1> {
  const input: VerificationActionKeyInputV1 = {
    actionKind: 'journal-contract',
    producer: { identity: 'journal-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      executionClass: 'expensive',
      declaredEnvironment: []
    },
    inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_A }],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local',
      contractRevision: 'verification-result-v1'
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: [],
    resultSchemaRevision: 'sec-verification-result-v1'
  };
  return createVerificationActionKeyV1(input);
}

function at(index: number): string {
  return `2026-08-08T13:00:0${index}.000Z`;
}

test('journal append/readback validates lifecycle and digest chain', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-'));
  try {
    const key = action();
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(2)
    });
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'terminal',
      recordedAt: at(3),
      terminal: { status: 'passed', reasonCode: 'executed-success', resultDigest: DIGEST_A }
    });
    const readback = readVerificationActionJournalV1(root, key.actionKey);
    expect(readback.events).toHaveLength(3);
    expect(readback.latestState).toBe('terminal');
    expect(readback.terminal?.status).toBe('passed');
    expect(readback.events[1]!.previousDigest).toBe(readback.events[0]!.eventDigest);
    expect(readback.events[2]!.previousDigest).toBe(readback.events[1]!.eventDigest);
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'invalidated',
      recordedAt: at(4),
      note: 'input changed'
    });
    const invalidated = readVerificationActionJournalV1(root, key.actionKey);
    expect(invalidated.latestState).toBe('invalidated');
    expect(invalidated.terminal).toBeNull();
    expect(invalidated.events[2]!.terminal?.status).toBe('passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal rejects corrupt and partial tails before exposing any projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-corrupt-'));
  try {
    const key = action();
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    const filePath = path.join(root, VERIFICATION_ACTION_JOURNAL_DIRECTORY, `${key.actionKey.slice(7)}.jsonl`);
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, `${original.slice(0, -1)}{"partial":true}`, 'utf8');
    expect(() => readVerificationActionJournalV1(root, key.actionKey)).toThrow(/invalid JSON|partial/);
    writeFileSync(filePath, original.replace('"recordedAt":"2026-08-08T13:00:01.000Z"', '"recordedAt":"2026-08-08T13:00:02.000Z"'), 'utf8');
    expect(() => readVerificationActionJournalV1(root, key.actionKey)).toThrow(/digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('illegal transitions are rejected and deleting the journal returns a clean empty projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-action-journal-delete-'));
  try {
    const key = action();
    expect(() => appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(1)
    })).toThrow('must begin with queued');
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'queued',
      recordedAt: at(1)
    });
    appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'cancelled',
      recordedAt: at(2),
      note: 'cancelled by test'
    });
    expect(() => appendVerificationActionJournalEventV1({
      repositoryRoot: root,
      action: key,
      state: 'running',
      recordedAt: at(3)
    })).toThrow('illegal transition');
    deleteVerificationActionJournalV1(root, key.actionKey);
    expect(readVerificationActionJournalV1(root, key.actionKey)).toMatchObject({
      events: [],
      latestState: null,
      terminal: null
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
