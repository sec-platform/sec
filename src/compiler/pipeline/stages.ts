import { CompilerError } from '../errors.ts';
import type { PassId } from '../../compiler/contract/pass-status.ts';

interface StageOwnership {
  readonly primaryPass: PassId;
  readonly ownedPasses?: readonly PassId[];
}

/** Ordered stage identities and ownership have one declaration. A singleton
 * owns its primary pass; a composite explicitly declares its execution order.
 * Primary identity is not inferred from the spelling or position of a pass. */
export const PIPELINE_STAGE_OWNERSHIP = Object.freeze({
  resolve: Object.freeze({ primaryPass: 'resolve',
    ownedPasses: Object.freeze(['parse', 'align', 'resolve'] as const) }),
  semantic: Object.freeze({ primaryPass: 'build-ir' }),
  compose: Object.freeze({ primaryPass: 'compose' }),
  verify: Object.freeze({ primaryPass: 'verify' }),
  lock: Object.freeze({ primaryPass: 'lock' }),
  emit: Object.freeze({ primaryPass: 'emit' })
} satisfies Record<string, StageOwnership>);

export type PipelineStageId = keyof typeof PIPELINE_STAGE_OWNERSHIP;
export const PIPELINE_STAGE_IDS: readonly PipelineStageId[] = Object.freeze(
  Object.keys(PIPELINE_STAGE_OWNERSHIP) as PipelineStageId[]
);
export const PIPELINE_VERIFY_STAGE_IDS = Object.freeze(
  PIPELINE_STAGE_IDS.slice(0, PIPELINE_STAGE_IDS.indexOf('verify') + 1)
);

/** Preserve caller ordering while rejecting holes, accessors, duplicates and unknown IDs. */
export function capturePipelineRequestedStages(
  value: readonly PipelineStageId[]
): readonly PipelineStageId[] {
  if (!Array.isArray(value)) {
    throw new CompilerError('PIPELINE-USAGE-001', 'Pipeline stages must be an array');
  }
  const result: PipelineStageId[] = [];
  const seen = new Set<PipelineStageId>();
  const length = value.length;
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    const stage: unknown = slot && 'value' in slot ? slot.value : undefined;
    if (typeof stage !== 'string' ||
        !PIPELINE_STAGE_IDS.includes(stage as PipelineStageId) ||
        seen.has(stage as PipelineStageId)) {
      throw new CompilerError(
        'PIPELINE-USAGE-001',
        'Pipeline stages must be dense, known and unique'
      );
    }
    result.push(stage as PipelineStageId);
    seen.add(stage as PipelineStageId);
  }
  return Object.freeze(result);
}
