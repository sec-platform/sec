/** Finite artifact domain for complete reachable history, separate from stdio.
 * Consumers still enforce their own aggregate snapshot and transport budgets. */
export const GIT_CANDIDATE_BUNDLE_MAXIMUM_BYTES = 4_294_967_296;

export function isGitCandidateBundleByteLength(bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= GIT_CANDIDATE_BUNDLE_MAXIMUM_BYTES;
}
