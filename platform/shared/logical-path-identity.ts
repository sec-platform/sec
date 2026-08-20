import { isWindowsReservedLogicalComponent } from './logical-path-component.ts';

const WINDOWS_FORBIDDEN_COMPONENT_CHARACTERS = /[<>:"|?*\u0000-\u001f]/u;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/u;

export interface CanonicalPortableLogicalPathOptionsV1 {
  readonly allowEmpty?: boolean;
}

function canonicalComponent(component: string): boolean {
  return component.length > 0
    && component !== '.'
    && component !== '..'
    && component.normalize('NFC') === component
    && !WINDOWS_FORBIDDEN_COMPONENT_CHARACTERS.test(component)
    && !component.endsWith('.')
    && !component.endsWith(' ')
    && !isWindowsReservedLogicalComponent(component);
}

/**
 * Stable lexical identity for SEC logical paths that may be materialized on
 * supported Windows/Linux workspaces.
 *
 * This owns portable spelling only. It deliberately does not claim to prove
 * host filesystem containment, symlink/reparse safety, inode/FileId identity,
 * or full filesystem-specific Unicode/case aliasing; those remain physical
 * observation responsibilities.
 */
export function isCanonicalPortableLogicalPathV1(
  value: string,
  options: CanonicalPortableLogicalPathOptionsV1 = {}
): boolean {
  if (value.length === 0) return options.allowEmpty === true;
  if (
    value.includes('\\')
    || value.startsWith('/')
    || value.startsWith('//')
    || WINDOWS_DRIVE_PREFIX.test(value)
    || value.normalize('NFC') !== value
  ) {
    return false;
  }

  return value.split('/').every(canonicalComponent);
}

/**
 * Canonical portable directory-prefix spelling. The trailing slash is part of
 * the prefix contract (for example `custom/`) but is not part of any path
 * component identity. No normalization is performed.
 */
export function isCanonicalPortableLogicalPathPrefixV1(value: string): boolean {
  return value.endsWith('/')
    && value.length > 1
    && isCanonicalPortableLogicalPathV1(value.slice(0, -1));
}

export function assertCanonicalPortableLogicalPathV1(
  value: string,
  label = 'Logical path',
  options: CanonicalPortableLogicalPathOptionsV1 = {}
): string {
  if (!isCanonicalPortableLogicalPathV1(value, options)) {
    throw new Error(`${label} is not one canonical portable logical path: ${value}`);
  }
  return value;
}

/**
 * Conservative collision identity for logical paths that can be published to
 * any supported workspace filesystem. The key deliberately collapses Unicode
 * case variants even on a case-sensitive host: a portable publication plan
 * must not gain two physical meanings merely by moving between Linux,
 * case-insensitive macOS, and Windows.
 *
 * This remains a logical pre-effect check. Physical containment, symlink /
 * reparse safety, and existing-entry identity still belong to the retained
 * filesystem authority at the publication boundary.
 */
export function portableLogicalPathCollisionKeyV1(
  value: string,
  label = 'Logical path'
): string {
  const canonical = assertCanonicalPortableLogicalPathV1(value, label);
  return canonical
    .split('/')
    .map((component) => component
      .toLocaleUpperCase('en-US')
      .toLocaleLowerCase('en-US')
      .normalize('NFC'))
    .join('/');
}
