import { expect } from 'bun:test';

import type { CiContract } from '../../src/adapters/verification/platform/ci/contract/core.ts';

export function expectPrFastLaneBoundary(contract: CiContract): void {
  expect(contract.prQuickLaneCommands).toContain('bun run imports:check');
  expect(contract.prQuickLaneCommands).toContain('bun run typecheck:verified');
  expect(contract.prQuickLaneCommands).toContain('bun run test -- --affected');
  expect(contract.prQuickLaneCommands).not.toContain('bun scripts/ci-pr-quick.ts');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:prepare');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:organize');
  expect(contract.prQuickLaneCommands.every((command) => !command.includes('--scope slow'))).toBe(true);
  expect(contract.prQuickLaneCommands.every((command) => !command.includes('--lane all'))).toBe(true);

}

export function expectFullLaneCoversSlowSuites(contract: CiContract, suiteIds: readonly string[]): void {
  for (const suiteId of suiteIds) {
    expect(contract.fullLaneCommands).toContain(`bun run test -- --scope slow --suite ${suiteId}`);
  }
  expect(contract.fullLaneCommands).toContain('bun run test -- --scope slow --suite e2e-ticket-semantic-vertical');
}

export function expectFullLaneCoversCorrectnessBackstop(contract: CiContract): void {
  expect(contract.fullLaneCommands).not.toContain('bun run imports:prepare');
  expect(contract.fullLaneCommands).toEqual(expect.arrayContaining([
    'bun run imports:check',
    'bun run typecheck:verified',
    'bun run docs:doctor',
    'bun run test -- --scope fast',
    'bun run sec -- verify --lane all --json --compact',
    'bun run sec -- reference check --json --compact'
  ]));
}
