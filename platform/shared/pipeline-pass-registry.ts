import type { PassId, PipelineStageId } from './pipeline-types.ts';

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
    invalidates: ['align', 'resolve', 'compose', 'adapt', 'verify', 'repair', 'lock', 'emit']
  },
  align: {
    id: 'align',
    requires: ['parse'],
    invalidates: ['resolve', 'compose', 'adapt', 'verify', 'repair', 'lock', 'emit']
  },
  resolve: {
    id: 'resolve',
    requires: ['align'],
    invalidates: ['compose', 'adapt', 'verify', 'repair', 'lock', 'emit']
  },
  compose: {
    id: 'compose',
    requires: ['resolve'],
    invalidates: ['adapt', 'verify', 'repair', 'lock', 'emit']
  },
  adapt: {
    id: 'adapt',
    requires: ['compose'],
    invalidates: ['verify', 'repair', 'lock', 'emit']
  },
  verify: {
    id: 'verify',
    requires: ['adapt'],
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
  compose: {
    id: 'compose',
    primaryPass: 'compose',
    ownedPasses: ['compose'],
    requires: PASS_DEFINITIONS.compose.requires,
    invalidates: PASS_DEFINITIONS.compose.invalidates
  },
  adapt: {
    id: 'adapt',
    primaryPass: 'adapt',
    ownedPasses: ['adapt'],
    requires: PASS_DEFINITIONS.adapt.requires,
    invalidates: PASS_DEFINITIONS.adapt.invalidates
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
