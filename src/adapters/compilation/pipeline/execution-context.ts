import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { PIPELINE_SOURCE_IDS, type PipelineSource } from '../../compilation-protocol/journal-types.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../compilation-protocol/stages.ts';
import type { PipelineExecutionContext } from '../../compilation-protocol/types.ts';

export function requirePipelineSource(value: unknown): PipelineSource {
  if (typeof value !== 'string' || !PIPELINE_SOURCE_IDS.includes(value as PipelineSource)) {
    throw new CompilerError('PIPELINE-USAGE-004', 'Unknown pipeline invocation source');
  }
  return value as PipelineSource;
}

/** Preserve caller ordering, but not holes, accessors, duplicate or unknown IDs. */
export function capturePipelineRequestedStages(value: readonly PipelineStageId[]): readonly PipelineStageId[] {
  if (!Array.isArray(value)) throw new CompilerError('PIPELINE-USAGE-001', 'Pipeline stages must be an array');
  const result: PipelineStageId[] = [];
  const seen = new Set<PipelineStageId>();
  const length = value.length;
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    const stage: unknown = slot && 'value' in slot ? slot.value : undefined;
    if (typeof stage !== 'string' || !PIPELINE_STAGE_IDS.includes(stage as PipelineStageId) || seen.has(stage as PipelineStageId)) {
      throw new CompilerError('PIPELINE-USAGE-001', 'Pipeline stages must be dense, known and unique');
    }
    result.push(stage as PipelineStageId); seen.add(stage as PipelineStageId);
  }
  return Object.freeze(result);
}

/** Enforce the existing readonly identity contract on both API and internal
 * contexts. Keep the real context object so its semantic producer is shared.
 * This never issues a lease; the physical lease owner must still admit it. */
export function sealPipelineExecutionContext(context: PipelineExecutionContext): PipelineExecutionContext {
  if (context === null || typeof context !== 'object') throw new TypeError('Pipeline context must be an object');
  const keys = ['transactionId', 'source', 'workspaceWriteLease', 'onEvent'] as const;
  const descriptors: PropertyDescriptorMap = {};
  const values: Record<string, unknown> = {};
  const extensible = Object.isExtensible(context);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (descriptor === undefined) {
      if (key !== 'onEvent') throw new TypeError(`Pipeline context needs own ${key} data`);
      if (extensible) descriptors[key] = { value: undefined, enumerable: false, writable: false, configurable: false };
      else if (key in context) throw new TypeError('Pipeline context cannot inherit its observer');
      values[key] = undefined;
    } else {
      if (!('value' in descriptor)) throw new TypeError(`Pipeline context ${key} must be data`);
      values[key] = descriptor.value;
      descriptors[key] = { value: descriptor.value, enumerable: descriptor.enumerable, writable: false, configurable: false };
    }
  }
  if (typeof values.transactionId !== 'string' || values.transactionId.length === 0) throw new TypeError('Pipeline transaction identity is empty');
  requirePipelineSource(values.source);
  if (values.workspaceWriteLease === undefined || values.workspaceWriteLease === null) throw new TypeError('Pipeline context needs a lease binding');
  if (values.onEvent !== undefined && typeof values.onEvent !== 'function') throw new TypeError('Pipeline observer must be callable');
  Object.defineProperties(context, descriptors);
  return context;
}

export interface PipelineStageExecutionOptions<T> {
  extractLock?: (result: T) => LockFile | Promise<LockFile>;
  preserveOwnedPassStates?: boolean;
}

/** Capture method identity and policy independently of its legitimate receiver. */
export function capturePipelineStageExecutionOptions<T>(options: PipelineStageExecutionOptions<T>) {
  const { extractLock, preserveOwnedPassStates } = options;
  if (extractLock !== undefined && typeof extractLock !== 'function') throw new TypeError('Pipeline lock extractor must be callable');
  if (preserveOwnedPassStates !== undefined && typeof preserveOwnedPassStates !== 'boolean') throw new TypeError('Pipeline preserveOwnedPassStates must be boolean');
  return Object.freeze({ preserveOwnedPassStates,
    extractLock: extractLock === undefined ? undefined : (result: T): LockFile | Promise<LockFile> => Reflect.apply(extractLock, options, [result])
  });
}
