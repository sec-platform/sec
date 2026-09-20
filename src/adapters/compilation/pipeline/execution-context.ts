import { requirePipelineSource } from '../../../compiler/pipeline/source.ts';
import type { PipelineExecutionContext } from '../../compilation-protocol/types.ts';

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
