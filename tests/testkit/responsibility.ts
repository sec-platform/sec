import { test } from 'bun:test';

import type { TestResponsibilityDeclaration } from '../../platform/shared/test-responsibility-contract.ts';

/**
 * Stable proof semantics authored beside one executable test case.
 * Physical source/suite/title locators are deliberately absent: the repository
 * census derives those from the current source tree.
 */
export type TestResponsibilityMetadata = Omit<
  TestResponsibilityDeclaration,
  'sourcePath' | 'case'
>;

export type SecTestBody = () => void | Promise<void>;

/**
 * Thin Bun adapter. SEC owns only proof metadata; Bun continues to own ordinary
 * test execution mechanics. The metadata is consumed statically by the
 * repository test-case census rather than accumulated in a runtime registry.
 */
export function secTest(
  responsibility: TestResponsibilityMetadata,
  title: string,
  body: SecTestBody
): void {
  void responsibility;
  test(title, body);
}
