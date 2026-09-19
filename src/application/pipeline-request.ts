import { isVerificationLane, VERIFICATION_LANES, type VerificationLane } from '../assurance/verification/contract/lanes.ts';
import { CompilerError } from '../compiler/errors.ts';
import { requirePipelineSource, type PipelineSource } from '../compiler/pipeline/source.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../compiler/pipeline/stages.ts';

export interface PipelineCompileRequest {
  source?: PipelineSource;
  from?: PipelineStageId;
  through?: PipelineStageId;
  verificationLane?: VerificationLane;
}

export const PIPELINE_DEFAULT_VERIFICATION_LANE = 'all' as const;

export const PIPELINE_VERIFICATION_LANE_OPTION = Object.freeze({
  name: 'lane',
  flags: '--lane <lane>',
  description: 'Verification lane'
} as const);

const PIPELINE_VERIFICATION_LANE_DESCRIPTION = VERIFICATION_LANES.map((lane, index) =>
  index === VERIFICATION_LANES.length - 1 ? `or ${lane}` : lane
).join(', ');

export function rejectPipelineOutputIssue(message: string): never {
  throw new CompilerError('PIPELINE-USAGE-003', message);
}

export function bindPipelineCliInvocation(input: Readonly<{
  from?: unknown;
  through?: unknown;
  verificationLane?: unknown;
}>) {
  const selection = selectPipelineStageRange(input.from, input.through);
  const configured = input.verificationLane;
  if (!isVerificationLane(configured)) {
    throw new CompilerError('PIPELINE-USAGE-002', `--lane must be ${PIPELINE_VERIFICATION_LANE_DESCRIPTION}`);
  }
  return Object.freeze({
    source: 'cli' as const,
    ...(selection.from === undefined ? {} : { from: selection.from }),
    ...(selection.through === undefined ? {} : { through: selection.through }),
    verificationLane: configured
  });
}

function stage(value: unknown, field: 'from' | 'through'): PipelineStageId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !PIPELINE_STAGE_IDS.includes(value as PipelineStageId)) {
    throw new CompilerError('PIPELINE-USAGE-001', `--${field} must be one of: ${PIPELINE_STAGE_IDS.join(', ')}`);
  }
  return value as PipelineStageId;
}

/** Decode the same stage semantics for CLI and API, including the existing
 * semantic prelude for a range that starts after semantic compilation. */
export function selectPipelineStageRange(fromValue: unknown, throughValue: unknown) {
  const from = stage(fromValue, 'from');
  const through = stage(throughValue, 'through');
  const fromIndex = from === undefined ? 0 : PIPELINE_STAGE_IDS.indexOf(from);
  const throughIndex = through === undefined ? PIPELINE_STAGE_IDS.length - 1 : PIPELINE_STAGE_IDS.indexOf(through);
  if (fromIndex > throughIndex) {
    throw new CompilerError('PIPELINE-USAGE-001', `Invalid pipeline stage range: ${from} -> ${through}`);
  }
  const selected = PIPELINE_STAGE_IDS.slice(fromIndex, throughIndex + 1);
  const stages: readonly PipelineStageId[] = Object.freeze(
    fromIndex > PIPELINE_STAGE_IDS.indexOf('semantic') ? ['semantic', ...selected] : selected
  );
  return Object.freeze({ from, through, stages });
}

/** Capture request decisions, not the operation's live capabilities. An unused
 * verification lane is not read; source values share the journal contract. */
export function bindPipelineCompileRequest(input: Readonly<PipelineCompileRequest>) {
  const { from, through } = input;
  const selection = selectPipelineStageRange(from, through);
  let verificationLane: VerificationLane = PIPELINE_DEFAULT_VERIFICATION_LANE;
  if (selection.stages.includes('verify')) {
    const configured = input.verificationLane;
    if (configured !== undefined) {
      if (!isVerificationLane(configured)) {
        throw new CompilerError('PIPELINE-USAGE-002', `--lane must be one of: ${VERIFICATION_LANES.join(', ')}`);
      }
      verificationLane = configured;
    }
  }
  const requestedSource = input.source;
  const source = requirePipelineSource(requestedSource === undefined ? 'api' : requestedSource);
  return Object.freeze({ ...selection, source, verificationLane });
}


/** Preserve admitted stage ordering while rejecting holes, accessors, duplicates
 * and unknown stage identities before any transaction capability is acquired. */
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
    const candidate: unknown = slot && 'value' in slot ? slot.value : undefined;
    if (typeof candidate !== 'string' ||
        !PIPELINE_STAGE_IDS.includes(candidate as PipelineStageId) ||
        seen.has(candidate as PipelineStageId)) {
      throw new CompilerError(
        'PIPELINE-USAGE-001',
        'Pipeline stages must be dense, known and unique'
      );
    }
    result.push(candidate as PipelineStageId);
    seen.add(candidate as PipelineStageId);
  }
  return Object.freeze(result);
}
