import { test } from 'bun:test';

import type { TestResponsibilityMetadata } from '../../platform/shared/test-responsibility-contract.ts';

export type SecTestBody = () => void | Promise<void>;

/**
 * Thin Bun adapter. SEC owns proof metadata; Bun owns ordinary execution mechanics.
 * Metadata is authored beside the case and consumed statically by the repository
 * census. No runtime registry or second locator database is created here.
 */
export function secTest(
  responsibility: TestResponsibilityMetadata,
  title: string,
  body: SecTestBody
): void {
  void responsibility;
  test(title, body);
}
