/** Canonical syntax for V1 CI changed-file and active-documentation selector inputs. */
export function CodexDevelopmentIsCanonicalRepositoryPath(
  value: unknown
): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.normalize('NFC')
    || value.includes('\0')
    || value.includes('\\')
    || value.includes(':')
    || value.startsWith('/')
  ) return false;

  return value.split('/').every((segment) => (
    segment.length > 0 && segment !== '.' && segment !== '..'
  ));
}
