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
