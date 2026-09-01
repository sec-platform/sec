import { randomUUID } from 'node:crypto';

import {
  compileEffectfulTestExecutionPolicy,
  type EffectfulTestExecutionPolicy,
  type EffectfulTestTerminalState
} from '../../src/development/runner/test-execution-policy.ts';
import {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  type CompilerDependencyEnvironmentRetirementReceipt
} from '../../src/toolchain/dependencies/test/runtime.ts';

export type EffectfulTestContext = Readonly<{
  policy: EffectfulTestExecutionPolicy;
  operationId: string;
  operationDeadlineAtUnixMs: number;
  cleanupDeadlineAtUnixMs: number;
  operationSignal: AbortSignal;
  cleanupSignal: AbortSignal;
}>;

type EffectfulTestRegistrar = (
  title: string,
  run: () => void | Promise<void>,
  timeoutMs?: number
) => unknown;

export class EffectfulTestPhysicalResidueError extends Error {
  readonly code = 'EFFECTFUL-TEST-PHYSICAL-RESIDUE' as const;
  readonly terminalState: EffectfulTestTerminalState;

  constructor(context: EffectfulTestContext, resourceRoot: string, reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason);
    super(`Effectful test cleanup left typed physical residue at ${resourceRoot}: ${message}`, {
      cause: reason
    });
    this.name = 'EffectfulTestPhysicalResidueError';
    this.terminalState = Object.freeze({
      terminal: 'physical-residue',
      semanticOperation: context.policy.semanticOperation,
      operationId: context.operationId,
      resourceRoot,
      reason: message
    });
  }
}

export class EffectfulTestTerminalAuthorityUnresolvedError extends Error {
  readonly code = 'EFFECTFUL-TEST-TERMINAL-AUTHORITY-UNRESOLVED' as const;
  readonly terminalState: EffectfulTestTerminalState;

  constructor(context: EffectfulTestContext, resourceRoot: string | null, reason: string) {
    super(
      `Effectful test terminal authority is unresolved for ${context.operationId}`
      + `${resourceRoot === null ? '' : ` at ${resourceRoot}`}: ${reason}`
    );
    this.name = 'EffectfulTestTerminalAuthorityUnresolvedError';
    this.terminalState = Object.freeze({
      terminal: 'authority-unresolved',
      semanticOperation: context.policy.semanticOperation,
      operationId: context.operationId,
      resourceRoot,
      reason
    });
  }
}

type EffectfulTestLifecycle = {
  terminalReceiptConsumed: boolean;
};

let activeEffectfulTestCount = 0;
const effectfulTestLifecycles = new WeakMap<EffectfulTestContext, EffectfulTestLifecycle>();

export function effectfulTest(
  register: EffectfulTestRegistrar,
  title: string,
  input: Readonly<{ operationTimeoutMs: number; cleanupSettlementMarginMs: number }>,
  run: (context: EffectfulTestContext) => Promise<void>
): void {
  const policy = compileEffectfulTestExecutionPolicy(input);
  register(title, async () => {
    if (activeEffectfulTestCount !== 0) {
      throw new Error('Effectful test contamination: a prior Effect case is not terminal.');
    }
    activeEffectfulTestCount += 1;
    const startedAtUnixMs = Date.now();
    const operationDeadlineAtUnixMs = startedAtUnixMs + policy.operationTimeoutMs;
    const cleanupDeadlineAtUnixMs = operationDeadlineAtUnixMs + policy.cleanupSettlementMarginMs;
    const operationController = new AbortController();
    const cleanupController = new AbortController();
    const context = Object.freeze({
      policy,
      operationId: `effectful-test:${randomUUID()}`,
      operationDeadlineAtUnixMs,
      cleanupDeadlineAtUnixMs,
      operationSignal: operationController.signal,
      cleanupSignal: cleanupController.signal
    });
    const lifecycle: EffectfulTestLifecycle = { terminalReceiptConsumed: false };
    effectfulTestLifecycles.set(context, lifecycle);
    const operationTimer = setTimeout(() => {
      operationController.abort(new Error(`Effectful test operation deadline expired: ${title}`));
    }, policy.operationTimeoutMs);
    const cleanupTimer = setTimeout(() => {
      cleanupController.abort(new Error(`Effectful test cleanup deadline expired: ${title}`));
    }, policy.operationTimeoutMs + policy.cleanupSettlementMarginMs);
    try {
      await run(context);
    } finally {
      clearTimeout(operationTimer);
      clearTimeout(cleanupTimer);
      if (lifecycle.terminalReceiptConsumed) {
        activeEffectfulTestCount -= 1;
        effectfulTestLifecycles.delete(context);
      }
    }
    if (!lifecycle.terminalReceiptConsumed) {
      throw new EffectfulTestTerminalAuthorityUnresolvedError(
        context,
        null,
        'no canonical domain terminal/readback receipt was consumed'
      );
    }
  }, policy.caseTimeoutMs);
}

export async function settleEffectfulTestCleanup(input: Readonly<{
  context: EffectfulTestContext;
  resourceRoot: string;
  settle: (binding: Readonly<{ outcome: string }>) =>
    Promise<CompilerDependencyEnvironmentRetirementReceipt>;
}>): Promise<CompilerDependencyEnvironmentRetirementReceipt> {
  const lifecycle = effectfulTestLifecycles.get(input.context);
  if (lifecycle === undefined || lifecycle.terminalReceiptConsumed) {
    throw new EffectfulTestTerminalAuthorityUnresolvedError(
      input.context,
      input.resourceRoot,
      'operation context is foreign, inactive, or already terminal'
    );
  }
  const outcome = `effectful-test-terminal-settlement:${input.context.operationId}`;
  let receipt: CompilerDependencyEnvironmentRetirementReceipt;
  try {
    input.context.cleanupSignal.throwIfAborted();
    receipt = await input.settle(Object.freeze({ outcome }));
  } catch (error) {
    if (error instanceof EffectfulTestPhysicalResidueError ||
        error instanceof EffectfulTestTerminalAuthorityUnresolvedError) throw error;
    throw new EffectfulTestPhysicalResidueError(input.context, input.resourceRoot, error);
  }
  try {
    assertCompilerDependencyEnvironmentRetirementReceipt(receipt, input.resourceRoot);
    if (receipt.outcome !== outcome) {
      throw new Error('owner receipt belongs to another Effectful operation');
    }
  } catch (error) {
    throw new EffectfulTestTerminalAuthorityUnresolvedError(
      input.context,
      input.resourceRoot,
      error instanceof Error ? error.message : String(error)
    );
  }
  lifecycle.terminalReceiptConsumed = true;
  return receipt;
}
