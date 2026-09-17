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
