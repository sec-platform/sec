import type { PassId, PipelineStageId } from './types.ts';

export interface PassDefinition {
  id: PassId;
  requires: PassId[];
  invalidates: PassId[];
}

export interface PipelineStageDefinition {
  id: PipelineStageId;
  primaryPass: PassId;
  ownedPasses: PassId[];
  requires: PassId[];
  invalidates: PassId[];
}

export const PASS_DEFINITIONS: Record<PassId, PassDefinition> = {
  parse: {
    id: 'parse',
    requires: [],
    invalidates: ['align', 'resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  align: {
    id: 'align',
    requires: ['parse'],
    invalidates: ['resolve', 'build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  resolve: {
    id: 'resolve',
    requires: ['align'],
    invalidates: ['build-ir', 'compose', 'verify', 'repair', 'lock', 'emit']
  },
  'build-ir': {
    id: 'build-ir',
    requires: ['resolve'],
    invalidates: ['compose', 'verify', 'repair', 'lock', 'emit']
  },
  compose: {
    id: 'compose',
    requires: ['build-ir'],
    invalidates: ['verify', 'repair', 'lock', 'emit']
  },
  verify: {
    id: 'verify',
    requires: ['compose'],
    invalidates: ['repair', 'lock', 'emit']
  },
  repair: {
    id: 'repair',
    requires: [],
    invalidates: ['verify', 'lock', 'emit']
  },
  lock: {
    id: 'lock',
    requires: ['verify'],
    invalidates: ['emit']
  },
  emit: {
    id: 'emit',
    requires: ['lock'],
    invalidates: []
  }
};

export const PIPELINE_STAGE_DEFINITIONS: Record<PipelineStageId, PipelineStageDefinition> = {
  resolve: {
    id: 'resolve',
    primaryPass: 'resolve',
    ownedPasses: ['parse', 'align', 'resolve'],
    requires: [],
    invalidates: PASS_DEFINITIONS.resolve.invalidates
  },
  semantic: {
    id: 'semantic',
    primaryPass: 'build-ir',
    ownedPasses: ['build-ir'],
    requires: PASS_DEFINITIONS['build-ir'].requires,
    invalidates: PASS_DEFINITIONS['build-ir'].invalidates
  },
  compose: {
    id: 'compose',
    primaryPass: 'compose',
    ownedPasses: ['compose'],
    requires: PASS_DEFINITIONS.compose.requires,
    invalidates: PASS_DEFINITIONS.compose.invalidates
  },
  verify: {
    id: 'verify',
    primaryPass: 'verify',
    ownedPasses: ['verify'],
    requires: PASS_DEFINITIONS.verify.requires,
    invalidates: PASS_DEFINITIONS.verify.invalidates
  },
  lock: {
    id: 'lock',
    primaryPass: 'lock',
    ownedPasses: ['lock'],
    requires: PASS_DEFINITIONS.lock.requires,
    invalidates: PASS_DEFINITIONS.lock.invalidates
  },
  emit: {
    id: 'emit',
    primaryPass: 'emit',
    ownedPasses: ['emit'],
    requires: PASS_DEFINITIONS.emit.requires,
    invalidates: PASS_DEFINITIONS.emit.invalidates
  }
};

export function getPipelineStageDefinition(stageId: PipelineStageId): PipelineStageDefinition {
  return PIPELINE_STAGE_DEFINITIONS[stageId];
}
