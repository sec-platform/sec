/**
 * Candidate Tree parity: merged main tree must equal the frozen candidate tree
 * for a session (Issue #311 Phase 0).
 */

import {
  commandErrorText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import {
  createCandidateTreeParityV1,
  parseVerificationCandidateTreeParityV1,
  type VerificationCandidateTreeParityV1
} from './verification-session-contract.ts';

export function resolveTreeSha(
  ctx: BranchLifecycleContext,
  ref: string
): string {
  const result = runBranchCommand(ctx, 'git', ['rev-parse', '--verify', `${ref}^{tree}`]);
  if (result.status !== 0) {
    throw new Error(`Cannot resolve tree for ${ref}: ${commandErrorText(result)}`);
  }
  const sha = result.stdout.toString('utf8').trim();
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
