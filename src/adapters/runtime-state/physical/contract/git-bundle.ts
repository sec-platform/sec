/** Complete reachable Git history transported as one bounded ordinary file. */
export const GIT_CANDIDATE_BUNDLE_MAXIMUM_BYTES = 16 * 1024 * 1024;

export function isGitCandidateBundleByteLength(bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= GIT_CANDIDATE_BUNDLE_MAXIMUM_BYTES;
}
