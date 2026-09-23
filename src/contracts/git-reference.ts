/**
 * Rejects every Git ref name that cannot be passed as one bounded option-safe
 * branch argument. Domain owners may impose narrower policy after this shared
 * machine grammar succeeds.
 */
export function assertGitBranchName(value: string, label = 'Git branch'): void {
  if (
    value.length === 0
    || value.length > 255
    || value.trim() !== value
    || value === '@'
    || value === 'HEAD'
    || value.startsWith('-')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.endsWith('.')
    || value.includes('..')
    || value.includes('@{')
    || value.includes('//')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(value)
    || value.split('/').some((segment) => (
      segment.length === 0
      || segment.startsWith('.')
      || segment.endsWith('.lock')
    ))
  ) {
    throw new Error(`${label} must be one bounded option-safe Git branch name.`);
  }
}


/** Parses only the bounded GitHub remote URL forms owned by the shared Git
 * reference contract. Domain callers must not infer repository identity from
 * arbitrary URL suffixes or caller-provided owner/name strings.
 */
export function parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/iu, '');
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/iu
    .exec(normalized);
  return match === null ? null : `${match[1]}/${match[2]}`;
}
