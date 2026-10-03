const SEC_REPOSITORY_TEST_MODULE_PATH =
  /^(?:src|tests)\/.+[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/iu;

/** Native Bun/dependency inputs shared by discovery and verification identity. */
export const SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS = Object.freeze([
  '.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'
] as const);

/**
 * Decide whether one repository-relative path is an executable test module.
 * Test-only support modules remain a repository import-boundary concern and
 * must not be promoted into runnable test identity by their directory alone.
 * Both dotted and underscore test suffixes participate in this same identity.
 */
export function isSecRepositoryTestModulePath(value: string): boolean {
  return SEC_REPOSITORY_TEST_MODULE_PATH.test(normalizeSecRepositoryTestModulePath(value));
}

/** The existing portable spelling projection, shared by discovery and planning.
 * This is lexical identity only: no case folding, realpath, symlink or hardlink
 * equivalence and no new filesystem permission is inferred from it.
 */
export function normalizeSecRepositoryTestModulePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}
