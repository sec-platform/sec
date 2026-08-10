import { expect, test } from 'bun:test';

import {
  appendVerificationSessionJournalEventV1,
  claimVerificationSessionOperationV1,
  createVerificationSessionOperationId,
  readVerificationSessionJournalV1,
  type VerificationSessionJournalFileSystem
} from '../../scripts/codex/verification-session-journal.ts';

const SESSION = `sha256:${'a'.repeat(64)}` as const;
const INPUT = `sha256:${'b'.repeat(64)}` as const;

class MemoryFs implements VerificationSessionJournalFileSystem {
  readonly files = new Map<string, string>();
  failNextCas = false;
  exists(filePath: string): boolean { return this.files.has(filePath); }
  readText(filePath: string): string {
    const value = this.files.get(filePath);
    if (value === undefined) throw new Error(`missing ${filePath}`);
    return value;
  }
  ensureDirectory(): void {}
  appendFsyncCas(filePath: string, expectedBytes: number, text: string): boolean {
    if (this.failNextCas) {
      this.failNextCas = false;
      return false;
    }
    const current = this.files.get(filePath) ?? '';
    if (Buffer.byteLength(current) !== expectedBytes) return false;
    this.files.set(filePath, current + text);
    return true;
  }
  createExclusiveFsync(filePath: string, text: string): boolean {
    if (this.files.has(filePath)) return false;
    this.files.set(filePath, text);
    return true;
  }
}

function at(index: number): string {
  return `2026-08-09T14:00:0${index}.000Z`;
}

test('session journal persists a monotonic fsync/CAS hash chain', () => {
  const fs = new MemoryFs();
  const root = 'R:/repo';
  const frozen = appendVerificationSessionJournalEventV1({
    repositoryRoot: root,
    sessionRevision: SESSION,
    targetStage: 'frozen',
    kind: 'completed',
    receiptDigest: INPUT,
    recordedAt: at(1),
    fs
  });
  const actions = appendVerificationSessionJournalEventV1({
    repositoryRoot: root,
    sessionRevision: SESSION,
    targetStage: 'actions-terminal',
    kind: 'completed',
    receiptDigest: INPUT,
    recordedAt: at(2),
    fs
  });
  expect(actions.previousDigest).toBe(frozen.eventDigest);
  expect(readVerificationSessionJournalV1({ repositoryRoot: root, sessionRevision: SESSION, fs }))
    .toMatchObject({ completedStage: 'actions-terminal', completedStageIndex: 1 });
  expect(() => appendVerificationSessionJournalEventV1({
    repositoryRoot: root,
    sessionRevision: SESSION,
    targetStage: 'hosted-verification-terminal',
    kind: 'completed',
    recordedAt: at(3),
    fs
  })).toThrow('skips a required stage');
});

test('waiting and failed observations do not advance the completed stage', () => {
  const fs = new MemoryFs();
  const root = 'R:/repo';
  appendVerificationSessionJournalEventV1({
    repositoryRoot: root,
    sessionRevision: SESSION,
    targetStage: 'frozen',
    kind: 'completed',
    recordedAt: at(1),
    fs
  });
  appendVerificationSessionJournalEventV1({
    repositoryRoot: root,
    sessionRevision: SESSION,
    targetStage: 'actions-terminal',
    kind: 'waiting',
    recordedAt: at(2),
    fs
  });
  expect(readVerificationSessionJournalV1({ repositoryRoot: root, sessionRevision: SESSION, fs }))
    .toMatchObject({ completedStage: 'frozen', completedStageIndex: 0 });
});

test('stable operation claim is immutable and prevents duplicate side effects', () => {
  const fs = new MemoryFs();
  const operationId = createVerificationSessionOperationId({
    sessionRevision: SESSION,
    operationKind: 'request-review',
    semanticInputDigest: INPUT
  });
  const first = claimVerificationSessionOperationV1({
    repositoryRoot: 'R:/repo',
    sessionRevision: SESSION,
    operationId,
    operationKind: 'request-review',
    claimedAt: at(1),
    fs
  });
  const second = claimVerificationSessionOperationV1({
    repositoryRoot: 'R:/repo',
    sessionRevision: SESSION,
    operationId,
    operationKind: 'request-review',
    claimedAt: at(2),
    fs
  });
  expect(first.claimed).toBe(true);
  expect(second.claimed).toBe(false);
  expect(second.claim.claimDigest).toBe(first.claim.claimDigest);
  expect(second.claim.claimedAt).toBe(at(1));
});

test('concurrent journal append fails closed and corrupt tails are rejected', () => {
  const fs = new MemoryFs();
  fs.failNextCas = true;
  expect(() => appendVerificationSessionJournalEventV1({
    repositoryRoot: 'R:/repo',
    sessionRevision: SESSION,
    targetStage: 'frozen',
    kind: 'completed',
    recordedAt: at(1),
    fs
  })).toThrow('changed concurrently');

  fs.files.clear();
  appendVerificationSessionJournalEventV1({
    repositoryRoot: 'R:/repo',
    sessionRevision: SESSION,
    targetStage: 'frozen',
    kind: 'completed',
    recordedAt: at(1),
    fs
  });
  const journal = [...fs.files.keys()].find((filePath) => filePath.endsWith('journal.jsonl'))!;
  fs.files.set(journal, `${fs.files.get(journal)!}{"partial":true}`);
  expect(() => readVerificationSessionJournalV1({
    repositoryRoot: 'R:/repo',
    sessionRevision: SESSION,
    fs
  })).toThrow('partial final line');
});
