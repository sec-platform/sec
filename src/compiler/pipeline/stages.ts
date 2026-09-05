export const PIPELINE_STAGE_IDS = Object.freeze([
  'resolve',
  'semantic',
  'compose',
  'verify',
  'lock',
  'emit'
] as const);

export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number];
export const PIPELINE_VERIFY_STAGE_IDS = Object.freeze(
  PIPELINE_STAGE_IDS.slice(0, PIPELINE_STAGE_IDS.indexOf('verify') + 1)
) as readonly PipelineStageId[];
