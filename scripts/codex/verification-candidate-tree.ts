/**
 * Candidate Tree parity: merged main tree must equal the frozen candidate tree
 * for a session (Issue #311 Phase 0).
 */

import { spawnSync } from 'node:child_process';

import {
  createBranchLifecycleGitChildEnvironmentV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import {
  createCandidateTreeParityV1,
  parseVerificationCandidateTreeParityV1,
  type VerificationCandidateTreeParityV1
} from './verification-session-contract.ts';

export function resolveTreeSha(
  repositoryRoot: string,
  ref: string
): string {
  if (ref.includes('\0')) throw new Error('Tree ref contains NUL.');
  const spawned = spawnSync('git', ['rev-parse', '--verify', `${ref}^{tree}`], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: createBranchLifecycleGitChildEnvironmentV1(process.env)
  });
  const result = {
    status: spawned.status,
    stdout: Buffer.isBuffer(spawned.stdout)
      ? spawned.stdout
      : Buffer.from(String(spawned.stdout ?? '')),
    stderr: Buffer.isBuffer(spawned.stderr)
      ? spawned.stderr
      : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
  };
  if (result.status !== 0) {
    throw new Error(`Cannot resolve tree for ${ref}: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  const sha = decodeBranchLifecycleChildStdoutV1(result);
  if (!/^[0-9a-f]{40}$/u.test(sha)) {
    throw new Error(`Resolved tree identity is invalid for ${ref}.`);
  }
  return sha;
}

export function checkCandidateTreeParity(input: {
  checkedAt: string;
  repository: string;
  sessionId: string;
  prNumber: number;
  candidateTreeSha: string;
  mergedTreeSha: string;
}): VerificationCandidateTreeParityV1 {
  return createCandidateTreeParityV1(input);
}

export function parseCandidateTreeParity(
  source: string
): VerificationCandidateTreeParityV1 {
  return parseVerificationCandidateTreeParityV1(source);
}
