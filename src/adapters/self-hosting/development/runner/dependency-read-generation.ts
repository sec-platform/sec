import type { RetainedCompilerDependencyReadGeneration } from '../../../toolchain/dependencies/runtime.ts';
import {
  assertMaterializedOperationDependencyBootstrapResult,
  type OperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';

export type OperationDependencyReadGenerationResolution =
  | Readonly<{
      status: 'ready';
      generation: RetainedCompilerDependencyReadGeneration;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'dependency-generation-unavailable' | 'dependency-runtime-unavailable';
    }>;

/**
 * Post-admission bridge from the dependency bootstrap receipt to the
 * dependency owner's read-only retained generation. The predependency CLI
 * never imports this module, so loading the full dependency runtime cannot
 * precede dependency admission.
 */
export async function retainOperationDependencyReadGeneration(input: Readonly<{
  dependencies: OperationDependencyBootstrapResult;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<OperationDependencyReadGenerationResolution> {
  assertMaterializedOperationDependencyBootstrapResult(input.dependencies);
  const dependencyRuntime = await import('../../../toolchain/dependencies/runtime.ts');
  const authority = input.dependencies.executionGenerationAuthority;
  return Object.freeze({
    status: 'ready' as const,
    generation: await dependencyRuntime.retainCompilerDependencyReadGeneration(authority, {
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      signal: input.signal
    })
  });
}

/**
 * Read-only plan admission for an already-published dependency generation.
 * It is deliberately separate from the materialized-result bridge so a
 * caller cannot select a weaker authority by omitting one structural field.
 */
export async function observeOperationDependencyReadGeneration(input: Readonly<{
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<OperationDependencyReadGenerationResolution> {
  let dependencyRuntime: typeof import('../../../toolchain/dependencies/runtime.ts');
  try {
    dependencyRuntime = await import('../../../toolchain/dependencies/runtime.ts');
  } catch {
    return Object.freeze({
      status: 'unavailable' as const,
      reason: 'dependency-runtime-unavailable' as const
    });
  }
  const authority = await dependencyRuntime.observeCompilerDependencyExecutionGenerationAuthority({
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    signal: input.signal
  });
  if (authority === null) {
    return Object.freeze({
      status: 'unavailable' as const,
      reason: 'dependency-generation-unavailable' as const
    });
  }
  return Object.freeze({
    status: 'ready' as const,
    generation: await dependencyRuntime.retainCompilerDependencyReadGeneration(authority, {
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      signal: input.signal
    })
  });
}
