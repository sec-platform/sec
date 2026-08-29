/**
 * Durable failed-child outcome publication for isolated Semantic Mutation
 * verification. The final outcome is tiny canonical evidence; a failed
 * publication must also preserve cleanup truth for its owned pending path.
 */
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  PIPELINE_EXECUTION_BOUNDARIES,
  type PipelineExecutionBoundary
} from '../pipeline/types.ts';

import { compareCodeUnits, sortedKeys } from './canonical.ts';

export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT =
  'semantic-mutation-isolated-child-outcome-v1' as const;
export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH =
  '.isolated-process/child/semantic-mutation-isolated-child-outcome-v1.json' as const;
export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH =
  '.isolated-process/child/.semantic-mutation-isolated-child-outcome-v1.pending' as const;

export type SemanticMutationIsolatedChildFailureStage =
  | 'preflight'
  | 'verify-all'
  | 'postcondition';

export interface SemanticMutationIsolatedChildOutcome {
  readonly formatVersion: typeof SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT;
  readonly status: 'failed';
  readonly stage: SemanticMutationIsolatedChildFailureStage;
  readonly boundary?: PipelineExecutionBoundary;
}

const MAX_OUTCOME_BYTES = 512;
const CHILD_FAILURE_STAGES = new Set<SemanticMutationIsolatedChildFailureStage>([
  'preflight',
  'verify-all',
  'postcondition'
]);
const PIPELINE_BOUNDARIES = new Set<PipelineExecutionBoundary>(PIPELINE_EXECUTION_BOUNDARIES);

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = sortedKeys(value);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalOutcome(value: unknown): SemanticMutationIsolatedChildOutcome {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Semantic Mutation isolated child outcome is invalid');
  }
  const record = value as Record<string, unknown>;
  const hasBoundary = Object.hasOwn(record, 'boundary');
  if (!exactObjectKeys(
      record,
      hasBoundary ? ['boundary', 'formatVersion', 'stage', 'status'] : ['formatVersion', 'stage', 'status']
    ) ||
    record.formatVersion !== SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT ||
    record.status !== 'failed' ||
    typeof record.stage !== 'string' ||
    !CHILD_FAILURE_STAGES.has(record.stage as SemanticMutationIsolatedChildFailureStage) ||
    (hasBoundary && (record.stage !== 'verify-all' || typeof record.boundary !== 'string' ||
      !PIPELINE_BOUNDARIES.has(record.boundary as PipelineExecutionBoundary)))) {
    throw new Error('Semantic Mutation isolated child outcome is invalid');
  }
  return Object.freeze({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage: record.stage as SemanticMutationIsolatedChildFailureStage,
    ...(hasBoundary ? { boundary: record.boundary as PipelineExecutionBoundary } : {})
  });
}

export function buildSemanticMutationIsolatedChildOutcome(
  stage: SemanticMutationIsolatedChildFailureStage,
  boundary?: PipelineExecutionBoundary
): SemanticMutationIsolatedChildOutcome {
  return canonicalOutcome({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage,
    ...(boundary === undefined ? {} : { boundary })
  });
}

export function semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot: string): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH.split('/')
  );
}

export function semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot: string): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH.split('/')
  );
}

export function semanticMutationIsolatedChildOutcomeBytes(
  value: SemanticMutationIsolatedChildOutcome
): Uint8Array {
  const outcome = canonicalOutcome(value);
  return new TextEncoder().encode(`${JSON.stringify(outcome)}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export function parseSemanticMutationIsolatedChildOutcomeBytes(
  bytes: Uint8Array
): SemanticMutationIsolatedChildOutcome {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_OUTCOME_BYTES) {
    throw new Error('Semantic Mutation isolated child outcome bytes are invalid');
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Semantic Mutation isolated child outcome bytes are invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error('Semantic Mutation isolated child outcome bytes are invalid');
  }
  const outcome = canonicalOutcome(parsed);
  if (!sameBytes(bytes, semanticMutationIsolatedChildOutcomeBytes(outcome))) {
    throw new Error('Semantic Mutation isolated child outcome bytes are not canonical');
  }
  return outcome;
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function cleanupOwnedPendingPath(pendingPath: string): Promise<void> {
  await rm(pendingPath, { force: true });
}

export async function publishSemanticMutationIsolatedChildOutcome(
  stagingWorkspaceRoot: string,
  value: SemanticMutationIsolatedChildOutcome
): Promise<void> {
  const bytes = semanticMutationIsolatedChildOutcomeBytes(value);
  const finalPath = semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot);
  const pendingPath = semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot);
  let pendingOwned = false;
  let primaryFailure: unknown = null;
  try {
    const handle = await open(pendingPath, 'wx', 0o600);
    pendingOwned = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pendingPath, finalPath);
    pendingOwned = false;
    await fsyncDirectory(path.dirname(finalPath));
  } catch (error) {
    primaryFailure = error;
  }

  let cleanupFailure: unknown = null;
  if (pendingOwned) {
    try {
      await cleanupOwnedPendingPath(pendingPath);
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (primaryFailure !== null && cleanupFailure !== null) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      `Semantic Mutation isolated child outcome publication failed and pending cleanup did not converge: ${pendingPath}`
    );
  }
  if (primaryFailure !== null) throw primaryFailure;
  if (cleanupFailure !== null) throw cleanupFailure;
}
