import { CompilerError } from '../errors.ts';
import { isVerificationLane, VERIFICATION_LANES, type VerificationLane } from '../../verification/contract/lanes.ts';
import type { PipelineSource } from './journal-types.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from './stages.ts';

export interface PipelineCompileRequest {
  source?: PipelineSource;
  from?: PipelineStageId;
  through?: PipelineStageId;
  verificationLane?: VerificationLane;
}

export const PIPELINE_DEFAULT_VERIFICATION_LANE = 'all' as const;

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
 * verification lane is not read; source validity remains owned by the journal. */
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
  const source = input.source ?? 'api';
  return Object.freeze({ ...selection, source, verificationLane });
}
