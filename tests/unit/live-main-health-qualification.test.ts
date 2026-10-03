import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

const FIXTURE = path.resolve(import.meta.dir, '../helpers/live-main-health/qualification-fixture.ts');
// Independent acceptance closure, not generated from the production catalog.
const CHECKS = [
  'bun run imports:check --all',
  'bun run typecheck:verified',
  'bun run audit -- --worktree-source-program --enforce',
  'bun run docs:doctor',
  'bun run test -- --scope fast'
];
interface Observation {
  failure: string | null;
  callbackCount: number;
  commands: string[];
  events: string[];
  consumption: Record<string, unknown>;
  retainedRevoked: boolean;
}
function observe(scenario: string): Observation {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-live-health-'));
  const root = path.join(parent, 'workspace');
  mkdirSync(root);
  try {
    const child = spawnSync(process.execPath, [FIXTURE, scenario, root], {
      cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, SEC_STATE_HOME: path.join(parent, 'state'), SEC_CACHE_HOME: path.join(parent, 'cache') }
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout) as Observation;
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

test('real MainHealth producer mints only after private preparation and all settled cleanup, then revokes', () => {
  const result = observe('success');
  expect(result.failure).toBeNull();
  expect(result.commands).toEqual(CHECKS);
  expect(result.callbackCount).toBe(1);
  expect(result.consumption).toMatchObject({ dependencyCacheKey: null,
    dependencyPreparation: 'private-authority-ephemeral-v1', producerSettledBeforeConsumer: true });
  expect(result.events.filter((event) => event.startsWith('scope-settle:')))
    .toEqual(['scope-settle:1', 'scope-settle:2', 'scope-settle:3']);
  expect(result.events.indexOf('container-removed')).toBeLessThan(result.events.indexOf('consumer'));
  expect(result.retainedRevoked).toBe(true);
});

test('unscoped production success is data and does not independently mint a live qualification', () => {
  const result = observe('unscoped-producer');
  expect(result.failure).toBeNull();
  expect(result.commands).toEqual(CHECKS);
  expect(result.callbackCount).toBe(0);
  expect(result.consumption.unscopedRejected).toBe(true);
});

test('canonical local publication admits real live production with hosted absence and rejects copied authority and JSON', () => {
  const result = observe('publication');
  expect(result.failure).toBeNull();
  expect(result.consumption).toMatchObject({ publicationAccepted: true, copiedAuthorityRejected: true,
    unqualifiedJsonRejected: true, revokedPublicationRejected: true });
});

test('healthy T1 and T2 cannot substitute another live producer provenance', () => {
  const result = observe('publication-source-drift');
  expect(result.failure).toBeNull();
  expect(result.consumption.sourceDriftRejected).toBe(true);
});

test('T1 and long-running T2 reuse the same live receipt with the deadline fixed before production', () => {
  const result = observe('long-t2');
  expect(result.failure).toBeNull();
  expect(result.consumption.longT2Accepted).toBe(true);
  expect(result.retainedRevoked).toBe(true);
});

test('live MainHealth expires exactly at the admitted deadline without renewing the scope', () => {
  const result = observe('expiry');
  expect(result.failure).toBeNull();
  expect(result.consumption.deadlineBoundaryRejected).toBe(true);
});

test('post-main assessment consumes the real live receipt and rejects subject, copied proof and expired-scope changes', () => {
  const result = observe('post-main-health');
  expect(result.failure).toBeNull();
  expect(result.consumption).toMatchObject({ postMainAccepted: true, postMainMismatchRejected: true });
  expect(result.retainedRevoked).toBe(true);
});

test('a parent deadline bounds both execution and live reuse without extending on observation', () => {
  const result = observe('parent-budget');
  expect(result.failure).toBeNull();
  expect(result.consumption.deadlineBoundaryRejected).toBe(true);
});

for (const scenario of ['expired-parent', 'invalid-parent']) {
  test(`MainHealth ${scenario} rejects before any Engine effect`, () => {
    const result = observe(scenario);
    expect(result.failure).toContain('parent operation deadline is invalid or expired');
    expect(result.callbackCount).toBe(0);
    expect(result.commands).toEqual([]);
    expect(result.events).toEqual([]);
  });
}

test('the same pathname with a replacement physical root cannot consume an issued receipt', () => {
  const result = observe('root-replaced');
  expect(result.failure).toBeNull();
  expect(result.consumption.rootReplacementRejected).toBe(true);
  expect(result.retainedRevoked).toBe(true);
});

for (const [scenario, expected] of [
  ['consumer-throw', 'TEST_CONSUMER_THROW'], ['consumer-cancel', 'TEST_CONSUMER_CANCEL']
] as const) {
  test(`live MainHealth scope revokes after ${scenario}`, () => {
    const result = observe(scenario);
    expect(result.failure).toContain(expected);
    expect(result.callbackCount).toBe(1);
    expect(result.retainedRevoked).toBe(true);
  });
}

for (const index of [1, 2, 3, 4, 5]) {
  test(`MainHealth command ${index} nonzero rejects before any live consumer`, () => {
    const result = observe(`command-failed-${index}`);
    expect(result.failure).toContain('controlled transport failure');
    expect(result.callbackCount).toBe(0);
    expect(result.commands).toEqual(CHECKS.slice(0, index));
    expect(result.events).toContain('container-removed');
    expect(result.events).toContain('session-closed');
  });
}

for (const [scenario, expected] of [
  ['setup-failed', 'controlled transport failure'],
  ['network-attached', 'network isolation readback is not empty'],
  ['main-drift-1', 'identity differs before execution'],
  ['tree-drift-1', 'identity differs before execution'],
  ['dirty-1', 'identity differs before execution'],
  ['main-drift-2', 'identity changed during execution'],
  ['tree-drift-2', 'identity changed during execution'],
  ['dirty-2', 'identity changed during execution'],
  ['endpoint-drift', 'successful physical settlement and exact endpoint readback'],
  ['cleanup-failed', 'container cleanup failed'],
  ['close-failed', 'TEST_SESSION_CLOSE']
] as const) {
  test(`MainHealth ${scenario} cannot mint a live qualification`, () => {
    const result = observe(scenario);
    expect(result.failure).toContain(expected);
    expect(result.callbackCount).toBe(0);
    expect(result.retainedRevoked).toBe(false);
  });
}

for (const phase of [1, 2, 3]) {
  test(`MainHealth settlement ${phase} failure cannot mint even after command success`, () => {
    const result = observe(`settlement-throw-${phase}`);
    expect(result.failure).toContain(`TEST_SETTLEMENT_${phase}`);
    expect(result.callbackCount).toBe(0);
  });
  test(`MainHealth settlement ${phase} with a canonical unknown receipt cannot mint`, () => {
    const result = observe(`settlement-unknown-${phase}`);
    expect(result.failure).toContain('successful physical settlement and exact endpoint readback');
    expect(result.callbackCount).toBe(0);
  });
  test(`MainHealth settlement ${phase} with a canonical not-started receipt cannot mint`, () => {
    const result = observe(`settlement-not-started-${phase}`);
    expect(result.failure).toContain('successful physical settlement and exact endpoint readback');
    expect(result.callbackCount).toBe(0);
  });
}
