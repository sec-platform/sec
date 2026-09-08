const SEC_REPOSITORY_TEST_MODULE_PATH =
  /^(?:src|tests)\/.+[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/iu;

/**
 * Decide whether one repository-relative path is an executable test module.
 * Test-only support modules remain a repository import-boundary concern and
 * must not be promoted into runnable test identity by their directory alone.
 * Both dotted and underscore test suffixes participate in this same identity.
 */
export function isSecRepositoryTestModulePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  return SEC_REPOSITORY_TEST_MODULE_PATH.test(normalized);
}
