/**
 * FreezeSession durability: exact candidate freeze with digest-bound identity
 * and readback (Issue #311 Phase 0).
 */

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { writeDurableFile } from './branch-recovery.ts';
import {
  createFreezeSessionV1,
  parseVerificationFreezeSessionV1,
  type VerificationFreezeSessionV1
} from './verification-session-contract.ts';

export const VERIFICATION_SESSION_DIRECTORY = '.tmp/codex/verification-sessions' as const;

export function freezeSessionFilePath(
  repositoryRoot: string,
  sessionId: string
): string {
  return path.join(repositoryRoot, VERIFICATION_SESSION_DIRECTORY, `${sessionId}.json`);
}

export function persistFreezeSession(
  repositoryRoot: string,
  session: VerificationFreezeSessionV1
): string {
  const filePath = freezeSessionFilePath(repositoryRoot, session.sessionId);
  writeDurableFile(filePath, `${JSON.stringify(session, null, 2)}\n`);
  return filePath;
}

export function loadFreezeSession(
  repositoryRoot: string,
  sessionId: string
): VerificationFreezeSessionV1 {
  const filePath = freezeSessionFilePath(repositoryRoot, sessionId);
  return parseVerificationFreezeSessionV1(readFileSync(filePath, 'utf8'));
}

export function readbackFreezeSession(
  repositoryRoot: string,
  session: VerificationFreezeSessionV1
): VerificationFreezeSessionV1 {
  const reloaded = loadFreezeSession(repositoryRoot, session.sessionId);
  if (reloaded.sessionDigest !== session.sessionDigest) {
    throw new Error('FreezeSession readback digest mismatch.');
  }
  return reloaded;
}

export function assertFreezeSessionDirectory(repositoryRoot: string): void {
  mkdirSync(path.join(repositoryRoot, VERIFICATION_SESSION_DIRECTORY), { recursive: true });
}

export function freezeSessionFromFacts(input: {
  sessionId: string;
  frozenAt: string;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  candidateTreeSha: string;
}): VerificationFreezeSessionV1 {
  return createFreezeSessionV1(input);
}
