import { PASS_INITIAL_STATES, type PassId } from '../contract/pass-status.ts';
import { PIPELINE_STAGE_OWNERSHIP, type PipelineStageId } from './stages.ts';

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

/** Compile data, not execution authority. Inputs remain untouched; all output
 * relations are snapshots. The built-in registry uses this same compiler. */
export function compilePipelineStageDefinitions(
  passes: Readonly<Record<PassId, PassDefinition>>,
  ownership: Readonly<Record<PipelineStageId, Readonly<{ primaryPass: PassId; ownedPasses?: readonly PassId[] }>>>
): Readonly<Record<PipelineStageId, PipelineStageDefinition>> {
  const exactIdentities = (actual: object, expected: object, label: string): void => {
    const keys = Object.keys(actual);
    const identities = Object.keys(expected);
    if (keys.length !== identities.length || keys.some((key) => !Object.hasOwn(expected, key))) {
      throw new Error(`Pipeline ${label} does not match its declared identity set`);
    }
  };
  exactIdentities(passes, PASS_INITIAL_STATES, 'passes');
  exactIdentities(ownership, PIPELINE_STAGE_OWNERSHIP, 'stages');
  for (const [id, pass] of Object.entries(passes)) {
    if (pass.id !== id) throw new Error(`Pipeline pass identity mismatch: ${id}`);
    for (const relation of [pass.requires, pass.invalidates]) {
      if (!Array.isArray(relation) || new Set(relation).size !== relation.length) {
        throw new Error(`Pipeline pass ${id} contains an invalid or duplicate relation`);
      }
      for (let index = 0; index < relation.length; index++) {
        const target = relation[index];
        if (!Object.hasOwn(relation, index) || typeof target !== 'string' || !Object.hasOwn(passes, target)) {
          throw new Error(`Pipeline pass ${id} references an unknown endpoint`);
        }
      }
    }
  }
  const owners = new Map<PassId, PipelineStageId>();
  const stageIds = Object.keys(ownership) as PipelineStageId[];
  const definitions = stageIds.map((id) => {
    const spec: Readonly<{ primaryPass: PassId; ownedPasses?: readonly PassId[] }> = ownership[id];
    const ownedPasses = Object.freeze([...(spec.ownedPasses ?? [spec.primaryPass])]);
    const owned = new Set(ownedPasses);
    if (ownedPasses.length === 0 || owned.size !== ownedPasses.length || !owned.has(spec.primaryPass)) {
      throw new Error(`Invalid pipeline ownership for stage ${id}`);
    }
    const completed = new Set<PassId>();
    const requires = new Set<PassId>();
    const invalidates = new Set<PassId>();
    for (const passId of ownedPasses) {
      if (owners.has(passId) || !Object.hasOwn(passes, passId)) {
        throw new Error(`Pipeline pass ${passId} has invalid or duplicate stage ownership`);
      }
      owners.set(passId, id);
      const pass = passes[passId];
      for (const dependency of pass.requires) {
        if (owned.has(dependency)) {
          if (!completed.has(dependency)) throw new Error(`Pipeline stage ${id} uses ${dependency} before its producer`);
        } else requires.add(dependency);
      }
      for (const invalidated of pass.invalidates) {
        if (owned.has(invalidated)) completed.delete(invalidated);
        else invalidates.add(invalidated);
      }
      completed.add(passId);
    }
    if (completed.size !== owned.size) {
      throw new Error(`Pipeline stage ${id} leaves an owned pass invalidated`);
    }
    return [id, Object.freeze({ id, primaryPass: spec.primaryPass, ownedPasses,
      requires: Object.freeze([...requires]), invalidates: Object.freeze([...invalidates]) })] as const;
  });
  return Object.freeze(Object.fromEntries(definitions) as Record<PipelineStageId, PipelineStageDefinition>);
}

/** The stage kernel and completion proof consume these same compiled relations. */
export const PIPELINE_STAGE_DEFINITIONS = compilePipelineStageDefinitions(PASS_DEFINITIONS, PIPELINE_STAGE_OWNERSHIP);

export function getPipelineStageDefinition(stageId: PipelineStageId): PipelineStageDefinition {
  if (!Object.hasOwn(PIPELINE_STAGE_DEFINITIONS, stageId)) {
    throw new Error(`Unknown pipeline stage: ${String(stageId)}`);
  }
  return PIPELINE_STAGE_DEFINITIONS[stageId];
}
