/**
 * Canonical owner identities for documentation lifecycle changes.
 *
 * This narrow contract is intentionally independent of the complete test
 * impact registry. Verification-plan construction only needs to answer
 * whether an observed owner belongs to this lifecycle; it must not import the
 * registry (and therefore must not inherit its unrelated evidence rules).
 */
export const DOCUMENTATION_LIFECYCLE_TEST_OWNERS = Object.freeze({
  authority: 'documentation-authority',
  evidence: 'documentation-evidence',
  frozenWorkPackage: 'frozen-work-package',
  historical: 'historical-documentation'
} as const);

const DOCUMENTATION_LIFECYCLE_OWNER_SET = new Set<string>(
  Object.values(DOCUMENTATION_LIFECYCLE_TEST_OWNERS)
);

export function isDocumentationLifecycleTestOwner(owner: string): boolean {
  return DOCUMENTATION_LIFECYCLE_OWNER_SET.has(owner);
}
