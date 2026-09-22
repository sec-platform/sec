import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  compileEffectfulTestExecutionPolicy,
  compileTestInvocationExecutionPolicy,
  DEFAULT_TEST_TIMEOUT_MS,
  EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS,
  EFFECTFUL_TEST_SEMANTIC_OPERATION,
  TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS
} from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import {
  disposeCompilerDependencyEnvironment,
  type CompilerDependencyEnvironmentRetirementReceipt
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import {
  effectfulTest,
  EffectfulTestPhysicalResidueError,
  EffectfulTestTerminalAuthorityUnresolvedError,
  settleEffectfulTestCleanup
} from '../helpers/effectful-test.ts';

function captureEffectfulCase(
  input: Readonly<{ operationTimeoutMs: number; cleanupSettlementMarginMs: number }>,
  body: Parameters<typeof effectfulTest>[3]
): Readonly<{ run: () => void | Promise<void>; timeoutMs: number }> {
  let captured: Readonly<{ run: () => void | Promise<void>; timeoutMs: number }> | null = null;
  effectfulTest((_title, run, timeoutMs) => {
    captured = Object.freeze({ run, timeoutMs: timeoutMs! });
  }, 'captured effectful case', input, body);
  if (captured === null) throw new Error('Effectful case registrar did not receive the case.');
  return captured;
}

test('effectful deadline projection orders operation cleanup Bun and supervisor ceilings', () => {
  const effectful = compileEffectfulTestExecutionPolicy({
    operationTimeoutMs: 60_000,
    cleanupSettlementMarginMs: 30_000
  });
  const invocation = compileTestInvocationExecutionPolicy(
    ['test', 'tests/integration/compiler-dependency-installation.test.ts'],
    300_000
  );

  expect(effectful.caseTimeoutMs).toBe(
    effectful.operationTimeoutMs
    + effectful.cleanupSettlementMarginMs
    + EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS
  );
  expect(effectful.semanticOperation).toBe(EFFECTFUL_TEST_SEMANTIC_OPERATION);
  expect(effectful.caseTimeoutMs).toBeLessThan(DEFAULT_TEST_TIMEOUT_MS);
  expect(invocation.caseTimeoutMs).toBe(DEFAULT_TEST_TIMEOUT_MS);
  expect(invocation.supervisorTimeoutMs).toBeGreaterThan(invocation.caseTimeoutMs);
  expect(invocation.supervisorTimeoutMs - invocation.caseTimeoutMs)
    .toBeGreaterThanOrEqual(TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS);
});

test('deadline compiler rejects any ordering that can time out before operation or cleanup terminal', () => {
  expect(() => compileEffectfulTestExecutionPolicy({
    operationTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    cleanupSettlementMarginMs: 1
  })).toThrow('must remain strictly inside');
  expect(() => compileTestInvocationExecutionPolicy(
    ['test', 'tests/unit/path-containment.test.ts', '--timeout', '1000'],
    1000
  )).toThrow('strictly greater');
  expect(() => compileTestInvocationExecutionPolicy(
    ['test', 'tests/unit/path-containment.test.ts', '--timeout', '1000'],
    1000 + TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS - 1
  )).toThrow('must reserve at least');
});

test('deadline compiler rejects ambiguous and invalid Bun timeout declarations', () => {
  expect(() => compileTestInvocationExecutionPolicy(
    ['test', '--timeout', '1000', '--timeout=2000'],
    300_000
  )).toThrow('can only be specified once');
  expect(() => compileTestInvocationExecutionPolicy(
    ['test', '--timeout', '0'],
    300_000
  )).toThrow('positive safe integer');
  expect(() => compileTestInvocationExecutionPolicy(
    ['test', '--timeout'],
    300_000
  )).toThrow('value is required');
});

test.serial('caller receipts never mint terminal authority without the production owner verifier', async () => {
  const events: string[] = [];
  const rejectionCodes: string[] = [];
  const ownerRoot = path.join(tmpdir(), `sec-effectful-owner-receipt-${randomUUID()}`);
  const captured = captureEffectfulCase({
    operationTimeoutMs: 5,
    cleanupSettlementMarginMs: 100
  }, async (context) => {
    await new Promise<void>((resolve) => {
      context.operationSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    events.push('operation-aborted');
    const forgedCandidates = [
      Object.freeze({
        semanticOperation: context.policy.semanticOperation,
        operationId: context.operationId,
        resourceRoot: 'fixture-root',
        cleanup: Object.freeze({ terminal: 'completed' }),
        readback: Object.freeze({ physical: 'absent' })
      }),
      Object.freeze({
        semanticOperation: context.policy.semanticOperation,
        operationId: 'effectful-test:wrong-operation',
        resourceRoot: 'fixture-root',
        cleanup: Object.freeze({ terminal: 'completed' }),
        readback: Object.freeze({ physical: 'absent' })
      }),
      Object.freeze({
        semanticOperation: context.policy.semanticOperation,
        operationId: context.operationId,
        resourceRoot: 'wrong-root',
        cleanup: Object.freeze({ terminal: 'completed' }),
        readback: Object.freeze({ physical: 'absent' })
      }),
      Object.freeze({
        semanticOperation: context.policy.semanticOperation,
        operationId: context.operationId,
        resourceRoot: 'fixture-root',
        cleanup: Object.freeze({ terminal: 'completed' })
      })
    ] as const;
    for (const candidate of [...forgedCandidates, forgedCandidates[0]]) {
      try {
        await settleEffectfulTestCleanup({
          context,
          resourceRoot: 'fixture-root',
          settle: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            events.push('cleanup-attempted');
            return candidate as never;
          }
        });
      } catch (error) {
        expect(error).toBeInstanceOf(EffectfulTestTerminalAuthorityUnresolvedError);
        rejectionCodes.push((error as EffectfulTestTerminalAuthorityUnresolvedError).code);
      }
    }
    try {
      await settleEffectfulTestCleanup({
        context,
        resourceRoot: 'fixture-residue',
        settle: async () => {
          throw new Error('physical root remains');
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EffectfulTestPhysicalResidueError);
      expect(error).toMatchObject({
        code: 'EFFECTFUL-TEST-PHYSICAL-RESIDUE',
        terminalState: {
          terminal: 'physical-residue',
          semanticOperation: EFFECTFUL_TEST_SEMANTIC_OPERATION,
          operationId: context.operationId,
          resourceRoot: 'fixture-residue'
        }
      });
    }
    try {
      await settleEffectfulTestCleanup({
        context,
        resourceRoot: ownerRoot,
        settle: async () => disposeCompilerDependencyEnvironment(
          ownerRoot,
          {},
          'effectful-test-terminal-settlement:wrong-operation'
        )
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EffectfulTestTerminalAuthorityUnresolvedError);
      rejectionCodes.push((error as EffectfulTestTerminalAuthorityUnresolvedError).code);
    }
    let rootBoundReceipt: CompilerDependencyEnvironmentRetirementReceipt | null = null;
    try {
      await settleEffectfulTestCleanup({
        context,
        resourceRoot: `${ownerRoot}-wrong-root`,
        settle: async ({ outcome }) => {
          rootBoundReceipt = await disposeCompilerDependencyEnvironment(ownerRoot, {}, outcome);
          return rootBoundReceipt;
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EffectfulTestTerminalAuthorityUnresolvedError);
      rejectionCodes.push((error as EffectfulTestTerminalAuthorityUnresolvedError).code);
    }
    if (rootBoundReceipt === null) throw new Error('Production owner did not issue its root-bound receipt.');
    await settleEffectfulTestCleanup({
      context,
      resourceRoot: ownerRoot,
      settle: async () => rootBoundReceipt!
    });
    try {
      await settleEffectfulTestCleanup({
        context,
        resourceRoot: ownerRoot,
        settle: async () => rootBoundReceipt!
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EffectfulTestTerminalAuthorityUnresolvedError);
      rejectionCodes.push((error as EffectfulTestTerminalAuthorityUnresolvedError).code);
    }
  });

  await captured.run();
  expect(rejectionCodes).toEqual(Array(8).fill('EFFECTFUL-TEST-TERMINAL-AUTHORITY-UNRESOLVED'));
  expect(events).toEqual(['operation-aborted', ...Array(5).fill('cleanup-attempted')]);
  expect(captured.timeoutMs).toBeGreaterThan(105);
});
