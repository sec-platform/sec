import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeDurableFile } from '../../scripts/codex/branch-recovery.ts';
import {
  loadFreezeSession,
  persistFreezeSession,
  readbackFreezeSession
} from '../../scripts/codex/verification-freeze-session.ts';
import {
  createFreezeSessionV1
} from '../../scripts/codex/verification-session-contract.ts';

const BASE_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const TREE_SHA = '3333333333333333333333333333333333333333';
const MANIFEST_DIGEST = `sha256:${'b'.repeat(64)}` as const;

test('freeze session persists and readbacks byte-exact identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-freeze-session-'));
  try {
    const session = createFreezeSessionV1({
      sessionId: 'sess-persist',
      frozenAt: '2026-08-07T00:00:00.000Z',
      repository: 'sec-platform/sec',
      prNumber: 9,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      manifestPath: 'docs/work-packages/example-v1.md',
      manifestDigest: MANIFEST_DIGEST,
      candidateTreeSha: TREE_SHA
    });
    const filePath = persistFreezeSession(root, session);
    expect(existsSync(filePath)).toBe(true);
    expect(readbackFreezeSession(root, session)).toEqual(session);
    expect(loadFreezeSession(root, session.sessionId).sessionDigest).toBe(session.sessionDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freeze session readback rejects a tampered persisted file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-freeze-tamper-'));
  try {
    const session = createFreezeSessionV1({
      sessionId: 'sess-tamper',
      frozenAt: '2026-08-07T00:00:00.000Z',
      repository: 'sec-platform/sec',
      prNumber: 9,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      manifestPath: 'docs/work-packages/example-v1.md',
      manifestDigest: MANIFEST_DIGEST,
      candidateTreeSha: TREE_SHA
    });
    persistFreezeSession(root, session);
    const filePath = path.join(
      root,
      '.tmp/codex/verification-sessions',
      `${session.sessionId}.json`
    );
    writeDurableFile(filePath, '{"tampered":true}\n');
    expect(() => loadFreezeSession(root, session.sessionId)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
