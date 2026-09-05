import type { PassId } from '../contract/pass-status.ts';
import { PIPELINE_STAGE_IDS, PIPELINE_STAGE_OWNERSHIP, type PipelineStageId } from './stages.ts';

export interface PassDefinition {
  readonly id: PassId;
  readonly requires: readonly PassId[];
  readonly invalidates: readonly PassId[];
}

export interface PipelineStageDefinition {
  readonly id: PipelineStageId;
  readonly primaryPass: PassId;
  readonly ownedPasses: readonly PassId[];
  readonly requires: readonly PassId[];
  readonly invalidates: readonly PassId[];
}

// Prerequisites and invalidation are separate relations. In particular repair
// invalidates verification without requiring it; do not infer one from the other.
const passInputs: Record<PassId, Omit<PassDefinition, 'id'>> = {
  parse: {
    requires: [],
    invalidates: ['align', 'resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  align: {
    requires: ['parse'],
    invalidates: ['resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  resolve: {
    requires: ['align'],
    invalidates: ['build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  'build-ir': {
    requires: ['resolve'],
    invalidates: ['compose', 'verify', 'repair', 'lock', 'emit']
  },
  compose: {
    requires: ['build-ir'],
    invalidates: ['verify', 'repair', 'lock', 'emit']
  },
  verify: {
    requires: ['compose'],
    invalidates: ['repair', 'lock', 'emit']
  },
  repair: {
    requires: [],
    invalidates: ['verify', 'lock', 'emit']
  },
  lock: {
    requires: ['verify'],
    invalidates: ['emit']
  },
  emit: {
    requires: ['lock'],
    invalidates: []
  }
};


export const PASS_DEFINITIONS: Readonly<Record<PassId, PassDefinition>> = Object.freeze(
  Object.fromEntries(Object.entries(passInputs).map(([id, input]) => [id, Object.freeze({
    id: id as PassId,
    requires: Object.freeze(input.requires),
    invalidates: Object.freeze(input.invalidates)
  })])) as Record<PassId, PassDefinition>
);

function buildStageDefinitions(): Readonly<Record<PipelineStageId, PipelineStageDefinition>> {
  const owners = new Map<PassId, PipelineStageId>();
  const definitions = PIPELINE_STAGE_IDS.map((id) => {
    const spec: Readonly<{ primaryPass: PassId; ownedPasses?: readonly PassId[] }> = PIPELINE_STAGE_OWNERSHIP[id];
    const ownedPasses = Object.freeze([...(spec.ownedPasses ?? [spec.primaryPass])]);
    const owned = new Set(ownedPasses);
    if (ownedPasses.length === 0 || owned.size !== ownedPasses.length || !owned.has(spec.primaryPass)) {
      throw new Error(`Invalid pipeline ownership for stage ${id}`);
    }
    const completed = new Set<PassId>();
    const requires = new Set<PassId>();
    const invalidates = new Set<PassId>();
    for (const passId of ownedPasses) {
      if (owners.has(passId) || !Object.hasOwn(PASS_DEFINITIONS, passId)) {
        throw new Error(`Pipeline pass ${passId} has invalid or duplicate stage ownership`);
      }
      owners.set(passId, id);
      const pass = PASS_DEFINITIONS[passId];
      for (const dependency of pass.requires) {
        if (owned.has(dependency)) {
          if (!completed.has(dependency)) throw new Error(`Pipeline stage ${id} uses ${dependency} before its producer`);
        } else requires.add(dependency);
      }
      for (const invalidated of pass.invalidates) if (!owned.has(invalidated)) invalidates.add(invalidated);
      completed.add(passId);
    }
    return [id, Object.freeze({ id, primaryPass: spec.primaryPass, ownedPasses,
      requires: Object.freeze([...requires]), invalidates: Object.freeze([...invalidates]) })] as const;
  });
  return Object.freeze(Object.fromEntries(definitions) as Record<PipelineStageId, PipelineStageDefinition>);
}

/** The stage kernel and completion proof consume these same compiled relations. */
export const PIPELINE_STAGE_DEFINITIONS = buildStageDefinitions();

export function getPipelineStageDefinition(stageId: PipelineStageId): PipelineStageDefinition {
  if (!Object.hasOwn(PIPELINE_STAGE_DEFINITIONS, stageId)) {
    throw new Error(`Unknown pipeline stage: ${String(stageId)}`);
  }
  return PIPELINE_STAGE_DEFINITIONS[stageId];
}
